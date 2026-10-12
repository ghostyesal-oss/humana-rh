-- Les fiches importées n'ont pas encore de compte Microsoft : elles ne
-- peuvent pas référencer auth.users. On retire les FK héritées de Supabase.

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class f on f.oid = con.confrelid
    join pg_namespace fn on fn.oid = f.relnamespace
    where con.contype = 'f'
      and n.nspname = 'public'
      and c.relname = 'profiles'
      and fn.nspname = 'auth'
      and f.relname = 'users'
  loop
    execute format('alter table public.profiles drop constraint if exists %I', r.conname);
  end loop;
end $$;
