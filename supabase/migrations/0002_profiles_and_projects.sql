-- Identity mirror of auth.users. We never read auth.users from app code.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      citext not null unique,
  full_name  text   not null,
  role       public.app_role not null default 'REQUESTER',
  -- Default manager for this person's requests; the form may override per request.
  manager_email citext,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Human-readable cost centres for bill_to = PROJECT.
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  code       citext not null unique,
  name       text   not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- PRD 4.3 "configurable format check". Kept permissive but non-empty and
  -- free of whitespace so the code is safe to embed in bill_to = 'PROJECT:<code>'.
  constraint chk_project_code check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$')
);

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create index idx_projects_active on public.projects (active) where active;

-- ---------------------------------------------------------------------------
-- RLS helpers.
--
-- SECURITY DEFINER so that a policy on `profiles` can call current_app_role()
-- without re-entering the same policy and recursing. STABLE so the planner
-- calls it once per statement rather than once per row.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.current_email()
returns citext
language sql stable security definer set search_path = public, pg_temp as $$
  select p.email from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.is_finance()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_role() in ('FINANCE','ADMIN');
$$;

-- Auto-provision a profile whenever Supabase Auth creates a user. Role and
-- name arrive via the signup metadata the seed script sends.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, role, manager_email)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'REQUESTER'),
    nullif(new.raw_user_meta_data->>'manager_email', '')::citext
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
