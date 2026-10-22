import { addMonthsUtc, companyCivilDay } from "./salary-advance-rules.js";

export const ATTESTATION_COOLDOWN_MONTHS = 3;
export const ATTESTATION_TYPE_LIMIT = 1;
export const ATTESTATION_TYPES = [
  "Attestation de travail",
  "Attestation de salaire",
  "Domiciliation de salaire",
  "Attestation de titularisation",
  "Attestation de déclaration de salaire annuel",
  "Bulletins de paie cachetés"
];

export function isAttestationDocumentType(type) {
  return ATTESTATION_TYPES.includes(String(type || "").trim());
}

export function countsTowardAttestationQuota(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("refus") || value.includes("rejet")) return false;
  return true;
}

function parseStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function civilDateKey(value, offsetMinutes = 60) {
  const date = parseStamp(value) || new Date();
  const civil = companyCivilDay(date, offsetMinutes);
  return `${civil.year}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
}

export function addMonthsToDateKey(dateKey, months = ATTESTATION_COOLDOWN_MONTHS) {
  const added = addMonthsUtc(dateKey, months);
  if (!added) return null;
  return added.toISOString().slice(0, 10);
}

export function formatDateKeyFr(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

export function lastAttestationByType(requests, offsetMinutes = 60) {
  const last = {};
  for (const row of requests || []) {
    const type = String(row.document_type || row.type || "").trim();
    if (!isAttestationDocumentType(type)) continue;
    if (!countsTowardAttestationQuota(row.status)) continue;
    const dateKey = civilDateKey(row.created_at || row.created, offsetMinutes);
    if (!last[type] || dateKey > last[type]) last[type] = dateKey;
  }
  return last;
}

export function attestationTypeCounts(requests, now = new Date(), offsetMinutes = 60) {
  const todayKey = civilDateKey(now, offsetMinutes);
  const last = lastAttestationByType(requests, offsetMinutes);
  const counts = {};
  for (const type of ATTESTATION_TYPES) {
    const next = last[type] ? addMonthsToDateKey(last[type]) : null;
    counts[type] = next && todayKey < next ? 1 : 0;
  }
  return { counts, last, todayKey };
}

export function evaluateAttestationRequest({
  type,
  requests = [],
  now = new Date(),
  offsetMinutes = 60,
  extraUsed = 0
} = {}) {
  const { counts, last, todayKey } = attestationTypeCounts(requests, now, offsetMinutes);
  const documentType = String(type || "").trim();
  if (!isAttestationDocumentType(documentType)) {
    return {
      ok: true,
      reason: null,
      counts,
      used: 0,
      remaining: ATTESTATION_TYPE_LIMIT,
      lastDate: null,
      nextAvailable: null
    };
  }
  const lastDate = last[documentType] || null;
  const nextAvailable = lastDate ? addMonthsToDateKey(lastDate) : null;
  const used = (counts[documentType] || 0) + Number(extraUsed || 0);
  const remaining = Math.max(0, ATTESTATION_TYPE_LIMIT - used);
  if (used >= ATTESTATION_TYPE_LIMIT) {
    const nextLabel = nextAvailable ? formatDateKeyFr(nextAvailable) : "";
    const lastLabel = lastDate ? formatDateKeyFr(lastDate) : "";
    const when = lastLabel && nextLabel
      ? ` (demandé le ${lastLabel}, prochaine demande possible le ${nextLabel})`
      : "";
    return {
      ok: false,
      reason: `« ${documentType} » a déjà été demandé il y a moins de ${ATTESTATION_COOLDOWN_MONTHS} mois${when}. Un seul document du même type tous les ${ATTESTATION_COOLDOWN_MONTHS} mois.`,
      counts,
      used,
      remaining,
      lastDate,
      nextAvailable,
      todayKey
    };
  }
  return {
    ok: true,
    reason: null,
    counts,
    used,
    remaining,
    lastDate,
    nextAvailable,
    todayKey
  };
}
