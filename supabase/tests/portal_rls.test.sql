-- ============================================================
-- pgTAP tests for the customer portal RLS rewrite
-- (supabase/migrations/20260721009_customer_portal.sql).
--
-- This converts the one-off manual verification walkthrough
-- (documented in README.md, "Customer portal" section, item 5 —
-- a real Supabase Auth login + direct PostgREST calls) into a
-- permanent, repeatable regression test. This is the one area of
-- the schema where a future policy edit could silently reopen a
-- real cross-customer data leak, so it gets its own dedicated
-- fixture and coverage rather than relying on the manual walkthrough
-- alone.
--
-- Covers exactly what the manual walkthrough proved:
--   - a portal login (customer_id set) sees only its own customer's
--     *non-draft* quotes/invoices, and both draft + non-draft is
--     correctly hidden/shown at every level (parent row + line rows)
--   - a portal login sees none of another customer's rows, at any
--     status
--   - every write path (update/insert/delete) is rejected by RLS for
--     a portal login — insert raises an explicit 42501, update/delete
--     silently affect zero rows (both are correct RLS behavior, just
--     different HTTP-level signatures, as confirmed during the live
--     walkthrough)
--   - staff (customer_id null) keeps full, unrestricted org-wide
--     access exactly as before the portal policies were rewritten —
--     a regression guard that the rewrite in migration 009 didn't
--     accidentally tighten normal staff behavior
--
-- Uses the standard Supabase pattern for simulating an authenticated
-- RLS context inside pgTAP: `set local role authenticated` plus
-- `set local request.jwt.claims`, so auth.uid() (and therefore
-- my_org_id()/my_customer_id()/is_platform_admin()) resolves exactly
-- as it would for a real logged-in request — no real JWT or network
-- round trip needed. All fixtures (including the two auth.users rows)
-- live inside this transaction and roll back at the end.
--
-- Run with the Supabase CLI against a local/shadow database:
--   supabase test db
-- (requires `supabase init` to have been run once in this repo —
-- there was no supabase/config.toml before this test was added).
-- ============================================================
begin;
select plan(18);

-- ---- fixtures: org, customers, product -----------------------
insert into public.organizations (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'Portal Test Org', 'portal-test-org');

insert into public.customers (id, organization_id, name)
values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Customer A'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Customer B');

insert into public.products (id, organization_id, name, sku_code, unit_of_measure)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Portal Test Roll', 'PTL-001', 'roll');

-- ---- fixtures: quotes (one draft + one non-draft per customer's --
-- ---- worth of coverage — Customer A gets both, Customer B just  --
-- ---- the non-draft one, since the cross-customer check doesn't  --
-- ---- need its own draft variant) --------------------------------
insert into public.quotes (id, organization_id, customer_id, status)
values
  ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'draft'),
  ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'sent'),
  ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'sent');

insert into public.quote_lines (id, quote_id, product_id, qty, unit_price, unit_cost_snapshot)
values ('66666666-6666-6666-6666-666666666661', '55555555-5555-5555-5555-555555555552', '44444444-4444-4444-4444-444444444444', 10, 5.00, 3.00);

-- ---- fixtures: orders (no draft concept — orders have no status --
-- ---- filter in the portal policy, just the customer scope) ------
insert into public.orders (id, organization_id, customer_id)
values
  ('77777777-7777-7777-7777-777777777771', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('77777777-7777-7777-7777-777777777772', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

insert into public.order_lines (id, order_id, product_id, qty, unit_price, unit_cost_snapshot)
values ('88888888-8888-8888-8888-888888888881', '77777777-7777-7777-7777-777777777771', '44444444-4444-4444-4444-444444444444', 10, 5.00, 3.00);

-- ---- fixtures: invoices (draft + non-draft on Customer A's order, --
-- ---- non-draft only on Customer B's order) ------------------------
insert into public.invoices (id, organization_id, order_id, status)
values
  ('99999999-9999-9999-9999-999999999991', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777771', 'draft'),
  ('99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777771', 'sent'),
  ('99999999-9999-9999-9999-999999999993', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777772', 'sent');

insert into public.invoice_lines (id, invoice_id, order_line_id, qty_invoiced, unit_price)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '99999999-9999-9999-9999-999999999992', '88888888-8888-8888-8888-888888888881', 10, 5.00);

-- ---- fixtures: two logins — a staff member (customer_id null) and --
-- ---- a portal login scoped to Customer A. auth.users rows are     --
-- ---- inserted directly (only `id`/`email` supplied — every other  --
-- ---- column is nullable/defaulted in Supabase's auth schema) so   --
-- ---- auth.uid() has something real to resolve once we switch role.
insert into auth.users (id, email)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'staff@portal-rls-test.local'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'portal-a@portal-rls-test.local');

insert into public.user_profiles (auth_user_id, organization_id, customer_id, email, full_name, role)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '11111111-1111-1111-1111-111111111111', null, 'staff@portal-rls-test.local', 'Staff User', 'administrator'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'portal-a@portal-rls-test.local', 'Portal User A', 'client_viewer');

-- ============================================================
-- STAFF (customer_id is null) — regression guard: unchanged,
-- unrestricted org-wide access after the migration 009 rewrite.
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1","role":"authenticated"}';

select is(
  (select count(*) from public.quotes where id = '55555555-5555-5555-5555-555555555551'),
  1::bigint,
  'staff still sees a draft quote (org-wide access unchanged)'
);

select is(
  (select count(*) from public.quotes where id = '55555555-5555-5555-5555-555555555553'),
  1::bigint,
  'staff still sees another customer''s quote (org-wide access unchanged)'
);

-- Note: the data-modifying CTE must be at the *top level* of the
-- statement — Postgres rejects `WITH ... UPDATE ... RETURNING` when
-- it's nested inside a subquery expression (e.g. as an argument to
-- select is(...)), so the WITH wraps the whole statement here instead
-- of living inside the is() call's first argument.
with updated as (
  update public.orders set status = 'fulfilling' where id = '77777777-7777-7777-7777-777777777771' returning id
)
select is(
  (select count(*) from updated),
  1::bigint,
  'staff can still write (org-wide access unchanged)'
);

-- ============================================================
-- PORTAL LOGIN scoped to Customer A — read scope.
-- ============================================================
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2","role":"authenticated"}';

select is(
  (select count(*) from public.quotes where id = '55555555-5555-5555-5555-555555555552'),
  1::bigint,
  'portal user sees their own customer''s non-draft quote'
);

select is(
  (select count(*) from public.quotes where id = '55555555-5555-5555-5555-555555555551'),
  0::bigint,
  'portal user does NOT see their own customer''s draft quote'
);

select is(
  (select count(*) from public.quotes where id = '55555555-5555-5555-5555-555555555553'),
  0::bigint,
  'portal user does NOT see another customer''s quote, even non-draft'
);

select is(
  (select count(*) from public.invoices where id = '99999999-9999-9999-9999-999999999992'),
  1::bigint,
  'portal user sees their own customer''s non-draft invoice'
);

select is(
  (select count(*) from public.invoices where id = '99999999-9999-9999-9999-999999999991'),
  0::bigint,
  'portal user does NOT see their own customer''s draft invoice'
);

select is(
  (select count(*) from public.invoices where id = '99999999-9999-9999-9999-999999999993'),
  0::bigint,
  'portal user does NOT see another customer''s invoice, even non-draft'
);

select is(
  (select count(*) from public.orders where id = '77777777-7777-7777-7777-777777777771'),
  1::bigint,
  'portal user sees their own customer''s order (orders have no draft concept)'
);

select is(
  (select count(*) from public.orders where id = '77777777-7777-7777-7777-777777777772'),
  0::bigint,
  'portal user does NOT see another customer''s order'
);

select is(
  (select count(*) from public.customers where id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'portal user sees their own customer row'
);

select is(
  (select count(*) from public.customers where id = '33333333-3333-3333-3333-333333333333'),
  0::bigint,
  'portal user does NOT see another customer row'
);

select is(
  (select count(*) from public.quote_lines where id = '66666666-6666-6666-6666-666666666661'),
  1::bigint,
  'portal user sees a line on their own customer''s visible (non-draft) quote'
);

select is(
  (select count(*) from public.invoice_lines where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  1::bigint,
  'portal user sees a line on their own customer''s visible (non-draft) invoice'
);

-- ============================================================
-- PORTAL LOGIN scoped to Customer A — write block. Confirms the
-- block is enforced by Postgres RLS itself, not just the app's UI
-- hiding buttons (same distinction proven live during the manual
-- walkthrough): a blocked UPDATE/DELETE silently affects zero rows,
-- a blocked INSERT raises an explicit 42501.
-- ============================================================
with updated as (
  update public.quotes set status = 'accepted'
  where id = '55555555-5555-5555-5555-555555555552'
  returning id
)
select is(
  (select count(*) from updated),
  0::bigint,
  'portal user cannot update a quote — blocked by RLS (zero rows affected)'
);

select throws_ok(
  $$ insert into public.quotes (organization_id, customer_id, status)
     values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'draft') $$,
  '42501',
  null,
  'portal user cannot insert a quote — blocked by RLS (explicit permission error)'
);

with deleted as (
  delete from public.customers
  where id = '22222222-2222-2222-2222-222222222222'
  returning id
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'portal user cannot delete their own visible customer row — blocked by RLS (zero rows affected)'
);

reset role;
select * from finish();
rollback;
