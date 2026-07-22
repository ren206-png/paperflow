-- ============================================================
-- 002_customers_products.sql
-- Sales & CRM (supporting module) + the SKU/variant records the
-- Pricing & Margin wedge prices against.
--
-- Per Phase 2.4: variant attributes (ply/GSM/roll length/sheet
-- count/case-pack) are handled as flat columns on `products` —
-- no BOM/configurator engine at MVP. Manufacturing costing is
-- deferred; `products` exists here purely as a pricing subject.
-- ============================================================

-- ============================================================
-- CUSTOMERS
-- default_price_book_id is added by 004_price_books.sql once
-- that table exists (avoids a circular FK across migrations).
-- ============================================================
create table if not exists public.customers (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  customer_type   text not null default 'wholesaler'
                    check (customer_type in ('distributor', 'institution', 'wholesaler', 'other')),
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  credit_terms    text,               -- e.g. "net 30" — free text at MVP, not a payments integration
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_customers_org_id on public.customers(organization_id);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

drop policy if exists "customers_select" on public.customers;
create policy "customers_select"
  on public.customers for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "customers_write" on public.customers;
create policy "customers_write"
  on public.customers for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

-- ============================================================
-- PRODUCTS
-- Finished-SKU records with the paper-specific variant matrix
-- baked in as columns — this is the concrete "we're not generic
-- MRP" differentiator called out in Phase 1.2.
-- ============================================================
create table if not exists public.products (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  sku_code        text not null,
  ply             integer,                       -- e.g. 1, 2, 3
  gsm             numeric,                        -- grams per square meter
  roll_length_ft  numeric,                        -- roll length in feet
  sheet_count     integer,                        -- sheets per roll
  case_pack_qty   integer,                        -- units per case
  unit_of_measure text not null default 'case'
                    check (unit_of_measure in ('each', 'roll', 'case', 'pallet')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, sku_code)
);

create index if not exists idx_products_org_id on public.products(organization_id);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

drop policy if exists "products_select" on public.products;
create policy "products_select"
  on public.products for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "products_write" on public.products;
create policy "products_write"
  on public.products for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());
