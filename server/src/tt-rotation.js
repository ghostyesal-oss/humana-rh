/** Rotation mensuelle du télétravail (R&D 3j, CS/CES 2j, bureau jamais vide). */

export const TT_QUOTA = { rnd: 3, cs: 2, ces: 2 };

export function ttQuotaForDept(dept) {
  const key = String(dept || "").toLowerCase();
  return TT_QUOTA[key] || 2;
}

export function monthRotationOffset(year, monthIndex) {
  const y = Number(year);
  const m = Number(monthIndex);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return ((y * 12) + m) % 5;
}

export function isValidatedLeaveStatus(status) {
  const value = String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!value || value.includes("refus") || value.includes("rejet")) return false;
  if (value.startsWith("a valider") || value.includes("prise en charge")) return false;
  return value.startsWith("approuv") || value.startsWith("valid");
}

export function weekdayFromIso(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getDay();
}

export function ttWeekdaysForPerson(personIndex, monthOffset, quota) {
  const count = Math.max(0, Math.min(5, Number(quota) || 0));
  const start = ((Number(personIndex) || 0) + (Number(monthOffset) || 0)) % 5;
  const days = [];
  for (let i = 0; i < count; i += 1) days.push(((start + i) % 5) + 1);
  return days;
}

function groupByDept(people) {
  const buckets = { rnd: [], cs: [], ces: [] };
  [...people].sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((person) => {
    const dept = buckets[person.dept] ? person.dept : "cs";
    buckets[dept].push({ ...person, dept });
  });
  return buckets;
}

function countKind(assign, personId, dates, kind) {
  return dates.filter((date) => assign[`${personId}|${date}`] === kind).length;
}

function pickToForceOffice(candidates, assign, dates) {
  return [...candidates].sort((a, b) => {
    const ta = countKind(assign, a.id, dates, "TT");
    const tb = countKind(assign, b.id, dates, "TT");
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/**
 * @param {Array<{id: string, dept: string}>} people
 * @param {string[]} workDates ISO dates (Mon–Fri, non fériés)
 * @param {{ year: number, monthIndex: number, skip?: Set<string> }} options skip = `${userId}|${date}`
 * @returns {Record<string, "TT"|"PR">} map `${userId}|${date}`
 */
export function assignTtRotation(people, workDates, options = {}) {
  const list = Array.isArray(people) ? people : [];
  const dates = Array.isArray(workDates) ? workDates : [];
  const skip = options.skip instanceof Set ? options.skip : new Set();
  const offset = monthRotationOffset(options.year, options.monthIndex);
  const buckets = groupByDept(list);
  const sorted = ["rnd", "cs", "ces"].flatMap((dept) => buckets[dept]);
  const assign = {};

  Object.entries(buckets).forEach(([, members]) => {
    members.forEach((person, index) => {
      const ttDays = new Set(ttWeekdaysForPerson(index, offset, ttQuotaForDept(person.dept)));
      dates.forEach((date) => {
        const key = `${person.id}|${date}`;
        if (skip.has(key)) return;
        const weekday = weekdayFromIso(date);
        assign[key] = ttDays.has(weekday) ? "TT" : "PR";
      });
    });
  });

  const available = (date, dept) => sorted.filter((person) => {
    if (dept && person.dept !== dept) return false;
    return !skip.has(`${person.id}|${date}`);
  });
  const withKind = (date, dept, kind) => available(date, dept).filter((person) => (
    assign[`${person.id}|${date}`] === kind
  ));

  const forceOffice = (date, candidates) => {
    const pick = pickToForceOffice(candidates, assign, dates);
    if (pick) assign[`${pick.id}|${date}`] = "PR";
  };

  dates.forEach((date) => {
    ["rnd", "cs", "ces"].forEach((dept) => {
      if (available(date, dept).length < 2) return;
      if (!withKind(date, dept, "PR").length) forceOffice(date, withKind(date, dept, "TT"));
    });
    if (available(date).length && !withKind(date, null, "PR").length) {
      forceOffice(date, withKind(date, null, "TT"));
    }
  });

  return assign;
}
