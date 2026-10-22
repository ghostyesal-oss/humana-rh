import { AsyncLocalStorage } from "node:async_hooks";
import { adminQuery, logSensitiveAccess, rlsDenied, withUser } from "./db.js";
import { resolveSelectLimit } from "./query-limit.js";
import { assertSalaryAdvanceInsert } from "./salary-advance.js";

const tx = new AsyncLocalStorage();

function dbQuery(text, values) {
  const client = tx.getStore();
  if (!client) throw new Error("Requête hors transaction utilisateur.");
  return client.query(text, values);
}

const COLUMN_SQL = Object.freeze({
  id: '"id"',
  email: '"email"',
  full_name: '"full_name"',
  role: '"role"',
  job_title: '"job_title"',
  department: '"department"',
  manager_id: '"manager_id"',
  matricule: '"matricule"',
  shift_code: '"shift_code"',
  hired_at: '"hired_at"',
  leave_grade: '"leave_grade"',
  holiday_calendar: '"holiday_calendar"',
  avatar_url: '"avatar_url"',
  phone: '"phone"',
  created_at: '"created_at"',
  updated_at: '"updated_at"',
  user_id: '"user_id"',
  punched_at: '"punched_at"',
  punch_type: '"punch_type"',
  punch_date: '"punch_date"',
  requested_time: '"requested_time"',
  lat: '"lat"',
  lng: '"lng"',
  latitude: '"latitude"',
  longitude: '"longitude"',
  accuracy: '"accuracy"',
  note: '"note"',
  source: '"source"',
  location: '"location"',
  leave_type: '"leave_type"',
  type: '"type"',
  start_date: '"start_date"',
  end_date: '"end_date"',
  start: '"start"',
  end: '"end"',
  days: '"days"',
  hours: '"hours"',
  unit: '"unit"',
  half_day: '"half_day"',
  motif: '"motif"',
  attachment_name: '"attachment_name"',
  workflow_step: '"workflow_step"',
  comment: '"comment"',
  status: '"status"',
  reason: '"reason"',
  work_date: '"work_date"',
  category: '"category"',
  amount: '"amount"',
  requested_date: '"requested_date"',
  key: '"key"',
  value: '"value"',
  title: '"title"',
  description: '"description"',
  event_type: '"event_type"',
  starts_at: '"starts_at"',
  ends_at: '"ends_at"',
  all_day: '"all_day"',
  visibility: '"visibility"',
  poster_url: '"poster_url"',
  poster_path: '"poster_path"',
  created_by: '"created_by"',
  recipient_id: '"recipient_id"',
  body: '"body"',
  message: '"message"',
  kind: '"kind"',
  payload: '"payload"',
  read_at: '"read_at"',
  subject_user_id: '"subject_user_id"',
  endpoint: '"endpoint"',
  p256dh: '"p256dh"',
  auth: '"auth"',
  user_agent: '"user_agent"',
  last_seen_at: '"last_seen_at"',
  published_at: '"published_at"',
  storage_path: '"storage_path"',
  file_url: '"file_url"',
  period: '"period"',
  month: '"month"',
  year: '"year"',
  work_location: '"work_location"',
  work_status: '"work_status"',
  connection_method: '"connection_method"',
  operating_system: '"operating_system"',
  browser_application: '"browser_application"',
  ip_address: '"ip_address"',
  network_type: '"network_type"',
  leave_balance_cp: '"leave_balance_cp"',
  leave_balance_rtt: '"leave_balance_rtt"',
  leave_balance_recup: '"leave_balance_recup"',
  document_type: '"document_type"',
  punch_kind: '"punch_kind"',
  reviewed_by: '"reviewed_by"',
  reviewed_at: '"reviewed_at"',
  disconnect_reason: '"disconnect_reason"',
  period_year: '"period_year"',
  period_month: '"period_month"',
  period_label: '"period_label"',
  created_by: '"created_by"',
  slot: '"slot"',
  structure: '"structure"',
  delay_min: '"delay_min"'
});

const DIRECTORY_COLUMNS = [
  "id", "email", "full_name", "job_title", "department", "role", "manager_id",
  "matricule", "shift_code", "hired_at", "leave_grade", "holiday_calendar"
];

const ADMIN_WRITE_TABLES = new Set([
  "pending_invites",
  "app_settings",
  "payslips",
  "hr_documents",
  "company_events"
]);

const PERSONAL_TABLES = new Set([
  "time_punches",
  "leave_requests",
  "punch_corrections",
  "overtime_requests",
  "activity_entries",
  "salary_advance_requests",
  "attestation_requests",
  "push_subscriptions",
  "hr_alerts",
  "planning_entries",
  "delay_reviews"
]);

const REQUEST_TABLES = new Set([
  "leave_requests",
  "attestation_requests",
  "salary_advance_requests",
  "punch_corrections",
  "overtime_requests",
  "activity_entries"
]);

const HR_REQUEST_TABLES = new Set([
  "attestation_requests",
  "salary_advance_requests"
]);

const STATUS_FIELDS = new Set(["status", "workflow_step"]);

const EMPLOYEE_PROFILE_FIELDS = new Set(["id", "email", "full_name", "avatar_url", "phone"]);
const PUBLIC_APP_SETTING_KEYS = ["nav_visibility", "company_timezone", "gta_shifts"];
const EDS_PAYROLL_SETTING_KEY = "eds_payroll";

function payrollEmails() {
  return String(process.env.PAYROLL_EMAILS || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function canManageEdsPayroll(user) {
  if (isAdmin(user)) return true;
  const email = String(user?.email || "").trim().toLowerCase();
  return Boolean(email && payrollEmails().includes(email));
}

/*
 * Phase 2 option A : API (ce fichier) + RLS Postgres (auth.uid() via withUser).
 * L'API pose request.jwt.claim.* dans la transaction ; humana_app n'est pas superuser.
 *
 * Table                    | select                         | insert/upsert                 | update                              | delete
 * -------------------------|--------------------------------|-------------------------------|-------------------------------------|--------------------------------
 * leave_requests           | soi / équipe / admin           | soi, statut forcé "A valider" | salarié : hors statut, si "A valider"| salarié : si "A valider"
 * attestation_requests     | soi / équipe / admin / RH      | soi, statut "A valider"       | RH/admin (pas soi, pas manager)     | soi si pending / RH / admin
 * salary_advance_requests  |                                | RH/admin : équipe             |                                     |
 * punch_corrections        |                                |                               |                                     |
 * overtime_requests        |                                |                               |                                     |
 * activity_entries         |                                |                               |                                     |
 * time_punches             | soi / équipe / admin           | salarié : punched_at = now()  | manager d'équipe (pas soi)          | admin
 * profiles                 | salarié : soi ; manager :      | upsert soi / admin            | soi : champs personnels             | admin
 *                          |   équipe ; admin : tout        |                               | admin : tout                       |
 * profiles_directory       | même périmètre que profiles    | —                             | —                                   | —
 * payslips                 | soi / admin                    | admin                         | admin                               | admin
 * hr_documents             | visibilité all/managers/admins | admin                         | admin                               | admin
 * pending_invites          | admin                          | admin                         | admin                               | admin
 * app_settings             | nav/GTA : authentifié          | admin / créateur              | admin / créateur                    | admin / créateur
 *                          | studio_creators : admin        |                               |                                     |
 * company_events           | visibilité all/managers/admins | admin                         | admin                               | admin
 * hr_alerts                | destinataire / admin           | soi / admin / RPC             | destinataire (lu) / admin           | destinataire / admin
 * push_subscriptions       | soi / admin                    | soi                           | soi                                 | soi
 * planning_entries         | soi / équipe / admin           | RPC import (manager/admin)    | RPC import                          | RPC import
 * delay_reviews            | soi / équipe / admin           | manager d'équipe (pas soi)    | manager d'équipe (pas soi)          | admin
 */

function denied(message, status = 403) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function execWrite(text, values) {
  return dbQuery(text, values);
}

function resolveLogicalTable(requested) {
  let table = "";
  let fromSql = "";
  if (requested === "time_punches") { table = "time_punches"; fromSql = '"time_punches"'; }
  else if (requested === "leave_requests") { table = "leave_requests"; fromSql = '"leave_requests"'; }
  else if (requested === "punch_corrections") { table = "punch_corrections"; fromSql = '"punch_corrections"'; }
  else if (requested === "profiles") { table = "profiles"; fromSql = '"profiles"'; }
  else if (requested === "profiles_directory") { table = "profiles_directory"; fromSql = '"profiles_directory"'; }
  else if (requested === "pending_invites") { table = "pending_invites"; fromSql = '"pending_invites"'; }
  else if (requested === "push_subscriptions") { table = "push_subscriptions"; fromSql = '"push_subscriptions"'; }
  else if (requested === "company_events") { table = "company_events"; fromSql = '"company_events"'; }
  else if (requested === "hr_alerts") { table = "hr_alerts"; fromSql = '"hr_alerts"'; }
  else if (requested === "overtime_requests") { table = "overtime_requests"; fromSql = '"overtime_requests"'; }
  else if (requested === "activity_entries") { table = "activity_entries"; fromSql = '"activity_entries"'; }
  else if (requested === "salary_advance_requests") { table = "salary_advance_requests"; fromSql = '"salary_advance_requests"'; }
  else if (requested === "attestation_requests") { table = "attestation_requests"; fromSql = '"attestation_requests"'; }
  else if (requested === "hr_documents") { table = "hr_documents"; fromSql = '"hr_documents"'; }
  else if (requested === "payslips") { table = "payslips"; fromSql = '"payslips"'; }
  else if (requested === "app_settings") { table = "app_settings"; fromSql = '"app_settings"'; }
  else if (requested === "planning_entries") { table = "planning_entries"; fromSql = '"planning_entries"'; }
  else if (requested === "delay_reviews") { table = "delay_reviews"; fromSql = '"delay_reviews"'; }
  if (!table || !fromSql) throw denied(`Table non autorisée: ${requested}`, 400);
  return { table, fromSql };
}

function colSql(name) {
  for (const key of Object.keys(COLUMN_SQL)) {
    if (key === name) return COLUMN_SQL[key];
  }
  throw denied(`Colonne non autorisée: ${name}`, 400);
}

function requestedColumnSet(raw) {
  const wanted = new Set();
  for (const item of String(raw || "").split(",")) {
    const key = item.trim();
    if (key) wanted.add(key);
  }
  return wanted;
}

function sqlFromAllowlist(wanted) {
  const sql = [];
  for (const key of Object.keys(COLUMN_SQL)) {
    if (wanted.has(key)) sql.push(COLUMN_SQL[key]);
  }
  return sql;
}

function upsertConflictClause(rawConflict, keys) {
  const wanted = requestedColumnSet(rawConflict || "id");
  const conflict = sqlFromAllowlist(wanted);
  if (!conflict.length) throw denied("Conflit upsert invalide.", 400);
  const updates = [];
  for (const key of keys) {
    if (wanted.has(key)) continue;
    updates.push(`${COLUMN_SQL[key]} = excluded.${COLUMN_SQL[key]}`);
  }
  const fallback = `${COLUMN_SQL[keys[0]]} = excluded.${COLUMN_SQL[keys[0]]}`;
  return ` on conflict (${conflict.join(",")}) do update set ${updates.join(",") || fallback}`;
}

function columnsFromList(raw) {
  if (!raw || raw === "*") return "*";
  const wanted = String(raw).split(",").map((item) => item.trim());
  const cols = Object.keys(COLUMN_SQL).filter((key) => wanted.includes(key)).map((key) => COLUMN_SQL[key]);
  return cols.length ? cols.join(", ") : "*";
}

function parseSelect(select) {
  const raw = String(select || "*").trim() || "*";
  const embedMatch = raw.match(/^(.*?)(?:,\s*)?([a-zA-Z_]+)\(([^)]+)\)\s*$/);
  if (!embedMatch) {
    return { columns: raw, embed: null };
  }
  const base = embedMatch[1].replace(/,\s*$/, "").trim() || "*";
  return {
    columns: base,
    embed: {
      table: embedMatch[2],
      columns: embedMatch[3].split(",").map((item) => item.trim()).filter(Boolean)
    }
  };
}

function isAdmin(user) {
  return user?.role === "admin" || user?.role === "creator";
}

function isHr(user) {
  return isAdmin(user) || user?.role === "rh";
}

function isManager(user) {
  return isHr(user) || user?.role === "manager";
}

async function reportIds(userId) {
  const { rows } = await dbQuery("select id from public.profiles where manager_id = $1", [userId]);
  return rows.map((row) => row.id);
}

function ownerColumn(table) {
  return table === "hr_alerts" ? "recipient_id" : "user_id";
}

function isPendingStatus(status) {
  return String(status || "").toLowerCase().startsWith("a valider");
}

async function canApproveTarget(user, targetUserId) {
  if (isAdmin(user)) return true;
  if (!targetUserId || targetUserId === user.sub) return false;
  if (isHr(user)) return true;
  if (!isManager(user)) return false;
  const reports = await reportIds(user.sub);
  return reports.includes(targetUserId);
}

function isDirectorProfile(profile) {
  const grade = String(profile?.leave_grade || "").toLowerCase();
  const title = String(profile?.job_title || "").toLowerCase();
  return grade === "codir"
    || title.includes("directeur")
    || title.includes("directrice")
    || title.includes("codir");
}

async function canApproveHrTarget(user, targetUserId) {
  if (!targetUserId || targetUserId === user.sub) return false;
  if (isHr(user)) return true;
  const { rows } = await dbQuery(
    "select role, leave_grade, job_title from public.profiles where id = $1 limit 1",
    [user.sub]
  );
  const me = rows[0];
  if (!me) return false;
  if (isHr({ role: me.role })) return true;
  return isDirectorProfile(me);
}

async function teamScopeIds(user) {
  return [user.sub, ...(await reportIds(user.sub))];
}

async function applyReadScope(table, user, filters) {
  const admin = isAdmin(user);
  const hr = isHr(user);
  if (table === "app_settings") {
    if (admin) return filters;
    if (canManageEdsPayroll(user)) {
      return [...filters, { op: "in", column: "key", value: [...PUBLIC_APP_SETTING_KEYS, EDS_PAYROLL_SETTING_KEY] }];
    }
    return [...filters, { op: "in", column: "key", value: PUBLIC_APP_SETTING_KEYS }];
  }
  if (table === "company_events" || table === "hr_documents") {
    if (hr) return filters;
    const managerish = isManager(user) || (await reportIds(user.sub)).length > 0;
    if (managerish) {
      return [...filters, { op: "in", column: "visibility", value: ["all", "managers"] }];
    }
    return [...filters, { op: "eq", column: "visibility", value: "all" }];
  }
  if (table === "pending_invites") {
    if (!admin) throw denied("Accès refusé.");
    return filters;
  }
  if (table === "profiles" || table === "profiles_directory") {
    if (hr) return filters;
    if (isManager(user)) {
      return [...filters, { op: "in", column: "id", value: await teamScopeIds(user) }];
    }
    return [...filters, { op: "eq", column: "id", value: user.sub }];
  }
  if (table === "payslips" && !hr) {
    return [...filters, { op: "eq", column: "user_id", value: user.sub }];
  }
  const userCol = ownerColumn(table);
  if (hr) return filters;
  if (PERSONAL_TABLES.has(table) && isManager(user)) {
    return [...filters, { op: "in", column: userCol, value: await teamScopeIds(user) }];
  }
  if (PERSONAL_TABLES.has(table)) {
    return [...filters, { op: "eq", column: userCol, value: user.sub }];
  }
  return filters;
}

function payloadRows(payload) {
  if (payload == null) return [];
  return Array.isArray(payload) ? payload : [payload];
}

function payloadHasStatus(payload) {
  return payloadRows(payload).some((row) =>
    row && [...STATUS_FIELDS].some((field) => Object.prototype.hasOwnProperty.call(row, field))
  );
}

async function loadScopedRows(fromSql, filters) {
  const { sql, params } = whereClause(filters);
  if (!sql) return [];
  const { rows } = await dbQuery(`select * from public.${fromSql}${sql}`, params);
  return rows;
}

const OS_LABELS = new Set(["Windows", "macOS", "Linux", "Android", "iOS", "Inconnu"]);
const BROWSER_LABELS = new Set([
  "Google Chrome", "Microsoft Edge", "Mozilla Firefox", "Safari", "Opera", "Navigateur"
]);
const METHOD_LABELS = new Set(["Web", "Web mobile"]);
const NETWORK_LABELS = new Set(["Wi-Fi", "Ethernet", "Mobile", "Bluetooth", "WiMAX", "LAN", "Internet", "Autre"]);

function redactPunchTelemetry(row) {
  row.ip_address = null;
  if (row.operating_system && !OS_LABELS.has(row.operating_system)) {
    row.operating_system = "Inconnu";
  }
  if (row.browser_application && !BROWSER_LABELS.has(row.browser_application)) {
    row.browser_application = "Navigateur";
  }
  if (row.connection_method && !METHOD_LABELS.has(row.connection_method)) {
    row.connection_method = "Web";
  }
  if (row.network_type && !NETWORK_LABELS.has(row.network_type)) {
    row.network_type = "Internet";
  }
}

function punchDateFromAt(punchedAt) {
  const instant = punchedAt ? new Date(punchedAt) : new Date();
  const valid = Number.isNaN(instant.getTime()) ? new Date() : instant;
  return valid.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

function conflictColumns(onConflict) {
  return String(onConflict || "id")
    .split(",")
    .map((item) => item.trim())
    .filter((key) => COLUMN_SQL[key]);
}

function conflictFilters(row, conflictCols) {
  const filters = [];
  for (const col of conflictCols) {
    if (row?.[col] == null || row[col] === "") return [];
    filters.push({ op: "eq", column: col, value: row[col] });
  }
  return filters;
}

async function loadConflictRows(fromSql, row, conflictCols) {
  const filters = conflictFilters(row, conflictCols);
  if (!filters.length) return [];
  return loadScopedRows(fromSql, filters);
}

async function conflictRowExists(fromSql, row, conflictCols) {
  const filters = conflictFilters(row, conflictCols);
  if (!filters.length) return false;
  const { sql, params } = whereClause(filters);
  const { rows } = await adminQuery(`select 1 from public.${fromSql}${sql} limit 1`, params);
  return rows.length > 0;
}

async function prepareWriteRows(table, user, rows) {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (table === "push_subscriptions") {
      row.user_agent = "web";
    }
    if (table === "time_punches") {
      redactPunchTelemetry(row);
      const owner = row.user_id || user.sub;
      if (!(await canApproveTarget(user, owner))) {
        if (row.user_id && row.user_id !== user.sub) {
          throw denied("Impossible de pointer pour un autre collaborateur.");
        }
        row.user_id = user.sub;
        row.punched_at = new Date().toISOString();
      }
      row.punch_date = punchDateFromAt(row.punched_at);
    }
    if (REQUEST_TABLES.has(table)) {
      const owner = row.user_id || user.sub;
      const privileged = HR_REQUEST_TABLES.has(table)
        ? await canApproveHrTarget(user, owner)
        : await canApproveTarget(user, owner);
      if (table === "salary_advance_requests") {
        await assertSalaryAdvanceInsert(owner, row.amount);
      }
      if (privileged) continue;
      if (row.user_id && row.user_id !== user.sub) {
        throw denied("Impossible de créer une demande pour un autre collaborateur.");
      }
      row.user_id = user.sub;
      if (!isPendingStatus(row.status)) row.status = "A valider";
      if (Object.prototype.hasOwnProperty.call(row, "workflow_step")) row.workflow_step = 1;
    }
  }
}

async function assertWriteAllowed(table, fromSql, user, op, payload, filters, onConflict) {
  if (ADMIN_WRITE_TABLES.has(table) && !isAdmin(user)) {
    if (table === "app_settings" && canManageEdsPayroll(user)) {
      const keys = payloadRows(payload).map((row) => row?.key);
      if (!keys.length || keys.some((key) => key !== EDS_PAYROLL_SETTING_KEY)) {
        throw denied("Accès refusé.");
      }
    } else {
      throw denied("Accès refusé.");
    }
  }

  const rows = payloadRows(payload);
  const conflictCols = conflictColumns(onConflict);
  let upsertExisting = [];
  if (op === "upsert") {
    for (const row of rows) {
      const visible = await loadConflictRows(fromSql, row, conflictCols);
      if (!visible.length && await conflictRowExists(fromSql, row, conflictCols)) {
        throw denied("Accès refusé.");
      }
      upsertExisting = upsertExisting.concat(visible);
    }
  }

  if (table === "profiles" && !isAdmin(user)) {
    for (const row of rows) {
      if (row && Object.prototype.hasOwnProperty.call(row, "role")) {
        throw denied("Modification du rôle refusée.");
      }
      if (row?.id && row.id !== user.sub) throw denied("Accès refusé.");
      const keys = Object.keys(row || {});
      if (keys.some((key) => !EMPLOYEE_PROFILE_FIELDS.has(key))) {
        throw denied("Modification de profil refusée.");
      }
    }
    if (op === "update" || op === "upsert") {
      const existing = op === "upsert" ? upsertExisting : await loadScopedRows(fromSql, filters);
      for (const row of existing) {
        if (row.id !== user.sub) {
          throw denied("Un manager ne peut pas modifier le profil d'un collaborateur.");
        }
      }
    }
  }

  if (table === "profiles" && op === "delete" && !isAdmin(user)) {
    throw denied("Accès refusé.");
  }

  if (table === "profiles_directory" && op !== "select") {
    throw denied("Accès refusé.");
  }

  if (table === "planning_entries" && op !== "select") {
    throw denied("Utilisez l'import planning.");
  }

  if (table === "delay_reviews" && op !== "select") {
    if (op === "delete" && !isAdmin(user)) {
      throw denied("Seul un administrateur peut supprimer une revue de retard.");
    }
    if (!isManager(user)) {
      throw denied("Seul un manager, RH ou administrateur peut traiter un retard.");
    }
    const reviewRows = op === "update" || op === "delete"
      ? await loadScopedRows(fromSql, filters)
      : rows;
    for (const row of reviewRows) {
      if (!row) continue;
      const owner = row.user_id || user.sub;
      if (!(await canApproveTarget(user, owner))) {
        throw denied("Vous ne pouvez traiter que les retards de votre équipe.");
      }
    }
    for (const row of rows) {
      if (!row) continue;
      if (row.status && !["Confirme", "Rectifie"].includes(String(row.status))) {
        throw denied("Statut de retard invalide.");
      }
      if (row.delay_min != null) {
        const minutes = Number(row.delay_min);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
          throw denied("Durée de retard invalide.");
        }
        row.delay_min = Math.round(minutes);
      }
    }
  }

  if (table === "time_punches" && (op === "insert" || op === "upsert") && !isAdmin(user)) {
    for (const row of rows) {
      if (!row) continue;
      const owner = row.user_id || user.sub;
      if (owner !== user.sub && !(await canApproveTarget(user, owner))) {
        throw denied("Impossible de pointer pour un autre collaborateur.");
      }
    }
  }

  if (table === "time_punches" && op === "delete" && !isAdmin(user)) {
    throw denied("Seul un administrateur peut supprimer un pointage.");
  }

  if (table === "time_punches" && op === "update") {
    for (const row of rows) {
      if (!row) continue;
      redactPunchTelemetry(row);
      if (row.punched_at) row.punch_date = punchDateFromAt(row.punched_at);
    }
    if (!isManager(user)) {
      throw denied("Un salarié ne peut pas modifier un pointage. Utilisez une demande de correction.");
    }
    const existingPunches = await loadScopedRows(fromSql, filters);
    for (const row of existingPunches) {
      if (!(await canApproveTarget(user, row.user_id))) {
        throw denied("Seul un manager ou un administrateur peut modifier ce pointage.");
      }
    }
  }

  const ownerCol = ownerColumn(table);
  if (PERSONAL_TABLES.has(table) && !isAdmin(user) && (op === "insert" || op === "upsert")) {
    for (const row of rows) {
      if (!row) continue;
      if (!isManager(user)) {
        if (row[ownerCol] && row[ownerCol] !== user.sub) throw denied("Accès refusé.");
        row[ownerCol] = user.sub;
      } else if (row[ownerCol] && row[ownerCol] !== user.sub) {
        const allowed = HR_REQUEST_TABLES.has(table)
          ? await canApproveHrTarget(user, row[ownerCol])
          : await canApproveTarget(user, row[ownerCol]);
        if (!allowed) throw denied("Accès refusé.");
      } else if (!row[ownerCol]) {
        row[ownerCol] = user.sub;
      }
    }
  }

  if (!REQUEST_TABLES.has(table)) return;

  if (op === "insert" || (op === "upsert" && !upsertExisting.length)) {
    for (const row of rows) {
      if (!row) continue;
      const privileged = HR_REQUEST_TABLES.has(table)
        ? await canApproveHrTarget(user, row.user_id || user.sub)
        : await canApproveTarget(user, row.user_id || user.sub);
      if (!privileged && !isPendingStatus(row.status)) {
        throw denied("Impossible de créer une demande déjà validée.");
      }
    }
    return;
  }

  const existing = op === "upsert" ? upsertExisting : await loadScopedRows(fromSql, filters);
  if (op === "delete") {
    if (isAdmin(user)) return;
    for (const row of existing) {
      if (HR_REQUEST_TABLES.has(table)) {
        if (await canApproveHrTarget(user, row.user_id)) continue;
        if (row.user_id !== user.sub || !isPendingStatus(row.status)) {
          throw denied("Impossible de supprimer une demande déjà traitée.");
        }
        continue;
      }
      if (isManager(user) && row.user_id !== user.sub) {
        if (!(await canApproveTarget(user, row.user_id))) throw denied("Accès refusé.");
        continue;
      }
      if (row.user_id !== user.sub || !isPendingStatus(row.status)) {
        throw denied("Impossible de supprimer une demande déjà traitée.");
      }
    }
    return;
  }

  if (op !== "update" && op !== "upsert") return;

  const payloadObj = Array.isArray(payload) ? payload[0] || {} : payload || {};
  if (Object.prototype.hasOwnProperty.call(payloadObj, "user_id")) {
    for (const row of existing) {
      if (payloadObj.user_id !== row.user_id) {
        throw denied("Impossible de transférer une demande.");
      }
    }
  }

  const touchesStatus = payloadHasStatus(payload);
  if (touchesStatus) {
    for (const row of existing) {
      if (HR_REQUEST_TABLES.has(table)) {
        if (!await canApproveHrTarget(user, row.user_id)) {
          throw denied("Seul un RH, un directeur ou un administrateur peut valider ou refuser cette demande.");
        }
        continue;
      }
      if (!(await canApproveTarget(user, row.user_id))) {
        throw denied("Seul un manager ou un administrateur peut valider ou refuser cette demande.");
      }
    }
    return;
  }

  if (!isAdmin(user)) {
    for (const row of existing) {
      const ownPending = row.user_id === user.sub && isPendingStatus(row.status);
      const managing = HR_REQUEST_TABLES.has(table)
        ? await canApproveHrTarget(user, row.user_id)
        : await canApproveTarget(user, row.user_id);
      if (!ownPending && !managing) {
        throw denied("Cette demande ne peut plus être modifiée.");
      }
    }
  }
}

function whereClause(filters) {
  const params = [];
  const parts = filters.map((filter) => {
    const col = colSql(filter.column);
    if (filter.op === "eq") {
      params.push(filter.value);
      return `${col} = $${params.length}`;
    }
    if (filter.op === "neq") {
      params.push(filter.value);
      return `${col} <> $${params.length}`;
    }
    if (filter.op === "gte") {
      params.push(filter.value);
      return `${col} >= $${params.length}`;
    }
    if (filter.op === "lte") {
      params.push(filter.value);
      return `${col} <= $${params.length}`;
    }
    if (filter.op === "gt") {
      params.push(filter.value);
      return `${col} > $${params.length}`;
    }
    if (filter.op === "lt") {
      params.push(filter.value);
      return `${col} < $${params.length}`;
    }
    if (filter.op === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (!values.length) return "false";
      params.push(values);
      return `${col} = any($${params.length})`;
    }
    if (filter.op === "is") {
      if (filter.value === null) return `${col} is null`;
      params.push(filter.value);
      return `${col} is not distinct from $${params.length}`;
    }
    throw denied(`Filtre non supporté: ${filter.op}`, 400);
  });
  return { sql: parts.length ? ` where ${parts.join(" and ")}` : "", params };
}

function returningColumns(select) {
  const parsed = parseSelect(select);
  return columnsFromList(parsed.columns);
}

function selectColumns(table, parsed) {
  if (table === "profiles_directory") {
    return DIRECTORY_COLUMNS.map((key) => COLUMN_SQL[key]).join(", ");
  }
  return columnsFromList(parsed.columns);
}

async function embedProfiles(rows, embed) {
  if (!embed || embed.table !== "profiles" || !rows.length) return rows;
  const ids = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  if (!ids.length) return rows.map((row) => ({ ...row, profiles: null }));
  const cols = embed.columns.length
    ? [...new Set(["id", ...embed.columns])].map(colSql).join(", ")
    : '"id", "full_name", "email"';
  const { rows: profiles } = await dbQuery(
    `select ${cols} from public.profiles where id = any($1)`,
    [ids]
  );
  const map = new Map(profiles.map((item) => [item.id, item]));
  return rows.map((row) => ({ ...row, profiles: map.get(row.user_id) || null }));
}

function payloadKeys(row) {
  return Object.keys(COLUMN_SQL).filter((key) => Object.prototype.hasOwnProperty.call(row || {}, key));
}

function auditRead(user, table, rows) {
  if (table !== "payslips" && table !== "hr_documents") return Promise.resolve();
  const list = (rows || []).filter(Boolean);
  return logSensitiveAccess({
    actor: user,
    action: table === "payslips" ? "payslip.read" : "hr_document.read",
    table,
    targetUserId: list.length === 1 ? list[0].user_id || null : null,
    meta: {
      count: list.length,
      ids: list.map((row) => row.id).filter(Boolean).slice(0, 50)
    }
  });
}

export async function runQuery(user, body) {
  try {
    return await withUser(user, (client) => tx.run(client, () => executeQuery(user, body)));
  } catch (error) {
    if (rlsDenied(error)) throw denied("Accès refusé.");
    throw error;
  }
}

const QUERY_OPS = new Set(["select", "insert", "update", "delete", "upsert"]);

async function executeQuery(user, body) {
  const { table, fromSql } = resolveLogicalTable(String(body.table || ""));
  const op = QUERY_OPS.has(body.op) ? body.op : (body.op ? "" : "select");
  if (!op) return { data: null, error: { message: `Opération inconnue: ${body.op}` } };
  const parsed = parseSelect(body.select);

  const filters = await applyReadScope(table, user, Array.isArray(body.filters) ? body.filters : []);

  if (op === "insert" || op === "upsert") {
    const rows = Array.isArray(body.payload) ? body.payload : [body.payload];
    await prepareWriteRows(table, user, rows);
    body.payload = Array.isArray(body.payload) ? rows : rows[0];
  }

  if (op !== "select") {
    await assertWriteAllowed(table, fromSql, user, op, body.payload, filters, body.onConflict);
  }

  if (op === "select") {
    const cols = selectColumns(table, parsed);
    const { sql, params } = whereClause(filters);
    let text = `select ${cols} from public.${fromSql}${sql}`;
    if (body.order?.column) {
      const orderKey = Object.keys(COLUMN_SQL).find((key) => key === body.order.column);
      if (orderKey) {
        text += ` order by ${COLUMN_SQL[orderKey]} ${body.order.ascending === false ? "desc" : "asc"}`;
      }
    }
    const limit = resolveSelectLimit(table, body.limit);
    if (limit) {
      params.push(limit);
      text += ` limit $${params.length}`;
    }
    const adminDirectory = isHr(user) && (table === "profiles" || table === "profiles_directory");
    const result = adminDirectory ? await adminQuery(text, params) : await dbQuery(text, params);
    const data = await embedProfiles(result.rows, parsed.embed);
    await auditRead(user, table, data);
    if (body.maybeSingle || body.single) {
      if (body.single && !data[0]) {
        return { data: null, error: { message: "Aucune ligne", code: "PGRST116" } };
      }
      return { data: data[0] || null, error: null };
    }
    return { data, error: null, count: data.length };
  }

  if (op === "insert" || op === "upsert") {
    const rows = Array.isArray(body.payload) ? body.payload : [body.payload];
    const first = rows[0] || {};
    const keys = payloadKeys(first);
    if (!keys.length) return { data: null, error: { message: "Payload vide" } };
    const values = [];
    const tuples = rows.map((row, rowIndex) => {
      const placeholders = keys.map((key, keyIndex) => {
        values.push(row[key]);
        return `$${rowIndex * keys.length + keyIndex + 1}`;
      });
      return `(${placeholders.join(",")})`;
    });
    let text = `insert into public.${fromSql} (${keys.map((key) => COLUMN_SQL[key]).join(",")}) values ${tuples.join(",")}`;
    if (op === "upsert") {
      text += upsertConflictClause(body.onConflict, keys);
    }
    text += ` returning ${returningColumns(body.select || "*")}`;
    let result;
    try {
      result = await execWrite(text, values);
    } catch (error) {
      const msg = String(error.message || "");
      if (op === "upsert" && /no unique or exclusion constraint/i.test(msg)) {
        const insertOnly = text.replace(/\s+on conflict[\s\S]*?(?= returning)/i, "");
        result = await execWrite(insertOnly, values);
      } else {
        throw error;
      }
    }
    if (body.single || body.maybeSingle) return { data: result.rows[0] || null, error: null };
    return { data: result.rows, error: null };
  }

  if (op === "update") {
    const payload = body.payload || {};
    const keys = payloadKeys(payload);
    if (!keys.length) return { data: null, error: { message: "Payload vide" } };
    const { sql, params } = whereClause(filters);
    if (!sql) {
      return { data: null, error: { message: "Update sans filtre refusé" } };
    }
    const setParams = keys.map((key) => payload[key]);
    const sets = keys.map((key, index) => `${COLUMN_SQL[key]} = $${index + 1}`);
    const whereSql = sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + keys.length}`);
    const text = `update public.${fromSql} set ${sets.join(", ")}${whereSql} returning *`;
    const result = await execWrite(text, [...setParams, ...params]);
    return { data: result.rows, error: null };
  }

  if (op === "delete") {
    const { sql, params } = whereClause(filters);
    if (!sql) return { data: null, error: { message: "Delete sans filtre refusé" } };
    const result = await execWrite(`delete from public.${fromSql}${sql} returning *`, params);
    return { data: result.rows, error: null };
  }

  return { data: null, error: { message: `Opération inconnue: ${op}` } };
}
