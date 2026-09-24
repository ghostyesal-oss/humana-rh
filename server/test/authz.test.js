import assert from "node:assert/strict";
import test from "node:test";
import { adminQuery, withUser } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { runQuery } from "../src/query.js";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const M = "a0000000-0000-4000-8000-000000000003";
const AD = "a0000000-0000-4000-8000-000000000004";
const LEAVE_A = "b0000000-0000-4000-8000-000000000001";
const PAY_B = "c0000000-0000-4000-8000-000000000002";
const PUNCH_A = "d0000000-0000-4000-8000-000000000001";
const DOC = "e0000000-0000-4000-8000-000000000001";

const empA = { sub: A, role: "employee", email: "emp-a@authz.test" };
const empB = { sub: B, role: "employee", email: "emp-b@authz.test" };
const mgr = { sub: M, role: "manager", email: "mgr@authz.test" };
const admin = { sub: AD, role: "admin", email: "admin@authz.test" };

async function reset() {
  await adminQuery("delete from public.audit_log where actor_email like '%@authz.test'");
  await adminQuery("delete from public.payslips where id = $1", [PAY_B]);
  await adminQuery("delete from public.leave_requests where id = $1", [LEAVE_A]);
  await adminQuery("delete from public.time_punches where id = $1", [PUNCH_A]);
  await adminQuery("delete from public.hr_documents where id = $1", [DOC]);
  await adminQuery("delete from public.profiles where id = any($1::uuid[])", [[A, B, M, AD]]);
}

async function seed() {
  await adminQuery(
    `insert into public.profiles (id, email, full_name, role, manager_id)
     values
       ($1, $2, 'Admin Test', 'admin', null),
       ($3, $4, 'Manager Test', 'manager', $1),
       ($5, $6, 'Employe A', 'employee', $3),
       ($7, $8, 'Employe B', 'employee', $3)`,
    [AD, admin.email, M, mgr.email, A, empA.email, B, empB.email]
  );
  await adminQuery(
    `insert into public.leave_requests (id, user_id, leave_type, status, start_date, end_date, days)
     values ($1, $2, 'CP', 'A valider', current_date, current_date, 1)`,
    [LEAVE_A, A]
  );
  await adminQuery(
    `insert into public.payslips (id, user_id, period_year, period_month, period_label)
     values ($1, $2, 2026, 1, 'Janvier 2026')`,
    [PAY_B, B]
  );
  await adminQuery(
    `insert into public.time_punches (id, user_id, punch_type, punched_at)
     values ($1, $2, 'in', now())`,
    [PUNCH_A, A]
  );
  await adminQuery(
    `insert into public.hr_documents (id, title, visibility)
     values ($1, 'Note interne', 'all')`,
    [DOC]
  );
}

test("authz: salarié, manager, admin", async (t) => {
  if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) {
    t.skip("DATABASE_URL / APP_DATABASE_URL requis");
    return;
  }
  await runMigrations();
  await reset();
  await seed();
  t.after(async () => {
    await reset();
  });

  await t.test("RLS: un salarié ne lit pas le bulletin d'un autre", async () => {
    await withUser(empA, async (client) => {
      const { rows } = await client.query("select * from public.payslips where user_id = $1", [B]);
      assert.equal(rows.length, 0);
    });
  });

  await t.test("API: un salarié ne lit pas le bulletin d'un autre", async () => {
    const result = await runQuery(empA, {
      table: "payslips",
      op: "select",
      filters: [{ op: "eq", column: "user_id", value: B }]
    });
    assert.equal((result.data || []).length, 0);
  });

  await t.test("journal: consultation de bulletin horodatée", async () => {
    await runQuery(empB, {
      table: "payslips",
      op: "select",
      filters: [{ op: "eq", column: "user_id", value: B }]
    });
    const { rows } = await adminQuery(
      `select * from public.audit_log
       where action = 'payslip.read' and actor_id = $1
       order by at desc limit 1`,
      [B]
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].at);
  });

  await t.test("API+RLS: un salarié ne valide pas sa propre demande", async () => {
    await assert.rejects(
      () => runQuery(empA, {
        table: "leave_requests",
        op: "update",
        filters: [{ op: "eq", column: "id", value: LEAVE_A }],
        payload: { status: "Validé" }
      }),
      (error) => error.status === 403 || /refus/i.test(error.message)
    );
    await withUser(empA, async (client) => {
      await assert.rejects(
        () => client.query("update public.leave_requests set status = 'Validé' where id = $1", [LEAVE_A])
      );
    });
    const { rows } = await adminQuery("select status from public.leave_requests where id = $1", [LEAVE_A]);
    assert.match(String(rows[0].status), /a valider/i);
  });

  await t.test("API: un salarié ne modifie pas un pointage", async () => {
    await assert.rejects(
      () => runQuery(empA, {
        table: "time_punches",
        op: "update",
        filters: [{ op: "eq", column: "id", value: PUNCH_A }],
        payload: { punch_type: "out" }
      }),
      (error) => error.status === 403
    );
  });

  await t.test("API: un salarié ne lit pas les pointages d'un autre", async () => {
    const result = await runQuery(empB, {
      table: "time_punches",
      op: "select",
      filters: [{ op: "eq", column: "user_id", value: A }]
    });
    assert.equal((result.data || []).length, 0);
  });

  await t.test("API: le manager valide la demande de son N-1, pas la sienne", async () => {
    const ok = await runQuery(mgr, {
      table: "leave_requests",
      op: "update",
      filters: [{ op: "eq", column: "id", value: LEAVE_A }],
      payload: { status: "Validé" }
    });
    assert.equal(ok.data[0].status, "Validé");
    await adminQuery("update public.leave_requests set status = 'A valider' where id = $1", [LEAVE_A]);

    const own = await adminQuery(
      `insert into public.leave_requests (user_id, leave_type, status, start_date, end_date, days)
       values ($1, 'CP', 'A valider', current_date, current_date, 1) returning id`,
      [M]
    );
    const ownId = own.rows[0].id;
    await assert.rejects(
      () => runQuery(mgr, {
        table: "leave_requests",
        op: "update",
        filters: [{ op: "eq", column: "id", value: ownId }],
        payload: { status: "Validé" }
      }),
      (error) => error.status === 403
    );
    await adminQuery("delete from public.leave_requests where id = $1", [ownId]);
  });

  await t.test("API: l'admin lit tous les bulletins", async () => {
    const result = await runQuery(admin, { table: "payslips", op: "select" });
    assert.ok((result.data || []).some((row) => row.id === PAY_B));
  });

  await t.test("journal: changement de rôle", async () => {
    const before = await adminQuery(
      "select count(*)::int as n from public.audit_log where action = 'role.change' and target_id = $1",
      [A]
    );
    await runQuery(admin, {
      table: "profiles",
      op: "update",
      filters: [{ op: "eq", column: "id", value: A }],
      payload: { role: "manager" }
    });
    const after = await adminQuery(
      "select count(*)::int as n from public.audit_log where action = 'role.change' and target_id = $1",
      [A]
    );
    assert.ok(after.rows[0].n > before.rows[0].n);
    await runQuery(admin, {
      table: "profiles",
      op: "update",
      filters: [{ op: "eq", column: "id", value: A }],
      payload: { role: "employee" }
    });
  });

  await t.test("API+RLS: un salarié ne change pas son rôle", async () => {
    await assert.rejects(
      () => runQuery(empA, {
        table: "profiles",
        op: "update",
        filters: [{ op: "eq", column: "id", value: A }],
        payload: { role: "admin" }
      }),
      (error) => error.status === 403
    );
    await withUser(empA, async (client) => {
      await assert.rejects(
        () => client.query("update public.profiles set role = 'admin' where id = $1", [A])
      );
    });
  });

  await t.test("index phase 2.3 présents", async () => {
    const { rows } = await adminQuery(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'time_punches_user_id_punched_at_desc_idx',
          'hr_documents_storage_path_idx',
          'leave_requests_user_status_created_idx'
        )
    `);
    assert.equal(rows.length, 3);
  });
});
