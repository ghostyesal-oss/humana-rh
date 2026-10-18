-- Demandes RH (attestation, avance) : le manager voit l'équipe mais ne valide pas.
-- Insert soi-même (statut à valider). Valider / refuser : RH ou admin, pas soi.

create or replace function public.humana_can_approve_hr(target uuid)
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
    );
$$;

revoke all on function public.humana_can_approve_hr(uuid) from public;
grant execute on function public.humana_can_approve_hr(uuid) to public;
grant execute on function public.humana_can_approve_hr(uuid) to authenticated;
grant execute on function public.humana_can_approve_hr(uuid) to humana_app;

do $$
declare
  t text;
begin
  foreach t in array array['attestation_requests', 'salary_advance_requests']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_manage_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_manage_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_delete', t);

    execute format(
      'create policy %I on public.%I for insert with check (
         (user_id = auth.uid() and public.humana_is_pending(status))
         or public.humana_can_approve_hr(user_id)
       )',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update
         using (
           public.humana_can_approve_hr(user_id)
           or (user_id = auth.uid() and public.humana_is_pending(status))
         )
         with check (
           public.humana_can_approve_hr(user_id)
           or (user_id = auth.uid() and public.humana_is_pending(status))
         )',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete using (
         public.humana_can_approve_hr(user_id)
         or (user_id = auth.uid() and public.humana_is_pending(status))
       )',
      t || '_delete', t
    );
  end loop;
end $$;
