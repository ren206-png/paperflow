-- ============================================================
-- 012_rate_limit_buckets.sql
--
-- Generic Postgres-backed rate limiter, added after a live manual
-- verification walkthrough of the customer portal (see README,
-- "Customer portal" section) surfaced a real gap: nothing throttles
-- POST /api/customers/:id/invite, which calls Supabase Auth's
-- inviteUserByEmail — repeated invites can trip Supabase Auth's
-- own built-in email-send rate limit, which the route currently
-- surfaces as an opaque 502 instead of a clean, expected 429.
--
-- Design: a fixed-window counter, keyed by an arbitrary caller-
-- supplied string (e.g. `invite:<organization_id>`) plus the
-- window's start timestamp. `on conflict ... do update` relies on
-- Postgres's row-level lock on the conflicting row for concurrency
-- safety — two simultaneous requests in the same window can't both
-- read-then-write past the limit, unlike a naive
-- select-count-then-insert approach.
--
-- No separate cleanup job yet: bucket rows are tiny (one row per
-- key per window) and this isn't urgent, but if this table grows
-- unexpectedly large, a periodic
--   delete from public.rate_limit_buckets where window_start < now() - interval '1 day'
-- is the fix.
--
-- RLS enabled with zero policies — same deliberate default-deny
-- pattern as quickbooks_connections / xero_connections. Only
-- reachable via the SECURITY DEFINER check_rate_limit() function
-- below (called from the server-only src/lib/rate-limit/server.ts
-- helper using the admin client), never directly by any client.
-- ============================================================

create table if not exists public.rate_limit_buckets (
  key text not null,
  window_start timestamptz not null,
  request_count int not null default 1,
  primary key (key, window_start)
);

alter table public.rate_limit_buckets enable row level security;
-- Intentionally no policies — service-role/SECURITY DEFINER only.

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters. Written only via check_rate_limit(); never exposed to any client role directly.';

create or replace function public.check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets (key, window_start, request_count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set request_count = rate_limit_buckets.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

comment on function public.check_rate_limit is
  'Increments the counter for (p_key, current fixed window of length p_window_seconds) and returns whether the caller is still within p_max_requests for that window. Called from src/lib/rate-limit/server.ts via the admin client.';
