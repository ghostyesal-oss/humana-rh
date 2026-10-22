import { adminQuery, withAdmin, withUser } from "./db.js";
import { salaryAdvanceQuotaFor } from "./salary-advance.js";

function rpcMissing(name) {
  return { data: null, error: { message: `Could not find the function public.${name}` } };
}

async function applyPendingInvite(user, args) {
  const userId = String(args.user_id || "");
  const email = String(args.user_email || user.email || "").trim().toLowerCase();
  if (!userId || userId !== user.sub) {
    const error = new Error("Accès refusé.");
    error.status = 403;
    throw error;
  }
  if (!email) return { data: null, error: null };
  try {
    const invite = await adminQuery(
      "select * from public.pending_invites where lower(email) = $1 limit 1",
      [email]
    );
    const row = invite.rows[0];
    if (!row) return { data: null, error: null };
    await adminQuery(
      `update public.profiles
       set full_name = coalesce(nullif($2, ''), full_name),
           role = coalesce(nullif($3, ''), role),
           job_title = coalesce(nullif($4, ''), job_title),
           department = coalesce(nullif($5, ''), department),
           manager_id = coalesce($6, manager_id),
           shift_code = coalesce(nullif($7, ''), shift_code),
           leave_grade = coalesce(nullif($8, ''), leave_grade),
           hired_at = coalesce($9, hired_at),
           holiday_calendar = coalesce(nullif($10, ''), holiday_calendar)
       where id = $1`,
      [
        userId,
        row.full_name || "",
        row.role || "",
        row.job_title || "",
        row.department || "",
        row.manager_id || null,
        row.shift_code || "",
        row.leave_grade || "",
        row.hired_at || null,
        row.holiday_calendar || ""
      ]
    );
    await adminQuery("delete from public.pending_invites where id = $1", [row.id]);
    return { data: true, error: null };
  } catch (error) {
    if (String(error.message || "").includes("does not exist")) return rpcMissing("apply_pending_invite");
    throw error;
  }
}

async function notifyAutoClockOut(user, args) {
  const subjectId = String(args.p_subject_user_id || user.sub);
  if (subjectId !== user.sub && !["admin", "creator"].includes(user.role)) {
    const error = new Error("Accès refusé.");
    error.status = 403;
    throw error;
  }
  const name = String(args.p_collaborator_name || "");
  const when = String(args.p_auto_out_time || new Date().toISOString());
  try {
    const managers = await adminQuery(
      `select coalesce(p.manager_id, p.id) as recipient_id
       from public.profiles p
       where p.id = $1`,
      [subjectId]
    );
    const recipient = managers.rows[0]?.recipient_id;
    if (!recipient) return { data: true, error: null };
    await adminQuery(
      `insert into public.hr_alerts (recipient_id, title, body, created_at)
       values ($1, $2, $3, now())`,
      [
        recipient,
        "Sortie automatique",
        `${name || "Un collaborateur"} a été déconnecté automatiquement (${when}).`
      ]
    );
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: { message: error.message || "notify_auto_clock_out failed" } };
  }
}

function denied(message, status = 403) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[A-Z]{1,8}$/;
const MAX_PLANNING_BATCH = 2500;

function asUuidList(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const id = String(value || "").trim();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizePlanningEntry(row) {
  if (!row || typeof row !== "object") return null;
  const userId = String(row.user_id || "").trim();
  const workDate = String(row.work_date || "").trim();
  const kind = String(row.kind || "PR").trim().toUpperCase();
  const slot = Number(row.slot) === 2 ? 2 : 1;
  const hours = Number(row.hours);
  if (!UUID_RE.test(userId) || !DATE_RE.test(workDate) || !KIND_RE.test(kind)) return null;
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return null;
  const clip = (value, max) => String(value || "").trim().slice(0, max);
  return {
    user_id: userId,
    work_date: workDate,
    slot,
    kind,
    hours: Math.round(hours * 100) / 100,
    department: clip(row.department, 80),
    structure: clip(row.structure, 80),
    location: clip(row.location, 80),
    note: clip(row.note, 240),
    source: clip(row.source || "import", 40) || "import",
    matricule: clip(row.matricule, 40)
  };
}

async function importPlanningEntries(user, args) {
  const role = String(user?.role || "").toLowerCase();
  if (!["admin", "creator", "manager"].includes(role)) {
    denied("Seul un manager ou un administrateur peut importer le planning.");
  }
  const raw = Array.isArray(args.entries) ? args.entries : [];
  if (raw.length > MAX_PLANNING_BATCH) {
    denied(`Lot trop volumineux (max ${MAX_PLANNING_BATCH} lignes).`, 400);
  }
  const entries = [];
  const seen = new Set();
  for (const row of raw) {
    const item = sanitizePlanningEntry(row);
    if (!item) continue;
    const key = `${item.user_id}|${item.work_date}|${item.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(item);
  }
  const replaceFrom = DATE_RE.test(String(args.replace_from || "")) ? args.replace_from : "";
  const replaceTo = DATE_RE.test(String(args.replace_to || "")) ? args.replace_to : "";
  const replaceIds = asUuidList(args.replace_user_ids);
  if (!entries.length && !replaceIds.length) {
    return { data: { imported: 0, replaced: 0 }, error: null };
  }
  const targetIds = asUuidList([
    ...entries.map((row) => row.user_id),
    ...replaceIds
  ]);
  return withUser(user, async (client) => {
    const allowed = await client.query(
      `select id from public.profiles
       where id = any($1::uuid[])
         and public.humana_in_team(id)`,
      [targetIds]
    );
    const allowedIds = new Set(allowed.rows.map((row) => row.id));
    const deniedIds = targetIds.filter((id) => !allowedIds.has(id));
    if (deniedIds.length) {
      denied("Import refusé : des agents sont hors de votre périmètre.");
    }
    let replaced = 0;
    if (replaceIds.length && replaceFrom && replaceTo) {
      const deleted = await client.query(
        `delete from public.planning_entries
         where work_date between $1::date and $2::date
           and user_id = any($3::uuid[])`,
        [replaceFrom, replaceTo, replaceIds]
      );
      replaced = deleted.rowCount || 0;
    }
    if (!entries.length) {
      return { data: { imported: 0, replaced }, error: null };
    }
    await client.query(
      `insert into public.planning_entries
         (user_id, work_date, slot, kind, hours, department, structure, location, note, source, matricule, created_by)
       select
         x.user_id, x.work_date, x.slot, x.kind, x.hours, x.department, x.structure, x.location, x.note, x.source, x.matricule, $2
       from json_to_recordset($1::json) as x(
         user_id uuid,
         work_date date,
         slot int,
         kind text,
         hours numeric,
         department text,
         structure text,
         location text,
         note text,
         source text,
         matricule text
       )`,
      [JSON.stringify(entries), user.sub]
    );
    return { data: { imported: entries.length, replaced }, error: null };
  });
}

function foldEmployeeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function employeeNameTokens(value) {
  return foldEmployeeName(value).split(" ").filter((token) => token.length >= 2);
}

function employeeNamesMatch(left, right) {
  const a = employeeNameTokens(left).sort();
  const b = employeeNameTokens(right).sort();
  if (a.length < 2 || a.length !== b.length) return false;
  return a.every((token, index) => token === b[index]);
}

function normalizeImportedMatricule(value) {
  const text = String(value || "").trim().replace(/\s+/g, "");
  if (!text || text === "-" || text === "0") return "";
  if (/^\d+(\.0+)?$/.test(text)) return String(Math.round(Number(text)));
  return text.slice(0, 40).toUpperCase();
}

function isPersonManagerName(value) {
  const tokens = employeeNameTokens(value);
  if (tokens.length < 2) return false;
  return !/^(oui|non|yes|no|n a|na|aucun|sans|x|manager|responsable)$/.test(foldEmployeeName(value));
}

function sanitizeImportedEmployee(row) {
  if (!row || typeof row !== "object") return null;
  const clip = (value, max) => String(value || "").trim().slice(0, max);
  const matricule = normalizeImportedMatricule(row.matricule);
  const fullName = clip(row.full_name, 120);
  if (!matricule && !fullName) return null;
  const role = ["employee", "manager", "rh", "admin"].includes(String(row.role || "")) ? row.role : "employee";
  const leaveGrade = ["employee", "manager", "codir"].includes(String(row.leave_grade || "")) ? row.leave_grade : "employee";
  const holidayCalendar = ["ma", "fr"].includes(String(row.holiday_calendar || "").toLowerCase())
    ? String(row.holiday_calendar).toLowerCase()
    : "";
  const shift = ["cs", "ces", "rnd"].includes(String(row.shift_code || "")) ? row.shift_code : "cs";
  const hired = DATE_RE.test(String(row.hired_at || "")) ? row.hired_at : null;
  const email = clip(row.email, 120).toLowerCase();
  return {
    matricule,
    full_name: fullName || matricule,
    email: email && email.includes("@") ? email : "",
    job_title: clip(row.job_title, 80) || "Collaborateur",
    department: clip(row.department, 80) || "General",
    role,
    leave_grade: leaveGrade,
    holiday_calendar: holidayCalendar,
    shift_code: shift,
    hired_at: hired,
    manager_matricule: normalizeImportedMatricule(row.manager_matricule),
    manager_name: isPersonManagerName(row.manager_name) ? clip(row.manager_name, 120) : ""
  };
}

function matchExistingEmployee(row, existing) {
  const matriculeId = normalizeImportedMatricule(row.matricule);
  if (matriculeId) {
    const hits = existing.filter((item) => normalizeImportedMatricule(item.matricule) === matriculeId);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const named = hits.filter((item) => employeeNamesMatch(item.full_name, row.full_name));
      if (named.length === 1) return named[0];
      return hits[0];
    }
  }
  const named = existing.filter((item) => employeeNamesMatch(item.full_name, row.full_name));
  return named.length === 1 ? named[0] : null;
}

async function importEmployees(user, args) {
  const role = String(user?.role || "").toLowerCase();
  if (!["admin", "creator"].includes(role)) {
    denied("Seul un administrateur peut importer les employés.");
  }
  const raw = Array.isArray(args.employees) ? args.employees : [];
  if (raw.length > 2000) denied("Lot trop volumineux (max 2000 employés).", 400);
  const employees = [];
  const seen = new Set();
  for (const row of raw) {
    const item = sanitizeImportedEmployee(row);
    if (!item) continue;
    const key = item.matricule || foldEmployeeName(item.full_name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    employees.push(item);
  }
  if (!employees.length) return { data: { created: 0, updated: 0, managers_linked: 0, total: 0 }, error: null };

  return withAdmin(async (client) => {
    await client.query("begin");
    try {
    const { rows: existingRows } = await client.query(
      `select id, email, full_name, role, matricule from public.profiles`
    );
    const existing = existingRows.slice();
    let created = 0;
    let updated = 0;
    const managerNames = employees.map((emp) => emp.manager_name).filter(Boolean);
    for (const emp of employees) {
      if (emp.role === "employee" && managerNames.some((name) => employeeNamesMatch(emp.full_name, name))) {
        emp.role = "manager";
        if (emp.leave_grade === "employee") emp.leave_grade = "manager";
      }
      const hit = matchExistingEmployee(emp, existing);
      const keepRole = hit && ["admin", "creator"].includes(String(hit.role || ""));
      const nextRole = keepRole ? hit.role : emp.role;
      if (hit) {
        await client.query(
          `update public.profiles
           set full_name = coalesce(nullif($2, ''), full_name),
               job_title = coalesce(nullif($3, ''), job_title),
               department = coalesce(nullif($4, ''), department),
               role = $5,
               matricule = coalesce(nullif($6, ''), matricule),
               shift_code = coalesce(nullif($7, ''), shift_code),
               leave_grade = coalesce(nullif($8, ''), leave_grade),
               hired_at = coalesce($9::date, hired_at),
               holiday_calendar = coalesce(nullif($10, ''), holiday_calendar),
               updated_at = now()
           where id = $1`,
          [
            hit.id,
            emp.full_name,
            emp.job_title,
            emp.department,
            nextRole,
            emp.matricule,
            emp.shift_code,
            emp.leave_grade,
            emp.hired_at,
            emp.holiday_calendar
          ]
        );
        if (emp.matricule) hit.matricule = emp.matricule;
        if (emp.full_name) hit.full_name = emp.full_name;
        updated += 1;
      } else {
        const inserted = await client.query(
          `insert into public.profiles
             (id, email, full_name, role, job_title, department, matricule, shift_code, hired_at, leave_grade, holiday_calendar)
           values (gen_random_uuid(), nullif($1, ''), $2, $3, $4, $5, nullif($6, ''), $7, $8::date, $9,
                   coalesce(nullif($10, ''), case when $7 = 'rnd' then 'ma' else 'fr' end))
           returning id, email, full_name, role, matricule`,
          [
            emp.email,
            emp.full_name,
            emp.role,
            emp.job_title,
            emp.department,
            emp.matricule,
            emp.shift_code,
            emp.hired_at,
            emp.leave_grade,
            emp.holiday_calendar
          ]
        );
        existing.push(inserted.rows[0]);
        created += 1;
      }
    }

    let managersLinked = 0;
    for (const emp of employees) {
      if (!emp.manager_matricule && !emp.manager_name) continue;
      const profile = matchExistingEmployee(emp, existing);
      if (!profile) continue;
      const manager = existing.find((item) => (
        (emp.manager_matricule && normalizeImportedMatricule(item.matricule) === emp.manager_matricule)
        || (emp.manager_name && employeeNamesMatch(item.full_name, emp.manager_name))
      ));
      if (!manager || manager.id === profile.id) continue;
      await client.query(
        `update public.profiles set manager_id = $2, updated_at = now() where id = $1`,
        [profile.id, manager.id]
      );
      if (!["admin", "creator", "manager"].includes(String(manager.role || ""))) {
        await client.query(
          `update public.profiles
           set role = 'manager',
               leave_grade = case when leave_grade = 'codir' then leave_grade else 'manager' end,
               updated_at = now()
           where id = $1`,
          [manager.id]
        );
        manager.role = "manager";
      }
      managersLinked += 1;
    }
    const counted = await client.query("select count(*)::int as n from public.profiles");
    await client.query("commit");
    return {
      data: {
        created,
        updated,
        managers_linked: managersLinked,
        total: counted.rows[0]?.n || 0
      },
      error: null
    };
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        /* rollback already done */
      }
      throw error;
    }
  });
}

export async function runRpc(user, name, args) {
  if (name === "apply_pending_invite") return applyPendingInvite(user, args || {});
  if (name === "notify_auto_clock_out") return notifyAutoClockOut(user, args || {});
  if (name === "process_auto_clock_outs") return rpcMissing(name);
  if (name === "import_planning_entries") return importPlanningEntries(user, args || {});
  if (name === "import_employees") return importEmployees(user, args || {});
  if (name === "salary_advance_quota") {
    const result = await salaryAdvanceQuotaFor(user.sub, null);
    return {
      data: { ...result.quota, ok: result.ok, reason: result.reason },
      error: null
    };
  }
  return rpcMissing(name);
}
