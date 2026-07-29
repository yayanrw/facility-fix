# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Facility Fix — internal web app for facility damage reports and asset master data. Every submission flows **requester → reviewer → approver**, with rich-text remarks on each decision and email reminders as the deadline approaches.

`docs/` is the specification and is kept in sync with the code. Read the relevant page before changing behaviour:

| Doc | Covers |
|---|---|
| `docs/README.md` | Product summary, stack, shadcn/ui design-system rules |
| `docs/01-data-model.md` | Schema, why `facilities.is_active` replaces a staging table |
| `docs/02-workflow.md` | Status machine, deadline rules, role matrix |
| `docs/03-security.md` | RLS policies, RPC exposure, sanitisation |
| `docs/04-notifications.md` | Deadline cron (not built yet) |
| `docs/05-roadmap.md` | Step-by-step progress; steps 0–6 done, 7–8 remain |

`README.md` is untouched create-next-app boilerplate and carries no project information.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # domain + sanitisation units, no network
npm run test:db      # RLS, schema guards, workflow RPCs against real Postgres
```

Run a single test file, or one test by name:

```bash
node --test test/domain.test.ts
node --env-file=.env.local --test test/integration/workflow.test.ts
node --env-file=.env.local --test --test-name-pattern "simultaneous" test/integration/concurrency.test.ts
```

Point `--test-name-pattern` at **one integration file**, not the glob. Node still runs every file's `before` hook when tests are filtered out, and the resulting mix of long-lived transactions and extra connections hangs against the Supabase pooler.

Tests use Node's built-in runner with type stripping — no Jest, no Vitest. That is why `tsconfig.json` sets `allowImportingTsExtensions` and why test imports carry the `.ts` suffix.

### Database

The project is **not** `supabase link`ed; migrations go through the direct connection string:

```bash
DBURL=$(node -e 'const fs=require("fs");const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^"|"$/g,"")]}));const u=new URL(env.POSTGRES_URL_NON_POOLING);u.password=encodeURIComponent(decodeURIComponent(u.password));console.log(u.toString())')

supabase db push --db-url "$DBURL" --dry-run
supabase db push --db-url "$DBURL" --yes
supabase db advisors --db-url "$DBURL"      # must report zero results
```

Migrations are numbered `NNNN_name.sql` and applied in order. Env vars come from `vercel env pull`, never hand-written.

## Architecture

### RLS is the security boundary, not the UI

Supabase hands the browser a direct Postgres connection through the anon key. Hiding a button protects nothing — anyone can call `supabase.from('submissions').update(...)` from the console. Access control lives in RLS policies (`0002`, `0004`, `0006`) and in triggers.

Three Supabase clients, and picking the wrong one is the most likely mistake:

| Module | Key | Use for |
|---|---|---|
| `lib/supabase/server.ts` | anon | Default for Server Components and reads. RLS applies. |
| `lib/supabase/client.ts` | anon | Browser (photo upload only). RLS applies. |
| `lib/supabase/service.ts` | **service role** | Status transitions, audit writes, signed URLs. **Bypasses all RLS.** |

`lib/supabase/service.ts` and `lib/auth.ts` import `server-only`, so importing them from a Client Component is a build error rather than a leaked key.

Query helpers live in `lib/queries.ts` and deliberately do **not** re-implement role filtering — `submissions_select` already scopes a requester to their own rows and opens the queue to staff. Duplicating that in TypeScript creates a second source of truth that can disagree with the policy.

### Workflow transitions live in Postgres, not TypeScript

`supabase-js` has no transactions, and every transition writes two or three tables at once. `supabase/migrations/0005_workflow.sql` therefore holds `create_damage_submission`, `create_asset_submission`, `resubmit_submission`, and `review_submission`. One RPC call is one transaction.

Two rules that are easy to break:

- These functions are **`security invoker`**, with `execute` revoked from `public`/`anon`/`authenticated` and granted only to `service_role`. A `security definer` function in schema `public` is callable by anyone holding the anon key — the exact hole being avoided. `service_role` already bypasses RLS, so `definer` buys nothing.
- `review_submission` takes a row lock (`select … for update`) before reading the status. That is what makes two simultaneous approvals safe; `test/integration/concurrency.test.ts` proves it with two real connections.

Server Actions in `app/(app)/submissions/actions.ts` validate with zod, sanitise remarks, then call the RPC. They never trust status or ownership from the form.

### Rules that keep `supabase db advisors` clean

- Write `(select auth.uid())` and `(select public.auth_role())` in policies, never the bare call — otherwise it is re-evaluated once per row.
- Use `to authenticated` **plus** an ownership predicate. `auth.role() = 'authenticated'` is deprecated and silently passes anonymous users; `to authenticated` alone is authentication without authorization.
- Every function needs `set search_path = public`.
- Invariants that must also bind the service role go in **triggers**, not policy `with check` clauses: policies do not apply to `service_role`, and comparing NEW against the current row needs a same-table subquery that re-enters RLS.
- Never derive authorization from `raw_user_meta_data` — it is client-controlled. The signup trigger hard-codes `role = 'requester'` for this reason.
- Since 2026-05-30 new tables in `public` are no longer auto-exposed to the Data API. After adding a table, confirm `anon`/`authenticated` can reach it.

### Domain vocabulary has one home

`lib/domain.ts` mirrors the CHECK constraints in `0001_init.sql` — statuses, roles, types, severities, conditions, labels, `canActOn`, `nextStatus`, `daysUntil`. Changing a value there means changing the migration too.

Date helpers format from the local calendar (`toDateInput`), never `toISOString()`, which converts to UTC and returns yesterday anywhere east of Greenwich.

### Framework specifics

- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention; having both is a build error. It refreshes the Supabase session and gates unauthenticated traffic to `/login?next=…`.
- **shadcn/ui on Base UI ships no `form` component.** Use the `field` primitives (`Field`, `FieldLabel`, `FieldError`) with zod validation in the Server Action, surfaced through `useActionState`. react-hook-form is deliberately absent.
- `Button render={<Link/>}` needs `nativeButton={false}`, or Base UI logs an accessibility error.
- Routes live in the `app/(app)/` group so the nav bar sits in one layout; `/login` stays outside it.
- Storage objects are keyed `{auth.uid()}/{uuid}.{ext}` — by uploader, not by submission, because uploads happen before the submission row exists. That is also the only shape the storage policy can enforce.
- `react-simple-wysiwyg` injects its stylesheet at runtime, unlayered, so Tailwind utilities cannot reach it (layered always loses to unlayered, and it lands last anyway). Its theming is a plain CSS block in `app/globals.css` scoped under `.remarks-editor`.

### Test harness

`test/integration/db.ts` runs everything inside one transaction that is rolled back, so tests can create users and submissions against the live project without residue.

- `denied(client, fn)` treats **both** an error and a zero-row result as denial. RLS refuses `insert`/`update` with an error but filters `select` silently; a test that only catches exceptions would pass while data leaks.
- `denied` and `scoped` open their own savepoints — otherwise the first expected failure aborts the transaction and every later statement fails spuriously.
- `concurrency.test.ts` is the exception: proving the second approval is refused requires the first to commit, so it cleans up via `purgeUsers`. That helper bypasses the append-only trigger with `session_replication_role = replica` rather than `alter table … disable trigger` — the DDL form needs an ACCESS EXCLUSIVE lock that blocks behind the other files' open transactions.
- Remarks sanitisation is tested as a unit, not through the browser: if it regressed, an XSS payload would fire `alert()` and freeze the automation session.
