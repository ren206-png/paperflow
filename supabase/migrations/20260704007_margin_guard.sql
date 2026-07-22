-- ============================================================
-- 007_margin_guard.sql
-- Cost-Change Margin Guard.
--
-- Why this exists: cost_inputs (003) is manual-entry only and
-- price_book_lines (004) never reacts to a cost change on its
-- own — a rep has to remember to go re-check every price book
-- line for every SKU whose cost just moved. Industry research
-- (see conversation with the product owner) shows distributors
-- in this space run ~3-4% operating margins, and typical
-- vendor-cost-increase-to-price-update lag alone erodes ~1.6%
-- of margin, with slow pricing reactions overall responsible for
-- ~6% erosion. Every enterprise competitor in this space
-- (Zilliant, Vendavo, Vistaar, Price Tweakers) sells this
-- capability — automatically surfacing which customer prices are
-- now underwater after a cost change — as a core differentiator.
--
-- Design:
--   1. `price_book_line_margins` is a plain (non-security-definer)
--      view, same pattern as `cost_inputs_with_total` (003) — it
--      is computed live from current data, never stored, so it
--      can never drift, and it inherits the RLS of the tables it
--      joins (price_book_lines, price_books, cost_inputs) rather
--      than needing its own policies.
--   2. `margin_alert_reviews` is an explicit human decision log
--      (propose-only — nothing here writes a price on its own).
--      An alert is considered "resolved" by the app layer only
--      if a review row exists whose `reviewed_cost_effective_date`
--      is >= the line's current cost_effective_date — so if the
--      cost changes AGAIN after a rep dismissed/repriced, the
--      alert correctly reappears instead of being silenced forever.
-- ============================================================

create or replace view public.price_book_line_margins as
select
  pbl.id            as price_book_line_id,
  pbl.price_book_id,
  pbl.product_id,
  pbl.unit_price,
  pbl.min_qty,
  pbl.max_qty,
  pbl.updated_at   as price_updated_at,
  pb.organization_id,
  pb.customer_id,
  pb.name          as price_book_name,
  pb.is_contract,
  lci.total_unit_cost as current_unit_cost,
  lci.effective_date  as cost_effective_date,
  case
    when pbl.unit_price = 0 or lci.total_unit_cost is null then null
    else round(((pbl.unit_price - lci.total_unit_cost) / pbl.unit_price) * 1000) / 10
  end as margin_pct
from public.price_book_lines pbl
join public.price_books pb on pb.id = pbl.price_book_id
left join lateral (
  select
    (ci.raw_material_cost + ci.packaging_cost + ci.labor_cost + ci.freight_cost_per_unit) as total_unit_cost,
    ci.effective_date
  from public.cost_inputs ci
  where ci.product_id = pbl.product_id
    and ci.effective_date <= current_date
  order by ci.effective_date desc
  limit 1
) lci on true;

-- ============================================================
-- MARGIN ALERT REVIEWS
-- One row per human decision on a margin alert. `price_book_lines`
-- has no organization_id of its own (see 004), so we store it
-- redundantly here (set by the app layer, same pattern as
-- cost_inputs.organization_id) to keep RLS a simple equality
-- check instead of another EXISTS-through-two-joins subquery.
-- ============================================================
create table if not exists public.margin_alert_reviews (
  id                           uuid primary key default uuid_generate_v4(),
  organization_id              uuid not null references public.organizations(id) on delete cascade,
  price_book_line_id           uuid not null references public.price_book_lines(id) on delete cascade,
  reviewed_cost_effective_date date not null,
  action                       text not null check (action in ('dismissed', 'repriced')),
  previous_unit_price          numeric,
  new_unit_price               numeric,
  reviewed_by                  uuid references auth.users(id),
  created_at                   timestamptz not null default now()
);

create index if not exists idx_margin_alert_reviews_line
  on public.margin_alert_reviews(price_book_line_id, reviewed_cost_effective_date desc);
create index if not exists idx_margin_alert_reviews_org
  on public.margin_alert_reviews(organization_id);

alter table public.margin_alert_reviews enable row level security;

drop policy if exists "margin_alert_reviews_select" on public.margin_alert_reviews;
create policy "margin_alert_reviews_select"
  on public.margin_alert_reviews for select
  using (public.is_platform_admin() or organization_id = public.my_org_id());

drop policy if exists "margin_alert_reviews_write" on public.margin_alert_reviews;
create policy "margin_alert_reviews_write"
  on public.margin_alert_reviews for all
  using (public.is_platform_admin() or organization_id = public.my_org_id())
  with check (public.is_platform_admin() or organization_id = public.my_org_id());
