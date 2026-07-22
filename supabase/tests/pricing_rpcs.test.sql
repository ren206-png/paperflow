-- ============================================================
-- pgTAP tests for the pricing/costing resolver RPCs
-- (resolve_price_book, resolve_unit_price, latest_cost_input).
--
-- These cover exactly the edge cases called out in the migration
-- comments and in Phase 2.2 of the strategy doc:
--   #2 — customer-specific price book beats org-wide default,
--        most-recent effective_start wins among ties
--   #3 — quantity tier boundaries are inclusive on both ends
--   cost-as-of-date lookup ignores future-dated cost entries
--
-- Plus additional edge cases found by auditing the resolver logic
-- rather than just the cases already named in the migration:
--   - two customer-specific books simultaneously effective (e.g. ops
--     forgot to set effective_end on the old one when renegotiating a
--     contract) — most-recent effective_start must still win
--   - effective_end is inclusive, and the day *after* it correctly
--     falls back to the org-wide default rather than staying stuck on
--     the expired book or returning null when a valid fallback exists
--   - a quantity that falls in a gap between two tiers (not just past
--     the last boundary) returns null instead of silently matching the
--     nearest tier
--
-- Run with the Supabase CLI against a local/shadow database:
--   supabase test db
-- (requires the pgTAP extension, which `supabase test db` enables
-- automatically; see https://supabase.com/docs/guides/cli/testing)
--
-- Everything runs inside a single transaction and rolls back at
-- the end, so this never touches real data.
-- ============================================================
begin;
select plan(19);

-- ---- fixtures ----------------------------------------------
insert into public.organizations (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'Test Org', 'test-org');

insert into public.customers (id, organization_id, name, customer_type)
values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Acme (contract)', 'distributor'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Beta (list price)', 'distributor');

insert into public.products (id, organization_id, name, sku_code, unit_of_measure)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Test Roll', 'TST-001', 'roll');

-- Org-wide default book (customer_id null), effective from Jan 1
insert into public.price_books (id, organization_id, customer_id, name, is_contract, effective_start)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', null, 'Org Default 2026', false, '2026-01-01');

-- Acme's negotiated contract book, effective from Jan 1
insert into public.price_books (id, organization_id, customer_id, name, is_contract, effective_start)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Acme Contract 2026', true, '2026-01-01');

-- Org default tiers: 1-99 @ $10.00, 100+ @ $8.00
insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
values
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 10.00, 1, 99),
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 8.00, 100, null);

-- Acme contract: flat $7.50 regardless of qty
insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
values ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 7.50, 1, null);

-- Two cost entries for the product, so we can test "as of" lookups
insert into public.cost_inputs (organization_id, product_id, raw_material_cost, packaging_cost, labor_cost, freight_cost_per_unit, effective_date, source)
values
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 3.00, 0.50, 0.75, 0.25, '2026-01-01', 'manual'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 3.50, 0.50, 0.75, 0.25, '2026-06-01', 'manual');

-- ---- resolve_price_book -------------------------------------

select is(
  public.resolve_price_book('22222222-2222-2222-2222-222222222222'::uuid, '2026-07-20'::date),
  '66666666-6666-6666-6666-666666666666'::uuid,
  'customer-specific contract book wins over the org-wide default for Acme'
);

select is(
  public.resolve_price_book('33333333-3333-3333-3333-333333333333'::uuid, '2026-07-20'::date),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'falls back to the org-wide default book when the customer has no contract book'
);

select is(
  public.resolve_price_book('33333333-3333-3333-3333-333333333333'::uuid, '2025-12-31'::date),
  null,
  'returns null when no price book is effective yet as of the given date'
);

-- ---- resolve_unit_price: quantity tier boundaries ------------

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 1, '2026-07-20'::date),
  10.00::numeric,
  'bottom boundary of the first tier (qty=1) resolves to $10.00'
);

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 99, '2026-07-20'::date),
  10.00::numeric,
  'top boundary of the first tier (qty=99, inclusive max_qty) still resolves to $10.00'
);

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 100, '2026-07-20'::date),
  8.00::numeric,
  'one unit past the boundary (qty=100, inclusive min_qty of next tier) drops to $8.00'
);

select is(
  public.resolve_unit_price('22222222-2222-2222-2222-222222222222'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 5000, '2026-07-20'::date),
  7.50::numeric,
  'contract book with an open-ended tier (max_qty null) applies at any quantity'
);

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 1, '2025-12-31'::date),
  null,
  'returns null (not an error) when no price book is effective yet — the app treats this as "needs manual pricing"'
);

-- ---- price_book_lines overlap guard (DB-level constraint) ----

select throws_ok(
  $$ insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
     values ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 9.00, 50, 10) $$,
  null,
  null,
  'the DB rejects a tier where max_qty < min_qty (check constraint), independent of the app-side overlap check'
);

-- ---- latest_cost_input: as-of date lookup ---------------------

select is(
  (public.latest_cost_input('44444444-4444-4444-4444-444444444444'::uuid, '2026-03-01'::date)).raw_material_cost,
  3.00::numeric,
  'before the second cost entry''s effective_date, latest_cost_input still returns the first entry'
);

select is(
  (public.latest_cost_input('44444444-4444-4444-4444-444444444444'::uuid, '2026-07-20'::date)).raw_material_cost,
  3.50::numeric,
  'once the second cost entry is effective, latest_cost_input returns the newer cost — not a stale earlier one'
);

select is(
  public.latest_cost_input('44444444-4444-4444-4444-444444444444'::uuid, '2025-01-01'::date),
  null,
  'returns null when no cost entry has an effective_date on or before the given date'
);

-- ---- additional fixtures: renegotiated contract, expiring contract, --
-- ---- and a product with a gap between volume tiers -------------------

insert into public.customers (id, organization_id, name, customer_type)
values
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Charlie (renegotiated contract)', 'distributor'),
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'Dana (expiring contract)', 'institution');

insert into public.products (id, organization_id, name, sku_code, unit_of_measure)
values ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'Gapped Tier Roll', 'TST-002', 'roll');

-- Charlie's original 2026 contract, left open-ended (no effective_end set)
-- — modeling the common real-world slip where ops renegotiates a contract
-- but forgets to close out the old book.
insert into public.price_books (id, organization_id, customer_id, name, is_contract, effective_start)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'Charlie Contract 2026-A', true, '2026-01-01');

-- Charlie's renegotiated contract, starting mid-year — also open-ended,
-- so as of any date on/after 2026-06-01 BOTH books are simultaneously
-- "effective" and the resolver's tie-break is the only thing preventing
-- an ambiguous/incorrect answer.
insert into public.price_books (id, organization_id, customer_id, name, is_contract, effective_start)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'Charlie Contract 2026-B (renegotiated)', true, '2026-06-01');

insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9.00, 1, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 6.00, 1, null);

-- Dana's contract explicitly expires mid-year.
insert into public.price_books (id, organization_id, customer_id, name, is_contract, effective_start, effective_end)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', '88888888-8888-8888-8888-888888888888', 'Dana Contract (expires mid-2026)', true, '2026-01-01', '2026-07-20');

insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 6.50, 1, null);

-- Gapped-tier product priced only on the org-wide default book: 1-10 units
-- @ $5.00, then a deliberate gap (11-19 have no tier at all), then 20+ @
-- $4.00 — modeling a real pricing-sheet mistake, not a contiguous ladder.
insert into public.price_book_lines (price_book_id, product_id, unit_price, min_qty, max_qty)
values
  ('55555555-5555-5555-5555-555555555555', '99999999-9999-9999-9999-999999999999', 5.00, 1, 10),
  ('55555555-5555-5555-5555-555555555555', '99999999-9999-9999-9999-999999999999', 4.00, 20, null);

-- ---- resolve_price_book: two simultaneously-effective customer books --

select is(
  public.resolve_price_book('77777777-7777-7777-7777-777777777777'::uuid, '2026-07-20'::date),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'when a customer has two open-ended contract books both currently effective, the most-recent effective_start wins (renegotiated contract beats the stale one ops forgot to close out)'
);

select is(
  public.resolve_price_book('77777777-7777-7777-7777-777777777777'::uuid, '2026-03-01'::date),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'before the renegotiated contract''s effective_start, the original contract book still correctly applies'
);

select is(
  public.resolve_unit_price('77777777-7777-7777-7777-777777777777'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 1, '2026-07-20'::date),
  6.00::numeric,
  'unit price reflects the renegotiated (winning) contract book, not the stale one'
);

-- ---- resolve_price_book: effective_end boundary is inclusive, and the --
-- ---- day after correctly falls back rather than sticking or nulling out

select is(
  public.resolve_price_book('88888888-8888-8888-8888-888888888888'::uuid, '2026-07-20'::date),
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'a contract book resolves on its effective_end date itself (inclusive upper boundary)'
);

select is(
  public.resolve_price_book('88888888-8888-8888-8888-888888888888'::uuid, '2026-07-21'::date),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'the day after a customer contract expires, resolution falls back to the org-wide default book rather than returning the expired book or null'
);

-- ---- resolve_unit_price: a quantity landing in a gap between tiers ----

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, 15, '2026-07-20'::date),
  null,
  'a quantity that falls in a gap between two tiers (11-19, with tiers only defined for 1-10 and 20+) returns null instead of silently matching the nearest tier'
);

select is(
  public.resolve_unit_price('33333333-3333-3333-3333-333333333333'::uuid, '99999999-9999-9999-9999-999999999999'::uuid, 20, '2026-07-20'::date),
  4.00::numeric,
  'the tier immediately after the gap still resolves correctly at its own min_qty boundary'
);

select * from finish();
rollback;
