-- Stubs + roles pour un dump SQL Supabase dans Postgres vanilla.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$ select 'service_role'; $$;

grant usage on schema public, auth, storage to humana, authenticated, anon;
grant all on schema public to humana;
