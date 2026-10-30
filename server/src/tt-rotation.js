/** Rotation mensuelle du télétravail (R&D 3j/semaine, CS/CES 2j/semaine, bureau jamais vide). */

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

export function mondayKey(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - (weekday - 1));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function datesByWeek(dates) {
  const groups = new Map();
  for (const date of dates) {
    const key = mondayKey(date);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    const bucket = groups.get(key);
    if (!bucket.includes(date)) bucket.push(date);
  }
  return [...groups.values()];
}

function lockedDateOf(key) {
  const index = String(key || "").lastIndexOf("|");
  return index >= 0 ? key.slice(index + 1) : "";
}

function mergeLockedAssign(assign, locked) {
  Object.entries(locked || {}).forEach(([key, kind]) => {
    if (kind === "TT" || kind === "PR") assign[key] = kind;
  });
}

function ensureOfficeOccupied(assign, people, dates, skip, countDates) {
  const tallyDates = Array.isArray(countDates) && countDates.length ? countDates : dates;
  const available = (date, dept) => people.filter((person) => {
    if (dept && person.dept !== dept) return false;
    return !skip.has(`${person.id}|${date}`);
  });
  const withKind = (date, dept, kind) => available(date, dept).filter((person) => (
    assign[`${person.id}|${date}`] === kind
  ));
  const forceOffice = (date, candidates) => {
    const pick = pickToForceOffice(candidates, assign, tallyDates);
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
}

function onsiteInDept(assign, people, date, dept, skip) {
  return people.filter((person) => {
    if (person.dept !== dept) return false;
    if (skip.has(`${person.id}|${date}`)) return false;
    return assign[`${person.id}|${date}`] === "PR";
  }).length;
}

function rebalanceWeeklyQuota(assign, people, dates, skip) {
  const editable = new Set(dates);
  const weekSource = [...dates];
  Object.keys(assign).forEach((key) => {
    const date = lockedDateOf(key);
    if (date) weekSource.push(date);
  });
  datesByWeek(weekSource).forEach((weekDates) => {
    people.forEach((person) => {
      const quota = ttQuotaForDept(person.dept);
      const available = weekDates.filter((date) => (
        !skip.has(`${person.id}|${date}`) && (assign[`${person.id}|${date}`] === "TT" || assign[`${person.id}|${date}`] === "PR")
      ));
      const target = Math.min(quota, available.length);
      const editableDays = available.filter((date) => editable.has(date));
      const ttDays = () => editableDays.filter((date) => assign[`${person.id}|${date}`] === "TT");
      const prDays = () => editableDays.filter((date) => assign[`${person.id}|${date}`] === "PR");
      let tt = available.filter((date) => assign[`${person.id}|${date}`] === "TT").length;
      const addCandidates = [...prDays()].sort((a, b) => (
        onsiteInDept(assign, people, b, person.dept, skip) - onsiteInDept(assign, people, a, person.dept, skip)
      ) || String(a).localeCompare(String(b)));
      for (const date of addCandidates) {
        if (tt >= target) break;
        const deptPresent = people.filter((row) => (
          row.dept === person.dept && !skip.has(`${row.id}|${date}`) && assign[`${row.id}|${date}`]
        )).length;
        if (deptPresent >= 2 && onsiteInDept(assign, people, date, person.dept, skip) <= 1) continue;
        assign[`${person.id}|${date}`] = "TT";
        tt += 1;
      }
      for (const date of ttDays()) {
        if (tt <= target) break;
        assign[`${person.id}|${date}`] = "PR";
        tt -= 1;
      }
    });
  });
}

/**
 * @param {Array<{id: string, dept: string}>} people
 * @param {string[]} workDates ISO dates à générer (Mon–Fri)
 * @param {{ year: number, monthIndex: number, skip?: Set<string>, locked?: Record<string, "TT"|"PR"> }} options
 *        locked = jours déjà planifiés d'une semaine à cheval (`${userId}|${date}`)
 * @returns {Record<string, "TT"|"PR">} map `${userId}|${date}`
 */
export function assignTtRotation(people, workDates, options = {}) {
  const list = Array.isArray(people) ? people : [];
  const dates = Array.isArray(workDates) ? workDates : [];
  const skip = options.skip instanceof Set ? options.skip : new Set();
  const locked = options.locked && typeof options.locked === "object" ? options.locked : {};
  const offset = monthRotationOffset(options.year, options.monthIndex);
  const buckets = groupByDept(list);
  const sorted = ["rnd", "cs", "ces"].flatMap((dept) => buckets[dept]);
  const assign = {};
  mergeLockedAssign(assign, locked);
  const countDates = [...new Set([...dates, ...Object.keys(locked).map(lockedDateOf).filter(Boolean)])];

  Object.entries(buckets).forEach(([, members]) => {
    members.forEach((person, index) => {
      const ttDays = new Set(ttWeekdaysForPerson(index, offset, ttQuotaForDept(person.dept)));
      dates.forEach((date) => {
        const key = `${person.id}|${date}`;
        if (skip.has(key) || Object.prototype.hasOwnProperty.call(locked, key)) return;
        const weekday = weekdayFromIso(date);
        assign[key] = ttDays.has(weekday) ? "TT" : "PR";
      });
    });
  });

  ensureOfficeOccupied(assign, sorted, dates, skip, countDates);
  rebalanceWeeklyQuota(assign, sorted, dates, skip);
  ensureOfficeOccupied(assign, sorted, dates, skip, countDates);
  return assign;
}
