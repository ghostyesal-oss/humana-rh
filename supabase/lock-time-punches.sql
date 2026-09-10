-- Verrou serveur : time_punches.
-- A executer dans Supabase SQL Editor.
-- Empeche un collaborateur d'anti/post-dater son propre pointage via l'API,
-- ou de creer un pointage pour un autre utilisateur.
-- Complete lock-gta-status.sql, lock-leave-attestation-status.sql, etc.

begin;

-- Tolerance de +/- 3 minutes entre l'horloge client et l'horloge serveur.
-- Au-dela, on reforce punched_at = now() (au lieu de refuser, pour ne pas casser
-- l'UX en cas de derive d'horloge). L'audit trail garde la trace de la valeur
-- envoyee par le client (colonne "client_punched_at").
alter table public.time_punches
  add column if not exists client_punched_at timestamptz;

create or replace function public.humana_guard_time_punch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  drift interval;
  is_manager boolean;
begin
  -- Toujours forcer user_id = auth.uid() pour un INSERT non-manager.
  if tg_op = 'INSERT' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;

    select exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'creator')
          or exists (
            select 1
            from public.profiles report
            where report.id = new.user_id
              and report.manager_id = me.id
          )
        )
    ) into is_manager;

    if new.user_id is distinct from auth.uid() and not is_manager then
      raise exception 'Impossible de pointer pour un autre collaborateur.';
    end if;

    -- Conserve l'heure envoyee par le client pour audit.
    new.client_punched_at := coalesce(new.punched_at, now());

    if new.punched_at is null then
      new.punched_at := now();
    else
      drift := now() - new.punched_at;
      -- Anti-cheat : un non-manager ne peut pas antidater/postdater > 3 min.
      if not is_manager and (drift > interval '3 minutes' or drift < interval '-3 minutes') then
        new.punched_at := now();
      end if;
    end if;

    return new;
  end if;

  -- UPDATE : uniquement admin/manager peut modifier un pointage existant.
  if tg_op = 'UPDATE' then
    select exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'creator')
          or exists (
            select 1
            from public.profiles report
            where report.id = old.user_id
              and report.manager_id = me.id
          )
        )
    ) into is_manager;

    if not is_manager then
      raise exception 'Seul un manager ou un administrateur peut modifier un pointage.';
    end if;

    if new.user_id is distinct from old.user_id then
      raise exception 'Impossible de transferer un pointage a un autre collaborateur.';
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists humana_guard_time_punch on public.time_punches;
create trigger humana_guard_time_punch
before insert or update on public.time_punches
for each row
execute function public.humana_guard_time_punch();

-- RLS defense en profondeur.
alter table public.time_punches enable row level security;
grant select, insert, update, delete on public.time_punches to authenticated;

drop policy if exists time_punches_own_select on public.time_punches;
create policy time_punches_own_select on public.time_punches
  for select using (auth.uid() = user_id);

drop policy if exists time_punches_manager_select on public.time_punches;
create policy time_punches_manager_select on public.time_punches
  for select using (
    exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'creator')
          or exists (
            select 1
            from public.profiles report
            where report.id = time_punches.user_id
              and report.manager_id = me.id
          )
        )
    )
  );

drop policy if exists time_punches_own_insert on public.time_punches;
create policy time_punches_own_insert on public.time_punches
  for insert
  with check (auth.uid() = user_id);

drop policy if exists time_punches_manager_insert on public.time_punches;
create policy time_punches_manager_insert on public.time_punches
  for insert
  with check (
    exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'creator')
          or exists (
            select 1
            from public.profiles report
            where report.id = time_punches.user_id
              and report.manager_id = me.id
          )
        )
    )
  );

drop policy if exists time_punches_manager_update on public.time_punches;
create policy time_punches_manager_update on public.time_punches
  for update
  using (
    exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('admin', 'creator')
          or exists (
            select 1
            from public.profiles report
            where report.id = time_punches.user_id
              and report.manager_id = me.id
          )
        )
    )
  );

drop policy if exists time_punches_manager_delete on public.time_punches;
create policy time_punches_manager_delete on public.time_punches
  for delete
  using (
    exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('admin', 'creator')
    )
  );

notify pgrst, 'reload schema';

commit;
