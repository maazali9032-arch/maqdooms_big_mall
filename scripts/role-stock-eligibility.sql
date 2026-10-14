-- Prospective ledger safety: drafts may retain entered values but never usable stock.
CREATE FUNCTION public.guard_usable_fabric() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE th public.thaans%rowtype; cp bigint;
BEGIN
 IF NEW.thaan_id IS NULL OR NEW.kind NOT IN('INWARD','TRANSFER','SALE','MATERIAL_ISSUE') THEN RETURN NULL; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=NEW.thaan_id;
 SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF th.original_mm IS NULL OR th.original_mm<=0 OR coalesce(cp,0)<=0 OR th.status NOT IN('active','depleted') THEN RAISE EXCEPTION 'Positive length and CP required before fabric receipt, transfer, sale or issue'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER usable_fabric_ledger AFTER INSERT ON public.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_usable_fabric();
REVOKE ALL ON FUNCTION public.guard_usable_fabric() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_active_thaan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE th public.thaans%rowtype; cp bigint;
BEGIN
 FOR th IN SELECT * FROM public.thaans WHERE (TG_TABLE_NAME='thaans' AND id=NEW.id) OR (TG_TABLE_NAME='fabric_stock_costs' AND fabric_stock_id=NEW.fabric_stock_id) LOOP
 IF th.status='active' THEN
  SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  IF coalesce(th.original_mm,0)<=0 OR coalesce(cp,0)<=0 THEN RAISE EXCEPTION 'Active Thaan requires positive recorded length and CP'; END IF;
 END IF;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER active_thaan_complete AFTER INSERT OR UPDATE ON public.thaans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_active_thaan();
CREATE CONSTRAINT TRIGGER active_thaan_cp AFTER INSERT ON public.fabric_stock_costs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_active_thaan();
REVOKE ALL ON FUNCTION public.guard_active_thaan() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_new_tailor_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.profile_id IS NULL OR NOT public.has_role(NEW.profile_id,'tailor') THEN RAISE EXCEPTION 'Choose an active Tailor account or create it in Add Staff'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER new_tailor_login BEFORE INSERT ON public.tailors FOR EACH ROW EXECUTE FUNCTION public.guard_new_tailor_login();
REVOKE ALL ON FUNCTION public.guard_new_tailor_login() FROM PUBLIC,anon,authenticated;
