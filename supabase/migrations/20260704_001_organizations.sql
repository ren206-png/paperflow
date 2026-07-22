-- ============================================================
-- 001_organizations.sql
-- PaperFlow OS — foundation schema: organizations (tenants),
-- user profiles, and the RLS helper functions every other
-- migration in this project relies on.
--
-- Tenant isolation strategy: row-level security (RLS) on a
-- shared schema, scoped by organization_id. See Phase 2.3 of
-- the product design memo for the reasoning — this is the
-- right cost/risk tradeoff at MVP scale (~10 design partners),
-- not schema- or database-per-tenant.
--
-- Run in the Supabase SQL editor (or via `supabase db push`).
-- Safe to re-run (idempotent).
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- ORGANIZATIONS
-- One row per converting/distribution company using PaperFlow.
-- Pricing metric (see Phase 3.1) is SKU/price-book complexity,
-- not seats — so there is no per-seat limit here.
-- ============================================================
create table if not exists public.organizations (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  slug                text not null unique,
  subscription_tier   text not null default 'free_trial'
                        check (subscription_tier in ('free_trial', 'starter', 'growth')),
  subscription_status text not null default 'trialing'
                        check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- USER PROFILES
-- Extends auth.users. Single-org membership per user at MVP
-- (matches the Phase 2.3 role matrix — org admin / sales rep
-- today; warehouse/production/portal-user roles are reserved
-- but unused until those modules exist).
-- ============================================================
create table if not exists public.user_profiles (
  id              uuid primary key default uuid_generate_v4(),
  auth_user_id    uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  full_name       text not null,
  role            text not null default 'sales_rep'
                    check (role in (
                      'platform_admin',
                      'organization_owner',
                      'administrator',
                      'sales_rep',
                      'client_viewer'
                    )),
  avatar_url      text,
  phone           text,
  status          text not null default 'active'
                    check (status in ('active', 'invited', 'suspended', 'deactivated')),
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_user_profiles_org_id on public.user_profiles(organization_id);
create index if not exists idx_user_profiles_auth_user_id on public.user_profiles(auth_user_id);

-- ============================================================
-- Trigger: keep updated_at fresh
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS helper functions
-- SECURITY DEFINER + fixed search_path so they're safe to call
-- from inside RLS policies without leaking privilege escalation.
-- ============================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role = 'platform_admin'
      and status = 'active'
  );
$$;

create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('platform_admin', 'organization_owner', 'administrator')
      and status = 'active'
  );
$$;

-- ============================================================
-- RLS policies — organizations
-- Members can see their own org; only admins can update it.
-- Inserts happen via a SECURITY DEFINER signup function (below),
-- never directly by end users.
-- ============================================================
alter table public.organizations enable row level security;

drop policy if exists "organizations_select" on public.organizations;
create policy "organizations_select"
  on public.organizations for select
  using (
    public.is_platform_admin()
    or id = public.my_org_id()
  );

drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update"
  on public.organizations for update
  using (
    public.is_platform_admin()
    or (id = public.my_org_id() and public.is_org_admin())
  );

-- ============================================================
-- RLS policies — user_profiles
-- ============================================================
alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select" on public.user_profiles;
create policy "user_profiles_select"
  on public.user_profiles for select
  using (
    public.is_platform_admin()
    or organization_id = public.my_org_id()
  );

drop policy if exists "user_profiles_update_self" on public.user_profiles;
create policy "user_profiles_update_self"
  on public.user_profiles for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "user_profiles_admin_manage" on public.user_profiles;
create policy "user_profiles_admin_manage"
  on public.user_profiles for all
  using (
    public.is_platform_admin()
    or (organization_id = public.my_org_id() and public.is_org_admin())
  );

-- ============================================================
-- Signup function: creates an organization + the first user's
-- profile (as organization_owner) atomically. Called from the
-- app right after Supabase Auth sign-up completes.
-- ============================================================
create or replace function public.create_organization_with_owner(
  p_org_name text,
  p_org_slug text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations (name, slug)
  values (p_org_name, p_org_slug)
  returning id into v_org_id;

  insert into public.user_profiles (auth_user_id, organization_id, email, full_name, role)
  values (
    auth.uid(),
    v_org_id,
    (select email from auth.users where id = auth.uid()),
    p_full_name,
    'organization_owner'
  );

  return v_org_id;
end;
$$;

grant execute on function public.create_organization_with_owner(text, text, text) to authenticated;
