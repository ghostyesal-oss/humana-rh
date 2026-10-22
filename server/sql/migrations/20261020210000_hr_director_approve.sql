-- Avance / attestation : visa RH ou Directeur (CODIR), pas soi-même.

create or replace function public.humana_is_director()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (
        leave_grade = 'codir'
        or lower(coalesce(job_title, '')) like '%directeur%'
        or lower(coalesce(job_title, '')) like '%directrice%'
        or lower(coalesce(job_title, '')) like '%codir%'
      )
  );
$$;

revoke all on function public.humana_is_director() from public;
grant execute on function public.humana_is_director() to public;
grant execute on function public.humana_is_director() to authenticated;
grant execute on function public.humana_is_director() to humana_app;

create or replace function public.humana_can_approve_hr(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target is not null
    and target is distinct from auth.uid()
    and (
      public.humana_is_admin()
      or public.humana_is_hr()
      or public.humana_is_director()
    );
$$;
