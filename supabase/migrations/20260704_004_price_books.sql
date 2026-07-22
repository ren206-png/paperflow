-- ============================================================
-- 004_price_books.sql
-- The actual wedge: contract/volume/customer-specific price
-- books with effective dates. See Phase 2.2/2.4 — this table
-- pair is the entire reason PaperFlow exists as a point solution
-- rather than "just use Odoo."
-- ============================================================

create table if not exists public.price_books (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  customer_id       uuid references public.customers(id) on delete cascade, -- null = org-wide default/list book
  name              text not null,
  is_contract       boolean not null default false,
  effective_start   date not null default current_date,
  effective_end     date,                       -- null = open-ended
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_end is null or effective_end >= effective_start)
);

create index if not exists idx_price_books_org_id on public.price_books(organization_id);
create index if not exists idx_price_books_customer_id on public.price_books(customer_id);
-- Supports "which book applies as of date X" lookups (edge case #2).
create index if not exists idx_price_books_effective
  on public.price_books(customer_id, effective_start desc, effective_end);

drop trigger if exists trg_price_books_updated_at on public.price_books;
create trigger trg_price_books_updated_at
  before update on public.price_books
  for each row execute function public.set_updated_at();

alter table public.price_books enable row level security;

drop policy if exists "price_books_select" on public.price_books;
create policy "price_books_select"
  on public.price_books for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "price_books_write" on public.price_books;
create policy "price_books_write"
  on public.price_books for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());

-- Now that price_books exists, wire up the customer's default book.
alter table public.customers
  add column if not exists default_price_book_id uuid references public.price_books(id) on delete set null;

-- ============================================================
-- PRICE BOOK LINES
-- Volume tiers are modeled relationally (min_qty/max_qty per
-- line) rather than as JSONB, so tier-boundary rules (edge case
-- #3) are queryable and constrainable by the database, not just
-- trusted to application code.
-- ============================================================
create table if not exists public.price_book_lines (
  id             uuid primary key default uuid_generate_v4(),
  price_book_id  uuid not null references public.price_books(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  unit_price     numeric not null,
  min_qty        integer not null default 1,
  max_qty        integer,                 -- null = unbounded upper tier
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (max_qty is null or max_qty >= min_qty)
);

create index if not exists idx_price_book_lines_book_id on public.price_book_lines(price_book_id);
create index if not exists idx_price_book_lines_product_id on public.price_book_lines(product_id);

drop trigger if exists trg_price_book_lines_updated_at on public.price_book_lines;
create trigger trg_price_book_lines_updated_at
  before update on public.price_book_lines
  for each row execute function public.set_updated_at();

alter table public.price_book_lines enable row level security;

-- Line-level RLS piggybacks on the parent book's organization,
-- since price_book_lines has no organization_id column of its own.
drop policy if exists "price_book_lines_select" on public.price_book_lines;
create policy "price_book_lines_select"
  on public.price_book_lines for select
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.price_books pb
      where pb.id = price_book_lines.price_book_id
        and pb.organization_id = public.my_org_id()
    )
  );

drop policy if exists "price_book_lines_write" on public.price_book_lines;
create policy "price_book_lines_write"
  on public.price_book_lines for all
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.price_books pb
      where pb.id = price_book_lines.price_book_id
        and pb.organization_id = public.my_org_id()
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1 from public.price_books pb
      where pb.id = price_book_lines.price_book_id
        and pb.organization_id = public.my_org_id()
    )
  );

-- ============================================================
-- Helper: resolve which price book applies to a customer as of
-- a given date. Resolution rule (Phase 2.2 edge case #2):
-- most-specific (customer contract) + most-recent effective_start
-- wins; ambiguity is the app's job to surface, this just picks
-- the single best match deterministically.
-- ============================================================
create or replace function public.resolve_price_book(p_customer_id uuid, p_as_of date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.price_books
  where (
    customer_id = p_customer_id
    or customer_id is null
  )
  and effective_start <= p_as_of
  and (effective_end is null or effective_end >= p_as_of)
  order by
    -- customer-specific book beats org-wide default. NOTE: this must be
    -- `customer_id is not null`, not `customer_id = p_customer_id` — the
    -- latter evaluates to NULL (not false) for the org-default row (where
    -- customer_id is null), and Postgres sorts NULL FIRST by default in a
    -- DESC ordering, i.e. tied with true. That silently made the winner
    -- depend on undefined tie-break/physical row order instead of always
    -- preferring the customer-specific book. Caught by pgTAP test
    -- "customer-specific contract book wins over the org-wide default".
    (customer_id is not null) desc,
    effective_start desc
  limit 1;
$$;

grant execute on function public.resolve_price_book(uuid, date) to authenticated;

-- ============================================================
-- Helper: unit price for a product/customer/qty as of a date,
-- respecting volume tiers (Phase 2.2 edge case #3: boundary
-- quantities are inclusive on min_qty, inclusive on max_qty).
-- ============================================================
create or replace function public.resolve_unit_price(
  p_customer_id uuid,
  p_product_id  uuid,
  p_qty         integer,
  p_as_of       date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select pbl.unit_price
  from public.price_book_lines pbl
  where pbl.price_book_id = public.resolve_price_book(p_customer_id, p_as_of)
    and pbl.product_id = p_product_id
    and p_qty >= pbl.min_qty
    and (pbl.max_qty is null or p_qty <= pbl.max_qty)
  order by pbl.min_qty desc
  limit 1;
$$;

grant execute on function public.resolve_unit_price(uuid, uuid, integer, date) to authenticated;
