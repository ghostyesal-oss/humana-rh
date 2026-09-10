-- A executer dans Supabase > SQL Editor.
-- Table des evenements internes declares par les administrateurs et diffuses
-- a l'ensemble des collaborateurs.

create extension if not exists pgcrypto;

create table if not exists public.company_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  location     text,
  event_type   text not null default 'general'
    check (event_type in ('general', 'meeting', 'celebration', 'training', 'reminder')),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  visibility   text not null default 'all'
    check (visibility in ('all', 'managers', 'admins')),
  poster_url   text,
  poster_path  text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Ajout des colonnes d'affiche pour les projets ayant deja cree la table.
alter table public.company_events
  add column if not exists poster_url  text;
alter table public.company_events
  add column if not exists poster_path text;

create index if not exists company_events_starts_at_idx
  on public.company_events (starts_at desc);

create or replace function public.company_events_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists company_events_touch_updated_at on public.company_events;
create trigger company_events_touch_updated_at
  before update on public.company_events
  for each row execute function public.company_events_touch_updated_at();

alter table public.company_events enable row level security;

-- Lecture ouverte a tous les utilisateurs authentifies, restreinte selon
-- la visibilite si specifiee.
drop policy if exists "events readable by scope" on public.company_events;
create policy "events readable by scope"
  on public.company_events
  for select
  using (
    auth.role() = 'authenticated'
    and (
      visibility = 'all'
      or (
        visibility = 'managers'
        and exists (
          select 1 from public.profiles
          where id = auth.uid()
            and role in ('admin', 'creator', 'manager')
        )
      )
      or (
        visibility = 'admins'
        and exists (
          select 1 from public.profiles
          where id = auth.uid()
            and role in ('admin', 'creator')
        )
      )
    )
  );

-- Seuls les administrateurs / createurs peuvent creer, modifier ou supprimer.
drop policy if exists "events writable by admins" on public.company_events;
create policy "events writable by admins"
  on public.company_events
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
    and created_by = auth.uid()
  );

drop policy if exists "events updatable by admins" on public.company_events;
create policy "events updatable by admins"
  on public.company_events
  for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  );

drop policy if exists "events deletable by admins" on public.company_events;
create policy "events deletable by admins"
  on public.company_events
  for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  );

-- Bucket public dedie aux affiches d'evenements (visuel non confidentiel).
insert into storage.buckets (id, name, public)
values ('event-posters', 'event-posters', true)
on conflict (id) do update set public = true;

drop policy if exists "event_posters_public_read" on storage.objects;
create policy "event_posters_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'event-posters');

drop policy if exists "event_posters_admin_insert" on storage.objects;
create policy "event_posters_admin_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'event-posters'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  );

drop policy if exists "event_posters_admin_update" on storage.objects;
create policy "event_posters_admin_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'event-posters'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  )
  with check (
    bucket_id = 'event-posters'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  );

drop policy if exists "event_posters_admin_delete" on storage.objects;
create policy "event_posters_admin_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'event-posters'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'creator')
    )
  );

notify pgrst, 'reload schema';
