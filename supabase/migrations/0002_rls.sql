-- Facility Fix — row level security
--
-- Supabase hands the browser a direct Postgres connection through the anon
-- key, so hiding a button in the UI protects nothing. Everything below is the
-- actual access control. See docs/03-security.md.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- `security definer` so this can read profiles without tripping the profiles
-- policies (which would call this function again — infinite recursion).
-- `set search_path` is mandatory on any security definer function: without it
-- a caller can point `public` at their own schema and hijack the lookup.
create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke execute on function public.auth_role() from public;
grant execute on function public.auth_role() to authenticated;

-- Answers "may this facility draft still be edited?" without the caller
-- needing select rights on submissions.
create or replace function public.facility_is_revisable(fid bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.submissions
    where facility_id = fid and status = 'rejected'
  );
$$;

revoke execute on function public.facility_is_revisable(bigint) from public;
grant execute on function public.facility_is_revisable(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.auth_role() = 'admin');

-- Users may fix their own name and unit. The role check pins `role` to its
-- current value — without it, a requester promotes themselves to approver
-- with a single client-side call.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.auth_role()
  );

-- No insert policy: profiles are created by the on_auth_user_created trigger.
-- No delete policy: profiles die with their auth.users row.

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------

alter table public.facilities enable row level security;

create policy facilities_select on public.facilities
  for select to authenticated
  using (
    is_active
    or created_by = auth.uid()
    or public.auth_role() in ('reviewer','approver','admin')
  );

-- `not is_active` is the important half: it stops a requester from writing a
-- row straight into the published master, bypassing the whole approval flow.
create policy facilities_insert on public.facilities
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.auth_role() in ('requester','admin')
    and not is_active
  );

-- Editable only while the matching submission sits in `rejected`. Once it is
-- queued for review the data freezes — a reviewer should not be judging a
-- moving target. `with check (not is_active)` blocks self-publishing.
create policy facilities_update_owner on public.facilities
  for update to authenticated
  using (
    created_by = auth.uid()
    and not is_active
    and public.facility_is_revisable(id)
  )
  with check (
    created_by = auth.uid()
    and not is_active
  );

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------

alter table public.submissions enable row level security;

create policy submissions_select on public.submissions
  for select to authenticated
  using (
    submitted_by = auth.uid()
    or public.auth_role() in ('reviewer','approver','admin')
  );

create policy submissions_insert on public.submissions
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.auth_role() in ('requester','admin')
    and status = 'pending_review'
    and deadline >= current_date
  );

-- Both clauses pin `status = 'rejected'`, so the owner can fix the content but
-- cannot walk their own submission forward. Resubmission goes through a
-- Server Action using the service role.
create policy submissions_update_owner on public.submissions
  for update to authenticated
  using (submitted_by = auth.uid() and status = 'rejected')
  with check (submitted_by = auth.uid() and status = 'rejected');

-- ---------------------------------------------------------------------------
-- submission_actions
-- ---------------------------------------------------------------------------

alter table public.submission_actions enable row level security;

create policy submission_actions_select on public.submission_actions
  for select to authenticated
  using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_actions.submission_id
        and (s.submitted_by = auth.uid() or public.auth_role() in ('reviewer','approver','admin'))
    )
  );

-- Intentionally no insert/update/delete policy for clients. The audit trail is
-- written only by Server Actions holding the service-role key.
