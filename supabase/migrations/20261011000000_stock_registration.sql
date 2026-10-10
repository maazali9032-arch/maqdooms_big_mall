-- Approved post-Phase-16 Stock Entry revision. Existing rows/barcodes unchanged.
-- New Fabric Type groups own sequentially suffixed physical Than variants.
-- Each variant reuses one operational fabric/stock identity with exactly one Than.
BEGIN;
CREATE SEQUENCE public.registration_batch_number;
CREATE TABLE public.stock_registration_batches (
 batch_id uuid PRIMARY KEY REFERENCES public.receiving_batches(id),
 provider_name text NOT NULL CHECK(btrim(provider_name)<>''),
 provider_prefix text NOT NULL CHECK(provider_prefix ~ '^[A-Z]{3}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_registration_fabric_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES public.stock_registration_batches(batch_id),
 code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z]{3}-[0-9]+$'),
 name text NOT NULL CHECK(btrim(name)<>''), next_ordinal bigint NOT NULL DEFAULT 1 CHECK(next_ordinal>0),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_types_batch_idx ON public.stock_registration_fabric_types(batch_id,created_at,id);
CREATE TABLE public.stock_registration_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fabric_type_id uuid NOT NULL REFERENCES public.stock_registration_fabric_types(id),
 ordinal bigint NOT NULL CHECK(ordinal>0), code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z]{3}-[0-9]+[a-z]+$'),
 fabric_stock_id uuid NOT NULL UNIQUE REFERENCES public.fabric_stock(id),
 thaan_id uuid NOT NULL UNIQUE REFERENCES public.thaans(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(fabric_type_id,ordinal), FOREIGN KEY(thaan_id,fabric_stock_id) REFERENCES public.thaans(id,fabric_stock_id)
);
CREATE TABLE public.stock_registration_requests (
 request_id uuid PRIMARY KEY, action text NOT NULL, payload jsonb NOT NULL,
 result_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 id uuid GENERATED ALWAYS AS(request_id) STORED
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stock_registration_batches','stock_registration_fabric_types','stock_registration_variants','stock_registration_requests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY registration_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',t);
  EXECUTE format('CREATE TRIGGER registration_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit()',t);
 END LOOP;
END; $$;
REVOKE ALL ON SEQUENCE public.registration_batch_number FROM PUBLIC,anon,authenticated;
CREATE TRIGGER registration_batches_immutable BEFORE UPDATE OR DELETE ON public.stock_registration_batches FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER registration_variants_immutable BEFORE UPDATE OR DELETE ON public.stock_registration_variants FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER registration_requests_immutable BEFORE UPDATE OR DELETE ON public.stock_registration_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE FUNCTION public.registration_group_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric Type history is permanent'; END IF;
 IF (to_jsonb(NEW)-'next_ordinal') IS DISTINCT FROM (to_jsonb(OLD)-'next_ordinal') OR NEW.next_ordinal<OLD.next_ordinal THEN RAISE EXCEPTION 'Fabric Type identity is permanent'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER registration_group_identity BEFORE UPDATE OR DELETE ON public.stock_registration_fabric_types FOR EACH ROW EXECUTE FUNCTION public.registration_group_guard();
CREATE FUNCTION public.registration_operational_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE registered boolean; BEGIN
 IF TG_TABLE_NAME='thaans' THEN
  IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE fabric_stock_id=NEW.fabric_stock_id) THEN RAISE EXCEPTION 'Registered barcode already identifies its physical Than'; END IF;
   RETURN NEW;
  END IF;
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE thaan_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered Than history is permanent'; END IF;
  IF registered AND (NEW.barcode IS NOT NULL OR NEW.price_paise IS NOT NULL OR (NEW.id,NEW.fabric_id,NEW.batch_id,NEW.fabric_stock_id,NEW.original_mm,NEW.created_by) IS DISTINCT FROM(OLD.id,OLD.fabric_id,OLD.batch_id,OLD.fabric_stock_id,OLD.original_mm,OLD.created_by)) THEN RAISE EXCEPTION 'Registered Than identity/length is permanent; use ledger corrections'; END IF;
 ELSIF TG_TABLE_NAME='fabric_stock' THEN
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE fabric_stock_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode stock is permanent'; END IF;
  IF registered AND (NEW.id,NEW.fabric_id,NEW.batch_id,NEW.barcode_id,NEW.created_by) IS DISTINCT FROM(OLD.id,OLD.fabric_id,OLD.batch_id,OLD.barcode_id,OLD.created_by) THEN RAISE EXCEPTION 'Registered barcode ownership and identity are permanent'; END IF;
 ELSE
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.fabric_stock s ON s.id=v.fabric_stock_id WHERE s.fabric_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered Fabric identity is permanent'; END IF;
  IF registered AND NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Registered Fabric code is permanent'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER registration_than_identity BEFORE INSERT OR UPDATE OR DELETE ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.registration_operational_identity_guard();
CREATE TRIGGER registration_stock_identity BEFORE UPDATE OR DELETE ON public.fabric_stock FOR EACH ROW EXECUTE FUNCTION public.registration_operational_identity_guard();
CREATE TRIGGER registration_fabric_identity BEFORE UPDATE OR DELETE ON public.fabrics FOR EACH ROW EXECUTE FUNCTION public.registration_operational_identity_guard();
CREATE FUNCTION public.registration_provider_prefix(p_name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE word text; BEGIN
 word:=regexp_replace((regexp_split_to_array(btrim(p_name),'\s+'))[1],'[^A-Za-z]','','g');
 IF word IS NULL OR length(word)<3 THEN RAISE EXCEPTION 'Provider first word must contain at least three English letters'; END IF;
 RETURN upper(left(word,1)||right(word,2)); END; $$;
CREATE FUNCTION public.registration_variant_suffix(p_ordinal bigint) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text:=''; n bigint:=p_ordinal; BEGIN
 IF n IS NULL OR n<=0 THEN RAISE EXCEPTION 'Positive variant ordinal required'; END IF;
 WHILE n>0 LOOP n:=n-1; result:=chr(97+(n%26)::integer)||result; n:=n/26; END LOOP;
 RETURN result; END; $$;
CREATE FUNCTION public.registration_request_result(p_request uuid,p_action text,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE old public.stock_registration_requests%rowtype; BEGIN
 IF NOT public.can_receive_fabric() OR p_request IS NULL THEN RAISE EXCEPTION 'Authorized Stock Entry and request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 SELECT * INTO old FROM public.stock_registration_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF old.actor_id IS DISTINCT FROM auth.uid() OR old.action<>p_action OR old.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Request already used by different actor/action/data'; END IF;
  RETURN old.result_id;
 END IF; RETURN NULL; END; $$;
CREATE FUNCTION public.register_delivery_batch(p_request uuid,p_provider text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; supplier uuid; prefix text; number text; payload jsonb; BEGIN
 payload:=jsonb_build_object('provider',btrim(p_provider));
 result:=public.registration_request_result(p_request,'batch',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 prefix:=public.registration_provider_prefix(p_provider);
 PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_provider)),12));
 SELECT id INTO supplier FROM public.suppliers WHERE lower(name)=lower(btrim(p_provider)) ORDER BY id LIMIT 1;
 IF supplier IS NULL THEN INSERT INTO public.suppliers(name) VALUES(btrim(p_provider)) RETURNING id INTO supplier; END IF;
 LOOP
  number:=nextval('public.registration_batch_number')::text;
  number:='B'||lpad(number,greatest(4,length(number)),'0');
  INSERT INTO public.receiving_batches(code,supplier_id,notes,created_by) VALUES(number,supplier,'Registered delivery',auth.uid()) ON CONFLICT(code) DO NOTHING RETURNING id INTO result;
  EXIT WHEN result IS NOT NULL;
 END LOOP;
 INSERT INTO public.stock_registration_batches(batch_id,provider_name,provider_prefix,created_by) VALUES(result,btrim(p_provider),prefix,auth.uid());
 INSERT INTO public.stock_registration_requests VALUES(p_request,'batch',payload,result,auth.uid(),now());
 RETURN result; END; $$;
CREATE FUNCTION public.registration_insert_thans(p_group uuid,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.stock_registration_fabric_types%rowtype; row jsonb; code text; f uuid; b uuid; s uuid; th uuid; item uuid; workshop uuid; length_mm numeric; cp bigint; BEGIN
 SELECT * INTO g FROM public.stock_registration_fabric_types WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_receive_fabric() OR NOT(public.has_role(auth.uid(),'owner') OR g.created_by=auth.uid()) THEN RAISE EXCEPTION 'Owned registered Fabric Type required'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Add 1–500 Thans per submission; more can be added later'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (row-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Only length and optional CP allowed'; END IF;
  length_mm:=(row->>'length_mm')::numeric; cp:=(row->>'cp_paise_per_m')::bigint;
  IF length_mm IS NULL OR length_mm<=0 OR length_mm<>trunc(length_mm) OR length_mm>2147483647 OR (cp IS NOT NULL AND (cp<0 OR cp>9007199254740991)) THEN RAISE EXCEPTION 'Positive exact millimetres and optional nonnegative CP required'; END IF;
  code:=g.code||public.registration_variant_suffix(g.next_ordinal);
  INSERT INTO public.fabrics(code,name) VALUES(code,g.name) RETURNING id INTO f;
  INSERT INTO public.barcodes(code,kind,created_by) VALUES(code,'fabric',auth.uid()) RETURNING id INTO b;
  INSERT INTO public.fabric_stock(fabric_id,batch_id,barcode_id,created_by) VALUES(f,g.batch_id,b,auth.uid()) RETURNING id INTO s;
  INSERT INTO public.thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by) VALUES(f,g.batch_id,s,length_mm::integer,'draft',auth.uid()) RETURNING id INTO th;
  IF cp IS NOT NULL THEN
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,cp,auth.uid(),'CP recorded during Than registration');
  END IF;
  UPDATE public.thaans SET status='active',updated_at=now() WHERE id=th;
  INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(th,'mm',0,auth.uid(),'Registered physical Than') RETURNING id INTO item;
  INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,destination_location_id,reason,reference,actor_id) VALUES(item,th,s,'INWARD',length_mm,'mm',workshop,'Registered physical Than received','REGISTRATION:'||code,auth.uid());
  UPDATE public.fabric_stock SET entry_state='complete' WHERE id=s;
  INSERT INTO public.stock_registration_variants(fabric_type_id,ordinal,code,fabric_stock_id,thaan_id,created_by) VALUES(g.id,g.next_ordinal,code,s,th,auth.uid());
  g.next_ordinal:=g.next_ordinal+1;
 END LOOP;
 UPDATE public.stock_registration_fabric_types SET next_ordinal=g.next_ordinal WHERE id=g.id;
END; $$;
CREATE FUNCTION public.register_fabric_type(p_request uuid,p_batch uuid,p_name text,p_rows jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; prefix text; candidate text; payload jsonb; attempt integer:=0; BEGIN
 payload:=jsonb_build_object('batch',p_batch,'name',btrim(p_name),'rows',p_rows);
 result:=public.registration_request_result(p_request,'fabric',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_name IS NULL OR btrim(p_name)='' THEN RAISE EXCEPTION 'Fabric Type name required'; END IF;
 SELECT provider_prefix INTO prefix FROM public.stock_registration_batches WHERE batch_id=p_batch AND (public.has_role(auth.uid(),'owner') OR created_by=auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned registered batch required'; END IF;
 LOOP
  attempt:=attempt+1; IF attempt>100 THEN RAISE EXCEPTION 'Could not allocate unique fabric code; retry'; END IF;
  candidate:=prefix||'-'||(10000000+floor(random()*90000000)::bigint)::text;
  IF EXISTS(SELECT 1 FROM public.barcodes WHERE code LIKE candidate||'%') OR EXISTS(SELECT 1 FROM public.fabrics WHERE code LIKE candidate||'%') THEN CONTINUE; END IF;
  INSERT INTO public.stock_registration_fabric_types(batch_id,code,name,created_by) VALUES(p_batch,candidate,btrim(p_name),auth.uid()) ON CONFLICT(code) DO NOTHING RETURNING id INTO result;
  EXIT WHEN result IS NOT NULL;
 END LOOP;
 PERFORM public.registration_insert_thans(result,p_rows);
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fabric',payload,result,auth.uid(),now());
 RETURN result; END; $$;
CREATE FUNCTION public.append_registered_thans(p_request uuid,p_fabric_type uuid,p_rows jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE result uuid; payload jsonb; BEGIN
 payload:=jsonb_build_object('fabric_type',p_fabric_type,'rows',p_rows);
 result:=public.registration_request_result(p_request,'append',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM public.registration_insert_thans(p_fabric_type,p_rows);
 INSERT INTO public.stock_registration_requests VALUES(p_request,'append',payload,p_fabric_type,auth.uid(),now());
 RETURN p_fabric_type; END; $$;
CREATE FUNCTION public.fill_registered_thaan_cp(p_request uuid,p_barcode text,p_cp bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE result uuid; s uuid; payload jsonb; BEGIN
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'cp',p_cp);
 result:=public.registration_request_result(p_request,'fill_cp',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_cp IS NULL OR p_cp<0 OR p_cp>9007199254740991 THEN RAISE EXCEPTION 'Nonnegative exact CP required'; END IF;
 SELECT v.fabric_stock_id INTO s FROM public.stock_registration_variants v WHERE v.code=btrim(p_barcode) AND (public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid());
 IF s IS NULL THEN RAISE EXCEPTION 'Owned registered Than barcode required'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=s FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=s) THEN RAISE EXCEPTION 'CP already recorded; use Owner correction workflow'; END IF;
 INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,p_cp,auth.uid(),'Missing CP entered by scanning registered Than');
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fill_cp',payload,s,auth.uid(),now());
 RETURN s; END; $$;
CREATE FUNCTION public.stock_registration_catalog(p_batch uuid DEFAULT NULL,p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(batch) ORDER BY created_at DESC,id),'[]') FROM(
 SELECT rb.batch_id id,b.code,rb.provider_name,rb.provider_prefix,rb.created_at,
 (SELECT coalesce(jsonb_agg(to_jsonb(group_data) ORDER BY created_at,id),'[]') FROM(
 SELECT g.id,g.code,g.name,g.created_at,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'ordinal',v.ordinal,'thaan_id',v.thaan_id,'stock_id',v.fabric_stock_id,'original_mm',th.original_mm,'available_mm',public.inventory_balance(i.id,NULL)::text,'can_fill_cp',(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id),'cp_paise_per_m',CASE WHEN public.has_role(auth.uid(),'owner') THEN (SELECT cp_paise_per_m::text FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1) END) ORDER BY v.ordinal),'[]') FROM public.stock_registration_variants v JOIN public.thaans th ON th.id=v.thaan_id JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.fabric_type_id=g.id) variants
 FROM public.stock_registration_fabric_types g WHERE g.batch_id=rb.batch_id) group_data) fabric_types
 FROM public.stock_registration_batches rb JOIN public.receiving_batches b ON b.id=rb.batch_id
 WHERE (public.has_role(auth.uid(),'owner') OR rb.created_by=auth.uid()) AND (p_batch IS NULL OR rb.batch_id=p_batch)
 AND(p_barcode IS NULL OR EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id WHERE g.batch_id=rb.batch_id AND v.code=btrim(p_barcode)))
 ) batch); END; $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('registration_operational_identity_guard','registration_group_guard','registration_provider_prefix','registration_variant_suffix','registration_request_result','registration_insert_thans','register_delivery_batch','register_fabric_type','append_registered_thans','fill_registered_thaan_cp','stock_registration_catalog') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.register_delivery_batch(uuid,text),public.register_fabric_type(uuid,uuid,text,jsonb),public.append_registered_thans(uuid,uuid,jsonb),public.fill_registered_thaan_cp(uuid,text,bigint),public.stock_registration_catalog(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
