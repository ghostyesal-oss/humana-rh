-- A executer dans Supabase > SQL Editor si besoin.
-- Ajoute le lieu de travail et le statut d'activite sur les pointages.
-- Le bouton J'arrive fonctionne aussi sans ces colonnes.

alter table public.time_punches
  add column if not exists work_location text,
  add column if not exists work_status text;

notify pgrst, 'reload schema';
