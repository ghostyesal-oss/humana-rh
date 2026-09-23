-- A lancer APRES restauration du dump (désactive le RLS Supabase : l'API Node filtre).
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

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
