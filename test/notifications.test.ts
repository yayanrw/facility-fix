import assert from "node:assert/strict";
import { test } from "node:test";

import { isAuthorizedCron } from "../lib/cron-auth.ts";
import {
  addDays,
  bodyFor,
  daysLabel,
  stalledRoles,
  subjectFor,
  type CronSubmission,
} from "../lib/notification-content.ts";

const sub: CronSubmission = {
  id: 45,
  type: "damage",
  title: "AC mati",
  status: "pending_review",
  deadline: "2026-08-04",
  facility: { code: "AC-GD1-201-U1", name: "AC Ruang 201", location: "Gedung 1" },
  submitter: { id: "u1", name: "Budi", email: "budi@test.local" },
};

test("stalledRoles points at whoever is holding the submission up", () => {
  assert.deepEqual(stalledRoles("pending_review"), ["reviewer"]);
  assert.deepEqual(stalledRoles("pending_approval"), ["approver"]);
  assert.deepEqual(stalledRoles("rejected"), []);
  assert.deepEqual(stalledRoles("approved"), []);
});

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-07-30", 3), "2026-08-02");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("daysLabel distinguishes upcoming from overdue", () => {
  assert.equal(daysLabel(3), "3 hari lagi");
  assert.equal(daysLabel(0), "0 hari lagi");
  assert.equal(daysLabel(-2), "terlambat 2 hari");
});

test("subjectFor formats reminder and overdue subjects", () => {
  assert.equal(subjectFor("reminder", sub, 3), "[H-3] AC mati — deadline 2026-08-04");
  assert.equal(subjectFor("overdue", sub, -2), "[TERLAMBAT] AC mati — lewat 2 hari");
});

test("bodyFor includes facility, status, and a link back to the submission", () => {
  const body = bodyFor(sub, "Budi", 3, "https://ff.example.com");
  assert.match(body, /Halo Budi,/);
  assert.match(body, /AC-GD1-201-U1 — AC Ruang 201 \(Gedung 1\)/);
  assert.match(body, /Menunggu Review/);
  assert.match(body, /3 hari lagi/);
  assert.match(body, /https:\/\/ff\.example\.com\/submissions\/45/);
});

test("isAuthorizedCron requires the exact bearer secret", () => {
  assert.equal(isAuthorizedCron("Bearer s3cr3t", "s3cr3t"), true);
  assert.equal(isAuthorizedCron(null, "s3cr3t"), false);
  assert.equal(isAuthorizedCron("Bearer wrong", "s3cr3t"), false);
  assert.equal(isAuthorizedCron("Bearer s3cr3t", undefined), false);
  assert.equal(isAuthorizedCron("s3cr3t", "s3cr3t"), false, "missing Bearer prefix");
});
