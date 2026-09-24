import { adminQuery } from "./db.js";

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
           hired_at = coalesce($9, hired_at)
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
        row.hired_at || null
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

export async function runRpc(user, name, args) {
  if (name === "apply_pending_invite") return applyPendingInvite(user, args || {});
  if (name === "notify_auto_clock_out") return notifyAutoClockOut(user, args || {});
  if (name === "process_auto_clock_outs") return rpcMissing(name);
  return rpcMissing(name);
}
