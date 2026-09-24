import { writeFileSync } from "node:fs";

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
  PAYROLL_EMAILS: ${JSON.stringify(payrollEmails)}
};
`;

writeFileSync("config.js", config);
console.log("config.js généré pour le déploiement.");
