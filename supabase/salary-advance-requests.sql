-- Demandes d'avance sur salaire (onglet Demande RH).
-- A executer dans Supabase SQL Editor.
-- Lecture/ecriture limitees au collaborateur et a son manager / admin.

begin;

create table if not exists public.salary_advance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric(12, 2) not null,
  reason text,
  requested_date date,
  status text not null default 'A valider',
  created_at timestamptz not null default now()
);

alter table public.salary_advance_requests enable row level security;
grant select, insert, update, delete on public.salary_advance_requests to authenticated;

create or replace function public.humana_can_manage_leave(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and (
        me.role in ('admin', 'creator')
        or exists (
          select 1
          from public.profiles report
          where report.id = target
            and report.manager_id = me.id
        )
      )
  );
$$;

grant execute on function public.humana_can_manage_leave(uuid) to authenticated;

create or replace function public.humana_leave_is_pending(status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(status, '')) like 'a valider%';
$$;

create or replace function public.humana_guard_salary_advance_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid()
       and not public.humana_can_manage_leave(new.user_id)
    then
      raise exception 'Impossible de creer une avance sur salaire pour un autre collaborateur.';
    end if;

    if not public.humana_can_manage_leave(new.user_id) then
      if new.status is null or not public.humana_leave_is_pending(new.status) then
        new.status := 'A valider';
      end if;
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Impossible de transferer une avance sur salaire.';
  end if;

  if new.status is distinct from old.status
     and not public.humana_can_manage_leave(old.user_id)
  then
    raise exception 'Seul un manager ou un administrateur peut valider ou refuser cette demande.';
  end if;

  return new;
end;
$$;

drop trigger if exists humana_guard_salary_advance_status on public.salary_advance_requests;
create trigger humana_guard_salary_advance_status
before insert or update on public.salary_advance_requests
for each row
execute function public.humana_guard_salary_advance_status();

drop policy if exists salary_advance_own_select on public.salary_advance_requests;
create policy salary_advance_own_select on public.salary_advance_requests
  for select using (auth.uid() = user_id);

drop policy if exists salary_advance_manage_select on public.salary_advance_requests;
create policy salary_advance_manage_select on public.salary_advance_requests
  for select using (public.humana_can_manage_leave(user_id));

drop policy if exists salary_advance_own_insert on public.salary_advance_requests;
create policy salary_advance_own_insert on public.salary_advance_requests
  for insert
  with check (
    auth.uid() = user_id
    and public.humana_leave_is_pending(status)
  );

drop policy if exists salary_advance_manage_update on public.salary_advance_requests;
create policy salary_advance_manage_update on public.salary_advance_requests
  for update
  using (public.humana_can_manage_leave(user_id))
  with check (public.humana_can_manage_leave(user_id));

drop policy if exists salary_advance_own_delete on public.salary_advance_requests;
create policy salary_advance_own_delete on public.salary_advance_requests
  for delete
  using (auth.uid() = user_id and public.humana_leave_is_pending(status));

notify pgrst, 'reload schema';

commit;
