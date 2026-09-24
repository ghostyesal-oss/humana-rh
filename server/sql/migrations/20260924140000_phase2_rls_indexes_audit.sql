-- Phase 2 option A : RLS + auth.uid() depuis request.jwt.claim.*.
-- L'API (query.js) reste le premier filtre. humana_app n'est pas superuser :
-- un bug API ne lit plus les données d'un autre salarié.
-- Index + journal d'audit des lectures paie/docs et des changements de rôle.

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anonymous');
$$;

create or replace function public.humana_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'creator')
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

create or replace function public.humana_in_team(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target = auth.uid() or public.humana_manages(target);
$$;

create or replace function public.humana_is_pending(status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(status, '')) like 'a valider%';
$$;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_table text,
  target_id uuid,
  target_user_id uuid,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);

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
  if current_user in ('humana', 'postgres') then
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

drop trigger if exists humana_guard_and_audit_role on public.profiles;
create trigger humana_guard_and_audit_role
  before update on public.profiles
  for each row
  execute function public.humana_guard_and_audit_role();

-- Index demandés (phase 2.3). btree ASC se parcourt aussi en DESC ;
-- on pose quand même punched_at desc pour le journal de pointage.
drop index if exists public.time_punches_user_punched_idx;
create index if not exists time_punches_user_id_punched_at_desc_idx
  on public.time_punches (user_id, punched_at desc);
create index if not exists hr_documents_storage_path_idx
  on public.hr_documents (storage_path);
create index if not exists leave_requests_user_status_created_idx
  on public.leave_requests (user_id, status, created_at desc);
create index if not exists attestation_requests_user_status_idx
  on public.attestation_requests (user_id, status);
create index if not exists salary_advance_requests_user_status_idx
  on public.salary_advance_requests (user_id, status);
create index if not exists punch_corrections_user_status_idx
  on public.punch_corrections (user_id, status);
create index if not exists overtime_requests_user_status_idx
  on public.overtime_requests (user_id, status);
create index if not exists activity_entries_user_status_idx
  on public.activity_entries (user_id, status);
create index if not exists payslips_user_id_idx
  on public.payslips (user_id);

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.schema_migrations disable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'pending_invites', 'app_settings', 'time_punches',
    'leave_requests', 'attestation_requests', 'salary_advance_requests',
    'punch_corrections', 'overtime_requests', 'activity_entries',
    'hr_alerts', 'hr_documents', 'payslips', 'company_events',
    'push_subscriptions', 'audit_log'
  ]
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles
  for select using (public.humana_in_team(id));
create policy profiles_insert on public.profiles
  for insert with check (public.humana_is_admin());
create policy profiles_update on public.profiles
  for update using (public.humana_in_team(id))
  with check (public.humana_in_team(id));
create policy profiles_delete on public.profiles
  for delete using (public.humana_is_admin());

-- demandes
do $$
declare t text;
begin
  foreach t in array array[
    'leave_requests', 'attestation_requests', 'salary_advance_requests',
    'punch_corrections', 'overtime_requests', 'activity_entries'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select using (public.humana_in_team(user_id))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (
         (user_id = auth.uid() and public.humana_is_pending(status))
         or public.humana_manages(user_id)
       )',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update
         using (
           public.humana_is_admin()
           or public.humana_manages(user_id)
           or (user_id = auth.uid() and public.humana_is_pending(status))
         )
         with check (
           public.humana_is_admin()
           or public.humana_manages(user_id)
           or (user_id = auth.uid() and public.humana_is_pending(status))
         )',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete using (
         public.humana_is_admin()
         or public.humana_manages(user_id)
         or (user_id = auth.uid() and public.humana_is_pending(status))
       )',
      t || '_delete', t
    );
  end loop;
end $$;

-- pointages
create policy time_punches_select on public.time_punches
  for select using (public.humana_in_team(user_id));
create policy time_punches_insert on public.time_punches
  for insert with check (user_id = auth.uid() or public.humana_manages(user_id));
create policy time_punches_update on public.time_punches
  for update using (public.humana_manages(user_id))
  with check (public.humana_manages(user_id));
create policy time_punches_delete on public.time_punches
  for delete using (public.humana_is_admin());

-- paie
create policy payslips_select on public.payslips
  for select using (user_id = auth.uid() or public.humana_is_admin());
create policy payslips_write on public.payslips
  for all using (public.humana_is_admin())
  with check (public.humana_is_admin());

-- documents RH
create policy hr_documents_select on public.hr_documents
  for select using (auth.uid() is not null);
create policy hr_documents_write on public.hr_documents
  for all using (public.humana_is_admin())
  with check (public.humana_is_admin());

create policy pending_invites_admin on public.pending_invites
  for all using (public.humana_is_admin())
  with check (public.humana_is_admin());

create policy app_settings_select on public.app_settings
  for select using (auth.uid() is not null);
create policy app_settings_write on public.app_settings
  for all using (public.humana_is_admin())
  with check (public.humana_is_admin());

create policy company_events_select on public.company_events
  for select using (auth.uid() is not null);
create policy company_events_write on public.company_events
  for all using (public.humana_is_admin())
  with check (public.humana_is_admin());

create policy hr_alerts_select on public.hr_alerts
  for select using (recipient_id = auth.uid() or public.humana_is_admin());
create policy hr_alerts_insert on public.hr_alerts
  for insert with check (recipient_id = auth.uid() or public.humana_is_admin());
create policy hr_alerts_update on public.hr_alerts
  for update using (recipient_id = auth.uid() or public.humana_is_admin())
  with check (recipient_id = auth.uid() or public.humana_is_admin());
create policy hr_alerts_delete on public.hr_alerts
  for delete using (recipient_id = auth.uid() or public.humana_is_admin());

create policy push_subscriptions_own on public.push_subscriptions
  for all using (user_id = auth.uid() or public.humana_is_admin())
  with check (user_id = auth.uid() or public.humana_is_admin());

create policy audit_log_select on public.audit_log
  for select using (public.humana_is_admin());
create policy audit_log_insert on public.audit_log
  for insert with check (actor_id = auth.uid() or public.humana_is_admin());

grant execute on function auth.uid() to public;
grant execute on function auth.role() to public;
grant execute on function public.humana_is_admin() to public;
grant execute on function public.humana_manages(uuid) to public;
grant execute on function public.humana_in_team(uuid) to public;
grant execute on function public.humana_is_pending(text) to public;
