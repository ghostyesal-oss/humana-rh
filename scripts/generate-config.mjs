import { writeFileSync } from "node:fs";

const config = `window.HUMANA_CONFIG = {
  SUPABASE_URL: "${process.env.SUPABASE_URL || ""}",
  SUPABASE_ANON_KEY: "${process.env.SUPABASE_ANON_KEY || ""}"
};
`;

writeFileSync("config.js", config);
console.log("config.js généré pour le déploiement.");
