-- Controles RLS a lancer dans SQL Editor APRES lock-rls-profiles-and-docs.sql
-- (et en etant connecte via le SQL Editor = role postgres, donc BYPASS RLS).
-- Ces requetes verifient que les policies existent. Les vrais tests metier
-- se font avec 3 comptes (collab / manager / admin) depuis l'app ou l'API.

select tablename, policyname, cmd, permissive
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'hr_documents', 'payslips', 'time_punches', 'leave_requests')
order by tablename, policyname;

select relname as table_name, relrowsecurity as rls_on
from pg_class
where relname in ('profiles', 'hr_documents', 'payslips', 'time_punches', 'profiles_directory')
  and relnamespace = 'public'::regnamespace;

select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles_directory'
order by ordinal_position;

-- Depuis l'app, en compte collaborateur, ces appels REST doivent echouer / 0 ligne :
-- GET /rest/v1/payslips?user_id=eq.<autre-uuid>
-- GET /rest/v1/time_punches?user_id=eq.<autre-uuid>
-- GET /rest/v1/profiles?select=leave_balance_cp  (hors soi / equipe / admin)
-- GET /rest/v1/hr_documents  ne doit renvoyer que visibility=all
-- GET /rest/v1/profiles_directory  OK : annuaire sans soldes de conges
