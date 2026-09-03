-- Migration du bucket hr-documents vers un stockage prive.
-- A executer dans Supabase SQL Editor APRES avoir deploye la version de
-- l'application qui utilise createSignedUrl().
--
-- Cette migration ne supprime aucun fichier. Elle :
-- 1. recupere storage_path depuis les anciennes URL publiques ;
-- 2. rend le bucket prive ;
-- 3. autorise les documents RH a tous les utilisateurs authentifies ;
-- 4. limite chaque bulletin a son collaborateur et aux admin/createur ;
-- 5. reserve upload, modification et suppression aux admin/createur.

begin;

-- Conserver le chemin des anciens fichiers sans effacer file_url.
update public.hr_documents
set storage_path = split_part(
  split_part(file_url, '/object/public/hr-documents/'),
  '?',
  1
)
where coalesce(storage_path, '') = ''
  and file_url like '%/object/public/hr-documents/%';

update public.payslips
set storage_path = split_part(
  split_part(file_url, '/object/public/hr-documents/'),
  '?',
  1
)
where coalesce(storage_path, '') = ''
  and file_url like '%/object/public/hr-documents/%';

-- Securite de migration : tout annuler plutot que couper l'acces a un ancien
-- fichier dont le chemin n'a pas pu etre retrouve ou qui manque dans Storage.
do $$
begin
  if exists (
    select 1 from public.hr_documents where coalesce(storage_path, '') = ''
    union all
    select 1 from public.payslips where coalesce(storage_path, '') = ''
  ) then
    raise exception 'Migration annulee : des lignes hr_documents/payslips n ont pas de storage_path.';
  end if;

  if exists (
    select 1
    from public.hr_documents document
    where not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'hr-documents'
        and object.name = document.storage_path
    )
    union all
    select 1
    from public.payslips payslip
    where not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'hr-documents'
        and object.name = payslip.storage_path
    )
  ) then
    raise exception 'Migration annulee : certains storage_path ne correspondent a aucun fichier du bucket.';
  end if;
end
$$;

-- Le role est lu cote serveur ; le navigateur ne peut pas se declarer admin.
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

revoke all on function public.humana_is_admin() from public;
grant execute on function public.humana_is_admin() to authenticated;

-- Les metadonnees suivent les memes droits que les objets Storage.
alter table public.hr_documents enable row level security;
alter table public.payslips enable row level security;

drop policy if exists "hr_documents_select_guard" on public.hr_documents;
create policy "hr_documents_select_guard"
on public.hr_documents
as restrictive
for select
to public
using (auth.uid() is not null);

drop policy if exists "hr_documents_authenticated_read" on public.hr_documents;
create policy "hr_documents_authenticated_read"
on public.hr_documents
for select
to authenticated
using (true);

drop policy if exists "hr_documents_write_guard" on public.hr_documents;
drop policy if exists "hr_documents_insert_guard" on public.hr_documents;
create policy "hr_documents_insert_guard"
on public.hr_documents
as restrictive
for insert
to public
with check (public.humana_is_admin());

drop policy if exists "hr_documents_update_guard" on public.hr_documents;
create policy "hr_documents_update_guard"
on public.hr_documents
as restrictive
for update
to public
using (public.humana_is_admin())
with check (public.humana_is_admin());

drop policy if exists "hr_documents_delete_guard" on public.hr_documents;
create policy "hr_documents_delete_guard"
on public.hr_documents
as restrictive
for delete
to public
using (public.humana_is_admin());

drop policy if exists "hr_documents_admin_write" on public.hr_documents;
create policy "hr_documents_admin_write"
on public.hr_documents
for all
to authenticated
using (public.humana_is_admin())
with check (public.humana_is_admin());

drop policy if exists "payslips_select_guard" on public.payslips;
create policy "payslips_select_guard"
on public.payslips
as restrictive
for select
to public
using (
  user_id = auth.uid()
  or public.humana_is_admin()
);

drop policy if exists "payslips_own_or_admin_read" on public.payslips;
create policy "payslips_own_or_admin_read"
on public.payslips
for select
to authenticated
using (
  user_id = auth.uid()
  or public.humana_is_admin()
);

drop policy if exists "payslips_write_guard" on public.payslips;
drop policy if exists "payslips_insert_guard" on public.payslips;
create policy "payslips_insert_guard"
on public.payslips
as restrictive
for insert
to public
with check (public.humana_is_admin());

drop policy if exists "payslips_update_guard" on public.payslips;
create policy "payslips_update_guard"
on public.payslips
as restrictive
for update
to public
using (public.humana_is_admin())
with check (public.humana_is_admin());

drop policy if exists "payslips_delete_guard" on public.payslips;
create policy "payslips_delete_guard"
on public.payslips
as restrictive
for delete
to public
using (public.humana_is_admin());

drop policy if exists "payslips_admin_write" on public.payslips;
create policy "payslips_admin_write"
on public.payslips
for all
to authenticated
using (public.humana_is_admin())
with check (public.humana_is_admin());

update storage.buckets
set public = false
where id = 'hr-documents';

-- Les policies restrictives neutralisent aussi une ancienne policy Storage
-- permissive qui aurait ete creee pour ce bucket.
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
      (storage.foldername(name))[1] = 'docs'
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

drop policy if exists "hr_storage_write_guard" on storage.objects;
create policy "hr_storage_write_guard"
on storage.objects
as restrictive
for insert
to public
with check (
  bucket_id <> 'hr-documents'
  or public.humana_is_admin()
);

drop policy if exists "hr_storage_update_guard" on storage.objects;
create policy "hr_storage_update_guard"
on storage.objects
as restrictive
for update
to public
using (
  bucket_id <> 'hr-documents'
  or public.humana_is_admin()
)
with check (
  bucket_id <> 'hr-documents'
  or public.humana_is_admin()
);

drop policy if exists "hr_storage_delete_guard" on storage.objects;
create policy "hr_storage_delete_guard"
on storage.objects
as restrictive
for delete
to public
using (
  bucket_id <> 'hr-documents'
  or public.humana_is_admin()
);

-- Policies permissives minimales necessaires a l'application.
drop policy if exists "hr_storage_read_allowed_files" on storage.objects;
create policy "hr_storage_read_allowed_files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hr-documents'
  and (
    (storage.foldername(name))[1] = 'docs'
    or (
      (storage.foldername(name))[1] = 'payslips'
      and (
        (storage.foldername(name))[2] = auth.uid()::text
        or public.humana_is_admin()
      )
    )
  )
);

drop policy if exists "hr_storage_admin_insert" on storage.objects;
create policy "hr_storage_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hr-documents'
  and public.humana_is_admin()
  and (storage.foldername(name))[1] in ('docs', 'payslips')
);

drop policy if exists "hr_storage_admin_update" on storage.objects;
create policy "hr_storage_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'hr-documents'
  and public.humana_is_admin()
)
with check (
  bucket_id = 'hr-documents'
  and public.humana_is_admin()
);

drop policy if exists "hr_storage_admin_delete" on storage.objects;
create policy "hr_storage_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hr-documents'
  and public.humana_is_admin()
);

commit;

-- Verification apres execution :
-- select id, public from storage.buckets where id = 'hr-documents';
-- select id, storage_path from public.hr_documents where coalesce(storage_path, '') = '';
-- select id, storage_path from public.payslips where coalesce(storage_path, '') = '';
