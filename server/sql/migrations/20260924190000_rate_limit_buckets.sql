create table if not exists auth.rate_limit_buckets (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

create index if not exists rate_limit_buckets_reset_at_idx
  on auth.rate_limit_buckets (reset_at);
