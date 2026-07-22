-- ============================================================
-- 011_audit_trigger_cascade_fix.sql
--
-- Fixes a NOT NULL violation in audit_price_book_line_change()
-- (defined in 20260704005_quotes_orders_invoices.sql) that fires
-- when a price_books row is deleted directly.
--
-- Root cause: price_book_lines.price_book_id is `on delete cascade`
-- to price_books(id). When a price_books row is deleted, Postgres
-- cascades the delete to its price_book_lines rows *within the same
-- statement*, but the parent price_books row is already gone by the
-- time each child row's AFTER DELETE trigger fires. The trigger's
--   select organization_id into v_org_id from price_books where id = old.price_book_id
-- therefore returns NULL, and the subsequent
--   insert into audit_log (organization_id, ...) values (v_org_id, ...)
-- fails audit_log.organization_id's NOT NULL constraint — which
-- aborts the whole delete, even though nothing about the delete
-- itself was invalid.
--
-- This path isn't reachable through the current UI (no screen
-- deletes a whole price_books row, only individual lines — see
-- src/app/dashboard/price-books/[id]/page.tsx), but it's a real
-- correctness gap: any future feature (or direct DB/REST access)
-- that deletes a price_books row hits it immediately, 100% of the
-- time, for every line in that book.
--
-- Fix, two layers:
--   1. Fall back to products.organization_id (via price_book_lines.
--      product_id, itself `on delete cascade` but far less likely to
--      be deleted in the same statement as its price book) when the
--      price_books lookup comes back NULL.
--   2. If both lookups come back NULL, skip the audit insert rather
--      than raising — audit logging is a side effect and must never
--      be able to block the real business operation it's observing.
--      (Silently skipping is preferable to catching the insert's
--      exception, since a caught exception here would also hide
--      genuine bugs like a stale/garbage organization_id.)
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

  if v_org_id is null then
    select organization_id into v_org_id
    from public.products
    where id = coalesce(new.product_id, old.product_id);
  end if;

  if v_org_id is null then
    -- Parent price_books row and the product row are both already
    -- gone (e.g. a wider cascade deleted the whole org). Nothing
    -- sane to attach the audit row to — skip logging, don't block
    -- the delete.
    return coalesce(new, old);
  end if;

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
