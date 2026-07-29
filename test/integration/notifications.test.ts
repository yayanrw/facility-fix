import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Client } from "pg";

import { runDeadlineCron } from "../../lib/notifications.ts";
import { connect, purgeUsers } from "./db.ts";

/**
 * Exercises runDeadlineCron (lib/notifications.ts) against real committed
 * data: it goes through the Supabase service client over PostgREST, a
 * separate connection from the `pg` client the other integration tests use,
 * so rows must actually be committed to be visible — same reason
 * concurrency.test.ts cannot hide inside a rolled-back transaction.
 *
 * Run with: npm run test:db
 */

let ctl: Client;

const USER = {
  requester: "dddddddd-1111-4111-8111-dddddddddddd",
  reviewerA: "dddddddd-2222-4222-8222-dddddddddddd",
  reviewerB: "dddddddd-3333-4333-8333-dddddddddddd",
  approver: "dddddddd-4444-4444-8444-dddddddddddd",
};

const EMAIL = {
  requester: "notif-req@test.local",
  reviewerA: "notif-revA@test.local",
  reviewerB: "notif-revB@test.local",
  approver: "notif-app@test.local",
};

let facilityId = 0;
let todayDate: Date;

/**
 * runDeadlineCron operates on the whole submissions table, not just this
 * test's own rows — that is the real production query, not something a test
 * can narrow. So before touching anything, snapshot every row's stamps and
 * restore them all in `after`, for every id this test didn't create itself.
 * Without this, running this suite against a shared dev/seed database
 * silently marks real submissions as reminded/notified using a fake `send`
 * that never actually emailed anyone — exactly what happened the first time
 * this test ran here (see docs/05-roadmap.md step 7).
 */
let stampSnapshot: { id: number; reminder_sent_at: string | null; overdue_sent_at: string | null }[] = [];

let subDueSoonReview = 0; // pending_review, deadline = today -> reminder to submitter + both reviewers
let subDueSoonApproval = 0; // pending_approval, deadline = today+3 -> reminder to submitter + approver
let subOverdue = 0; // pending_review, deadline = today-2 -> overdue notice to submitter + both reviewers
let subApprovedOverdue = 0; // approved, deadline = today-5 -> terminal, no email
let subOutOfRange = 0; // pending_review, deadline = today+10 -> outside the H-3 window
let subAlreadyReminded = 0; // pending_review, deadline = today+1, reminder_sent_at pre-set -> skipped

type SentEmail = { to: string; subject: string; text: string };

async function createUser(client: Client, id: string, email: string, role: string) {
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '{}'::jsonb, now(), now())`,
    [id, email]
  );
  await client.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
}

async function newDamage(deadlineExpr: string): Promise<number> {
  const { rows } = await ctl.query(
    `select public.create_damage_submission($1, $2, 'Test notif', 'x', 'ringan', ${deadlineExpr}) as id`,
    [USER.requester, facilityId]
  );
  return rows[0].id;
}

before(async () => {
  ctl = await connect();

  // Committed on purpose — runDeadlineCron reads through PostgREST, a
  // separate connection that cannot see this client's uncommitted work.
  await purgeUsers(ctl, Object.values(USER));

  await createUser(ctl, USER.requester, EMAIL.requester, "requester");
  await createUser(ctl, USER.reviewerA, EMAIL.reviewerA, "reviewer");
  await createUser(ctl, USER.reviewerB, EMAIL.reviewerB, "reviewer");
  await createUser(ctl, USER.approver, EMAIL.approver, "approver");

  const f = await ctl.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('NOTIF-001', 'AC Notif', 'AC', 'Gedung N', 'baik', true, $1) returning id`,
    [USER.requester]
  );
  facilityId = f.rows[0].id;

  const today = await ctl.query(`select current_date::text as d`);
  todayDate = new Date(`${today.rows[0].d}T00:00:00`);

  const snap = await ctl.query(
    `select id, reminder_sent_at, overdue_sent_at from public.submissions`
  );
  stampSnapshot = snap.rows;

  subDueSoonReview = await newDamage("current_date");
  subOverdue = await newDamage("current_date - 2");
  subOutOfRange = await newDamage("current_date + 10");
  subAlreadyReminded = await newDamage("current_date + 1");
  await ctl.query(`update public.submissions set reminder_sent_at = now() where id = $1`, [
    subAlreadyReminded,
  ]);

  subDueSoonApproval = await newDamage("current_date + 3");
  await ctl.query(
    `select public.review_submission($1, $2, 'approve', null)`,
    [subDueSoonApproval, USER.reviewerA]
  );

  subApprovedOverdue = await newDamage("current_date - 5");
  await ctl.query(`select public.review_submission($1, $2, 'approve', null)`, [
    subApprovedOverdue,
    USER.reviewerA,
  ]);
  await ctl.query(`select public.review_submission($1, $2, 'approve', null)`, [
    subApprovedOverdue,
    USER.approver,
  ]);
});

after(async () => {
  if (ctl) {
    // Restore any real submission's stamps that runDeadlineCron touched
    // during this run — the fake `send` above never actually emailed them.
    const ownIds = new Set(
      [subDueSoonReview, subDueSoonApproval, subOverdue, subApprovedOverdue, subOutOfRange, subAlreadyReminded].filter(Boolean)
    );
    for (const row of stampSnapshot) {
      if (ownIds.has(row.id)) continue;
      await ctl.query(
        `update public.submissions set reminder_sent_at = $2, overdue_sent_at = $3 where id = $1`,
        [row.id, row.reminder_sent_at, row.overdue_sent_at]
      );
    }

    await purgeUsers(ctl, Object.values(USER));
    await ctl.end();
  }
});

function recipientsFor(log: SentEmail[], submissionId: number): Set<string> {
  return new Set(
    log.filter((e) => e.text.includes(`/submissions/${submissionId}`)).map((e) => e.to)
  );
}

/**
 * Asserts `expected` is a subset of `actual`, not equal to it.
 *
 * The reviewer/approver pool is real project data (rev@ff.test, app@ff.test,
 * plus whatever other integration tests have committed) — every reviewer
 * gets an email per docs/04-notifications.md, so the actual set legitimately
 * contains more than just this test's four accounts.
 */
function assertRecipients(actual: Set<string>, expected: string[], message: string): void {
  for (const email of expected) {
    assert.ok(actual.has(email), `${message}: missing ${email}`);
  }
}

test("first run: correct recipients per status, stamps set, approved and out-of-range skipped", async () => {
  const log: SentEmail[] = [];
  const send = async (to: string, subject: string, text: string) => {
    log.push({ to, subject, text });
  };

  const result = await runDeadlineCron(send, "https://ff.test", todayDate);
  // Only subDueSoonReview and subDueSoonApproval fall in the reminder window;
  // subOverdue's deadline is in the past, so it counts toward `overdue` instead.
  assert.ok(result.reminders >= 2, "expected at least the 2 due-soon test rows counted");
  assert.ok(result.overdue >= 1, "expected at least the 1 overdue test row counted");

  assertRecipients(
    recipientsFor(log, subDueSoonReview),
    [EMAIL.requester, EMAIL.reviewerA, EMAIL.reviewerB],
    "pending_review reminder should reach the submitter and every reviewer"
  );
  assert.equal(
    recipientsFor(log, subDueSoonApproval).has(EMAIL.reviewerA),
    false,
    "pending_review reminder leaked to an approver-only account"
  );

  assertRecipients(
    recipientsFor(log, subDueSoonApproval),
    [EMAIL.requester, EMAIL.approver],
    "pending_approval reminder should reach the submitter and every approver"
  );

  assertRecipients(
    recipientsFor(log, subOverdue),
    [EMAIL.requester, EMAIL.reviewerA, EMAIL.reviewerB],
    "overdue notice should reach the submitter and every reviewer"
  );

  const overdueSubject = log.find((e) => e.text.includes(`/submissions/${subOverdue}`))?.subject;
  assert.match(overdueSubject ?? "", /^\[TERLAMBAT\]/);

  assert.equal(recipientsFor(log, subApprovedOverdue).size, 0, "approved submission got an email");
  assert.equal(recipientsFor(log, subOutOfRange).size, 0, "out-of-window submission got an email");
  assert.equal(
    recipientsFor(log, subAlreadyReminded).size,
    0,
    "already-stamped submission was emailed again"
  );

  const stamps = await ctl.query(
    `select id, reminder_sent_at, overdue_sent_at from public.submissions where id = any($1)`,
    [[subDueSoonReview, subDueSoonApproval, subOverdue]]
  );
  for (const row of stamps.rows) {
    if (row.id === subOverdue) {
      assert.ok(row.overdue_sent_at, `submission ${row.id} missing overdue_sent_at`);
    } else {
      assert.ok(row.reminder_sent_at, `submission ${row.id} missing reminder_sent_at`);
    }
  }
});

test("second run sends nothing for submissions already stamped", async () => {
  const log: SentEmail[] = [];
  const send = async (to: string, subject: string, text: string) => {
    log.push({ to, subject, text });
  };

  await runDeadlineCron(send, "https://ff.test", todayDate);

  for (const id of [subDueSoonReview, subDueSoonApproval, subOverdue]) {
    assert.equal(recipientsFor(log, id).size, 0, `submission ${id} was emailed twice`);
  }
});
