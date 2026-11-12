-- Le rôle RH peut lire et enregistrer uniquement le réglage des éléments de paie EDS.

drop policy if exists app_settings_eds_payroll_hr on public.app_settings;
create policy app_settings_eds_payroll_hr on public.app_settings
  for all
  using (
    key = 'eds_payroll'
    and (public.humana_is_admin() or public.humana_is_hr())
  )
  with check (
    key = 'eds_payroll'
    and (public.humana_is_admin() or public.humana_is_hr())
  );
