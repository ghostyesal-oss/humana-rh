import assert from "node:assert/strict";
import test from "node:test";
import { adminQuery, withUser } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { runQuery } from "../src/query.js";
import { assertCanReadStorage } from "../src/storage.js";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const M = "a0000000-0000-4000-8000-000000000003";
const AD = "a0000000-0000-4000-8000-000000000004";
const LEAVE_A = "b0000000-0000-4000-8000-000000000001";
const PAY_B = "c0000000-0000-4000-8000-000000000002";
const PUNCH_A = "d0000000-0000-4000-8000-000000000001";
const DOC = "e0000000-0000-4000-8000-000000000001";
const DOC_ADMIN = "e0000000-0000-4000-8000-000000000002";
const EVT_ADMIN = "f0000000-0000-4000-8000-000000000001";
const EVT_MGR = "f0000000-0000-4000-8000-000000000002";

const empA = { sub: A, role: "employee", email: "emp-a@authz.test" };
const empB = { sub: B, role: "employee", email: "emp-b@authz.test" };
const mgr = { sub: M, role: "manager", email: "mgr@authz.test" };
const admin = { sub: AD, role: "admin", email: "admin@authz.test" };

async function reset() {
  await adminQuery("delete from public.audit_log where actor_email like '%@authz.test'");
  await adminQuery("delete from public.payslips where id = $1", [PAY_B]);
  await adminQuery("delete from public.leave_requests where id = $1", [LEAVE_A]);
  await adminQuery("delete from public.time_punches where id = $1", [PUNCH_A]);
  await adminQuery("delete from public.hr_documents where id = any($1::uuid[])", [[DOC, DOC_ADMIN]]);
  await adminQuery("delete from public.company_events where id = any($1::uuid[])", [[EVT_ADMIN, EVT_MGR]]);
  await adminQuery("delete from public.app_settings where key in ('studio_creators', 'nav_visibility', 'company_timezone', 'gta_shifts')");
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
    `insert into public.hr_documents (id, title, visibility, storage_path)
     values
       ($1, 'Note interne', 'all', 'notes/all.pdf'),
       ($2, 'Note admin', 'admins', 'notes/admin.pdf')`,
    [DOC, DOC_ADMIN]
  );
  await adminQuery(
    `insert into public.company_events (id, title, starts_at, visibility, poster_path)
     values
       ($1, 'Comité', now() + interval '1 day', 'admins', 'posters/admin.png'),
       ($2, 'Briefing managers', now() + interval '2 day', 'managers', 'posters/mgr.png')`,
    [EVT_ADMIN, EVT_MGR]
  );
  await adminQuery(
    `update public.payslips set storage_path = 'payslips/' || user_id::text || '/slip.pdf' where id = $1`,
    [PAY_B]
  );
  await adminQuery(
    `insert into public.app_settings (key, value) values
       ('studio_creators', $1::jsonb),
       ('nav_visibility', '{}'::jsonb),
       ('company_timezone', '"GMT+1"'::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify([admin.email])]
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

  await t.test("API+RLS: un manager ne modifie pas le profil RH de son N-1", async () => {
    await assert.rejects(
      () => runQuery(mgr, {
        table: "profiles",
        op: "update",
        filters: [{ op: "eq", column: "id", value: A }],
        payload: { job_title: "Hacked", leave_balance_cp: 99 }
      }),
      (error) => error.status === 403
    );
    await withUser(mgr, async (client) => {
      await assert.rejects(
        () => client.query("update public.profiles set job_title = 'Hacked' where id = $1", [A])
      );
    });
    const { rows } = await adminQuery("select job_title, leave_balance_cp from public.profiles where id = $1", [A]);
    assert.notEqual(rows[0].job_title, "Hacked");
  });

  await t.test("API: un manager peut modifier son propre nom", async () => {
    const result = await runQuery(mgr, {
      table: "profiles",
      op: "update",
      filters: [{ op: "eq", column: "id", value: M }],
      payload: { full_name: "Manager Maj" }
    });
    assert.equal(result.data[0].full_name, "Manager Maj");
    await adminQuery("update public.profiles set full_name = 'Manager Test' where id = $1", [M]);
  });

  await t.test("API+RLS: un salarié ne lit pas studio_creators", async () => {
    const result = await runQuery(empA, { table: "app_settings", op: "select" });
    const keys = (result.data || []).map((row) => row.key);
    assert.equal(keys.includes("studio_creators"), false);
    assert.ok(keys.includes("nav_visibility") || keys.includes("company_timezone"));
    await withUser(empA, async (client) => {
      const hidden = await client.query("select key from public.app_settings where key = 'studio_creators'");
      assert.equal(hidden.rows.length, 0);
    });
  });

  await t.test("API: l'admin lit studio_creators", async () => {
    const result = await runQuery(admin, {
      table: "app_settings",
      op: "select",
      filters: [{ op: "eq", column: "key", value: "studio_creators" }]
    });
    assert.equal((result.data || []).length, 1);
  });

  await t.test("API+RLS: un salarié ne voit pas un document admin", async () => {
    const result = await runQuery(empA, { table: "hr_documents", op: "select" });
    const ids = (result.data || []).map((row) => row.id);
    assert.ok(ids.includes(DOC));
    assert.equal(ids.includes(DOC_ADMIN), false);
  });

  await t.test("API+RLS: un salarié ne voit pas un événement managers/admins", async () => {
    const result = await runQuery(empA, { table: "company_events", op: "select" });
    const ids = (result.data || []).map((row) => row.id);
    assert.equal(ids.includes(EVT_ADMIN), false);
    assert.equal(ids.includes(EVT_MGR), false);
  });

  await t.test("API: un manager voit les événements managers, pas admins", async () => {
    const result = await runQuery(mgr, { table: "company_events", op: "select" });
    const ids = (result.data || []).map((row) => row.id);
    assert.equal(ids.includes(EVT_MGR), true);
    assert.equal(ids.includes(EVT_ADMIN), false);
  });

  await t.test("stockage: un salarié ne lit pas le bulletin ou l'affiche d'un autre", async () => {
    await assert.rejects(
      () => assertCanReadStorage(empA, "hr-documents", `payslips/${B}/slip.pdf`),
      (error) => error.status === 404
    );
    await assert.rejects(
      () => assertCanReadStorage(empA, "event-posters", "posters/admin.png"),
      (error) => error.status === 404
    );
    await assert.rejects(
      () => assertCanReadStorage(empA, "hr-documents", "notes/admin.pdf"),
      (error) => error.status === 404
    );
    await assert.rejects(
      () => assertCanReadStorage(admin, "hr-documents", "notes/orphan-not-in-db.pdf"),
      (error) => error.status === 404
    );
    assert.equal(await assertCanReadStorage(admin, "hr-documents", "notes/admin.pdf"), "notes/admin.pdf");
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
