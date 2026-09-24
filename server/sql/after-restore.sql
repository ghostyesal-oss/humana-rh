-- Après restauration : l'API Node filtre, plus de RLS / triggers Supabase.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

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
  loop
    execute format('drop trigger if exists %I on %I.%I', r.tgname, r.sch, r.tbl);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I disable row level security', r.tablename);
  end loop;
end $$;

grant all on all tables in schema public to humana;
grant all on all sequences in schema public to humana;
grant all on all functions in schema public to humana;
alter default privileges in schema public grant all on tables to humana;

create unique index if not exists pending_invites_email_key
  on public.pending_invites (email);
