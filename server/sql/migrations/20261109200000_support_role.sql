-- Role Support : collaborateur d'assistance, sans droits admin ni RH.

create or replace function public.humana_guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_roles constant text[] := array['employee', 'support', 'manager', 'rh', 'admin', 'creator'];
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
  if new.role is null or new.role not in ('employee', 'support', 'manager', 'rh', 'admin', 'creator') then
    raise exception 'Role d invitation invalide.';
  end if;
  return new;
end;
$$;
