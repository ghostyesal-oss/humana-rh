import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminQuery, withAdmin } from "./db.js";

export async function ensureAppRole() {
  const password = process.env.POSTGRES_PASSWORD || "";
  if (!password) {
    console.warn("POSTGRES_PASSWORD vide: mot de passe humana_app non mis à jour.");
  }
  await adminQuery(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'humana_app') then
        create role humana_app nosuperuser nocreatedb nocreaterole nobypassrls nologin;
      end if;
      alter role humana_app with login nosuperuser nocreatedb nocreaterole nobypassrls;
    end $$
  `);
  if (password) {
    const { rows } = await adminQuery("select format('alter role humana_app password %L', $1) as sql", [password]);
    await adminQuery(rows[0].sql);
  }
}

export async function grantAppRole() {
  await adminQuery(`
    do $$
    begin
      execute format('grant connect on database %I to humana_app', current_database());
    end $$
  `);
  await adminQuery(`
    grant usage on schema public, auth to humana_app;
    grant select, insert, update, delete on all tables in schema public to humana_app;
    grant usage, select on all sequences in schema public to humana_app;
    grant execute on all functions in schema public to humana_app;
    grant execute on all functions in schema auth to humana_app;
    alter default privileges for role humana in schema public
      grant select, insert, update, delete on tables to humana_app;
    alter default privileges for role humana in schema public
      grant usage, select on sequences to humana_app;
  `);
  await adminQuery(`
    do $$
    begin
      if exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'profiles_directory'
      ) then
        execute 'grant select on public.profiles_directory to humana_app';
        execute 'revoke insert, update, delete on public.profiles_directory from humana_app';
      end if;
    end $$
  `);
}

export async function runMigrations() {
  await ensureAppRole();
  await adminQuery(`create extension if not exists pgcrypto`);
  await adminQuery(`create extension if not exists "uuid-ossp"`);
  await adminQuery(`create schema if not exists auth`);
  await adminQuery(`
    create table if not exists public.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../sql/migrations");
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const done = await adminQuery("select 1 from public.schema_migrations where id = $1", [id]);
      if (done.rows.length) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      console.log(`migration ${id}`);
      await withAdmin(async (client) => {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (id) values ($1)", [id]);
      });
    }
  }
  await grantAppRole();
}
