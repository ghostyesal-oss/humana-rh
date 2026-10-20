-- Après import d'un dump Supabase : retirer Auth/Storage qui cassent
-- Postgres vanilla. Ne désactive PAS la RLS (fail-closed pour humana_app).
-- Refusé si les migrations Humana sont déjà là (base de production).
-- Ensuite : redémarrer l'API pour recréer les policies RLS.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'schema_migrations'
  ) and exists (
    select 1 from public.schema_migrations where id like '%phase2_rls%'
  ) then
    raise exception
      'after-restore.sql refusé: RLS Humana déjà en place. Restaurez un backup Daylyx avec scripts/restore-postgres.sh.';
  end if;
end $$;

-- Triggers hors humana_* (artefacts Supabase : auth.users, storage, etc.).
do $$
declare r record;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname in ('public', 'storage')
      and t.tgname not like 'humana_%'
  loop
    execute format('drop trigger if exists %I on %I.%I', r.tgname, r.sch, r.tbl);
  end loop;
end $$;

-- Policies du dump source. Les policies Humana sont recréées par les migrations.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- RLS on + aucune policy = deny pour humana_app (le owner bypass le temps des migrations).
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    if r.tablename = 'schema_migrations' then
      execute format('alter table public.%I disable row level security', r.tablename);
    else
      execute format('alter table public.%I enable row level security', r.tablename);
    end if;
  end loop;
end $$;

grant all on all tables in schema public to humana;
grant all on all sequences in schema public to humana;
grant all on all functions in schema public to humana;
alter default privileges in schema public grant all on tables to humana;

do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'pending_invites'
  ) then
    execute 'create unique index if not exists pending_invites_email_key on public.pending_invites (email)';
  end if;
end $$;
