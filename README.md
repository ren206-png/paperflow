# PaperFlow OS

Contract pricing & margin engine for paper converters/distributors. This is the
MVP wedge product from the PaperFlow OS strategy engagement: a quote builder
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
