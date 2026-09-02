-- A executer dans Supabase > SQL Editor (production).
-- Ajoute les colonnes techniques du Journal : OS, navigateur, IP, reseau, etc.

alter table public.time_punches
  add column if not exists connection_method text,
  add column if not exists operating_system text,
  add column if not exists browser_application text,
  add column if not exists ip_address text,
  add column if not exists network_type text,
  add column if not exists disconnect_reason text;

notify pgrst, 'reload schema';
