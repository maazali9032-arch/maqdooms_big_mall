-- Security hardening baseline (audit 29 Oct 2026: F2, F7, F8, F9).
-- Grants, policies and audit triggers only: no table, column, row or function
-- body changes. Every function that writes these tables is SECURITY DEFINER,
-- so it keeps working after staff lose direct table/function access.
-- Each statement is reversible by a later migration (GRANT / CREATE POLICY back).
BEGIN;

-- F2: logged-out visitors could read internal Thaan barcodes, per-floor metres and
-- location names. The storefront is not live yet; a narrow public catalogue
-- function will be added with e-commerce categories. Logged-in staff keep access
-- (v_listing_availability on the E-commerce page uses it).
REVOKE EXECUTE ON FUNCTION public.storefront_catalog(), public.listing_showroom_availability()
FROM PUBLIC, anon;

-- F7: old billing/sale entry points that no screen calls. Newer bill functions
-- still call some of them internally as the database owner, which is unaffected.
REVOKE EXECUTE ON FUNCTION
  public.complete_counter_bill(uuid,uuid,jsonb,jsonb,boolean,uuid,uuid,text,text),
  public.complete_counter_bill_with_advance(uuid,uuid,jsonb,jsonb,bigint,uuid,text,text),
  public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text),
  public.complete_counter_bill_multi_with_advance(uuid,jsonb,jsonb,bigint,uuid,text,text),
  public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb),
  public.complete_counter_bill_gst_discount(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb,integer),
  public.complete_direct_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),
  public.place_hold(uuid,integer,integer,text)
FROM PUBLIC, anon, authenticated;

-- F8: staff could update their own profile row directly (salesperson number,
-- email, id, ...). Only the Owner may now update profiles directly, and only the
-- active flag. Own-name changes keep working through update_account_name().
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "owner updates profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_perm(auth.uid(), 'access.manage'))
  WITH CHECK (public.has_perm(auth.uid(), 'access.manage'));
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
GRANT UPDATE (active) ON public.profiles TO authenticated;

-- F9: customers are only written by find_or_create_customer() and the counter bill.
DROP POLICY IF EXISTS "manage customers" ON public.customers;
REVOKE INSERT, UPDATE, DELETE ON public.customers FROM authenticated;

-- F9: the app only inserts fabric types directly (Stock Entry quick-create).
REVOKE UPDATE, DELETE ON public.fabrics FROM authenticated;

-- F9: the app only changes online order status directly.
REVOKE INSERT, DELETE ON public.online_orders FROM authenticated;

-- F9: record direct changes on the three tables that had no row audit.
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.listing_variants
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();

NOTIFY pgrst, 'reload schema';
COMMIT;
