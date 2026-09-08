-- A executer dans Supabase > SQL Editor.
-- Stocke les abonnements Web Push des collaborateurs pour l'envoi de
-- rappels de pointage depuis l'Edge Function "late-punch-reminder".

create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions readable" on public.push_subscriptions;
create policy "own subscriptions readable"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "own subscriptions writable" on public.push_subscriptions;
create policy "own subscriptions writable"
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "own subscriptions updatable" on public.push_subscriptions;
create policy "own subscriptions updatable"
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own subscriptions deletable" on public.push_subscriptions;
create policy "own subscriptions deletable"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);

-- L'Edge Function utilisera la service role key (bypass RLS) pour lire toutes les
-- souscriptions et pousser une notification aux collaborateurs qui n'ont pas
-- pointe en debut de journee.

notify pgrst, 'reload schema';
