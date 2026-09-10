-- Verrou serveur : leave_requests + attestation_requests.
-- A executer dans Supabase SQL Editor.
-- Empeche un collaborateur de s'auto-approuver son propre conge ou attestation
-- via l'API, meme en bidouillant les policies cote client.
-- Complete lock-gta-status.sql et lock-roles-and-studio.sql.

begin;

-- --- Helper : identifier un manager habilite pour un utilisateur cible ---
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

-- --- Trigger leave_requests : empeche le status/workflow d'etre change par le demandeur ---
create or replace function public.humana_guard_leave_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Un utilisateur ne peut creer qu'une demande pour lui-meme
    -- (sauf manager/admin qui peut la creer pour son collab).
    if new.user_id is distinct from auth.uid()
       and not public.humana_can_manage_leave(new.user_id)
    then
      raise exception 'Impossible de creer une demande de conge pour un autre collaborateur.';
    end if;

    -- Force le statut a "A valider ..." pour les demandes hors manager.
    if not public.humana_can_manage_leave(new.user_id) then
      if new.status is null or not public.humana_leave_is_pending(new.status) then
        new.status := 'A valider';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE : le user_id ne bouge pas.
  if new.user_id is distinct from old.user_id then
    raise exception 'Impossible de transferer une demande de conge.';
  end if;

  -- Seul un manager habilite peut faire evoluer le status ou workflow_step.
  if (new.status is distinct from old.status
      or coalesce(new.workflow_step, 1) is distinct from coalesce(old.workflow_step, 1))
     and not public.humana_can_manage_leave(old.user_id)
  then
    raise exception 'Seul un manager ou un administrateur peut valider ou refuser cette demande.';
  end if;

  return new;
end;
$$;

drop trigger if exists humana_guard_leave_status on public.leave_requests;
create trigger humana_guard_leave_status
before insert or update on public.leave_requests
for each row
execute function public.humana_guard_leave_status();

-- --- Trigger attestation_requests : idem ---
create or replace function public.humana_guard_attestation_status()
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
      raise exception 'Impossible de creer une demande d''attestation pour un autre collaborateur.';
    end if;

    if not public.humana_can_manage_leave(new.user_id) then
      if new.status is null or not public.humana_leave_is_pending(new.status) then
        new.status := 'A valider';
      end if;
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Impossible de transferer une demande d''attestation.';
  end if;

  if new.status is distinct from old.status
     and not public.humana_can_manage_leave(old.user_id)
  then
    raise exception 'Seul un manager ou un administrateur peut valider ou refuser cette demande.';
  end if;

  return new;
end;
$$;

drop trigger if exists humana_guard_attestation_status on public.attestation_requests;
create trigger humana_guard_attestation_status
before insert or update on public.attestation_requests
for each row
execute function public.humana_guard_attestation_status();

-- --- Policies RLS (defense en profondeur) ---
alter table public.leave_requests enable row level security;
alter table public.attestation_requests enable row level security;

grant select, insert, update, delete on public.leave_requests to authenticated;
grant select, insert, update, delete on public.attestation_requests to authenticated;

-- leave_requests : own row + managed subordinates
drop policy if exists leave_requests_own_select on public.leave_requests;
create policy leave_requests_own_select on public.leave_requests
  for select using (auth.uid() = user_id);

drop policy if exists leave_requests_manage_select on public.leave_requests;
create policy leave_requests_manage_select on public.leave_requests
  for select using (public.humana_can_manage_leave(user_id));

drop policy if exists leave_requests_own_insert on public.leave_requests;
create policy leave_requests_own_insert on public.leave_requests
  for insert
  with check (
    auth.uid() = user_id
    and public.humana_leave_is_pending(status)
  );

drop policy if exists leave_requests_manage_insert on public.leave_requests;
create policy leave_requests_manage_insert on public.leave_requests
  for insert
  with check (public.humana_can_manage_leave(user_id));

drop policy if exists leave_requests_own_update on public.leave_requests;
create policy leave_requests_own_update on public.leave_requests
  for update
  using (auth.uid() = user_id and public.humana_leave_is_pending(status))
  with check (auth.uid() = user_id and public.humana_leave_is_pending(status));

drop policy if exists leave_requests_manage_update on public.leave_requests;
create policy leave_requests_manage_update on public.leave_requests
  for update
  using (public.humana_can_manage_leave(user_id))
  with check (public.humana_can_manage_leave(user_id));

drop policy if exists leave_requests_own_delete on public.leave_requests;
create policy leave_requests_own_delete on public.leave_requests
  for delete
  using (auth.uid() = user_id and public.humana_leave_is_pending(status));

drop policy if exists leave_requests_manage_delete on public.leave_requests;
create policy leave_requests_manage_delete on public.leave_requests
  for delete
  using (public.humana_can_manage_leave(user_id));

-- attestation_requests : idem
drop policy if exists attestation_requests_own_select on public.attestation_requests;
create policy attestation_requests_own_select on public.attestation_requests
  for select using (auth.uid() = user_id);

drop policy if exists attestation_requests_manage_select on public.attestation_requests;
create policy attestation_requests_manage_select on public.attestation_requests
  for select using (public.humana_can_manage_leave(user_id));

drop policy if exists attestation_requests_own_insert on public.attestation_requests;
create policy attestation_requests_own_insert on public.attestation_requests
  for insert
  with check (
    auth.uid() = user_id
    and public.humana_leave_is_pending(status)
  );

drop policy if exists attestation_requests_manage_update on public.attestation_requests;
create policy attestation_requests_manage_update on public.attestation_requests
  for update
  using (public.humana_can_manage_leave(user_id))
  with check (public.humana_can_manage_leave(user_id));

drop policy if exists attestation_requests_own_delete on public.attestation_requests;
create policy attestation_requests_own_delete on public.attestation_requests
  for delete
  using (auth.uid() = user_id and public.humana_leave_is_pending(status));

notify pgrst, 'reload schema';

commit;
