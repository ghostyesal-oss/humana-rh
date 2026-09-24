alter table public.profiles
  add column if not exists session_epoch integer not null default 1;
