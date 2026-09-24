-- Baseline idempotent : un Postgres vierge peut reconstruire le schéma.
-- Sûr à rejouer sur la base OVH déjà restaurée (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

create table if not exists public.schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  role text not null default 'employee',
  job_title text,
  department text,
  manager_id uuid,
  matricule text,
  shift_code text default 'cs',
  hired_at date,
  leave_grade text default 'employee',
  avatar_url text,
  phone text,
  leave_balance_cp numeric,
  leave_balance_rtt numeric,
  leave_balance_recup numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists manager_id uuid;
alter table public.profiles add column if not exists matricule text;
alter table public.profiles add column if not exists shift_code text;
alter table public.profiles add column if not exists hired_at date;
alter table public.profiles add column if not exists leave_grade text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists leave_balance_cp numeric;
alter table public.profiles add column if not exists leave_balance_rtt numeric;
alter table public.profiles add column if not exists leave_balance_recup numeric;

create table if not exists public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  role text default 'employee',
  job_title text,
  department text,
  manager_id uuid,
  shift_code text default 'cs',
  leave_grade text default 'employee',
  hired_at date,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.pending_invites add column if not exists hired_at date;
alter table public.pending_invites add column if not exists shift_code text;
alter table public.pending_invites add column if not exists leave_grade text;
alter table public.pending_invites add column if not exists created_by uuid;
create unique index if not exists pending_invites_email_key on public.pending_invites (email);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb
);

create table if not exists public.time_punches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  punch_type text not null,
  punched_at timestamptz not null default now(),
  punch_date date,
  lat double precision,
  lng double precision,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  note text,
  source text,
  location text,
  work_location text,
  work_status text,
  connection_method text,
  operating_system text,
  browser_application text,
  ip_address text,
  network_type text,
  disconnect_reason text,
  created_at timestamptz not null default now()
);

alter table public.time_punches add column if not exists work_location text;
alter table public.time_punches add column if not exists work_status text;
alter table public.time_punches add column if not exists connection_method text;
alter table public.time_punches add column if not exists operating_system text;
alter table public.time_punches add column if not exists browser_application text;
alter table public.time_punches add column if not exists ip_address text;
alter table public.time_punches add column if not exists network_type text;
alter table public.time_punches add column if not exists disconnect_reason text;

create index if not exists time_punches_user_punched_idx
  on public.time_punches (user_id, punched_at);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  leave_type text,
  type text,
  start_date date,
  end_date date,
  days numeric,
  hours numeric,
  unit text default 'days',
  half_day text,
  motif text,
  attachment_name text,
  workflow_step integer default 1,
  comment text,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

alter table public.leave_requests add column if not exists unit text;
alter table public.leave_requests add column if not exists half_day text;
alter table public.leave_requests add column if not exists hours numeric;
alter table public.leave_requests add column if not exists motif text;
alter table public.leave_requests add column if not exists attachment_name text;
alter table public.leave_requests add column if not exists workflow_step integer;

create table if not exists public.attestation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text,
  document_type text,
  reason text,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

alter table public.attestation_requests add column if not exists document_type text;

create table if not exists public.salary_advance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric(12, 2) not null,
  reason text,
  requested_date date,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

create table if not exists public.punch_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  punch_date date not null,
  requested_time time,
  punch_kind text,
  reason text,
  status text not null default 'A valider',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.punch_corrections add column if not exists punch_kind text;
alter table public.punch_corrections add column if not exists reviewed_by uuid;
alter table public.punch_corrections add column if not exists reviewed_at timestamptz;

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  work_date date not null,
  hours numeric not null,
  reason text,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

create table if not exists public.activity_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  work_date date not null,
  hours numeric not null,
  category text not null,
  comment text,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

create table if not exists public.hr_alerts (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  title text,
  body text,
  message text,
  kind text,
  payload jsonb,
  read_at timestamptz,
  subject_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists hr_alerts_recipient_idx
  on public.hr_alerts (recipient_id, created_at desc);

create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  visibility text not null default 'all',
  file_url text,
  storage_path text,
  published_at date,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.hr_documents add column if not exists visibility text;
alter table public.hr_documents add column if not exists storage_path text;

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  period text,
  period_label text,
  period_month integer,
  period_year integer,
  month integer,
  year integer,
  file_url text,
  storage_path text,
  published_at date,
  created_at timestamptz not null default now()
);

alter table public.payslips add column if not exists period_label text;
alter table public.payslips add column if not exists period_month integer;
alter table public.payslips add column if not exists period_year integer;
alter table public.payslips add column if not exists storage_path text;
do $$
begin
  create unique index if not exists payslips_user_period_key
    on public.payslips (user_id, period_year, period_month)
    where period_year is not null and period_month is not null;
exception
  when unique_violation then
    raise notice 'payslips_user_period_key ignore: periodes en double';
end $$;

create table if not exists public.company_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  event_type text not null default 'general',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  visibility text not null default 'all',
  poster_url text,
  poster_path text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_events add column if not exists poster_url text;
alter table public.company_events add column if not exists poster_path text;
create index if not exists company_events_starts_at_idx
  on public.company_events (starts_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create or replace view public.profiles_directory as
select id, email, full_name, job_title, department, role, manager_id,
       matricule, shift_code, hired_at, leave_grade
from public.profiles;

grant all on all tables in schema public to current_user;
grant all on all sequences in schema public to current_user;
grant all on all functions in schema public to current_user;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'humana') then
    execute 'grant all on all tables in schema public to humana';
    execute 'grant all on all sequences in schema public to humana';
    execute 'grant all on all functions in schema public to humana';
    execute 'alter default privileges in schema public grant all on tables to humana';
  end if;
end $$;
