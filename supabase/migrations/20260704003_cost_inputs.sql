-- ============================================================
-- 003_cost_inputs.sql
-- Manually-entered (or CSV-imported) unit cost per SKU.
--
-- Per Phase 2.4 / 3.2: there is deliberately no BOM/manufacturing
-- costing engine at MVP. This table is the honest, visible
-- substitute — see the "hardest edge case" in Phase 2.2 about
-- stale cost entries undermining trust in the margin numbers.
-- effective_date lets a rep see cost history, and the app layer
-- is responsible for warning when the latest row is stale.
-- ============================================================

create table if not exists public.cost_inputs (
  id                     uuid primary key default uuid_generate_v4(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  product_id             uuid not null references public.products(id) on delete cascade,
  raw_material_cost      numeric not null default 0,
  packaging_cost         numeric not null default 0,
  labor_cost             numeric not null default 0,
  freight_cost_per_unit  numeric not null default 0,
  effective_date         date not null default current_date,
  source                 text not null default 'manual'
                           check (source in ('manual', 'import')),
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now()
);

create index if not exists idx_cost_inputs_org_id on public.cost_inputs(organization_id);
create index if not exists idx_cost_inputs_product_id on public.cost_inputs(product_id);
-- Fast "latest cost as of date X" lookups — this is the query the
-- quote builder runs on every line item.
create index if not exists idx_cost_inputs_product_effective
  on public.cost_inputs(product_id, effective_date desc);

-- Convenience: total unit cost, computed rather than stored so it
-- can never drift from its components.
create or replace view public.cost_inputs_with_total as
  select
    ci.*,
    (ci.raw_material_cost + ci.packaging_cost + ci.labor_cost + ci.freight_cost_per_unit)
      as total_unit_cost
  from public.cost_inputs ci;

alter table public.cost_inputs enable row level security;

drop policy if exists "cost_inputs_select" on public.cost_inputs;
create policy "cost_inputs_select"
  on public.cost_inputs for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "cost_inputs_write" on public.cost_inputs;
create policy "cost_inputs_write"
  on public.cost_inputs for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

-- ============================================================
-- Helper: latest cost snapshot for a product as of a given date.
-- Used by the quote builder (2.2 workflow step 2) and by the
-- "stale cost" edge-case warning (2.2 hardest edge case #5).
-- ============================================================
create or replace function public.latest_cost_input(p_product_id uuid, p_as_of date default current_date)
returns public.cost_inputs
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.cost_inputs
  where product_id = p_product_id
    and effective_date <= p_as_of
  order by effective_date desc
  limit 1;
$$;

grant execute on function public.latest_cost_input(uuid, date) to authenticated;
