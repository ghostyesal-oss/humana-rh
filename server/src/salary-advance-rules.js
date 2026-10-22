export const ADVANCE_CUTOFF_DAY = 6;
export const ADVANCE_YEAR_LIMIT = 4;
export const ADVANCE_NET_RATIO = 0.3;

export function isCadreProfile(profile) {
  const grade = String(profile?.leave_grade || "").toLowerCase();
  const title = String(profile?.job_title || "").toLowerCase();
  const role = String(profile?.role || "").toLowerCase();
  if (grade === "manager" || grade === "codir") return true;
  if (title.includes("directeur") || title.includes("directrice") || title.includes("codir")) return true;
  return role === "manager" || role === "admin" || role === "creator";
}

export function minAdvanceMonths(profile) {
  return isCadreProfile(profile) ? 3 : 6;
}

export function addMonthsUtc(isoDate, months) {
  const [year, month, day] = String(isoDate || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1 + months, day));
}

export function hasAdvanceSeniority(profile, at = new Date()) {
  const hired = String(profile?.hired_at || "").slice(0, 10);
  if (!hired) return false;
  const eligible = addMonthsUtc(hired, minAdvanceMonths(profile));
  if (!eligible) return false;
  return at.getTime() >= eligible.getTime();
}

export function companyCivilDay(at = new Date(), offsetMinutes = 60) {
  const shifted = new Date(at.getTime() + Number(offsetMinutes || 0) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

export function isAdvanceWindowOpen(at = new Date(), offsetMinutes = 60, cutoffDay = ADVANCE_CUTOFF_DAY) {
  return companyCivilDay(at, offsetMinutes).day < cutoffDay;
}

export function countsTowardYearQuota(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("refus") || value.includes("rejet")) return false;
  return true;
}

export function latestNetSalary(edsPayroll, userId) {
  let bestStart = "";
  let best = null;
  const cycles = edsPayroll && typeof edsPayroll === "object" ? edsPayroll : {};
  for (const [cycle, users] of Object.entries(cycles)) {
    const start = String(cycle).split("_")[0] || "";
    const raw = users && userId ? users[userId]?.salaireNet : null;
    const net = Number(String(raw ?? "").replace(",", "."));
    if (!Number.isFinite(net) || net <= 0) continue;
    if (start >= bestStart) {
      bestStart = start;
      best = net;
    }
  }
  return best;
}

export function maxAdvanceAmount(netSalary) {
  if (!Number.isFinite(netSalary) || netSalary <= 0) return null;
  return Math.round(netSalary * ADVANCE_NET_RATIO * 100) / 100;
}

export function yearAdvanceUsed(requests, year) {
  return (requests || []).filter((row) => {
    if (!countsTowardYearQuota(row.status)) return false;
    const stamp = String(row.created_at || row.created || "").slice(0, 4);
    return Number(stamp) === Number(year);
  }).length;
}

export function evaluateSalaryAdvance({ profile, requests, netSalary, amount, now, offsetMinutes = 60 }) {
  const civil = companyCivilDay(now, offsetMinutes);
  const cadre = isCadreProfile(profile);
  const minMonths = minAdvanceMonths(profile);
  const windowOpen = isAdvanceWindowOpen(now, offsetMinutes);
  const eligible = hasAdvanceSeniority(profile, now);
  const used = yearAdvanceUsed(requests, civil.year);
  const maxAmount = maxAdvanceAmount(netSalary);
  const quota = {
    windowOpen,
    cutoffDay: ADVANCE_CUTOFF_DAY,
    companyDay: civil.day,
    year: civil.year,
    eligible,
    cadre,
    minMonths,
    hiredAt: profile?.hired_at || null,
    yearUsed: used,
    yearLimit: ADVANCE_YEAR_LIMIT,
    yearRemaining: Math.max(0, ADVANCE_YEAR_LIMIT - used),
    netSalary: netSalary || null,
    maxAmount,
    ratio: ADVANCE_NET_RATIO
  };

  if (!windowOpen) {
    return { ok: false, reason: `Les demandes d'avance sont bloquées à partir du ${ADVANCE_CUTOFF_DAY} du mois.`, quota };
  }
  if (!eligible) {
    const who = cadre ? "cadre" : "collaborateur";
    return {
      ok: false,
      reason: `L'avance sur salaire est possible après ${minMonths} mois d'ancienneté (${who}).`,
      quota
    };
  }
  if (used >= ADVANCE_YEAR_LIMIT) {
    return { ok: false, reason: `Quatre avances maximum par an (${used}/${ADVANCE_YEAR_LIMIT} déjà utilisées).`, quota };
  }
  if (!maxAmount) {
    return { ok: false, reason: "Salaire net EDS introuvable. Contactez le RH pour mettre à jour le rapport EDS.", quota };
  }
  if (amount != null) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: "Indiquez un montant d'avance supérieur à 0.", quota };
    }
    if (value > maxAmount + 0.001) {
      return {
        ok: false,
        reason: `Le montant ne peut pas dépasser 30 % du salaire net (${maxAmount.toLocaleString("fr-FR")} MAD).`,
        quota
      };
    }
  }
  return { ok: true, reason: null, quota };
}
