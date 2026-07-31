# PlyCount

Contract pricing & margin engine for paper converters/distributors. This is the
MVP wedge product from the PlyCount strategy engagement: a quote builder
that resolves the correct contract/volume price per customer+SKU+quantity and
shows live per-line and blended margin against snapshotted unit cost — so a
sales rep can never accidentally quote below floor margin without seeing it.

Everything outside that wedge (customers, products/SKUs, cost entry, price
books, orders, invoicing, a margin rollup dashboard, PDF/email delivery,
platform billing, accounting sync) exists to support the wedge end-to-end.
See **Deferred / not built** below for what's intentionally still missing.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth), multi-tenant via shared schema + Row-Level
  Security (`organization_id` on every tenant table)
- React Query for client-side data fetching/caching
- Pricing/costing resolution lives in Postgres RPC functions
  (`resolve_price_book`, `resolve_unit_price`, `latest_cost_input`), called
  identically from the UI — see `src/lib/pricing/resolve.ts`. This keeps the
  quote builder and any future integration (customer portal, EDI) from
  drifting on pricing logic.
- `@react-pdf/renderer` + Resend for quote PDF generation/email delivery
- Stripe for platform subscription billing (separate from customer AR)
- QuickBooks Online (OAuth2 + Accounting API v3) or Xero (OAuth2 + Accounting
  API) for invoice sync — one provider connected per organization at a time
- Vitest for unit tests, pgTAP for DB-level RPC tests

## Getting started

1. **Create a Supabase project** and run the migrations in
   `supabase/migrations/` in order (via the SQL editor, or the Supabase CLI:
   `supabase db push`). They must run in filename order — later migrations
   assume earlier tables/functions exist (e.g. `price_books` migration adds a
   FK column onto `customers`; `quickbooks_sync` adds columns onto
   `customers`/`products` and a new `quickbooks_connections` table;
   `xero_sync` does the same for Xero; `customer_portal` adds
   `user_profiles.customer_id` and rewrites RLS policies on seven tables to
   scope portal logins).

2. **Copy env vars**:

   ```bash
   cp .env.local.example .env.local
   ```

   Required to run the app at all:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your
     Supabase project's API settings.
   - `SUPABASE_SERVICE_ROLE_KEY` — used by `src/lib/supabase/admin.ts`
     (server-only): the Stripe webhook and the QuickBooks token
     store/refresh/invoice-sync path all need to bypass RLS (webhooks have no
     user session; `quickbooks_connections` has no client-facing RLS policy
     at all by design — see below). Keep this out of client bundles.

   Not required to run/build, only to exercise those specific features:
   - `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — quote PDF email delivery. The
     "Send to customer" button on a quote returns a friendly 501 until this
     is set.
   - `STRIPE_*` — platform subscription billing (Starter/Growth tiers). The
     billing settings page returns a friendly 501 from the checkout/portal
     routes until this is set.
   - `QUICKBOOKS_*` — invoice sync to QuickBooks Online. The Integrations
     settings page and the connect route return a friendly 501 until this is
     set.
   - `XERO_*` — invoice sync to Xero. Same friendly-501 behavior as
     QuickBooks until set. Only one of QuickBooks or Xero can be connected
     per organization at a time — connecting one is blocked while the other
     has an active connection.

   Note: `next build` will fail if `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset, because the Supabase browser
   client throws at module-init time. Any real value works for a local type
   check/build; a real project is needed for the app to actually function.

3. **Install and run**:

   ```bash
   npm install
   npm run dev
   ```

4. **Sign up** at `/signup` — this calls the `create_organization_with_owner`
   Postgres function, which creates the `organizations` row, the owner's
   `user_profiles` row, and grants `organization_owner`. This assumes email
   confirmation is disabled (or auto-confirmed) in your Supabase Auth
   settings; otherwise the profile row won't get created until the user
   confirms and logs in for the first time — not yet handled.

## Data model overview

See `supabase/migrations/*.sql` for full detail; each file has inline comments
explaining the reasoning behind non-obvious choices (why relational
`min_qty`/`max_qty` tiers instead of JSONB, why cost is snapshotted at
quote-time rather than looked up live, why audit logging is a hybrid of
trigger + explicit RPC call, why QuickBooks tokens live in their own
policy-less table, etc).

Core flow: `customers` + `products` → `cost_inputs` (manual, effective-dated)
→ `price_books` + `price_book_lines` (contract/volume tiers, effective-dated)
→ `quotes` + `quote_lines` (price/cost snapshot at quote time, live margin) →
convert to `orders` + `order_lines` (partial fulfillment via `fulfilled_qty`)
→ `invoices` + `invoice_lines` (partial invoicing per order line,
`external_ref` populated once an invoice is synced to QuickBooks).
`audit_log` is insert-only and currently populated by a trigger on
`price_book_lines` changes and an explicit call on quote→order conversion.

## What's built

- Auth (signup/login) + multi-tenant RLS
- Customers CRUD
- Products/SKUs CRUD (flat variant attributes: ply, gsm, roll length, sheet
  count, case pack, unit of measure — no BOM/manufacturing costing engine)
- Cost inputs entry, with a staleness flag (>30 days since last entry)
- Price book editor: contract or volume/list books, effective-dated, with
  client-side overlap validation on quantity tiers
- **Quote builder (the wedge)**: customer → auto-resolved price book →
  add lines with auto-resolved unit price + cost → live per-line and blended
  margin (red under 15%) → manual price override when no tier matches →
  save as draft
- Quote detail page: download a customer-facing PDF, email it via Resend
  (attaches the PDF, flips status to `sent`), convert to order (creates the
  order + order lines, flips quote status to `accepted`, writes an audit log
  entry)
- Orders list/detail: manual fulfillment entry per line, create a draft
  invoice for whatever's fulfilled-but-unbilled; syncs the invoice
  automatically to whichever accounting provider (QuickBooks or Xero) is
  connected (or via a manual "Sync" button), storing the resulting invoice
  Id as `external_ref`
- Margin dashboard: realized margin (from booked orders, not open quotes)
  rolled up by SKU and by customer
- **Margin Guard** (`/dashboard/margin-alerts`): a live view joins every
  price book line against its latest cost input to compute current margin;
  any line under 15% surfaces as a worklist entry with a suggested reprice
  (to a configurable target margin) that a rep can Apply or Dismiss. Every
  decision is logged (`margin_alert_reviews`) against the cost snapshot it
  was made on, so if the cost changes again later the alert correctly
  reappears instead of staying silenced. Nothing reprices automatically —
  a human always clicks Apply. The dashboard overview banner shows the
  current alert count.
- **Billing settings** (`/dashboard/settings/billing`): current plan/status,
  Stripe Checkout for Starter/Growth, Stripe Billing Portal for managing an
  existing subscription. A webhook (`/api/stripe/webhook`) keeps
  `organizations.subscription_tier`/`subscription_status` in sync with
  Stripe subscription events.
- **Integrations settings** (`/dashboard/settings/integrations`): connect
  QuickBooks Online or Xero via OAuth2 (org admins only), see connection
  status, disconnect. Only one provider can be connected at a time — the
  Connect button for the other is disabled while a connection is active.
  First sync of a customer/product auto-creates and caches the matching
  QuickBooks Customer/Item or Xero Contact (Xero invoices don't require a
  pre-created Item, so line items post directly with a resolved default
  sales account code instead).
- **Customer self-service portal** (`/portal`, read-only): an org admin
  invites a customer by email from that customer's detail page
  (`POST /api/customers/:id/invite`, admin-only, uses
  `supabase.auth.admin.inviteUserByEmail` + creates a `client_viewer`
  `user_profiles` row scoped to that one customer via the new
  `customer_id` column). The invited user sets a password at
  `/portal/set-password` and lands in a lightweight portal (separate
  layout from the staff dashboard) showing only their own non-draft
  quotes, orders, and invoices — enforced at the RLS layer via a new
  `my_customer_id()` helper, not just hidden in the UI, and with no write
  access anywhere. Staff (`customer_id is null`) see unchanged, full-org
  behavior under the same policies.
- Automated tests: Vitest unit tests for pricing/margin math and the RPC
  wrapper functions (`src/**/*.test.ts`), pgTAP tests for the actual
  Postgres pricing/costing RPCs (`supabase/tests/pricing_rpcs.test.sql`)

### Running tests

```bash
npm run test         # Vitest — pure functions + RPC wrapper argument shapes
npm run test:watch   # Vitest in watch mode
```

The pgTAP suite exercises the real SQL resolution logic (tier boundaries,
customer-book-beats-org-default precedence, as-of-date cost lookups, the
`max_qty >= min_qty` check constraint) against a local/shadow database.
Normally that's:

```bash
supabase test db
```

which requires the Supabase CLI and Docker — neither is available in this
environment, so instead all 6 migrations plus `pricing_rpcs.test.sql` were
run directly against a scratch local Postgres 15 instance (Postgres.app +
pgTAP, `auth`/`anon`/`authenticated`/`service_role` stubbed to match
Supabase's shape) as a one-off manual verification. All 12 assertions pass
now, but this **did surface two real bugs** that are now fixed:

- `resolve_price_book`'s tiebreak ordered by `(customer_id = p_customer_id)
  desc`, which evaluates to SQL `NULL` (not `false`) for the org-wide
  default row — and Postgres sorts `NULL` *first* in `DESC` order, i.e. tied
  with `true`. That made "customer-specific book beats org default" depend
  on undefined row order instead of always winning. Fixed to
  `(customer_id is not null) desc`. This transitively also fixed
  `resolve_unit_price` returning the wrong tier for a customer with a
  contract book (it was silently falling back to the org-wide book's
  tiers).
- The test file itself under-declared its plan (`plan(11)` for 12
  assertions) — fixed to `plan(12)`.

This was a manual one-off, not wired into CI — run `supabase test db`
yourself (or repeat the scratch-Postgres approach) before trusting this as
an ongoing regression gate.

## Integration setup notes

### Stripe (platform billing)

1. Create Starter/Growth Prices in Stripe, set `STRIPE_PRICE_STARTER` /
   `STRIPE_PRICE_GROWTH` to their Price IDs.
2. Point a webhook endpoint at `/api/stripe/webhook` for
   `checkout.session.completed`, `customer.subscription.updated`, and
   `customer.subscription.deleted`; set `STRIPE_WEBHOOK_SECRET` to its
   signing secret.
3. This is platform subscription billing only — separate from customer
   accounts-receivable, which stays in `invoices` / QuickBooks sync.

### QuickBooks Online

1. Register an app at the Intuit developer portal, add a redirect URI
   matching `QUICKBOOKS_REDIRECT_URI` (defaults to
   `${origin}/api/quickbooks/callback` if unset).
2. Set `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` and
   `QUICKBOOKS_ENVIRONMENT` (`sandbox` or `production`).
3. **Security note**: QuickBooks access/refresh tokens are stored in
   `quickbooks_connections`, a table with RLS enabled and *no policies at
   all* — deliberately unreachable from the browser (anon/authenticated
   roles), only touchable via the service-role admin client from
   server-only routes. They are **not** stored on `organizations`, because
   that table is selected client-side by every org member (down to
   `client_viewer`) via `AuthProvider`, and raw OAuth tokens must never ride
   along in that response.
4. Written against Intuit's documented OAuth2 + Accounting API v3 shapes,
   and now **verified end-to-end against a real Intuit developer sandbox**
   (real `QUICKBOOKS_CLIENT_ID`/`SECRET`, a real sandbox company, a live
   user consent screen — not mocked):
   - Registered `http://localhost:3000/api/quickbooks/callback` as a
     redirect URI on the Intuit app and drove the actual `Connect to
     QuickBooks` button through Intuit's real consent screen.
     `/api/quickbooks/connect` → 307 to `appcenter.intuit.com` →
     user consent → `/api/quickbooks/callback` came back with a genuine
     Intuit-issued `code`/`realmId` and exchanged it for tokens
     (`oauth.platform.intuit.com/oauth2/v1/tokens/bearer`); confirmed via
     the dev server log and by inspecting `quickbooks_connections`
     directly — real `access_token`/`refresh_token`/`realm_id` values were
     persisted, and the Integrations page showed "Connected (company
     9341457562717515)".
   - Created a customer, product, quote, and converted it to an order,
     then used "Create draft invoice for fulfilled qty" to trigger the
     documented auto-sync-at-creation behavior. `POST
     /api/invoices/[id]/quickbooks-sync` took ~6.7s (a real network round
     trip, not a stub) and the invoice flipped to `status: sent` with
     `external_ref: 145` — the QuickBooks Online invoice Id.
   - Independently verified this wasn't just the app's own bookkeeping: a
     direct `GET
     sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/invoice/145`
     call (using the stored access token, outside the app entirely)
     returned a real Intuit-hosted invoice with `CustomerRef: "Test
     Distributor LLC"`, a line item for `TT2-96-STD — 2-Ply Standard Bath
     Tissue` at qty 1 / $42.50, and `TotalAmt: 42.5`, created in the same
     second as the sync request. The connect → sync round trip is real.

### Xero

1. Register an app at the Xero developer portal, add a redirect URI matching
   `XERO_REDIRECT_URI` (defaults to `${origin}/api/xero/callback` if unset).
   Scopes are `openid profile email accounting.contacts
   accounting.settings.read accounting.invoices offline_access` — see the
   granular-scopes note below for why this isn't the broader
   `accounting.transactions` scope you'll see in older Xero examples.
2. Set `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`.
3. Same security posture as QuickBooks: tokens live in `xero_connections`,
   RLS-enabled with zero policies — service-role only, never selected by
   `AuthProvider`.
4. **Verified end-to-end against a real Xero developer sandbox** (real
   `XERO_CLIENT_ID`/`SECRET`, a real trial/demo Xero organisation, a live
   user consent screen — not mocked). Two real bugs surfaced and were fixed
   by this walkthrough, not just config issues:
   - **`invalid_scope` on connect**: Xero apps created after 2 March 2026
     (this one included) only have access to its newer granular scope set —
     the broad legacy scope `accounting.transactions` no longer exists and
     requesting it fails OAuth with `invalid_scope` (error code 500),
     confirmed against the live app. Fixed by switching to
     `accounting.contacts` (read+write, for `findOrCreateXeroContact`),
     `accounting.settings.read` (read-only, for the Chart of Accounts
     lookup in `getDefaultSalesAccountCode`), and `accounting.invoices`
     (read+write, for `createXeroInvoice`) — see `src/lib/xero/server.ts`.
   - **Missing `DueDate` on invoice creation**: unlike QuickBooks, which
     defaults the due date server-side when none is sent, Xero rejects an
     `AUTHORISED`-status invoice with `400 ValidationException: "The
     document DueDate field must be specified"` if `DueDate` is omitted.
     Confirmed live (the first sync attempt failed with exactly this
     error). Fixed by sending both `Date` (today) and `DueDate` (net-30)
     on every created invoice.
   - With both fixes in place, drove the actual `Connect Xero` button
     through Xero's real consent screen (`/api/xero/connect` → 307 to
     `login.xero.com` → user consent → `/api/xero/callback` came back with
     a genuine Xero-issued `code`, exchanged for tokens at
     `identity.xero.com/connect/token`, then resolved a tenant via `GET
     api.xero.com/connections`); confirmed via `xero_connections` directly
     — real `access_token`/`refresh_token`/`tenant_id` were persisted, and
     the Integrations page showed "Connected (tenant
     717c1df5-7379-4220-aa38-d3635bdd2dbf)".
   - Built a full test-data chain (customer, SKU, cost input, price book,
     quote → accepted → order, fulfilled qty, draft invoice) and synced it
     via the order page's "Sync to Xero" button. The invoice flipped to
     `status: sent` with `external_ref: 36d354c1-2149-4f88-8e39-72c7d5f3be29`
     — the Xero invoice Id.
   - Independently verified this wasn't just the app's own bookkeeping: a
     direct `GET api.xero.com/api.xro/2.0/Invoices/{InvoiceID}` call (using
     the stored access token, outside the app entirely) returned a real
     Xero-hosted invoice with `Contact.Name: "Xero Sync Test Co"`, a line
     item for `XERO-TEST-01 — Xero Sync Test SKU` at qty 10 / $25.00,
     `Total: 250`, `Status: "AUTHORISED"`, and a `DueDate` 30 days out —
     created in the same minute as the sync request. The connect → sync
     round trip is real. Test data (customer, SKU, cost input, price book,
     quote, order, invoice) was deleted afterward.
5. One difference from QuickBooks worth calling out: Xero has no
   pre-created "Item" catalog requirement, so line items post directly with
   `Description`/`Quantity`/`UnitAmount` against a resolved default sales
   `AccountCode` — no `xero_item_id` lookup/creation round trip needed
   (the column exists on `products` for parity but isn't populated by the
   current sync path).

### Customer portal

1. From a customer's detail page (`/dashboard/customers/:id`), an org admin
   enters an email and clicks "Invite to portal". This calls
   `supabase.auth.admin.inviteUserByEmail` (service role) and inserts a
   `user_profiles` row with `role: 'client_viewer'`, `status: 'invited'`,
   and `customer_id` set to that customer — the column that scopes
   everything the login can see. Only one portal user is allowed per
   customer at a time (`POST /api/customers/:id/invite` rejects a new
   invite while one already exists); the admin must click "Remove access"
   first, which calls `DELETE /api/customers/:id/invite` to delete both
   the `user_profiles` row and the underlying Supabase Auth user before a
   different email can be invited.
2. The invited user follows the emailed link to `/portal/set-password`,
   sets a password (`supabase.auth.updateUser`), and is redirected into
   `/portal`.
3. Enforcement is at the RLS layer, not the UI: `my_customer_id()` (mirrors
   the existing `my_org_id()` pattern) returns null for staff and the
   scoped customer id for a portal login; every `_select` policy on
   `customers`/`quotes`/`quote_lines`/`orders`/`order_lines`/`invoices`/
   `invoice_lines` branches on it, and every `_write` policy requires it to
   be null. A portal login attempting a direct write via `fetch`/devtools
   (bypassing the UI entirely) is rejected by Postgres, not just hidden by
   missing buttons.
4. Cost data (`unit_cost_snapshot`, `margin_pct` on `quote_lines`/
   `order_lines`) is a row-level RLS concern only if the portal never
   selects those columns — the portal pages explicitly select a narrow
   column list (`id, product_id, qty, unit_price`) rather than `select('*')`
   on those two tables specifically, since RLS is row-scoped, not
   column-scoped.
5. **Verified end-to-end via a live manual walkthrough** (a real Supabase
   Auth login, two real test customers, direct REST calls against
   PostgREST outside the app entirely — not mocked):
   - Built a two-customer fixture (Customer A, Customer B), each with its
     own price book, a draft + a non-draft quote, two fulfilled orders, and
     a draft + a non-draft invoice — specifically to exercise every branch
     of the RLS policies (own-customer visibility, cross-customer
     invisibility, draft-status hiding for quotes/invoices).
   - Signed in as a portal login scoped to Customer A and confirmed:
     `/dashboard/*` redirects to `/portal` (the inverse guard in
     `dashboard/layout.tsx` fires correctly); the Quotes/Orders/Invoices
     pages show only Customer A's *non-draft* quote and invoice (the draft
     versions are correctly hidden) and both of Customer A's orders; no
     Customer B data is visible anywhere.
   - **Confirmed the write block is real, not just UI**: authenticated as
     the portal login and issued direct `PATCH`/`POST`/`DELETE` calls
     straight against the Supabase REST API (bypassing the app's UI and
     API routes entirely) — attempting to update Customer A's own visible
     quote/invoice, insert a new quote, and delete the customer row.
     Every write was rejected by Postgres RLS (either an explicit `42501
     row-level security policy` error on insert, or a silently
     zero-row-affected update/delete), and a service-role re-check
     confirmed nothing in the database had changed. A direct `SELECT` for
     Customer B's invoice by id also returned zero rows.
   - Signing back in as the org admin afterward showed no session
     disruption; all test data (both customers, the shared SKU, cost
     input, price books, quotes, orders, invoices, the portal test auth
     user, and its `user_profiles` row) was deleted afterward.
   - **Real gap surfaced by this walkthrough**: the actual invite flow
     (`POST /api/customers/:id/invite` → `supabase.auth.admin
     .inviteUserByEmail`) hit Supabase Auth's built-in email sender rate
     limit (`429 over_email_send_rate_limit`), which the route currently
     surfaced as a generic `502`. No custom SMTP/Resend is wired up for
     Supabase Auth's own transactional email (separate from the app's
     `RESEND_API_KEY`, used only for quote delivery and also unset), so
     there was no fallback once the built-in sender's limit was hit.
     **Fixed** in the hardening pass below: the route is now rate-limited
     to 10 invites/hour/org (comfortably under Auth's own limit) and
     returns a clean `429` instead of a `502` once hit — configuring
     custom SMTP for Supabase Auth is still worth doing before relying on
     high-volume invite traffic in production, but the opaque-error part
     of the gap is closed.

## Hardening / monitoring

A deliberate pass (before any new features) to add the process/
infrastructure a real audit found actually missing — the codebase itself
was already clean (no dead code, no stray TODOs, consistent error
handling, full RLS coverage, hardened `security definer` functions,
verified webhook signatures, no committed secrets), but nothing ran CI,
nothing watched for regressions, nothing caught a runtime error in
production, and nothing rate-limited any endpoint.

- **CI** (`.github/workflows/ci.yml`): every push/PR to `main` runs
  `type-check` → `lint` → `test` → `build` (blocking — a failure here
  blocks merge once branch protection is turned on, a manual GitHub
  settings step not covered by this repo's files) plus `knip` (dead-code/
  unused-dependency detection) and `npm audit` (non-blocking,
  `continue-on-error: true` by design — these report, they don't gate,
  since false positives on a fast-moving app shouldn't block shipping).
  Only needs two dummy `NEXT_PUBLIC_*` env vars to build; every other
  secret is read lazily at request time, never at build time, so no real
  credentials are needed in CI.
- **Dead-code detection**: `knip.json` (run via `npm run knip`), configured
  with explicit Next.js App Router entry points (`page`/`layout`/`route`/
  `error`/etc. per segment) so framework-invoked exports aren't
  false-flagged as unused. First real run found 9 genuinely unused
  dependencies (`@hookform/resolvers`, `@stripe/stripe-js`,
  `@tanstack/react-query-devtools`, `class-variance-authority`,
  `date-fns`, `lucide-react`, `react-hook-form`, `recharts`, `zod` — zero
  usages anywhere in `src/`, confirmed by grep before removing), which
  were removed from `package.json`; the full verification chain
  (`type-check`/`lint`/`test`/`build`) still passes identically afterward.
  Remaining findings (4 exported types used only within their own file)
  are stylistic, not dead code, and left for human judgment.
- **Rate limiting**: Postgres-backed, no new vendor. A fixed-window
  counter table (`rate_limit_buckets`, RLS-enabled with zero policies —
  same default-deny pattern as `quickbooks_connections`/
  `xero_connections`) plus a `check_rate_limit()` SECURITY DEFINER
  function (`supabase/migrations/20260721012_rate_limit_buckets.sql`),
  wrapped by `src/lib/rate-limit/server.ts` (`checkRateLimit(key,
  maxRequests, windowSeconds)`, fails **open** on error — a rate-limiter
  outage must never be able to block real traffic). Currently wired into
  the one endpoint with a proven, documented failure mode from the portal
  walkthrough above: `POST /api/customers/:id/invite`, 10/hour/org. The
  helper is generic and cheap to add to more routes (login, quote-send-
  email) once this pattern is proven in production.
- **Runtime error monitoring**: Sentry (`@sentry/nextjs`), wired across
  all three Next.js runtimes it needs (`sentry.client.config.ts`,
  `sentry.server.config.ts`, `sentry.edge.config.ts` — `src/middleware.ts`
  runs on Edge by default, hence the separate edge config), plus
  `src/app/error.tsx` / `src/app/global-error.tsx` App Router error
  boundaries and explicit `Sentry.captureException` calls at the
  QuickBooks/Xero invoice-sync routes' catch-all error paths and the
  Stripe webhook's subscription-sync failure paths. Every config file is
  guarded on `NEXT_PUBLIC_SENTRY_DSN` being set — leaving it unset (the
  default) is a true no-op, `Sentry.init()` is simply never called, so
  the app behaves identically to before Sentry was added until a DSN is
  actually configured.
- **RLS regression test**: `supabase/tests/portal_rls.test.sql`, a pgTAP
  suite (same tooling as the existing `pricing_rpcs.test.sql`) that turns
  the manual portal walkthrough above into a permanent, repeatable test —
  own-customer visibility, cross-customer invisibility, draft-status
  hiding at both the parent-row and line-row level, and the write-block
  (update/delete silently affect zero rows, insert raises an explicit
  `42501`) are all asserted directly against Postgres via `set local role
  authenticated` + `set local request.jwt.claims`, no real network/JWT
  round trip needed. Not wired into CI yet (needs Docker for `supabase
  test db`'s local Postgres, which meaningfully slows every push) — run
  it manually, same as `pricing_rpcs.test.sql`:
  ```bash
  supabase init   # first time only — no supabase/config.toml existed before this
  supabase test db
  ```
  **Verified**: run locally end-to-end (`supabase init` → `supabase start`
  → `supabase test db`) — all 37 assertions across both suites pass. This
  was the first time this repo's migrations had ever been replayed
  through the real Supabase CLI/Postgres locally, and it surfaced two
  real, pre-existing gaps having nothing to do with the portal RLS logic
  itself, both now fixed:
  - **Migration filename collision**: 7 migrations shared the
    `20260704_NNN_*` prefix and 5 shared `20260721_NNN_*`. The Supabase
    CLI derives each migration's `schema_migrations` version from the
    digits *before the first underscore* — so every file sharing a date
    collided on the same version and applying more than one same-day
    migration in one run failed with a duplicate-key error. Fixed by
    renaming all 12 existing migrations to fold the sequence number into
    the leading digit run (e.g. `20260704_001_organizations.sql` →
    `20260704001_organizations.sql`), which is a pure rename — no SQL
    content changed, and Postgres/Supabase's own migration application
    order is unaffected since it still sorts lexically the same way.
  - **Missing baseline table grants**: every table in the schema granted
    `anon`/`authenticated` only `TRIGGER`/`TRUNCATE`/`REFERENCES` — never
    `SELECT`/`INSERT`/`UPDATE`/`DELETE`. RLS policies only decide *which
    rows* a query may touch; Postgres checks the coarser table-level
    grant first and rejects the query before RLS is ever evaluated. None
    of the checked-in migrations ever ran a base-privilege `GRANT`
    (production almost certainly has this already, most likely applied
    once via the Supabase Studio Table Editor and never captured back
    into a migration) — meaning the migration history alone couldn't
    rebuild a working database from scratch. Fixed in
    `supabase/migrations/20260722013_baseline_grants.sql`: an explicit,
    idempotent `grant select, insert, update, delete ... to authenticated`
    (deliberately **not** `anon` — this app has no unauthenticated
    data-access path) plus a matching `alter default privileges` so
    future migrations' tables get the same baseline automatically. RLS
    remains the real gate: tables with zero policies for a command (e.g.
    `quickbooks_connections`/`xero_connections`/`rate_limit_buckets` have
    no policies at all; `audit_log` has only a `SELECT` policy) stay
    fully denied for that command regardless of this grant.
- **Dependency updates**: `.github/dependabot.yml` — weekly PRs for both
  the `npm` and `github-actions` ecosystems, minor/patch grouped.
- **Health check**: `GET /api/health` — process liveness plus a real
  Supabase connectivity check, for manual smoke-testing and as a target
  for external uptime monitoring.
- **Weekly scheduled audit**: beyond CI-on-every-push, a recurring weekly
  job runs the same non-blocking checks (`lint`, `type-check`, `test`,
  `knip`, `npm audit`) independent of whether anyone pushed that week —
  catches drift like a freshly-disclosed CVE in an otherwise-unchanged
  dependency.

## Deferred / not built (by design, see strategy doc)

- BOM/manufacturing costing engine — cost is a flat manual entry per SKU
- Any mobile/offline support
- Encryption-at-rest for QuickBooks/Xero tokens beyond Postgres/Supabase's
  standard at-rest encryption (no application-level envelope encryption yet)
- Portal write access (approving quotes, paying invoices online) — the
  portal is intentionally read-only for now

## Project conventions

Supabase client/server helper patterns, middleware, and RLS helper function
naming (`my_org_id()`, `is_org_admin()`, `is_platform_admin()`) were carried
over from a sibling project (`pipefield-os`) for consistency across the
"vertical OS" product line, trimmed to what this MVP actually needs.
