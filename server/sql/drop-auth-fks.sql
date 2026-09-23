-- Après le schéma, avant les données : FKs auth.users et triggers Supabase cassent le COPY.
do $$
declare r record;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class f on f.oid = con.confrelid
    join pg_namespace fn on fn.oid = f.relnamespace
    where con.contype = 'f'
      and fn.nspname = 'auth'
      and f.relname = 'users'
  loop
    execute format('alter table %I.%I drop constraint if exists %I', r.sch, r.tbl, r.conname);
  end loop;
end $$;
