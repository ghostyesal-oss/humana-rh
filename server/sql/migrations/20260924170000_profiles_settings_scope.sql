-- Manager : plus de update HR sur l'équipe. app_settings studio masqué.

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = auth.uid() or public.humana_is_admin())
  with check (id = auth.uid() or public.humana_is_admin());

create or replace function public.humana_guard_profile_hr_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.humana_is_admin() then
    return new;
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'Modification du profil d''un autre collaborateur refusée.';
  end if;
  if new.manager_id is distinct from old.manager_id
     or new.job_title is distinct from old.job_title
     or new.department is distinct from old.department
     or new.matricule is distinct from old.matricule
     or new.shift_code is distinct from old.shift_code
     or new.hired_at is distinct from old.hired_at
     or new.leave_grade is distinct from old.leave_grade
     or new.leave_balance_cp is distinct from old.leave_balance_cp
     or new.leave_balance_rtt is distinct from old.leave_balance_rtt
     or new.leave_balance_recup is distinct from old.leave_balance_recup
  then
    raise exception 'Modification RH du profil refusée.';
  end if;
  return new;
end;
$$;

drop trigger if exists humana_guard_profile_hr_fields on public.profiles;
create trigger humana_guard_profile_hr_fields
  before update on public.profiles
  for each row
  execute function public.humana_guard_profile_hr_fields();

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (
    public.humana_is_admin()
    or key in ('nav_visibility', 'company_timezone', 'gta_shifts')
  );

grant execute on function public.humana_guard_profile_hr_fields() to humana_app;
