-- ============================================================
-- 009_customer_portal.sql
-- Read-only customer self-service portal. A `client_viewer`
-- user_profiles row is scoped to exactly one customer via the
-- new `customer_id` column; every RLS policy below is rewritten
-- (not additively layered) so that a portal login only ever sees
-- its own customer's non-draft quotes/orders/invoices, and can
-- never write anything. Staff behavior (customer_id is null) is
-- completely unchanged.
-- ============================================================

alter table public.user_profiles
  add column if not exists customer_id uuid references public.customers(id) on delete cascade;

comment on column public.user_profiles.customer_id is
  'Set only for client_viewer rows — scopes a portal login to the one customer it may see. Null for staff.';

create index if not exists idx_user_profiles_customer_id on public.user_profiles(customer_id);

-- ============================================================
-- RLS helper: the customer a portal login is scoped to, or null
-- for staff. Same SECURITY DEFINER pattern as my_org_id().
-- ============================================================
create or replace function public.my_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- ============================================================
-- CUSTOMERS — a portal login may only see (never write) its own
-- customer row.
-- ============================================================
drop policy if exists "customers_select" on public.customers;
create policy "customers_select"
  on public.customers for select
  using (
    public.is_platform_admin()
    or (
      organization_id = public.my_org_id()
      and (public.my_customer_id() is null or id = public.my_customer_id())
    )
  );

drop policy if exists "customers_write" on public.customers;
create policy "customers_write"
  on public.customers for all
  using (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null))
  with check (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null));

-- ============================================================
-- QUOTES / QUOTE LINES — portal sees only its own customer's
-- non-draft quotes.
-- ============================================================
drop policy if exists "quotes_select" on public.quotes;
create policy "quotes_select" on public.quotes for select
  using (
    public.is_platform_admin()
    or (
      organization_id = public.my_org_id()
      and (
        public.my_customer_id() is null
        or (customer_id = public.my_customer_id() and status <> 'draft')
      )
    )
  );

drop policy if exists "quotes_write" on public.quotes;
create policy "quotes_write" on public.quotes for all
  using (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null))
  with check (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null));

drop policy if exists "quote_lines_select" on public.quote_lines;
create policy "quote_lines_select" on public.quote_lines for select
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.quotes q
      where q.id = quote_lines.quote_id
        and q.organization_id = public.my_org_id()
        and (
          public.my_customer_id() is null
          or (q.customer_id = public.my_customer_id() and q.status <> 'draft')
        )
    )
  );

drop policy if exists "quote_lines_write" on public.quote_lines;
create policy "quote_lines_write" on public.quote_lines for all
  using (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.organization_id = public.my_org_id())
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.organization_id = public.my_org_id())
    )
  );

-- ============================================================
-- ORDERS / ORDER LINES — orders have no draft status, so no
-- status filter is needed, just the customer scope.
-- ============================================================
drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders for select
  using (
    public.is_platform_admin()
    or (
      organization_id = public.my_org_id()
      and (public.my_customer_id() is null or customer_id = public.my_customer_id())
    )
  );

drop policy if exists "orders_write" on public.orders;
create policy "orders_write" on public.orders for all
  using (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null))
  with check (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null));

drop policy if exists "order_lines_select" on public.order_lines;
create policy "order_lines_select" on public.order_lines for select
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.organization_id = public.my_org_id()
        and (public.my_customer_id() is null or o.customer_id = public.my_customer_id())
    )
  );

drop policy if exists "order_lines_write" on public.order_lines;
create policy "order_lines_write" on public.order_lines for all
  using (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.orders o where o.id = order_lines.order_id and o.organization_id = public.my_org_id())
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.orders o where o.id = order_lines.order_id and o.organization_id = public.my_org_id())
    )
  );

-- ============================================================
-- INVOICES / INVOICE LINES — invoices have no customer_id column
-- of their own, so the portal scope is resolved through the
-- parent order.
-- ============================================================
drop policy if exists "invoices_select" on public.invoices;
create policy "invoices_select" on public.invoices for select
  using (
    public.is_platform_admin()
    or (
      organization_id = public.my_org_id()
      and (
        public.my_customer_id() is null
        or (
          status <> 'draft'
          and exists (select 1 from public.orders o where o.id = invoices.order_id and o.customer_id = public.my_customer_id())
        )
      )
    )
  );

drop policy if exists "invoices_write" on public.invoices;
create policy "invoices_write" on public.invoices for all
  using (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null))
  with check (public.is_platform_admin() or (organization_id = public.my_org_id() and public.my_customer_id() is null));

drop policy if exists "invoice_lines_select" on public.invoice_lines;
create policy "invoice_lines_select" on public.invoice_lines for select
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.invoices i
      join public.orders o on o.id = i.order_id
      where i.id = invoice_lines.invoice_id
        and i.organization_id = public.my_org_id()
        and (
          public.my_customer_id() is null
          or (i.status <> 'draft' and o.customer_id = public.my_customer_id())
        )
    )
  );

drop policy if exists "invoice_lines_write" on public.invoice_lines;
create policy "invoice_lines_write" on public.invoice_lines for all
  using (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.organization_id = public.my_org_id())
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.my_customer_id() is null
      and exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id and i.organization_id = public.my_org_id())
    )
  );
