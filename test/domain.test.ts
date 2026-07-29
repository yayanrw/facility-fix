import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canActOn,
  daysUntil,
  defaultDeadline,
  DEFAULT_DEADLINE_DAYS,
  nextStatus,
  ROLES,
  STATUSES,
  type Role,
  type Status,
} from "../lib/domain.ts";
import { isRemarksEmpty } from "../lib/html.ts";

test("daysUntil counts whole days, negative when overdue", () => {
  const today = new Date(2026, 6, 28);
  assert.equal(daysUntil("2026-07-28", today), 0);
  assert.equal(daysUntil("2026-07-31", today), 3);
  assert.equal(daysUntil("2026-07-27", today), -1);
  assert.equal(daysUntil("2026-08-04", today), 7);
});

test("daysUntil ignores time of day", () => {
  // Late-evening "today" must not round a same-day deadline down to -1.
  const lateToday = new Date(2026, 6, 28, 23, 59, 59);
  assert.equal(daysUntil("2026-07-28", lateToday), 0);
  assert.equal(daysUntil("2026-07-29", lateToday), 1);
});

test("daysUntil survives a DST boundary", () => {
  // Spans the US DST change; a naive ms/86400000 division yields 29.958 and
  // rounds to the wrong day count without the UTC normalisation.
  const today = new Date(2026, 2, 1);
  assert.equal(daysUntil("2026-03-31", today), 30);
});

test("defaultDeadline is today + 7", () => {
  const today = new Date(2026, 6, 28);
  assert.equal(defaultDeadline(today), "2026-08-04");
  assert.equal(daysUntil(defaultDeadline(today), today), DEFAULT_DEADLINE_DAYS);
});

test("defaultDeadline crosses month and year boundaries", () => {
  assert.equal(defaultDeadline(new Date(2026, 11, 28)), "2027-01-04");
  assert.equal(defaultDeadline(new Date(2028, 1, 25)), "2028-03-03"); // leap year
});

test("approve walks review -> approval -> approved", () => {
  assert.equal(nextStatus("pending_review", "approve"), "pending_approval");
  assert.equal(nextStatus("pending_approval", "approve"), "approved");
});

test("reject from either stage lands in a single rejected state", () => {
  assert.equal(nextStatus("pending_review", "reject"), "rejected");
  assert.equal(nextStatus("pending_approval", "reject"), "rejected");
});

test("only the stage owner and admin may act", () => {
  assert.equal(canActOn("reviewer", "pending_review"), true);
  assert.equal(canActOn("admin", "pending_review"), true);
  assert.equal(canActOn("approver", "pending_review"), false);
  assert.equal(canActOn("requester", "pending_review"), false);

  assert.equal(canActOn("approver", "pending_approval"), true);
  assert.equal(canActOn("admin", "pending_approval"), true);
  assert.equal(canActOn("reviewer", "pending_approval"), false);
});

test("terminal and rejected states accept no decisions from anyone", () => {
  for (const role of ROLES) {
    assert.equal(canActOn(role, "approved"), false, `${role} on approved`);
    assert.equal(canActOn(role, "rejected"), false, `${role} on rejected`);
  }
});

test("every role/status pair resolves without throwing", () => {
  for (const role of ROLES as readonly Role[]) {
    for (const status of STATUSES as readonly Status[]) {
      assert.equal(typeof canActOn(role, status), "boolean");
    }
  }
});

test("isRemarksEmpty rejects blank contenteditable output", () => {
  assert.equal(isRemarksEmpty(""), true);
  assert.equal(isRemarksEmpty(null), true);
  assert.equal(isRemarksEmpty(undefined), true);
  assert.equal(isRemarksEmpty("<p><br></p>"), true);
  assert.equal(isRemarksEmpty("<p>&nbsp;</p>"), true);
  assert.equal(isRemarksEmpty("   <div>  </div> "), true);
});

test("isRemarksEmpty accepts real content", () => {
  assert.equal(isRemarksEmpty("<p>Foto kurang jelas</p>"), false);
  assert.equal(isRemarksEmpty("<ul><li>Lengkapi kode aset</li></ul>"), false);
  assert.equal(isRemarksEmpty("teks polos"), false);
});
