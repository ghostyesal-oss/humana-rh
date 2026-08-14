-- Humana RH — schéma initial à exécuter dans le SQL Editor Supabase.
create extension if not exists "pgcrypto";

create type public.app_role as enum ('employee', 'manager', 'hr', 'admin');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.candidate_stage as enum ('new', 'screening', 'interview', 'offer', 'hired', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  avatar_url text,
  role public.app_role not null default 'employee',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  employee_number text unique,
  job_title text not null,
  department text not null,
  manager_id uuid references public.employees(id) on delete set null,
  start_date date not null,
  contract_type text,
  work_location text,
  status text not null default 'active' check (status in ('active', 'leave', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null,
  starts_on date not null,
  ends_on date not null,
  working_days numeric(5, 2) not null check (working_days > 0),
  reason text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  storage_path text not null unique,
  mime_type text,
  owner_id uuid references public.profiles(id) on delete set null,
  is_company_wide boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_openings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null,
  description text,
  location text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_openings(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  resume_path text,
  stage public.candidate_stage not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_at timestamptz not null default now()
);

create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  reviewer_id uuid references public.employees(id) on delete set null,
  objectives jsonb not null default '[]'::jsonb,
  employee_comments text,
  reviewer_comments text,
  score numeric(2, 1) check (score between 1 and 5),
  status text not null default 'draft' check (status in ('draft', 'employee_input', 'manager_review', 'completed')),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.has_rh_access()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('hr', 'admin')
  );
$$;

create or replace function public.is_manager_of(target_employee uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.employees target
    join public.employees manager on manager.id = target.manager_id
    where target.id = target_employee and manager.profile_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.leave_requests enable row level security;
alter table public.documents enable row level security;
alter table public.job_openings enable row level security;
alter table public.candidates enable row level security;
alter table public.review_cycles enable row level security;
alter table public.performance_reviews enable row level security;

create policy "Authenticated users can view directory profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "HR can manage profiles" on public.profiles
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());

-- Empêche un utilisateur de s'attribuer lui-même le rôle admin via l'API.
-- Les rôles sont modifiés depuis un backend de confiance ou le SQL Editor.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create policy "Authenticated users can view employee directory" on public.employees
  for select to authenticated using (true);
create policy "HR can manage employees" on public.employees
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());

create policy "Employees can view relevant leave requests" on public.leave_requests
  for select to authenticated using (
    public.has_rh_access()
    or public.is_manager_of(employee_id)
    or exists (select 1 from public.employees where id = employee_id and profile_id = auth.uid())
  );
create policy "Employees can request their own leave" on public.leave_requests
  for insert to authenticated with check (
    exists (select 1 from public.employees where id = employee_id and profile_id = auth.uid())
  );
create policy "Managers and HR can review leave" on public.leave_requests
  for update to authenticated using (public.has_rh_access() or public.is_manager_of(employee_id));

create policy "Users can view shared or owned documents" on public.documents
  for select to authenticated using (is_company_wide or owner_id = auth.uid() or public.has_rh_access());
create policy "HR can manage documents" on public.documents
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());

create policy "Authenticated users can view published jobs" on public.job_openings
  for select to authenticated using (status = 'published' or public.has_rh_access());
create policy "HR can manage jobs" on public.job_openings
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());
create policy "HR can manage candidates" on public.candidates
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());

create policy "Authenticated users can view active review cycles" on public.review_cycles
  for select to authenticated using (status = 'active' or public.has_rh_access());
create policy "HR can manage review cycles" on public.review_cycles
  for all to authenticated using (public.has_rh_access()) with check (public.has_rh_access());
create policy "Users can view their relevant reviews" on public.performance_reviews
  for select to authenticated using (
    public.has_rh_access()
    or exists (select 1 from public.employees where id in (employee_id, reviewer_id) and profile_id = auth.uid())
  );
create policy "Review participants can update reviews" on public.performance_reviews
  for update to authenticated using (
    public.has_rh_access()
    or exists (select 1 from public.employees where id in (employee_id, reviewer_id) and profile_id = auth.uid())
  );
create policy "HR can create reviews" on public.performance_reviews
  for insert to authenticated with check (public.has_rh_access());

create index leave_requests_employee_idx on public.leave_requests(employee_id);
create index candidates_job_idx on public.candidates(job_id);
create index reviews_employee_idx on public.performance_reviews(employee_id);
