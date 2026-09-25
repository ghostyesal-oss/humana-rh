-- Colonne absente des dumps OVH antérieurs au baseline (CREATE TABLE IF NOT EXISTS
-- ne l'ajoute pas). Doit s'appliquer avant le trigger humana_sync_punch_date.
alter table public.time_punches add column if not exists punch_date date;

update public.time_punches
  set punch_date = (timezone('Europe/Paris', punched_at))::date
  where punch_date is null and punched_at is not null;
