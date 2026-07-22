-- ============================================================
-- 008_xero_sync.sql
-- OAuth connection state for the Xero integration, mirroring
-- 006_quickbooks_sync.sql exactly. `invoices.external_ref` (005)
-- was already named provider-agnostically for this.
--
-- One accounting provider connected at a time per org (enforced in
-- application code, not here — see src/app/api/xero/connect/route.ts
-- and src/app/api/quickbooks/connect/route.ts): there is no
-- `provider` column anywhere, because at sync time whichever of
-- `quickbooks_connections` / `xero_connections` has a row for the
-- org is simply the active one.
--
-- Same deliberate default-deny as `quickbooks_connections`: RLS
-- enabled, zero policies, service-role admin client only.
-- ============================================================

create table if not exists public.xero_connections (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  tenant_id             text not null,
  access_token          text not null,
  refresh_token         text not null,
  token_expires_at      timestamptz not null,
  connected_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.xero_connections enable row level security;
-- Intentionally no policies — default-deny for anon/authenticated.
-- Only the service-role client (bypasses RLS) can touch this table.

drop trigger if exists trg_xero_connections_updated_at on public.xero_connections;
create trigger trg_xero_connections_updated_at
  before update on public.xero_connections
  for each row execute function public.set_updated_at();

alter table public.customers
  add column if not exists xero_contact_id text;

alter table public.products
  add column if not exists xero_item_id text;

comment on column public.customers.xero_contact_id is
  'Xero Contact.ContactID this PaperFlow customer maps to, once synced at least once.';
comment on column public.products.xero_item_id is
  'Xero Item.ItemID this PaperFlow product maps to, once synced at least once.';
