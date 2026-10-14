-- Rôle RH : visa final des congés interchangeable avec le Directeur.
-- Le RH voit / valide les demandes de toute l'organisation, sans droits d'administration.

create or replace function public.humana_is_hr()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'rh'
  );
$$;

create or replace function public.humana_manages(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.humana_is_admin()
    or (
      public.humana_is_hr()
      and target is not null
      and target is distinct from auth.uid()
    )
    or (
      auth.uid() is not null
      and target is not null
      and target is distinct from auth.uid()
      and exists (
        select 1 from public.profiles report
        where report.id = target
          and report.manager_id = auth.uid()
      )
    );
$$;

create or replace function public.humana_is_manager_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.humana_is_admin()
    or public.humana_is_hr()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('manager', 'rh')
    )
    or exists (
      select 1 from public.profiles
      where manager_id = auth.uid()
    );
$$;

create or replace function public.humana_can_read_visibility(vis text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      coalesce(vis, 'all') = 'all'
      or (coalesce(vis, 'all') = 'managers' and public.humana_is_manager_or_above())
      or (coalesce(vis, 'all') = 'admins' and (public.humana_is_admin() or public.humana_is_hr()))
    );
$$;

revoke all on function public.humana_is_hr() from public;
grant execute on function public.humana_is_hr() to public;
grant execute on function public.humana_is_hr() to authenticated;
grant execute on function public.humana_is_hr() to humana_app;

do $$
begin
  if to_regclass('public.planning_entries') is null then
    return;
  end if;
  execute 'drop policy if exists planning_entries_insert on public.planning_entries';
  execute 'drop policy if exists planning_entries_update on public.planning_entries';
  execute 'drop policy if exists planning_entries_delete on public.planning_entries';
  execute $p$
    create policy planning_entries_insert on public.planning_entries
      for insert with check (
        public.humana_in_team(user_id)
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager', 'rh')
        )
      )
  $p$;
  execute $p$
    create policy planning_entries_update on public.planning_entries
      for update using (
        public.humana_in_team(user_id)
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager', 'rh')
        )
      )
      with check (
        public.humana_in_team(user_id)
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager', 'rh')
        )
      )
  $p$;
  execute $p$
    create policy planning_entries_delete on public.planning_entries
      for delete using (
        public.humana_in_team(user_id)
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'creator', 'manager', 'rh')
        )
      )
  $p$;
end $$;

create or replace function public.humana_guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_roles constant text[] := array['employee', 'manager', 'rh', 'admin', 'creator'];
begin
  if tg_op = 'INSERT' and (new.role is null or new.role = '') then
    new.role := 'employee';
  end if;

  if new.role is null or not (new.role = any (allowed_roles)) then
    raise exception 'Role invalide.';
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('admin', 'creator', 'rh')
       and not public.humana_is_admin()
       and not exists (
         select 1
         from public.pending_invites invite
         where lower(invite.email) = lower(new.email)
           and invite.role = new.role
       )
    then
      raise exception 'Seul un administrateur peut attribuer ce role.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    if not public.humana_is_admin()
       and not exists (
         select 1
         from public.pending_invites invite
         where lower(invite.email) = lower(new.email)
           and invite.role = new.role
       )
    then
      raise exception 'Seul un administrateur peut modifier le role.';
    end if;

    if old.role in ('admin', 'creator')
       and new.role not in ('admin', 'creator')
       and not exists (
         select 1
         from public.profiles other
         where other.id <> old.id
           and other.role in ('admin', 'creator')
       )
    then
      raise exception 'Impossible de retirer le dernier administrateur.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists humana_guard_profile_role on public.profiles;
create trigger humana_guard_profile_role
before insert or update of role on public.profiles
for each row
execute function public.humana_guard_profile_role();

create or replace function public.humana_guard_pending_invite_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.humana_is_admin() then
    raise exception 'Seul un administrateur peut gerer les invitations.';
  end if;
  if new.role is null or new.role not in ('employee', 'manager', 'rh', 'admin', 'creator') then
    raise exception 'Role d invitation invalide.';
  end if;
  return new;
end;
$$;
