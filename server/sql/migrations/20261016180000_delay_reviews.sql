-- Revues manager des retards détectés sur les pointages.
-- Sans revue, le retard reste compté (EDS). Valider = confirmer. Rectifier = corriger l'heure.

create table if not exists public.delay_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  delay_min integer not null default 0,
  status text not null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint delay_reviews_status_chk check (status in ('Confirme', 'Rectifie')),
  constraint delay_reviews_min_chk check (delay_min >= 0 and delay_min <= 1440),
  constraint delay_reviews_user_date unique (user_id, work_date)
);

create index if not exists delay_reviews_date_idx
  on public.delay_reviews (work_date);
create index if not exists delay_reviews_user_idx
  on public.delay_reviews (user_id, work_date);

alter table public.delay_reviews enable row level security;
alter table public.delay_reviews force row level security;

drop policy if exists delay_reviews_select on public.delay_reviews;
drop policy if exists delay_reviews_insert on public.delay_reviews;
drop policy if exists delay_reviews_update on public.delay_reviews;
drop policy if exists delay_reviews_delete on public.delay_reviews;

create policy delay_reviews_select on public.delay_reviews
  for select using (public.humana_in_team(user_id));

create policy delay_reviews_insert on public.delay_reviews
  for insert with check (public.humana_manages(user_id));

create policy delay_reviews_update on public.delay_reviews
  for update using (public.humana_manages(user_id))
  with check (public.humana_manages(user_id));

create policy delay_reviews_delete on public.delay_reviews
  for delete using (public.humana_is_admin());

grant select, insert, update, delete on public.delay_reviews to humana_app;
grant select on public.delay_reviews to authenticated;
grant execute on function public.humana_manages(uuid) to humana_app;
