-- Visibilité réelle des documents RH et des événements (all / managers / admins).
-- Remplace le "tout utilisateur authentifié voit tout".

create or replace function public.humana_is_manager_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.humana_is_admin()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'manager'
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
      or (coalesce(vis, 'all') = 'admins' and public.humana_is_admin())
    );
$$;

drop policy if exists hr_documents_select on public.hr_documents;
create policy hr_documents_select on public.hr_documents
  for select using (public.humana_can_read_visibility(visibility));

drop policy if exists company_events_select on public.company_events;
create policy company_events_select on public.company_events
  for select using (public.humana_can_read_visibility(visibility));

grant execute on function public.humana_is_manager_or_above() to humana_app;
grant execute on function public.humana_can_read_visibility(text) to humana_app;
