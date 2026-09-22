import { writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_ANON_KEY || "";
const redirect = process.env.REDIRECT_URL || "https://humana-rh.vercel.app";
const vapid = process.env.VAPID_PUBLIC_KEY || "";

const config = `window.HUMANA_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
  REDIRECT_URL: ${JSON.stringify(redirect)},
  VAPID_PUBLIC_KEY: ${JSON.stringify(vapid)}
};
`;

writeFileSync("config.js", config);
console.log("config.js généré pour le déploiement.");
