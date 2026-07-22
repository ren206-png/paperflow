-- ============================================================
-- 005_quotes_orders_invoices.sql
-- Core workflow tables: quote → order → fulfillment → invoice
-- (Phase 2.2), plus the audit log required by Phase 2.3 for
-- price-book changes and quote→order conversions.
-- ============================================================

-- ============================================================
-- QUOTES
-- ============================================================
create table if not exists public.quotes (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete restrict,
  price_book_id   uuid references public.price_books(id) on delete set null,
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'accepted', 'expired')),
  created_by      uuid references auth.users(id),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_quotes_org_id on public.quotes(organization_id);
create index if not exists idx_quotes_customer_id on public.quotes(customer_id);

drop trigger if exists trg_quotes_updated_at on public.quotes;
create trigger trg_quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

alter table public.quotes enable row level security;

drop policy if exists "quotes_select" on public.quotes;
create policy "quotes_select" on public.quotes for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "quotes_write" on public.quotes;
create policy "quotes_write" on public.quotes for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

-- ============================================================
-- QUOTE LINES
-- unit_cost_snapshot is captured at quote time (not looked up
-- live later) — see Phase 2.2 edge case #1: cost changes
-- mid-quote-cycle must not silently move the margin shown
-- earlier to the rep.
-- ============================================================
create table if not exists public.quote_lines (
  id                  uuid primary key default uuid_generate_v4(),
  quote_id            uuid not null references public.quotes(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  qty                 integer not null check (qty > 0),
  unit_price          numeric not null,
  unit_cost_snapshot  numeric not null,
  cost_effective_date date,   -- effective_date of the cost_inputs row this was snapshotted from
  margin_pct          numeric generated always as (
                        case when unit_price = 0 then 0
                        else round(((unit_price - unit_cost_snapshot) / unit_price) * 100, 2)
                        end
                      ) stored,
  created_at          timestamptz not null default now()
);

create index if not exists idx_quote_lines_quote_id on public.quote_lines(quote_id);

alter table public.quote_lines enable row level security;

drop policy if exists "quote_lines_select" on public.quote_lines;
create policy "quote_lines_select" on public.quote_lines for select
  using (
    public.is_platform_admin()
    or exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.organization_id = public.my_org_id())
  );

drop policy if exists "quote_lines_write" on public.quote_lines;
create policy "quote_lines_write" on public.quote_lines for all
  using (
    public.is_platform_admin()
    or exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.organization_id = public.my_org_id())
  )
  with check (
    public.is_platform_admin()
    or exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.organization_id = public.my_org_id())
  );

-- ============================================================
-- ORDERS — created 1:1 from an accepted quote (Phase 2.2 step 3)
-- ============================================================
create table if not exists public.orders (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id        uuid references public.quotes(id) on delete set null,
  customer_id     uuid not null references public.customers(id) on delete restrict,
  status          text not null default 'open'
                    check (status in ('open', 'fulfilling', 'fulfilled', 'invoiced', 'cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_orders_org_id on public.orders(organization_id);
create index if not exists idx_orders_customer_id on public.orders(customer_id);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "orders_write" on public.orders;
create policy "orders_write" on public.orders for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

-- ============================================================
-- ORDER LINES
-- fulfilled_qty supports partial fulfillment (Phase 2.2 edge
-- case #4) without a full logistics module: an order line can
-- be invoiced for less than its full qty as shipments trickle in.
-- ============================================================
create table if not exists public.order_lines (
  id                  uuid primary key default uuid_generate_v4(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  qty                 integer not null check (qty > 0),
  unit_price          numeric not null,
  unit_cost_snapshot  numeric not null,
  fulfilled_qty       integer not null default 0 check (fulfilled_qty >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (fulfilled_qty <= qty)
);

create index if not exists idx_order_lines_order_id on public.order_lines(order_id);

drop trigger if exists trg_order_lines_updated_at on public.order_lines;
create trigger trg_order_lines_updated_at
  before update on public.order_lines
  for each row execute function public.set_updated_at();

alter table public.order_lines enable row level security;

drop policy if exists "order_lines_select" on public.order_lines;
create policy "order_lines_select" on public.order_lines for select
  using (
    public.is_platform_admin()
    or exists (select 1 from public.orders o where o.id = order_lines.order_id and o.organization_id = public.my_org_id())
  );

drop policy if exists "order_lines_write" on public.order_lines;
create policy "order_lines_write" on public.order_lines for all
  using (
    public.is_platform_admin()
    or exists (select 1 from public.orders o where o.id = order_lines.order_id and o.organization_id = public.my_org_id())
  )
  with check (
    public.is_platform_admin()
    or exists (select 1 from public.orders o where o.id = order_lines.order_id and o.organization_id = public.my_org_id())
  );

-- ============================================================
-- INVOICES + INVOICE LINES
-- Native record + external_ref for the QuickBooks/Xero sync
-- (Phase 2.5). Multiple invoices per order are allowed, each
-- covering only the order lines/quantities actually fulfilled.
-- ============================================================
create table if not exists public.invoices (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete restrict,
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'paid', 'void')),
  external_ref    text,          -- QuickBooks/Xero invoice ID once synced
  total_amount    numeric not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_invoices_org_id on public.invoices(organization_id);
create index if not exists idx_invoices_order_id on public.invoices(order_id);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

drop policy if exists "invoices_select" on public.invoices;
create policy "invoices_select" on public.invoices for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "invoices_write" on public.invoices;
create policy "invoices_write" on public.invoices for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

create table if not exists public.invoice_lines (
  id             uuid primary key default uuid_generate_v4(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  order_line_id  uuid not null references public.order_lines(id) on delete restrict,
  qty_invoiced   integer not null check (qty_invoiced > 0),
  unit_price     numeric not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_invoice_lines_invoice_id on public.invoice_lines(invoice_id);

alter table public.invoice_lines enable row level security;

drop policy if exists "invoice_lines_select" on public.invoice_lines;
create policy "invoice_lines_select" on public.invoice_lines for select
  using (
    public.is_platform_admin()
    or exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.organization_id = public.my_org_id())
  );

drop policy if exists "invoice_lines_write" on public.invoice_lines;
create policy "invoice_lines_write" on public.invoice_lines for all
  using (
    public.is_platform_admin()
    or exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.organization_id = public.my_org_id())
  )
  with check (
    public.is_platform_admin()
    or exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.organization_id = public.my_org_id())
  );

-- ============================================================
-- AUDIT LOG (Phase 2.3)
-- Scope: price-book changes and quote→order conversions — the
-- data a design partner will actually ask for during a "why did
-- this price change" dispute. Retention: 2 years.
-- Insert-only from the app's perspective; no update/delete policy
-- is defined, so rows are immutable once written.
-- ============================================================
create table if not exists public.audit_log (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id   uuid references auth.users(id),
  action          text not null,        -- e.g. 'price_book_line.update', 'quote.converted_to_order'
  entity_type     text not null,        -- e.g. 'price_book_lines', 'quotes'
  entity_id       uuid not null,
  before_data     jsonb,
  after_data      jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_org_id on public.audit_log(organization_id);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log for select
  using (
    public.is_platform_admin()
    or (organization_id = public.my_org_id() and public.is_org_admin())
  );
-- No insert/update/delete policy for regular users — all writes
-- go through the SECURITY DEFINER trigger/function below.

-- ============================================================
-- Automatic audit trigger for price_book_lines (the most
-- dispute-prone table — this is literally what a customer will
-- ask about first).
-- ============================================================
create or replace function public.audit_price_book_line_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from public.price_books
  where id = coalesce(new.price_book_id, old.price_book_id);

  insert into public.audit_log (organization_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    v_org_id,
    auth.uid(),
    'price_book_line.' || lower(tg_op),
    'price_book_lines',
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_price_book_lines on public.price_book_lines;
create trigger trg_audit_price_book_lines
  after insert or update or delete on public.price_book_lines
  for each row execute function public.audit_price_book_line_change();

-- ============================================================
-- Callable function for logging a quote→order conversion — this
-- is a business event, not a raw row diff, so the app calls it
-- explicitly at the moment of conversion (Phase 2.2 step 3).
-- ============================================================
create or replace function public.log_quote_conversion(p_quote_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from public.quotes where id = p_quote_id;

  insert into public.audit_log (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    v_org_id,
    auth.uid(),
    'quote.converted_to_order',
    'orders',
    p_order_id,
    jsonb_build_object('quote_id', p_quote_id, 'order_id', p_order_id)
  );
end;
$$;

grant execute on function public.log_quote_conversion(uuid, uuid) to authenticated;
