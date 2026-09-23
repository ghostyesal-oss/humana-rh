-- Stubs pour un dump SQL Supabase (FK vers auth.users / storage) dans Postgres vanilla.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
);

grant usage on schema public, auth, storage to humana;
