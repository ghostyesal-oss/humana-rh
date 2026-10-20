-- Le dump d'origine n'autorise que in / out / break_*.
-- L'UI enregistre Break, Coaching, Réunion et Formation en punch_type = status_change.

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'time_punches'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'punch_type'
  loop
    execute format('alter table public.time_punches drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.time_punches
  add constraint time_punches_punch_type_check
  check (punch_type in ('in', 'out', 'break_start', 'break_end', 'status_change'))
  not valid;
