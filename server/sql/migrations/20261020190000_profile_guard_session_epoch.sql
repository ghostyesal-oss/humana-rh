-- Logout incrémente session_epoch via le rôle owner (humana), sans JWT.
-- Le garde-fou RH prenait ça pour une modification du profil d'un autre.

create or replace function public.humana_guard_profile_hr_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user in ('humana', 'postgres') then
    return new;
  end if;
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
