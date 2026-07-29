import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Client } from "pg";

import { actAs, actAsOwner, connect, denied, scoped } from "./db.ts";

/**
 * Exercises the schema guards and RLS policies against the real database.
 *
 * Run with: npm run test:db
 *
 * Everything happens inside a single transaction that is rolled back in
 * `after`, so the live project is untouched when this finishes.
 */

let db: Client;

const USER = {
  requesterA: "11111111-1111-4111-8111-111111111111",
  requesterB: "22222222-2222-4222-8222-222222222222",
  reviewer: "33333333-3333-4333-8333-333333333333",
  approver: "44444444-4444-4444-8444-444444444444",
  admin: "55555555-5555-4555-8555-555555555555",
};

/**
 * Signs up asking for `role: 'admin'` in metadata and is never promoted, so
 * whatever role their profile ends up with is entirely the trigger's doing.
 */
const IMPOSTOR = "66666666-6666-4666-8666-666666666666";

/** Facility + submission ids created in `before`, reused across tests. */
const fx = {
  publishedFacility: 0,
  draftFacilityA: 0,
  pendingSubmission: 0,
  rejectedSubmission: 0,
  rejectedDraftFacility: 0,
};

async function createUser(id: string, email: string, meta: object = {}) {
  await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())`,
    [id, email, JSON.stringify(meta)]
  );
}

before(async () => {
  db = await connect();
  await db.query("begin");

  // The signup trigger fires on these inserts and creates the profiles.
  await createUser(USER.requesterA, "req-a@test.local", { name: "Requester A" });
  await createUser(USER.requesterB, "req-b@test.local", { name: "Requester B" });
  await createUser(USER.reviewer, "reviewer@test.local", { name: "Reviewer" });
  await createUser(USER.approver, "approver@test.local", { name: "Approver" });
  await createUser(USER.admin, "admin@test.local", { name: "Admin" });
  await createUser(IMPOSTOR, "impostor@test.local", {
    name: "Impostor",
    role: "admin",
    unit: "Gedung A",
  });

  // Roles are assigned out of band, as the real app does through an admin.
  await db.query(`update public.profiles set role = 'reviewer' where id = $1`, [
    USER.reviewer,
  ]);
  await db.query(`update public.profiles set role = 'approver' where id = $1`, [
    USER.approver,
  ]);
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [
    USER.admin,
  ]);

  const pub = await db.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('AC-TEST-001', 'AC Ruang Rapat', 'AC', 'Gedung A / R.201', 'baik', true, $1)
     returning id`,
    [USER.admin]
  );
  fx.publishedFacility = pub.rows[0].id;

  const draft = await db.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('AC-TEST-002', 'AC Lobi', 'AC', 'Gedung A / Lobi', 'baik', false, $1)
     returning id`,
    [USER.requesterA]
  );
  fx.draftFacilityA = draft.rows[0].id;

  const pending = await db.query(
    `insert into public.submissions (type, title, description, facility_id, severity, deadline, submitted_by)
     values ('damage', 'AC tidak dingin', 'Sudah 3 hari', $1, 'sedang', current_date + 7, $2)
     returning id`,
    [fx.publishedFacility, USER.requesterA]
  );
  fx.pendingSubmission = pending.rows[0].id;

  const rejFac = await db.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('AC-TEST-003', 'AC Gudang', 'AC', 'Gedung B / Gudang', 'baik', false, $1)
     returning id`,
    [USER.requesterA]
  );
  fx.rejectedDraftFacility = rejFac.rows[0].id;

  const rejected = await db.query(
    `insert into public.submissions (type, title, description, facility_id, deadline, status, submitted_by)
     values ('asset', 'Pendataan AC Gudang', 'Aset baru', $1, current_date + 7, 'rejected', $2)
     returning id`,
    [fx.rejectedDraftFacility, USER.requesterA]
  );
  fx.rejectedSubmission = rejected.rows[0].id;
});

after(async () => {
  if (db) {
    await db.query("rollback");
    await db.end();
  }
});

// ---------------------------------------------------------------------------

describe("signup trigger", () => {
  test("creates a profile for every auth user", async () => {
    await actAsOwner(db);
    const { rows } = await db.query(
      `select id, name, role from public.profiles where id = $1`,
      [USER.requesterA]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Requester A");
    assert.equal(rows[0].role, "requester");
  });

  test("ignores a role smuggled in through signup metadata", async () => {
    await actAsOwner(db);
    // `supabase.auth.signUp({ options: { data: { role: 'admin' } } })` is a
    // plain client call, so raw_user_meta_data is attacker-controlled.
    const { rows } = await db.query(
      `select role, unit from public.profiles where id = $1`,
      [IMPOSTOR]
    );
    assert.equal(rows[0].role, "requester", "signup metadata set the role");
    // `unit` is harmless and IS taken from metadata — proving the trigger read
    // the object rather than ignoring it wholesale.
    assert.equal(rows[0].unit, "Gedung A");
  });
});

describe("schema guards", () => {
  test("deadline cannot be changed after submit", async () => {
    await actAsOwner(db);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.submissions set deadline = current_date + 30 where id = $1`, [
          fx.pendingSubmission,
        ])
      )
    );
    assert.equal(res.ok, true, "deadline was mutable");
  });

  test("type, submitter, and facility are immutable", async () => {
    await actAsOwner(db);
    for (const sql of [
      `update public.submissions set type = 'asset' where id = $1`,
      `update public.submissions set submitted_by = '${USER.requesterB}' where id = $1`,
      `update public.submissions set facility_id = ${"$2"} where id = $1`,
    ]) {
      const res = await scoped(db, () =>
        denied(db, () =>
          db.query(
            sql,
            sql.includes("$2")
              ? [fx.pendingSubmission, fx.draftFacilityA]
              : [fx.pendingSubmission]
          )
        )
      );
      assert.equal(res.ok, true, `mutable: ${sql}`);
    }
  });

  test("status may still move forward", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const r = await db.query(
        `update public.submissions set status = 'pending_approval' where id = $1`,
        [fx.pendingSubmission]
      );
      assert.equal(r.rowCount, 1);
    });
  });

  test("damage requires a severity, asset forbids one", async () => {
    await actAsOwner(db);
    const noSeverity = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, deadline, submitted_by)
           values ('damage', 'x', 'y', $1, current_date + 7, $2)`,
          [fx.publishedFacility, USER.requesterA]
        )
      )
    );
    assert.equal(noSeverity.ok, true, "damage accepted without severity");

    const assetSeverity = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, severity, deadline, submitted_by)
           values ('asset', 'x', 'y', $1, 'berat', current_date + 7, $2)`,
          [fx.draftFacilityA, USER.requesterA]
        )
      )
    );
    assert.equal(assetSeverity.ok, true, "asset accepted a severity");
  });

  test("damage must target a published facility", async () => {
    await actAsOwner(db);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, severity, deadline, submitted_by)
           values ('damage', 'x', 'y', $1, 'ringan', current_date + 7, $2)`,
          [fx.draftFacilityA, USER.requesterA]
        )
      )
    );
    assert.equal(res.ok, true, "damage report accepted an unpublished facility");
  });

  test("asset must target the submitter's own unpublished draft", async () => {
    await actAsOwner(db);

    const published = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, deadline, submitted_by)
           values ('asset', 'x', 'y', $1, current_date + 7, $2)`,
          [fx.publishedFacility, USER.requesterA]
        )
      )
    );
    assert.equal(published.ok, true, "asset submission accepted a published facility");

    const someoneElses = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, deadline, submitted_by)
           values ('asset', 'x', 'y', $1, current_date + 7, $2)`,
          [fx.draftFacilityA, USER.requesterB]
        )
      )
    );
    assert.equal(someoneElses.ok, true, "asset submission accepted another user's draft");
  });

  test("quantity must be positive", async () => {
    await actAsOwner(db);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.facilities (code, name, category, location, condition, quantity, created_by)
           values ('X-1', 'x', 'c', 'l', 'baik', 0, $1)`,
          [USER.requesterA]
        )
      )
    );
    assert.equal(res.ok, true, "zero quantity accepted");
  });

  test("a rejection without remarks is refused", async () => {
    await actAsOwner(db);
    for (const remarks of [null, "", "<p><br></p>", "<p></p>"]) {
      const res = await scoped(db, () =>
        denied(db, () =>
          db.query(
            `insert into public.submission_actions (submission_id, actor_id, actor_role, action, remarks_html)
             values ($1, $2, 'reviewer', 'reject', $3)`,
            [fx.pendingSubmission, USER.reviewer, remarks]
          )
        )
      );
      assert.equal(res.ok, true, `empty rejection accepted: ${JSON.stringify(remarks)}`);
    }
  });

  test("a rejection with real remarks is accepted", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const r = await db.query(
        `insert into public.submission_actions (submission_id, actor_id, actor_role, action, remarks_html)
         values ($1, $2, 'reviewer', 'reject', '<p>Foto kurang jelas</p>')`,
        [fx.pendingSubmission, USER.reviewer]
      );
      assert.equal(r.rowCount, 1);
    });
  });

  test("the audit trail is append-only, even for the table owner", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const ins = await db.query(
        `insert into public.submission_actions (submission_id, actor_id, actor_role, action, remarks_html)
         values ($1, $2, 'requester', 'submit', null) returning id`,
        [fx.pendingSubmission, USER.requesterA]
      );
      const id = ins.rows[0].id;

      const upd = await denied(db, () =>
        db.query(`update public.submission_actions set remarks_html = '<p>edited</p>' where id = $1`, [id])
      );
      assert.equal(upd.ok, true, "audit row was editable");

      const del = await denied(db, () =>
        db.query(`delete from public.submission_actions where id = $1`, [id])
      );
      assert.equal(del.ok, true, "audit row was deletable");
    });
  });
});

describe("RLS — profiles", () => {
  test("a requester cannot promote themselves", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.profiles set role = 'approver' where id = $1`, [
          USER.requesterA,
        ])
      )
    );
    assert.equal(res.ok, true, "self-promotion succeeded");
  });

  test("a requester can still fix their own name", async () => {
    await actAs(db, USER.requesterA);
    await scoped(db, async () => {
      const r = await db.query(
        `update public.profiles set name = 'Nama Baru' where id = $1`,
        [USER.requesterA]
      );
      assert.equal(r.rowCount, 1);
    });
  });

  test("a requester cannot read another user's profile", async () => {
    await actAs(db, USER.requesterA);
    const { rows } = await db.query(`select id from public.profiles where id = $1`, [
      USER.requesterB,
    ]);
    assert.equal(rows.length, 0);
  });

  test("an admin can read every profile", async () => {
    await actAs(db, USER.admin);
    const { rows } = await db.query(`select id from public.profiles`);
    assert.ok(rows.length >= 5, `admin saw only ${rows.length} profiles`);
  });
});

describe("RLS — facilities", () => {
  test("a requester cannot insert straight into the published master", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
           values ('SELF-PUB-1', 'x', 'c', 'l', 'baik', true, $1)`,
          [USER.requesterA]
        )
      )
    );
    assert.equal(res.ok, true, "requester published a facility directly");
  });

  test("a requester cannot publish their own draft", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.facilities set is_active = true where id = $1`, [
          fx.rejectedDraftFacility,
        ])
      )
    );
    assert.equal(res.ok, true, "requester self-published");
  });

  test("a draft is editable only while its submission is rejected", async () => {
    await actAs(db, USER.requesterA);

    // draftFacilityA has no rejected submission attached.
    const locked = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.facilities set name = 'Ubah' where id = $1`, [
          fx.draftFacilityA,
        ])
      )
    );
    assert.equal(locked.ok, true, "draft was editable outside a rejection");

    await scoped(db, async () => {
      const r = await db.query(
        `update public.facilities set name = 'AC Gudang (revisi)' where id = $1`,
        [fx.rejectedDraftFacility]
      );
      assert.equal(r.rowCount, 1, "rejected draft was not editable");
    });
  });

  test("a requester cannot insert a facility owned by someone else", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.facilities (code, name, category, location, condition, created_by)
           values ('IMPERSONATE-1', 'x', 'c', 'l', 'baik', $1)`,
          [USER.requesterB]
        )
      )
    );
    assert.equal(res.ok, true, "requester forged created_by");
  });

  test("published facilities are visible to everyone", async () => {
    for (const id of Object.values(USER)) {
      await actAs(db, id);
      const { rows } = await db.query(`select id from public.facilities where id = $1`, [
        fx.publishedFacility,
      ]);
      assert.equal(rows.length, 1, `user ${id} could not see the published facility`);
    }
  });

  test("another requester's draft stays hidden", async () => {
    await actAs(db, USER.requesterB);
    const { rows } = await db.query(`select id from public.facilities where id = $1`, [
      fx.draftFacilityA,
    ]);
    assert.equal(rows.length, 0);
  });

  test("a reviewer can see unpublished drafts", async () => {
    await actAs(db, USER.reviewer);
    const { rows } = await db.query(`select id from public.facilities where id = $1`, [
      fx.draftFacilityA,
    ]);
    assert.equal(rows.length, 1);
  });
});

describe("RLS — submissions", () => {
  test("a requester cannot submit as already approved", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, severity, deadline, status, submitted_by)
           values ('damage', 'x', 'y', $1, 'ringan', current_date + 7, 'approved', $2)`,
          [fx.publishedFacility, USER.requesterA]
        )
      )
    );
    assert.equal(res.ok, true, "requester inserted an approved submission");
  });

  test("a deadline in the past is refused", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(
          `insert into public.submissions (type, title, description, facility_id, severity, deadline, submitted_by)
           values ('damage', 'x', 'y', $1, 'ringan', current_date - 1, $2)`,
          [fx.publishedFacility, USER.requesterA]
        )
      )
    );
    assert.equal(res.ok, true, "backdated deadline accepted");
  });

  test("a valid submission from a requester goes through", async () => {
    await actAs(db, USER.requesterA);
    await scoped(db, async () => {
      const r = await db.query(
        `insert into public.submissions (type, title, description, facility_id, severity, deadline, submitted_by)
         values ('damage', 'Lampu mati', 'Ruang 301', $1, 'ringan', current_date + 7, $2)`,
        [fx.publishedFacility, USER.requesterA]
      );
      assert.equal(r.rowCount, 1);
    });
  });

  test("a requester cannot approve their own submission", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.submissions set status = 'approved' where id = $1`, [
          fx.rejectedSubmission,
        ])
      )
    );
    assert.equal(res.ok, true, "requester approved their own submission");
  });

  test("a requester cannot resubmit by flipping the status themselves", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.submissions set status = 'pending_review' where id = $1`, [
          fx.rejectedSubmission,
        ])
      )
    );
    assert.equal(res.ok, true, "requester moved their own submission forward");
  });

  test("a requester can revise the content of a rejected submission", async () => {
    await actAs(db, USER.requesterA);
    await scoped(db, async () => {
      const r = await db.query(
        `update public.submissions set description = 'Deskripsi revisi' where id = $1`,
        [fx.rejectedSubmission]
      );
      assert.equal(r.rowCount, 1);
    });
  });

  test("a pending submission is frozen against its owner", async () => {
    await actAs(db, USER.requesterA);
    const res = await scoped(db, () =>
      denied(db, () =>
        db.query(`update public.submissions set description = 'diam-diam' where id = $1`, [
          fx.pendingSubmission,
        ])
      )
    );
    assert.equal(res.ok, true, "owner edited a submission already under review");
  });

  test("a requester cannot read another requester's submission", async () => {
    await actAs(db, USER.requesterB);
    const { rows } = await db.query(`select id from public.submissions where id = $1`, [
      fx.pendingSubmission,
    ]);
    assert.equal(rows.length, 0);
  });

  test("reviewers and approvers see the whole queue", async () => {
    for (const id of [USER.reviewer, USER.approver, USER.admin]) {
      await actAs(db, id);
      const { rows } = await db.query(`select id from public.submissions where id = $1`, [
        fx.pendingSubmission,
      ]);
      assert.equal(rows.length, 1, `user ${id} could not see the queue`);
    }
  });
});

describe("RLS — submission_actions", () => {
  test("no client may write to the audit trail", async () => {
    for (const [who, id] of Object.entries(USER)) {
      await actAs(db, id);
      const res = await scoped(db, () =>
        denied(db, () =>
          db.query(
            `insert into public.submission_actions (submission_id, actor_id, actor_role, action, remarks_html)
             values ($1, $2, 'reviewer', 'approve', '<p>ok</p>')`,
            [fx.pendingSubmission, id]
          )
        )
      );
      assert.equal(res.ok, true, `${who} wrote to the audit trail`);
    }
  });

  test("the owner and staff can read the trail; outsiders cannot", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      await db.query(
        `insert into public.submission_actions (submission_id, actor_id, actor_role, action)
         values ($1, $2, 'requester', 'submit')`,
        [fx.pendingSubmission, USER.requesterA]
      );

      await actAs(db, USER.requesterA);
      const owner = await db.query(
        `select id from public.submission_actions where submission_id = $1`,
        [fx.pendingSubmission]
      );
      assert.ok(owner.rows.length >= 1, "owner could not read their own trail");

      await actAs(db, USER.reviewer);
      const staff = await db.query(
        `select id from public.submission_actions where submission_id = $1`,
        [fx.pendingSubmission]
      );
      assert.ok(staff.rows.length >= 1, "reviewer could not read the trail");

      await actAs(db, USER.requesterB);
      const outsider = await db.query(
        `select id from public.submission_actions where submission_id = $1`,
        [fx.pendingSubmission]
      );
      assert.equal(outsider.rows.length, 0, "outsider read someone else's trail");
    });
  });
});
