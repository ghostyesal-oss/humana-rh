-- Planning importé (fichier). Sert de référence aux heures prévues.
-- Une ligne par agent / jour / demi-journée (slot 1 matin, slot 2 après-midi).
-- Le matricule importé est stocké pour audit ; le lien opérationnel est user_id.

create table if not exists public.planning_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  slot smallint not null default 1,
  kind text not null default 'PR',
  hours numeric(6,2) not null default 0,
  department text,
  structure text,
  location text,
  note text,
  source text not null default 'import',
  matricule text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint planning_entries_slot_chk check (slot in (1, 2)),
  constraint planning_entries_hours_chk check (hours >= 0 and hours <= 24),
  constraint planning_entries_user_date_slot unique (user_id, work_date, slot)
);

create index if not exists planning_entries_date_idx
  on public.planning_entries (work_date);
create index if not exists planning_entries_user_date_idx
  on public.planning_entries (user_id, work_date);
create index if not exists planning_entries_matricule_idx
  on public.planning_entries (matricule);

alter table public.planning_entries enable row level security;
alter table public.planning_entries force row level security;

drop policy if exists planning_entries_select on public.planning_entries;
drop policy if exists planning_entries_insert on public.planning_entries;
drop policy if exists planning_entries_update on public.planning_entries;
drop policy if exists planning_entries_delete on public.planning_entries;

create policy planning_entries_select on public.planning_entries
  for select using (public.humana_in_team(user_id));

create policy planning_entries_insert on public.planning_entries
  for insert with check (
    public.humana_in_team(user_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager')
    )
  );

create policy planning_entries_update on public.planning_entries
  for update using (
    public.humana_in_team(user_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager')
    )
  )
  with check (
    public.humana_in_team(user_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager')
    )
  );

create policy planning_entries_delete on public.planning_entries
  for delete using (
    public.humana_in_team(user_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager')
    )
  );

grant select, insert, update, delete on public.planning_entries to humana_app;
