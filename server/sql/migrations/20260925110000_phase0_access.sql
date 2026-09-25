-- Phase 0 : garde-fou des rôles, vue annuaire, punch_date serveur.

create or replace function public.humana_guard_and_audit_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not distinct from old.role then
    return new;
  end if;
  if session_user in ('humana', 'postgres') then
    insert into public.audit_log (actor_id, actor_email, action, target_table, target_id, target_user_id, meta)
    values (
      coalesce(auth.uid(), old.id),
      current_setting('request.jwt.claim.email', true),
      'role.change',
      'profiles',
      new.id,
      new.id,
      jsonb_build_object('from', old.role, 'to', new.role, 'via', 'bootstrap')
    );
    return new;
  end if;
  if not public.humana_is_admin() then
    raise exception 'Modification du rôle refusée.';
  end if;
  insert into public.audit_log (actor_id, actor_email, action, target_table, target_id, target_user_id, meta)
  values (
    auth.uid(),
    current_setting('request.jwt.claim.email', true),
    'role.change',
    'profiles',
    new.id,
    new.id,
    jsonb_build_object('from', old.role, 'to', new.role)
  );
  return new;
end;
$$;

drop view if exists public.profiles_directory;
create view public.profiles_directory
with (security_invoker = true) as
select id, email, full_name, job_title, department, role, manager_id,
       matricule, shift_code, hired_at, leave_grade
from public.profiles;

grant select on public.profiles_directory to humana_app;
revoke insert, update, delete on public.profiles_directory from humana_app;

alter table public.time_punches add column if not exists punch_date date;
update public.time_punches
  set punch_date = (timezone('Europe/Paris', punched_at))::date
  where punch_date is null and punched_at is not null;

create or replace function public.humana_sync_punch_date()
returns trigger
language plpgsql
as $$
begin
  if new.punched_at is null then
    new.punched_at := clock_timestamp();
  end if;
  new.punch_date := (timezone('Europe/Paris', new.punched_at))::date;
  return new;
end;
$$;

drop trigger if exists humana_sync_punch_date on public.time_punches;
create trigger humana_sync_punch_date
  before insert or update on public.time_punches
  for each row
  execute function public.humana_sync_punch_date();

grant execute on function public.humana_sync_punch_date() to humana_app;
grant execute on function public.humana_guard_and_audit_role() to humana_app;
