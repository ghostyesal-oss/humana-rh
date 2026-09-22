-- Verrou RLS : documents RH par audience + profils (annuaire vs soldes).
-- A executer dans Supabase > SQL Editor.
-- Ne supprime aucune donnee. Idempotent.

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

create or replace function public.humana_is_manager_or_above()
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
      and role in ('admin', 'creator', 'manager')
  );
$$;

create or replace function public.humana_can_read_full_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target is not null
    and (
      target = auth.uid()
      or exists (
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
      )
    );
$$;

create or replace function public.humana_can_read_hr_document(doc_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.humana_is_admin()
    or coalesce(doc_visibility, 'all') = 'all'
    or (coalesce(doc_visibility, 'all') = 'managers' and public.humana_is_manager_or_above())
    or (coalesce(doc_visibility, 'all') = 'admins' and public.humana_is_admin());
$$;

revoke all on function public.humana_is_admin() from public;
revoke all on function public.humana_is_manager_or_above() from public;
revoke all on function public.humana_can_read_full_profile(uuid) from public;
revoke all on function public.humana_can_read_hr_document(text) from public;
grant execute on function public.humana_is_admin() to authenticated;
grant execute on function public.humana_is_manager_or_above() to authenticated;
grant execute on function public.humana_can_read_full_profile(uuid) to authenticated;
grant execute on function public.humana_can_read_hr_document(text) to authenticated;

-- ---------- Documents RH : visibilite ----------
alter table if exists public.hr_documents
  add column if not exists visibility text;

update public.hr_documents
set visibility = 'all'
where coalesce(visibility, '') = '';

alter table public.hr_documents
  alter column visibility set default 'all';

alter table public.hr_documents
  drop constraint if exists hr_documents_visibility_check;

alter table public.hr_documents
  add constraint hr_documents_visibility_check
  check (visibility in ('all', 'managers', 'admins'));

alter table public.hr_documents enable row level security;

drop policy if exists "hr_documents_authenticated_read" on public.hr_documents;
drop policy if exists "hr_documents_select_guard" on public.hr_documents;
drop policy if exists hr_documents_select_by_visibility on public.hr_documents;

create policy hr_documents_select_by_visibility
on public.hr_documents
for select
to authenticated
using (public.humana_can_read_hr_document(visibility));

create policy "hr_documents_select_guard"
on public.hr_documents
as restrictive
for select
to public
using (
  auth.uid() is not null
  and public.humana_can_read_hr_document(visibility)
);

-- Storage : un chemin docs/ n'est lisible que si la ligne hr_documents l'autorise.
drop policy if exists "hr_storage_select_guard" on storage.objects;
create policy "hr_storage_select_guard"
on storage.objects
as restrictive
for select
to public
using (
  bucket_id <> 'hr-documents'
  or (
    auth.uid() is not null
    and (
      (
        (storage.foldername(name))[1] = 'docs'
        and exists (
          select 1
          from public.hr_documents document
          where document.storage_path = name
            and public.humana_can_read_hr_document(document.visibility)
        )
      )
      or (
        (storage.foldername(name))[1] = 'payslips'
        and (
          (storage.foldername(name))[2] = auth.uid()::text
          or public.humana_is_admin()
        )
      )
    )
  )
);

drop policy if exists "hr_storage_read_allowed_files" on storage.objects;
create policy "hr_storage_read_allowed_files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hr-documents'
  and (
    (
      (storage.foldername(name))[1] = 'docs'
      and exists (
        select 1
        from public.hr_documents document
        where document.storage_path = name
          and public.humana_can_read_hr_document(document.visibility)
      )
    )
    or (
      (storage.foldername(name))[1] = 'payslips'
      and (
        (storage.foldername(name))[2] = auth.uid()::text
        or public.humana_is_admin()
      )
    )
  )
);

-- ---------- Profils : lignes sensibles vs annuaire ----------
alter table public.profiles
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists manager_id uuid,
  add column if not exists shift_code text,
  add column if not exists leave_grade text,
  add column if not exists hired_at date,
  add column if not exists matricule text,
  add column if not exists leave_balance_cp numeric,
  add column if not exists leave_balance_rtt numeric,
  add column if not exists leave_balance_recup numeric;

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

do $$
declare pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

create policy profiles_select_scope
on public.profiles
for select
to authenticated
using (public.humana_can_read_full_profile(id));

create policy profiles_select_guard
on public.profiles
as restrictive
for select
to public
using (
  auth.uid() is not null
  and public.humana_can_read_full_profile(id)
);

create policy profiles_own_insert
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy profiles_own_update
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy profiles_admin_update
on public.profiles
for update
to authenticated
using (public.humana_is_admin())
with check (public.humana_is_admin());

create or replace function public.humana_guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not public.humana_is_admin() then
    new.leave_balance_cp := old.leave_balance_cp;
    new.leave_balance_rtt := old.leave_balance_rtt;
    new.leave_balance_recup := old.leave_balance_recup;
    new.manager_id := old.manager_id;
    new.shift_code := old.shift_code;
    new.leave_grade := old.leave_grade;
    new.hired_at := old.hired_at;
    new.matricule := old.matricule;
  end if;
  return new;
end;
$$;

drop trigger if exists humana_guard_profile_sensitive_fields on public.profiles;
create trigger humana_guard_profile_sensitive_fields
before update on public.profiles
for each row
execute function public.humana_guard_profile_sensitive_fields();

drop view if exists public.profiles_directory;
create view public.profiles_directory
with (security_invoker = false)
as
select
  id,
  email,
  full_name,
  job_title,
  department,
  role,
  manager_id,
  shift_code,
  leave_grade,
  matricule,
  hired_at
from public.profiles;

revoke all on public.profiles_directory from public;
grant select on public.profiles_directory to authenticated;

notify pgrst, 'reload schema';

commit;
