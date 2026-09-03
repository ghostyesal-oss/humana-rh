-- Cegid Maroc GTA (gestion des temps) — a executer dans Supabase SQL Editor.
-- M-Work n'est pas dans le perimetre : ne pas creer d'API ni de planning teletravail.

alter table if exists public.profiles
  add column if not exists hired_at date,
  add column if not exists shift_code text default 'cs',
  add column if not exists leave_grade text default 'employee';

alter table if exists public.leave_requests
  add column if not exists unit text default 'days',
  add column if not exists half_day text,
  add column if not exists hours numeric,
  add column if not exists motif text,
  add column if not exists attachment_name text,
  add column if not exists workflow_step integer default 1;

alter table if exists public.pending_invites
  add column if not exists hired_at date,
  add column if not exists shift_code text default 'cs',
  add column if not exists leave_grade text default 'employee';

create table if not exists public.punch_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  punch_date date not null,
  requested_time time,
  reason text,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

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

create or replace function public.humana_can_manage_gta(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and (
        me.role in ('admin', 'creator')
        or exists (
          select 1
          from public.profiles report
          where report.id = target
            and report.manager_id = me.id
        )
      )
  );
$$;

grant execute on function public.humana_can_manage_gta(uuid) to authenticated;

alter table public.punch_corrections enable row level security;
alter table public.overtime_requests enable row level security;
alter table public.activity_entries enable row level security;

drop policy if exists punch_corrections_own on public.punch_corrections;
drop policy if exists punch_corrections_own_select on public.punch_corrections;
drop policy if exists punch_corrections_own_insert on public.punch_corrections;
drop policy if exists punch_corrections_own_update on public.punch_corrections;
create policy punch_corrections_own_select on public.punch_corrections
  for select using (auth.uid() = user_id);
create policy punch_corrections_own_insert on public.punch_corrections
  for insert with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');
create policy punch_corrections_own_update on public.punch_corrections
  for update
  using (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%')
  with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');

drop policy if exists punch_corrections_manage_select on public.punch_corrections;
create policy punch_corrections_manage_select on public.punch_corrections
  for select using (public.humana_can_manage_gta(user_id));

drop policy if exists punch_corrections_manage_update on public.punch_corrections;
create policy punch_corrections_manage_update on public.punch_corrections
  for update using (public.humana_can_manage_gta(user_id))
  with check (public.humana_can_manage_gta(user_id));

drop policy if exists overtime_own on public.overtime_requests;
drop policy if exists overtime_own_select on public.overtime_requests;
drop policy if exists overtime_own_insert on public.overtime_requests;
drop policy if exists overtime_own_update on public.overtime_requests;
create policy overtime_own_select on public.overtime_requests
  for select using (auth.uid() = user_id);
create policy overtime_own_insert on public.overtime_requests
  for insert with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');
create policy overtime_own_update on public.overtime_requests
  for update
  using (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%')
  with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');

drop policy if exists overtime_manage_select on public.overtime_requests;
create policy overtime_manage_select on public.overtime_requests
  for select using (public.humana_can_manage_gta(user_id));

drop policy if exists overtime_manage_update on public.overtime_requests;
create policy overtime_manage_update on public.overtime_requests
  for update using (public.humana_can_manage_gta(user_id))
  with check (public.humana_can_manage_gta(user_id));

drop policy if exists activity_own on public.activity_entries;
drop policy if exists activity_own_select on public.activity_entries;
drop policy if exists activity_own_insert on public.activity_entries;
drop policy if exists activity_own_update on public.activity_entries;
create policy activity_own_select on public.activity_entries
  for select using (auth.uid() = user_id);
create policy activity_own_insert on public.activity_entries
  for insert with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');
create policy activity_own_update on public.activity_entries
  for update
  using (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%')
  with check (auth.uid() = user_id and lower(coalesce(status, '')) like 'a valider%');

drop policy if exists activity_manage_select on public.activity_entries;
create policy activity_manage_select on public.activity_entries
  for select using (public.humana_can_manage_gta(user_id));

drop policy if exists activity_manage_update on public.activity_entries;
create policy activity_manage_update on public.activity_entries
  for update using (public.humana_can_manage_gta(user_id))
  with check (public.humana_can_manage_gta(user_id));

grant select, insert, update, delete on public.punch_corrections to authenticated;
grant select, insert, update, delete on public.overtime_requests to authenticated;
grant select, insert, update, delete on public.activity_entries to authenticated;

alter table if exists public.punch_corrections
  add column if not exists punch_kind text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

notify pgrst, 'reload schema';
