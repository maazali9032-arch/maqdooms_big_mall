BEGIN;
-- Delete from future work without erasing references, stock or recorded history.
CREATE TABLE public.owner_definition_deletions(
 request_id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN('floor','product','design')),
 definition_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 payload jsonb NOT NULL,previous_value jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(kind,definition_id)
);
ALTER TABLE public.owner_definition_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_definition_deletions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_definition_deletions TO authenticated;
GRANT ALL ON public.owner_definition_deletions TO service_role;
CREATE POLICY deletion_owner_read ON public.owner_definition_deletions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER definition_deletion_immutable BEFORE UPDATE OR DELETE ON public.owner_definition_deletions FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

-- A boolean visibility predicate keeps existing invoker/RLS catalogue access intact.
CREATE FUNCTION public.definition_available(p_kind text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.owner_definition_deletions WHERE kind=p_kind AND definition_id=p_id);
$$;
REVOKE ALL ON FUNCTION public.definition_available(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.definition_available(text,uuid) TO authenticated;

CREATE FUNCTION public.guard_deleted_definition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD AND NOT public.definition_available(CASE TG_TABLE_NAME WHEN 'locations' THEN 'floor' WHEN 'products' THEN 'product' ELSE 'design' END,OLD.id) THEN RAISE EXCEPTION 'Deleted definition is retained for history and cannot be reactivated'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_deleted_definition() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER deleted_location_guard BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_definition();
CREATE TRIGGER deleted_product_guard BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_definition();
CREATE TRIGGER deleted_design_guard BEFORE UPDATE ON public.designs FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_definition();

CREATE FUNCTION public.owner_delete_definition(p_request uuid,p_kind text,p_id uuid,p_expected_name text,p_expected_active boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb;saved public.owner_definition_deletions%rowtype;previous jsonb;table_name text;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN('floor','product','design') OR nullif(btrim(p_expected_name),'') IS NULL OR p_expected_active IS NULL THEN RAISE EXCEPTION 'Explicit definition and expected values required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'kind',p_kind,'id',p_id,'name',p_expected_name,'active',p_expected_active);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,51));
 SELECT * INTO saved FROM public.owner_definition_deletions WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Delete retry requires identical details'; END IF; RETURN saved.definition_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 table_name:=CASE p_kind WHEN 'floor' THEN 'locations' WHEN 'product' THEN 'products' ELSE 'designs' END;
 EXECUTE format('SELECT to_jsonb(d) FROM public.%I d WHERE id=$1 FOR UPDATE',table_name) INTO previous USING p_id;
 IF previous IS NULL THEN RAISE EXCEPTION 'Definition not found'; END IF;
 IF NOT public.definition_available(p_kind,p_id) THEN RETURN p_id; END IF;
 IF previous->>'name' IS DISTINCT FROM p_expected_name OR (previous->>'active')::boolean IS DISTINCT FROM p_expected_active THEN RAISE EXCEPTION 'Definition changed; refresh before deleting'; END IF;
 IF p_kind='floor' THEN
  IF previous->>'kind'<>'showroom_sublocation' THEN RAISE EXCEPTION 'Workshop and general Showroom are permanent locations'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_items i WHERE public.inventory_balance(i.id,p_id)<>0) OR EXISTS(SELECT 1 FROM public.finished_products WHERE current_location_id=p_id AND status='available') THEN RAISE EXCEPTION 'Move all stock out of this floor before deleting it'; END IF;
 END IF;
 EXECUTE format('UPDATE public.%I SET active=false WHERE id=$1',table_name) USING p_id;
 INSERT INTO public.owner_definition_deletions(request_id,kind,definition_id,actor_id,payload,previous_value) VALUES(p_request,p_kind,p_id,auth.uid(),payload_value,previous);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'delete_definition',table_name,p_id,previous,previous||jsonb_build_object('active',false,'deleted_from_future_work',true),'DEFINITION:'||p_request::text);
 RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.owner_delete_definition(uuid,text,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_delete_definition(uuid,text,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.owner_location_summary() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('fabric_thaans',(SELECT count(*) FROM public.inventory_items i WHERE i.thaan_id IS NOT NULL AND public.inventory_balance(i.id,l.id)>0),'fabric_mm',(SELECT coalesce(sum(public.inventory_balance(i.id,l.id)),0)::text FROM public.inventory_items i WHERE i.thaan_id IS NOT NULL),'finished_pieces',(SELECT coalesce(sum(public.inventory_balance(i.id,l.id)),0)::text FROM public.inventory_items i WHERE i.finished_product_id IS NOT NULL)) ORDER BY CASE l.kind WHEN 'showroom' THEN 0 WHEN 'showroom_sublocation' THEN 1 ELSE 2 END,l.name,l.id) FROM public.locations l WHERE public.definition_available('floor',l.id)),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.owner_location_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_location_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.inventory_locations() RETURNS TABLE(id uuid,code text,name text,kind text,parent_id uuid,active boolean)
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT id,code,name,kind,parent_id,active FROM public.locations WHERE public.definition_available('floor',id) ORDER BY kind,name; $$;
CREATE OR REPLACE FUNCTION public.owner_production_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.view') THEN RAISE EXCEPTION 'Production access required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') THEN RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.products WHERE public.definition_available('product',id)),'[]'::jsonb),'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.designs WHERE public.definition_available('design',id)),'[]'::jsonb)); END IF;
 RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.code) FROM public.products p WHERE public.definition_available('product',p.id)),'[]'::jsonb),
 'designs',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('charge_version_id',v.id,'charge_paise',v.amount_paise) ORDER BY d.code)
 FROM public.designs d LEFT JOIN LATERAL(SELECT id,amount_paise FROM public.design_charge_versions WHERE design_id=d.id ORDER BY revision DESC LIMIT 1) v ON true WHERE public.definition_available('design',d.id)),'[]'::jsonb));
END; $function$
;
CREATE OR REPLACE FUNCTION public.stock_activity(p_limit integer DEFAULT 100,p_after timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Stock workflow role required'; END IF;
 IF (p_after IS NULL)<>(p_after_id IS NULL) OR p_limit NOT BETWEEN 1 AND 200 OR p_limit IS NULL THEN RAISE EXCEPTION 'Valid stock history cursor and limit required'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY occurred_at DESC,id DESC),'[]') INTO result FROM(
 SELECT m.id,m.occurred_at,jsonb_build_object('id',m.id,'occurred_at',m.occurred_at,'kind',m.kind,'quantity',m.quantity::text,'unit',m.unit,
 'barcode',coalesce(v.code,t.barcode,b.code,pb.code),'item',coalesce(f.name,product.name,material.name),
 'source',CASE WHEN source.kind='showroom' THEN source.name||' — floor not assigned' ELSE source.name END,'destination',CASE WHEN destination.kind='showroom' THEN destination.name||' — floor not assigned' ELSE destination.name END,'reference',m.reference,'note',m.reason,'actor_id',m.actor_id,'actor',actor.full_name) row_value
 FROM public.inventory_movements m LEFT JOIN public.thaans t ON t.id=m.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
 LEFT JOIN public.fabric_stock fs ON fs.id=m.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 LEFT JOIN public.finished_products p ON p.id=m.finished_product_id LEFT JOIN public.products product ON product.id=p.product_id LEFT JOIN public.barcodes pb ON pb.id=p.barcode_id
 LEFT JOIN public.materials material ON material.id=m.material_id LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles actor ON actor.id=m.actor_id
 WHERE (p_after IS NULL OR (m.occurred_at,m.id)<(p_after,p_after_id)) AND (nullif(btrim(p_search),'') IS NULL OR concat_ws(' ',v.code,t.barcode,b.code,pb.code,f.name,product.name,material.name,m.reference,source.name,destination.name) ILIKE '%'||btrim(p_search)||'%')
 ORDER BY m.occurred_at DESC,m.id DESC LIMIT p_limit) rows;
 RETURN result;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
