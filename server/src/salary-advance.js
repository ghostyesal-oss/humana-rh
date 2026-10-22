import { adminQuery } from "./db.js";
import { evaluateSalaryAdvance, latestNetSalary } from "./salary-advance-rules.js";

export {
  ADVANCE_CUTOFF_DAY,
  ADVANCE_NET_RATIO,
  ADVANCE_YEAR_LIMIT,
  evaluateSalaryAdvance,
  isCadreProfile
} from "./salary-advance-rules.js";

async function loadCompanyOffsetMinutes() {
  try {
    const { rows } = await adminQuery(
      "select value from public.app_settings where key = 'company_timezone' limit 1"
    );
    const raw = rows[0]?.value;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
    if (/\bGMT\b/.test(text) && !text.includes("1")) return 0;
  } catch {
    /* défaut GMT+1 */
  }
  return 60;
}

async function loadEdsPayrollValue() {
  const { rows } = await adminQuery(
    "select value from public.app_settings where key = 'eds_payroll' limit 1"
  );
  const raw = rows[0]?.value;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function nowForAdvance() {
  const raw = process.env.SALARY_ADVANCE_NOW || "";
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

export async function salaryAdvanceQuotaFor(userId, amount, now = nowForAdvance()) {
  const [{ rows: profileRows }, { rows: requestRows }, eds, offsetMinutes] = await Promise.all([
    adminQuery(
      "select id, hired_at, leave_grade, job_title, role from public.profiles where id = $1 limit 1",
      [userId]
    ),
    adminQuery(
      "select status, created_at from public.salary_advance_requests where user_id = $1",
      [userId]
    ),
    loadEdsPayrollValue(),
    loadCompanyOffsetMinutes()
  ]);
  const profile = profileRows[0] || { hired_at: null, leave_grade: "employee" };
  const netSalary = latestNetSalary(eds, userId);
  return evaluateSalaryAdvance({
    profile,
    requests: requestRows,
    netSalary,
    amount,
    now,
    offsetMinutes
  });
}

export async function assertSalaryAdvanceInsert(userId, amount) {
  const result = await salaryAdvanceQuotaFor(userId, amount);
  if (!result.ok) {
    const error = new Error(result.reason);
    error.status = 400;
    throw error;
  }
  return result;
}
