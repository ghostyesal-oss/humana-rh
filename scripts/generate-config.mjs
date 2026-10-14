import { writeFileSync } from "node:fs";

function legalText(value, max = 220) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function legalEmail(value) {
  const text = legalText(value, 120);
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text) ? text : "";
}

function legalSiret(value) {
  return legalText(value, 20).replace(/[^\d\s]/g, "");
}

const url = process.env.API_URL || "";
const redirect = process.env.REDIRECT_URL || "";
const vapid = process.env.VAPID_PUBLIC_KEY || "";
const payrollEmails = String(process.env.PAYROLL_EMAILS || "")
  .split(/[,;]+/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const config = `window.HUMANA_CONFIG = {
  API_URL: ${JSON.stringify(url)},
  REDIRECT_URL: ${JSON.stringify(redirect)},
  VAPID_PUBLIC_KEY: ${JSON.stringify(vapid)},
  PAYROLL_EMAILS: ${JSON.stringify(payrollEmails)},
  LEGAL_PUBLISHER_NAME: ${JSON.stringify(legalText(process.env.LEGAL_PUBLISHER_NAME))},
  LEGAL_PUBLISHER_ADDRESS: ${JSON.stringify(legalText(process.env.LEGAL_PUBLISHER_ADDRESS))},
  LEGAL_SIRET: ${JSON.stringify(legalSiret(process.env.LEGAL_SIRET))},
  LEGAL_PUBLICATION_DIRECTOR: ${JSON.stringify(legalText(process.env.LEGAL_PUBLICATION_DIRECTOR))},
  LEGAL_DPO_NAME: ${JSON.stringify(legalText(process.env.LEGAL_DPO_NAME))},
  LEGAL_DPO_EMAIL: ${JSON.stringify(legalEmail(process.env.LEGAL_DPO_EMAIL))}
};
`;

writeFileSync("config.js", config);
console.log("config.js généré pour le déploiement.");
