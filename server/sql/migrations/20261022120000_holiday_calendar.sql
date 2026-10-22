-- Calendrier des jours fériés par collaborateur : Maroc (ma) ou France (fr).

alter table public.profiles
  add column if not exists holiday_calendar text;

alter table public.pending_invites
  add column if not exists holiday_calendar text;

update public.profiles
  set holiday_calendar = case
    when lower(coalesce(shift_code, '')) = 'rnd' then 'ma'
    else 'fr'
  end
  where holiday_calendar is null or holiday_calendar not in ('ma', 'fr');

update public.pending_invites
  set holiday_calendar = case
    when lower(coalesce(shift_code, '')) = 'rnd' then 'ma'
    else 'fr'
  end
  where holiday_calendar is null or holiday_calendar not in ('ma', 'fr');

alter table public.profiles
  alter column holiday_calendar set default 'fr';

alter table public.pending_invites
  alter column holiday_calendar set default 'fr';

do $$
begin
  alter table public.profiles
    add constraint profiles_holiday_calendar_chk
    check (holiday_calendar in ('ma', 'fr'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pending_invites
    add constraint pending_invites_holiday_calendar_chk
    check (holiday_calendar in ('ma', 'fr'));
exception
  when duplicate_object then null;
end $$;

drop view if exists public.profiles_directory;
create view public.profiles_directory
with (security_invoker = true) as
select id, email, full_name, job_title, department, role, manager_id,
       matricule, shift_code, hired_at, leave_grade, holiday_calendar
from public.profiles;

grant select on public.profiles_directory to humana_app;
revoke insert, update, delete on public.profiles_directory from humana_app;
