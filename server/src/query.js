import { query, withClient } from "./db.js";

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
  created_by: '"created_by"'
});

const DIRECTORY_COLUMNS = [
  "id", "email", "full_name", "job_title", "department", "role", "manager_id",
  "matricule", "shift_code", "hired_at", "leave_grade"
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
  "hr_alerts"
]);

const EMPLOYEE_PROFILE_FIELDS = new Set(["id", "email", "full_name", "avatar_url", "phone"]);

function denied(message, status = 403) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function execWrite(text, values) {
  return withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = replica");
      const result = await client.query(text, values);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function resolveLogicalTable(requested) {
  let table = "";
  let fromSql = "";
  if (requested === "time_punches") { table = "time_punches"; fromSql = '"time_punches"'; }
  else if (requested === "leave_requests") { table = "leave_requests"; fromSql = '"leave_requests"'; }
  else if (requested === "punch_corrections") { table = "punch_corrections"; fromSql = '"punch_corrections"'; }
  else if (requested === "profiles") { table = "profiles"; fromSql = '"profiles"'; }
  else if (requested === "profiles_directory") { table = "profiles_directory"; fromSql = '"profiles"'; }
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
  if (!table || !fromSql) throw denied(`Table non autorisée: ${requested}`, 400);
  return { table, fromSql };
}

function colSql(name) {
  const key = Object.keys(COLUMN_SQL).find((item) => item === name);
  if (!key) throw denied(`Colonne non autorisée: ${name}`, 400);
  return COLUMN_SQL[key];
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

function isManager(user) {
  return isAdmin(user) || user?.role === "manager";
}

async function reportIds(userId) {
  const { rows } = await query("select id from public.profiles where manager_id = $1", [userId]);
  return rows.map((row) => row.id);
}

async function applyReadScope(table, user, filters, op = "select") {
  const admin = isAdmin(user);
  if (table === "app_settings" || table === "company_events" || table === "hr_documents") {
    return filters;
  }
  if (table === "pending_invites") {
    if (!admin) throw denied("Accès refusé.");
    return filters;
  }
  if (table === "profiles" || table === "profiles_directory") {
    if (!admin && !isManager(user) && op !== "select") {
      return [{ op: "eq", column: "id", value: user.sub }];
    }
    return filters;
  }
  if (table === "payslips" && !admin) {
    return [
      ...filters.filter((item) => item.column !== "user_id"),
      { op: "eq", column: "user_id", value: user.sub }
    ];
  }
  const userCol = table === "hr_alerts" ? "recipient_id" : "user_id";
  if (admin) return filters;
  if (!isManager(user) && PERSONAL_TABLES.has(table)) {
    return [
      ...filters.filter((item) => item.column !== userCol),
      { op: "eq", column: userCol, value: user.sub }
    ];
  }
  if (isManager(user)) {
    const hasUserFilter = filters.some((item) => item.column === userCol || item.column === "id");
    const ids = [user.sub, ...(await reportIds(user.sub))];
    if (!hasUserFilter) {
      return [...filters, { op: "in", column: userCol, value: ids }];
    }
    return filters;
  }
  return filters;
}

function assertWriteAllowed(table, user, op, payload) {
  if (ADMIN_WRITE_TABLES.has(table) && !isAdmin(user)) {
    throw denied("Accès refusé.");
  }
  const rows = Array.isArray(payload) ? payload : [payload];
  if (table === "profiles" && !isAdmin(user)) {
    for (const row of rows || []) {
      if (row && Object.prototype.hasOwnProperty.call(row, "role")) {
        throw denied("Modification du rôle refusée.");
      }
    }
    if (!isManager(user)) {
      for (const row of rows || []) {
        if (row?.id && row.id !== user.sub) throw denied("Accès refusé.");
        const keys = Object.keys(row || {});
        if (keys.some((key) => !EMPLOYEE_PROFILE_FIELDS.has(key))) {
          throw denied("Modification de profil refusée.");
        }
      }
    }
  }
  if (PERSONAL_TABLES.has(table) && !isAdmin(user) && !isManager(user) && (op === "insert" || op === "upsert")) {
    const ownerCol = table === "hr_alerts" ? "recipient_id" : "user_id";
    for (const row of rows || []) {
      if (row?.[ownerCol] && row[ownerCol] !== user.sub) throw denied("Accès refusé.");
      if (row && !row[ownerCol]) row[ownerCol] = user.sub;
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
  const { rows: profiles } = await query(
    `select ${cols} from public.profiles where id = any($1)`,
    [ids]
  );
  const map = new Map(profiles.map((item) => [item.id, item]));
  return rows.map((row) => ({ ...row, profiles: map.get(row.user_id) || null }));
}

function payloadKeys(row) {
  return Object.keys(COLUMN_SQL).filter((key) => Object.prototype.hasOwnProperty.call(row || {}, key));
}

export async function runQuery(user, body) {
  const { table, fromSql } = resolveLogicalTable(String(body.table || ""));
  const op = body.op || "select";
  const parsed = parseSelect(body.select);

  if (op !== "select") {
    assertWriteAllowed(table, user, op, body.payload);
  }

  const filters = await applyReadScope(table, user, Array.isArray(body.filters) ? body.filters : [], op);

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
    if (body.limit) {
      params.push(Number(body.limit));
      text += ` limit $${params.length}`;
    }
    const result = await query(text, params);
    const data = await embedProfiles(result.rows, parsed.embed);
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
      const conflictCols = String(body.onConflict || "id").split(",").map((item) => item.trim());
      const conflict = Object.keys(COLUMN_SQL).filter((key) => conflictCols.includes(key)).map((key) => COLUMN_SQL[key]);
      if (!conflict.length) throw denied("Conflit upsert invalide.", 400);
      const updates = keys
        .filter((key) => !conflictCols.includes(key))
        .map((key) => `${COLUMN_SQL[key]} = excluded.${COLUMN_SQL[key]}`);
      text += ` on conflict (${conflict.join(",")}) do update set ${updates.join(",") || `${COLUMN_SQL[keys[0]]} = excluded.${COLUMN_SQL[keys[0]]}`}`;
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
