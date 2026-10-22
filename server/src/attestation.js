import { adminQuery } from "./db.js";
import { evaluateAttestationRequest, isAttestationDocumentType } from "./attestation-rules.js";

export {
  ATTESTATION_COOLDOWN_MONTHS,
  ATTESTATION_TYPE_LIMIT,
  ATTESTATION_TYPES,
  evaluateAttestationRequest,
  isAttestationDocumentType
} from "./attestation-rules.js";

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

export async function assertAttestationInsert(userId, documentType, extraUsed = 0) {
  if (!isAttestationDocumentType(documentType)) return { ok: true, reason: null };
  const [{ rows }, offsetMinutes] = await Promise.all([
    adminQuery(
      "select document_type, status, created_at from public.attestation_requests where user_id = $1",
      [userId]
    ),
    loadCompanyOffsetMinutes()
  ]);
  const result = evaluateAttestationRequest({
    type: documentType,
    requests: rows,
    extraUsed,
    offsetMinutes
  });
  if (!result.ok) {
    const error = new Error(result.reason);
    error.status = 400;
    throw error;
  }
  return result;
}
