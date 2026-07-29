import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import type { Client } from "pg";

import { connect, purgeUsers } from "./db.ts";

/**
 * Two reviewers pressing Approve at the same moment.
 *
 * This is the one test that cannot hide inside a rolled-back transaction:
 * proving the second decision is refused requires the first one to actually
 * commit. So it writes real rows and cleans up afterwards in `after`.
 *
 * Run with: npm run test:db
 */

let ctl: Client;
let a: Client;
let b: Client;

const USER = {
  requester: "cccccccc-1111-4111-8111-cccccccccccc",
  reviewerA: "cccccccc-2222-4222-8222-cccccccccccc",
  reviewerB: "cccccccc-3333-4333-8333-cccccccccccc",
};

let submissionId = 0;

before(async () => {
  ctl = await connect();
  a = await connect();
  b = await connect();

  // Committed on purpose — the racing connections have to be able to see it.
  await purgeUsers(ctl, Object.values(USER));

  for (const [id, role] of [
    [USER.requester, "requester"],
    [USER.reviewerA, "reviewer"],
    [USER.reviewerB, "reviewer"],
  ] as const) {
    await ctl.query(
      `insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '{}'::jsonb, now(), now())`,
      // These UUIDs share their first block, so the email has to come from a
      // segment that actually differs between them.
      [id, `race-${id.slice(9, 13)}@test.local`]
    );
    await ctl.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
  }

  const f = await ctl.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('RACE-001', 'AC Race', 'AC', 'Gedung D', 'baik', true, $1) returning id`,
    [USER.requester]
  );

  const s = await ctl.query(
    `select public.create_damage_submission($1, $2, 'Race', 'x', 'ringan', current_date + 7) as id`,
    [USER.requester, f.rows[0].id]
  );
  submissionId = s.rows[0].id;
});

after(async () => {
  if (ctl) await purgeUsers(ctl, Object.values(USER));
  await Promise.all([a?.end(), b?.end(), ctl?.end()]);
});

test("two simultaneous approvals: the second one is refused", async () => {
  await a.query("begin");
  await b.query("begin");

  // A takes the row lock inside review_submission and holds it, uncommitted.
  const first = await a.query(
    `select public.review_submission($1, $2, 'approve', null) as status`,
    [submissionId, USER.reviewerA]
  );
  assert.equal(first.rows[0].status, "pending_approval");

  // B enters the same function and blocks on `for update`. Not awaited yet —
  // that is the whole point: it cannot finish until A commits or aborts.
  const secondPromise = b
    .query(`select public.review_submission($1, $2, 'approve', null) as status`, [
      submissionId,
      USER.reviewerB,
    ])
    .then(
      (res) => ({ ok: true as const, status: res.rows[0].status }),
      (err: Error) => ({ ok: false as const, message: err.message })
    );

  // Give B time to actually reach the lock rather than the function entry.
  await delay(300);

  await a.query("commit");

  const second = await secondPromise;
  await b.query("rollback");

  assert.equal(
    second.ok,
    false,
    `second approval succeeded with status ${"status" in second ? second.status : ""}`
  );
  assert.match(
    "message" in second ? second.message : "",
    /may not act on a submission with status/,
    "second approval failed for the wrong reason"
  );
});

test("only one decision was recorded", async () => {
  const { rows } = await ctl.query(
    `select action, count(*)::int n from public.submission_actions
     where submission_id = $1 group by action order by action`,
    [submissionId]
  );

  const byAction = Object.fromEntries(rows.map((r) => [r.action, r.n]));
  assert.equal(byAction.approve, 1, "the audit trail recorded a duplicate approval");
  assert.equal(byAction.submit, 1);

  const s = await ctl.query(`select status from public.submissions where id = $1`, [
    submissionId,
  ]);
  assert.equal(s.rows[0].status, "pending_approval", "status advanced twice");
});
