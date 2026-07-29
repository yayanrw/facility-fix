import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Client } from "pg";

import { actAs, actAsOwner, connect, denied, scoped } from "./db.ts";

/**
 * Exercises the workflow RPCs in supabase/migrations/0005_workflow.sql.
 *
 * Run with: npm run test:db
 */

let db: Client;

const USER = {
  requester: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  other: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa",
  reviewer: "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa",
  approver: "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa",
};

let publishedFacility = 0;

async function createUser(client: Client, id: string, email: string, role: string) {
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '{}'::jsonb, now(), now())`,
    [id, email]
  );
  await client.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
}

async function newDamage(client: Client, actor = USER.requester): Promise<number> {
  const { rows } = await client.query(
    `select public.create_damage_submission($1, $2, 'AC mati', 'Sudah 3 hari', 'sedang', current_date + 7) as id`,
    [actor, publishedFacility]
  );
  return rows[0].id;
}

before(async () => {
  db = await connect();
  await db.query("begin");

  await createUser(db, USER.requester, "wf-req@test.local", "requester");
  await createUser(db, USER.other, "wf-other@test.local", "requester");
  await createUser(db, USER.reviewer, "wf-rev@test.local", "reviewer");
  await createUser(db, USER.approver, "wf-app@test.local", "approver");

  const { rows } = await db.query(
    `insert into public.facilities (code, name, category, location, condition, is_active, created_by)
     values ('WF-TEST-001', 'AC Aula', 'AC', 'Gedung C / Aula', 'baik', true, $1)
     returning id`,
    [USER.requester]
  );
  publishedFacility = rows[0].id;
});

after(async () => {
  if (db) {
    await db.query("rollback");
    await db.end();
  }
});

// ---------------------------------------------------------------------------

describe("create_damage_submission", () => {
  test("creates the submission and its opening audit entry together", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);

      const s = await db.query(
        `select type, status, severity, deadline from public.submissions where id = $1`,
        [id]
      );
      assert.equal(s.rows[0].type, "damage");
      assert.equal(s.rows[0].status, "pending_review");
      assert.equal(s.rows[0].severity, "sedang");

      const a = await db.query(
        `select action, actor_role from public.submission_actions where submission_id = $1`,
        [id]
      );
      assert.equal(a.rows.length, 1);
      assert.equal(a.rows[0].action, "submit");
      assert.equal(a.rows[0].actor_role, "requester");
    });
  });

  test("a reviewer cannot file a submission", async () => {
    await actAsOwner(db);
    const res = await scoped(db, () => denied(db, () => newDamage(db, USER.reviewer)));
    assert.equal(res.ok, true, "reviewer created a submission");
  });
});

describe("create_asset_submission", () => {
  test("creates an unpublished facility plus its submission", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const { rows } = await db.query(
        `select public.create_asset_submission(
           $1, 'Pendataan proyektor', 'Aset baru', current_date + 7,
           'WF-PRJ-001', 'Proyektor Aula', 'Elektronik', 'Gedung C / Aula', 'baik', 2
         ) as id`,
        [USER.requester]
      );
      const id = rows[0].id;

      const s = await db.query(
        `select s.type, s.status, f.code, f.is_active, f.quantity
         from public.submissions s
         join public.facilities f on f.id = s.facility_id
         where s.id = $1`,
        [id]
      );
      assert.equal(s.rows[0].type, "asset");
      assert.equal(s.rows[0].code, "WF-PRJ-001");
      assert.equal(s.rows[0].is_active, false, "facility was published too early");
      assert.equal(s.rows[0].quantity, 2);
    });
  });

  test("a duplicate code leaves no orphan facility behind", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      // Scoped to this test's own user: the concurrency suite runs in a
      // parallel process and commits rows, so a global count would be flaky.
      const before = await db.query(
        `select count(*)::int n from public.facilities where created_by = $1`,
        [USER.requester]
      );

      const res = await denied(db, () =>
        db.query(
          `select public.create_asset_submission(
             $1, 'Duplikat', 'x', current_date + 7,
             'WF-TEST-001', 'Bentrok', 'AC', 'Gedung C', 'baik', 1
           )`,
          [USER.requester]
        )
      );
      assert.equal(res.ok, true, "duplicate code was accepted");

      const after_ = await db.query(
        `select count(*)::int n from public.facilities where created_by = $1`,
        [USER.requester]
      );
      assert.equal(
        after_.rows[0].n,
        before.rows[0].n,
        "a facility survived the failed submission"
      );
    });
  });
});

describe("review_submission", () => {
  test("reviewer approval moves the submission to the approver", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      const { rows } = await db.query(
        `select public.review_submission($1, $2, 'approve', null) as status`,
        [id, USER.reviewer]
      );
      assert.equal(rows[0].status, "pending_approval");
    });
  });

  test("approver approval is terminal and publishes an asset", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const created = await db.query(
        `select public.create_asset_submission(
           $1, 'Pendataan kursi', 'x', current_date + 7,
           'WF-KRS-001', 'Kursi Aula', 'Meubel', 'Gedung C / Aula', 'baik', 50
         ) as id`,
        [USER.requester]
      );
      const id = created.rows[0].id;

      await db.query(`select public.review_submission($1, $2, 'approve', null)`, [
        id,
        USER.reviewer,
      ]);
      const { rows } = await db.query(
        `select public.review_submission($1, $2, 'approve', null) as status`,
        [id, USER.approver]
      );
      assert.equal(rows[0].status, "approved");

      const f = await db.query(
        `select f.is_active from public.facilities f
         join public.submissions s on s.facility_id = f.id where s.id = $1`,
        [id]
      );
      assert.equal(f.rows[0].is_active, true, "asset was not published on approval");
    });
  });

  test("the approver cannot act while it is still with the reviewer", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      const res = await denied(db, () =>
        db.query(`select public.review_submission($1, $2, 'approve', null)`, [
          id,
          USER.approver,
        ])
      );
      assert.equal(res.ok, true, "approver skipped the review stage");
    });
  });

  test("the submitter cannot approve their own submission", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      const res = await denied(db, () =>
        db.query(`select public.review_submission($1, $2, 'approve', null)`, [
          id,
          USER.requester,
        ])
      );
      assert.equal(res.ok, true, "requester approved their own submission");
    });
  });

  test("a rejection with no reason is refused, including blank markup", async () => {
    await actAsOwner(db);
    for (const remarks of [null, "", "<p><br></p>", "<p>&nbsp;</p>"]) {
      await scoped(db, async () => {
        const id = await newDamage(db);
        const res = await denied(db, () =>
          db.query(`select public.review_submission($1, $2, 'reject', $3)`, [
            id,
            USER.reviewer,
            remarks,
          ])
        );
        assert.equal(
          res.ok,
          true,
          `blank rejection accepted: ${JSON.stringify(remarks)}`
        );
      });
    }
  });

  test("a rejection with a reason records the remarks", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      const { rows } = await db.query(
        `select public.review_submission($1, $2, 'reject', '<p>Foto kurang jelas</p>') as status`,
        [id, USER.reviewer]
      );
      assert.equal(rows[0].status, "rejected");

      const a = await db.query(
        `select action, remarks_html from public.submission_actions
         where submission_id = $1 order by id desc limit 1`,
        [id]
      );
      assert.equal(a.rows[0].action, "reject");
      assert.match(a.rows[0].remarks_html, /Foto kurang jelas/);
    });
  });

  test("an already-approved submission accepts no further decisions", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      await db.query(`select public.review_submission($1, $2, 'approve', null)`, [
        id,
        USER.reviewer,
      ]);
      await db.query(`select public.review_submission($1, $2, 'approve', null)`, [
        id,
        USER.approver,
      ]);

      const res = await denied(db, () =>
        db.query(`select public.review_submission($1, $2, 'approve', null)`, [
          id,
          USER.approver,
        ])
      );
      assert.equal(res.ok, true, "approved submission was re-decided");
    });
  });
});

describe("resubmit_submission", () => {
  test("a rejection by the approver still returns to the reviewer", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      await db.query(`select public.review_submission($1, $2, 'approve', null)`, [
        id,
        USER.reviewer,
      ]);
      await db.query(`select public.review_submission($1, $2, 'reject', '<p>kurang</p>')`, [
        id,
        USER.approver,
      ]);

      await db.query(`select public.resubmit_submission($1, $2)`, [id, USER.requester]);

      const s = await db.query(`select status from public.submissions where id = $1`, [
        id,
      ]);
      assert.equal(
        s.rows[0].status,
        "pending_review",
        "revision skipped the reviewer"
      );
    });
  });

  test("the deadline survives a rejection and revision", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);
      const before = await db.query(
        `select deadline from public.submissions where id = $1`,
        [id]
      );

      await db.query(`select public.review_submission($1, $2, 'reject', '<p>x</p>')`, [
        id,
        USER.reviewer,
      ]);
      await db.query(`select public.resubmit_submission($1, $2)`, [id, USER.requester]);

      const after_ = await db.query(
        `select deadline from public.submissions where id = $1`,
        [id]
      );
      assert.deepEqual(
        after_.rows[0].deadline,
        before.rows[0].deadline,
        "rejection bought the submitter more time"
      );
    });
  });

  test("only the submitter may resubmit, and only from rejected", async () => {
    await actAsOwner(db);

    await scoped(db, async () => {
      const id = await newDamage(db);
      await db.query(`select public.review_submission($1, $2, 'reject', '<p>x</p>')`, [
        id,
        USER.reviewer,
      ]);
      const res = await denied(db, () =>
        db.query(`select public.resubmit_submission($1, $2)`, [id, USER.other])
      );
      assert.equal(res.ok, true, "a stranger resubmitted someone else's work");
    });

    await scoped(db, async () => {
      const id = await newDamage(db);
      const res = await denied(db, () =>
        db.query(`select public.resubmit_submission($1, $2)`, [id, USER.requester])
      );
      assert.equal(res.ok, true, "a pending submission was resubmitted");
    });
  });
});

describe("RPC exposure", () => {
  test("authenticated users cannot call the workflow functions directly", async () => {
    await actAsOwner(db);
    await scoped(db, async () => {
      const id = await newDamage(db);

      // Without this, every one of these is a public API endpoint reachable
      // from the browser with the anon key.
      for (const sql of [
        `select public.review_submission(${id}, '${USER.reviewer}', 'approve', null)`,
        `select public.resubmit_submission(${id}, '${USER.requester}')`,
        `select public.create_damage_submission('${USER.requester}', ${publishedFacility}, 'x', 'y', 'ringan', current_date + 7)`,
      ]) {
        await actAs(db, USER.reviewer);
        const res = await denied(db, () => db.query(sql));
        assert.equal(res.ok, true, `callable by authenticated: ${sql.slice(0, 60)}`);
      }
      await actAsOwner(db);
    });
  });
});
