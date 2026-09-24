import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, withClient } from "./db.js";

export async function runMigrations() {
  await query(`
    create table if not exists public.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../sql/migrations");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const done = await query("select 1 from public.schema_migrations where id = $1", [id]);
    if (done.rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`migration ${id}`);
    // Sans 2e argument : protocole simple Postgres (plusieurs instructions dans le fichier).
    await withClient(async (client) => {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (id) values ($1)", [id]);
    });
  }
}
