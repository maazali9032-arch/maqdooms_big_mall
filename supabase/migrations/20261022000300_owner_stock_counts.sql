BEGIN;
INSERT INTO public.permissions(key,label,domain) VALUES('stock_count.perform','Perform assigned stock counts','inventory') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key)
SELECT role_key,'stock_count.perform' FROM public.roles WHERE key<>'owner' ON CONFLICT DO NOTHING;

CREATE TABLE public.stock_count_audits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE, name text NOT NULL, item_kinds text[] NOT NULL CHECK(item_kinds <@ ARRAY['fabric','finished_product']), location_ids uuid[] NOT NULL, assigned_to uuid NOT NULL REFERENCES public.profiles(id), status text NOT NULL DEFAULT 'active' CHECK(status IN('active','completed','cancelled')), created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE TABLE public.stock_count_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audit_id uuid NOT NULL REFERENCES public.stock_count_audits(id), item_kind text NOT NULL CHECK(item_kind IN('fabric','finished_product')), barcode text NOT NULL, location_id uuid NOT NULL REFERENCES public.locations(id), details jsonb NOT NULL, UNIQUE(audit_id,barcode)
);
CREATE TABLE public.stock_count_scans(
 audit_item_id uuid PRIMARY KEY REFERENCES public.stock_count_items(id), audit_id uuid NOT NULL REFERENCES public.stock_count_audits(id), scanned_by uuid NOT NULL REFERENCES public.profiles(id), scanned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.stock_count_audits ENABLE ROW LEVEL SECURITY; ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.stock_count_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_count_audits,public.stock_count_items,public.stock_count_scans FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_count_audits,public.stock_count_items,public.stock_count_scans TO authenticated; GRANT ALL ON public.stock_count_audits,public.stock_count_items,public.stock_count_scans TO service_role;
CREATE POLICY stock_count_audits_read ON public.stock_count_audits FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR assigned_to=auth.uid());
CREATE POLICY stock_count_items_read ON public.stock_count_items FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE POLICY stock_count_scans_read ON public.stock_count_scans FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR EXISTS(SELECT 1 FROM public.stock_count_audits a WHERE a.id=audit_id AND a.assigned_to=auth.uid()));
CREATE TRIGGER stock_count_items_immutable BEFORE UPDATE OR DELETE ON public.stock_count_items FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER stock_count_scans_immutable BEFORE UPDATE OR DELETE ON public.stock_count_scans FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.stock_count_setup_catalog() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('staff',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) ORDER BY p.full_name) FROM public.profiles p WHERE p.active AND NOT public.has_role(p.id,'owner')),'[]'::jsonb),'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind) ORDER BY l.name) FROM public.locations l WHERE l.active),'[]'::jsonb)) WHERE public.has_role(auth.uid(),'owner');
$$;
CREATE FUNCTION public.create_stock_count_audit(p_request uuid,p_name text,p_kinds text[],p_locations uuid[],p_staff uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid(); item_count integer;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_name),'') IS NULL OR p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 2 OR p_kinds <@ ARRAY['fabric','finished_product'] IS NOT TRUE OR p_locations IS NULL OR cardinality(p_locations)<1 OR p_staff IS NULL THEN RAISE EXCEPTION 'Name, at least one item type, location and assigned staff member are required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_staff AND active) OR (SELECT count(*) FROM public.locations WHERE id=ANY(p_locations) AND active)<>cardinality(p_locations) THEN RAISE EXCEPTION 'Assigned staff member and all locations must be active'; END IF;
 INSERT INTO public.stock_count_audits(id,request_id,name,item_kinds,location_ids,assigned_to,created_by) VALUES(result,p_request,btrim(p_name),p_kinds,p_locations,p_staff,auth.uid());
 IF 'fabric'=ANY(p_kinds) THEN INSERT INTO public.stock_count_items(audit_id,item_kind,barcode,location_id,details)
 SELECT result,'fabric',coalesce(v.code,t.barcode,b.code),l.id,jsonb_build_object('name',coalesce(g.name,f.name),'batch',rb.code,'location',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)::text)
 FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=fs.fabric_id JOIN public.locations l ON l.id=ANY(p_locations) LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.receiving_batches rb ON rb.id=fs.batch_id LEFT JOIN public.barcodes b ON b.id=fs.barcode_id
 WHERE i.unit='mm' AND public.inventory_balance(i.id,l.id)>0; END IF;
 IF 'finished_product'=ANY(p_kinds) THEN INSERT INTO public.stock_count_items(audit_id,item_kind,barcode,location_id,details)
 SELECT result,'finished_product',b.code,p.current_location_id,jsonb_build_object('name',product.name,'design',coalesce(d.name,pj.custom_design),'size',public.production_piece_context(p.id)->>'size','location',l.name)
 FROM public.finished_products p JOIN public.inventory_items i ON i.finished_product_id=p.id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.locations l ON l.id=p.current_location_id LEFT JOIN public.designs d ON d.id=p.design_id LEFT JOIN public.production_jobs pj ON pj.id=p.production_job_id
 WHERE p.status='available' AND p.current_location_id=ANY(p_locations) AND public.inventory_balance(i.id,p.current_location_id)=1; END IF;
 SELECT count(*) INTO item_count FROM public.stock_count_items WHERE audit_id=result; IF item_count=0 THEN RAISE EXCEPTION 'No currently tracked items match the chosen locations and types'; END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value) VALUES(auth.uid(),'create_stock_count_audit','stock_count_audits',result,jsonb_build_object('items',item_count,'kinds',p_kinds,'locations',p_locations,'assigned_to',p_staff)); RETURN result;
END; $$;
CREATE FUNCTION public.stock_count_owner_view() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'assigned_to',p.full_name,'created_at',a.created_at,'total',(SELECT count(*) FROM public.stock_count_items i WHERE i.audit_id=a.id),'scanned',(SELECT count(*) FROM public.stock_count_scans s WHERE s.audit_id=a.id),'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('barcode',i.barcode,'kind',i.item_kind,'details',i.details,'scanned',s.audit_item_id IS NOT NULL) ORDER BY i.item_kind,i.barcode),'[]'::jsonb) FROM public.stock_count_items i LEFT JOIN public.stock_count_scans s ON s.audit_item_id=i.id WHERE i.audit_id=a.id)) ORDER BY a.created_at DESC),'[]'::jsonb) FROM public.stock_count_audits a JOIN public.profiles p ON p.id=a.assigned_to WHERE public.has_role(auth.uid(),'owner');
$$;
CREATE FUNCTION public.stock_count_my_task() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',a.id,'name',a.name,'total',(SELECT count(*) FROM public.stock_count_items i WHERE i.audit_id=a.id),'scanned',(SELECT count(*) FROM public.stock_count_scans s WHERE s.audit_id=a.id)) FROM public.stock_count_audits a WHERE a.assigned_to=auth.uid() AND a.status='active' ORDER BY a.created_at DESC LIMIT 1;
$$;
CREATE FUNCTION public.stock_count_scan(p_audit uuid,p_barcode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item public.stock_count_items%rowtype; total integer; scanned integer; was_already_scanned boolean;
BEGIN
 IF NOT public.has_perm(auth.uid(),'stock_count.perform') THEN RAISE EXCEPTION 'Assigned stock-count access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_count_audits WHERE id=p_audit AND assigned_to=auth.uid() AND status='active') THEN RAISE EXCEPTION 'This stock count is not assigned to you'; END IF;
 SELECT * INTO item FROM public.stock_count_items WHERE audit_id=p_audit AND barcode=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This barcode is not in the assigned count'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.stock_count_scans WHERE audit_item_id=item.id) INTO was_already_scanned;
 INSERT INTO public.stock_count_scans(audit_item_id,audit_id,scanned_by) VALUES(item.id,p_audit,auth.uid()) ON CONFLICT(audit_item_id) DO NOTHING;
 SELECT count(*) INTO total FROM public.stock_count_items WHERE audit_id=p_audit; SELECT count(*) INTO scanned FROM public.stock_count_scans WHERE audit_id=p_audit; RETURN jsonb_build_object('barcode',item.barcode,'scanned',scanned,'total',total,'already_scanned',was_already_scanned);
END; $$;
CREATE FUNCTION public.complete_stock_count_audit(p_audit uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF; UPDATE public.stock_count_audits SET status='completed',completed_at=clock_timestamp() WHERE id=p_audit AND status='active'; IF NOT FOUND THEN RAISE EXCEPTION 'Active stock count required'; END IF; END; $$;
GRANT EXECUTE ON FUNCTION public.stock_count_setup_catalog(),public.create_stock_count_audit(uuid,text,text[],uuid[],uuid),public.stock_count_owner_view(),public.stock_count_my_task(),public.stock_count_scan(uuid,text),public.complete_stock_count_audit(uuid) TO authenticated;
NOTIFY pgrst,'reload schema'; COMMIT;
