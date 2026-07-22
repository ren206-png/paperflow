-- ============================================================
-- 006_quickbooks_sync.sql
-- OAuth connection state for the QuickBooks Online integration
-- (Phase 2.5 fast-follow), plus the entity-mapping columns needed
-- to push an invoice: a PaperFlow customer/product must be linked
-- to its corresponding QBO Customer/Item before an Invoice object
-- can reference it.
--
-- Tokens live in their own table, deliberately NOT in
-- `organizations`. The `organizations` row is selectable by every
-- member of the org (organizations_select RLS: any my_org_id()
-- match, not just admins) and is fetched client-side via the anon
-- key in AuthProvider — so raw OAuth access/refresh tokens must
-- never live there, or any logged-in org member (down to
-- client_viewer) could read them out of the browser's network
-- tab/devtools and call the QuickBooks API directly as the org.
--
-- `quickbooks_connections` has RLS enabled with NO policies at
-- all, so it is unreachable from the anon/authenticated roles by
-- default — only the service-role admin client (used exclusively
-- by our server-only routes) can read or write it.
-- ============================================================

create table if not exists public.quickbooks_connections (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  realm_id              text not null,
  access_token          text not null,
  refresh_token         text not null,
  token_expires_at      timestamptz not null,
  connected_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.quickbooks_connections enable row level security;
-- Intentionally no policies — default-deny for anon/authenticated.
-- Only the service-role client (bypasses RLS) can touch this table.

drop trigger if exists trg_quickbooks_connections_updated_at on public.quickbooks_connections;
create trigger trg_quickbooks_connections_updated_at
  before update on public.quickbooks_connections
  for each row execute function public.set_updated_at();

-- Non-sensitive ID mappings (safe to live on the regularly-selected
-- tables — these are QBO record IDs, not credentials).
alter table public.customers
  add column if not exists quickbooks_customer_id text;

alter table public.products
  add column if not exists quickbooks_item_id text;

comment on column public.customers.quickbooks_customer_id is
  'QBO Customer.Id this PaperFlow customer maps to, once synced at least once.';
comment on column public.products.quickbooks_item_id is
  'QBO Item.Id this PaperFlow product maps to, once synced at least once.';
