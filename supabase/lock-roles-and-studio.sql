-- Verrou serveur : roles, invitations et Studio createur.
-- A executer dans Supabase SQL Editor.
-- Ne supprime aucune donnee. Un employe ne peut plus se promouvoir
-- admin/createur via l'API, meme en bidouillant le navigateur.

begin;

create or replace function public.humana_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'creator')
  );
$$;

create or replace function public.humana_is_studio_creator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and (
        me.role = 'creator'
        or exists (
          select 1
          from public.app_settings settings
          where settings.key = 'studio_creators'
            and jsonb_typeof(settings.value::jsonb) = 'array'
            and exists (
              select 1
              from jsonb_array_elements_text(settings.value::jsonb) as creator_email(email)
              where lower(creator_email.email) = lower(me.email)
            )
        )
      )
  );
$$;

create or replace function public.humana_can_manage_studio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.humana_is_studio_creator()
    or (
      public.humana_is_admin()
      and not exists (select 1 from public.profiles where role = 'creator')
      and not exists (
        select 1
        from public.app_settings
        where key = 'studio_creators'
          and jsonb_typeof(value::jsonb) = 'array'
          and jsonb_array_length(value::jsonb) > 0
      )
    );
$$;

revoke all on function public.humana_is_admin() from public;
revoke all on function public.humana_is_studio_creator() from public;
revoke all on function public.humana_can_manage_studio() from public;
grant execute on function public.humana_is_admin() to authenticated;
grant execute on function public.humana_is_studio_creator() to authenticated;
grant execute on function public.humana_can_manage_studio() to authenticated;

-- Interdit de changer profiles.role sauf admin/createur.
-- Exception : appliquer une invitation deja creee par un admin.
create or replace function public.humana_guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_roles constant text[] := array['employee', 'manager', 'admin', 'creator'];
begin
  if tg_op = 'INSERT' and (new.role is null or new.role = '') then
    new.role := 'employee';
  end if;

  if new.role is null or not (new.role = any (allowed_roles)) then
    raise exception 'Role invalide.';
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('admin', 'creator')
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
set search_path = ''
as $$
begin
  if not public.humana_is_admin() then
    raise exception 'Seul un administrateur peut gerer les invitations.';
  end if;
  if new.role is null or new.role not in ('employee', 'manager', 'admin', 'creator') then
    raise exception 'Role d invitation invalide.';
  end if;
  return new;
end;
$$;

drop trigger if exists humana_guard_pending_invite_role on public.pending_invites;
create trigger humana_guard_pending_invite_role
before insert or update on public.pending_invites
for each row
execute function public.humana_guard_pending_invite_role();

create or replace function public.humana_guard_app_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.key in ('studio_creators', 'nav_visibility') then
      if not public.humana_can_manage_studio() then
        raise exception 'Seul un createur peut modifier ce reglage.';
      end if;
    elsif not public.humana_is_admin() then
      raise exception 'Seul un administrateur peut modifier ce reglage.';
    end if;
    return old;
  end if;

  if new.key in ('studio_creators', 'nav_visibility') then
    if not public.humana_can_manage_studio() then
      raise exception 'Seul un createur peut modifier ce reglage.';
    end if;
  elsif not public.humana_is_admin() then
    raise exception 'Seul un administrateur peut modifier ce reglage.';
  end if;
  return new;
end;
$$;

drop trigger if exists humana_guard_app_settings on public.app_settings;
create trigger humana_guard_app_settings
before insert or update or delete on public.app_settings
for each row
execute function public.humana_guard_app_settings();

alter table public.app_settings enable row level security;
alter table public.pending_invites enable row level security;

drop policy if exists "app_settings_authenticated_read" on public.app_settings;
create policy "app_settings_authenticated_read"
on public.app_settings
for select
to authenticated
using (true);

drop policy if exists "app_settings_write_permissive" on public.app_settings;
create policy "app_settings_write_permissive"
on public.app_settings
for all
to authenticated
using (true)
with check (true);

drop policy if exists "app_settings_insert_guard" on public.app_settings;
create policy "app_settings_insert_guard"
on public.app_settings
as restrictive
for insert
to public
with check (
  case key
    when 'studio_creators' then public.humana_can_manage_studio()
    when 'nav_visibility' then public.humana_can_manage_studio()
    else public.humana_is_admin()
  end
);

drop policy if exists "app_settings_update_guard" on public.app_settings;
create policy "app_settings_update_guard"
on public.app_settings
as restrictive
for update
to public
using (
  case key
    when 'studio_creators' then public.humana_can_manage_studio()
    when 'nav_visibility' then public.humana_can_manage_studio()
    else public.humana_is_admin()
  end
)
with check (
  case key
    when 'studio_creators' then public.humana_can_manage_studio()
    when 'nav_visibility' then public.humana_can_manage_studio()
    else public.humana_is_admin()
  end
);

drop policy if exists "app_settings_delete_guard" on public.app_settings;
create policy "app_settings_delete_guard"
on public.app_settings
as restrictive
for delete
to public
using (
  case key
    when 'studio_creators' then public.humana_can_manage_studio()
    when 'nav_visibility' then public.humana_can_manage_studio()
    else public.humana_is_admin()
  end
);

drop policy if exists "pending_invites_admin_read" on public.pending_invites;
create policy "pending_invites_admin_read"
on public.pending_invites
for select
to authenticated
using (public.humana_is_admin());

drop policy if exists "pending_invites_admin_write" on public.pending_invites;
create policy "pending_invites_admin_write"
on public.pending_invites
for all
to authenticated
using (public.humana_is_admin())
with check (public.humana_is_admin());

drop policy if exists "pending_invites_write_guard" on public.pending_invites;
create policy "pending_invites_write_guard"
on public.pending_invites
as restrictive
for all
to public
using (public.humana_is_admin())
with check (public.humana_is_admin());

commit;
