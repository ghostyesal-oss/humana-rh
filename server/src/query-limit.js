const SELECT_UNLIMITED = new Set(["profiles", "profiles_directory", "app_settings"]);
const SELECT_MAX = Object.freeze({
  time_punches: 20000,
  planning_entries: 15000,
  leave_requests: 2000,
  attestation_requests: 400,
  salary_advance_requests: 400,
  punch_corrections: 400,
  overtime_requests: 400,
  activity_entries: 400,
  delay_reviews: 400,
  hr_documents: 200,
  payslips: 200,
  pending_invites: 200,
  company_events: 200,
  hr_alerts: 80
});
const SELECT_DEFAULT = Object.freeze({
  time_punches: 2000,
  planning_entries: 8000,
  leave_requests: 500,
  attestation_requests: 200,
  salary_advance_requests: 200,
  punch_corrections: 200,
  overtime_requests: 200,
  activity_entries: 200,
  delay_reviews: 200,
  hr_documents: 80,
  payslips: 80,
  pending_invites: 200,
  company_events: 200,
  hr_alerts: 40
});
const SELECT_MAX_FALLBACK = 5000;

export function resolveSelectLimit(table, requested) {
  const n = Number(requested);
  const asked = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (SELECT_UNLIMITED.has(table)) return asked;
  const max = SELECT_MAX[table] || SELECT_MAX_FALLBACK;
  if (asked) return Math.min(asked, max);
  return SELECT_DEFAULT[table] || max;
}
