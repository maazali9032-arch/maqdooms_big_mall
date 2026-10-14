-- A location is saleable only when it is an active Showroom or its active floor.
CREATE FUNCTION public.is_showroom_location(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id
 WHERE l.id=p_location AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom')));
$$;
REVOKE ALL ON FUNCTION public.is_showroom_location(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_showroom_location(uuid) TO authenticated;

CREATE FUNCTION public.production_fabric_projection(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN

 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'fabric_name',r->>'barcode') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_name',coalesce(g.name,f.name),'batch_code',b.code,
 'colour',f.colour,'barcode',coalesce(v.code,t.barcode,bc.code),
 'cuts',jsonb_build_array(jsonb_build_object('inventory_item_id',i.id,'thaan_id',t.id,
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)
 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb)))) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 WHERE t.status='active' AND t.original_mm>0 AND coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),0)>0 AND (p_barcode IS NULL OR btrim(p_barcode) IN(v.code,t.barcode,bc.code))
 AND EXISTS(SELECT 1 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0)
 )q),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.production_fabric_projection(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_fabric_catalog(p_barcode text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT public.has_perm(auth.uid(),'production.view') THEN RAISE EXCEPTION 'Production view permission required'; END IF;RETURN public.production_fabric_projection(p_barcode);END; $$;
REVOKE ALL ON FUNCTION public.production_fabric_catalog(text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.production_fabric_catalog(text) TO authenticated;

CREATE FUNCTION public.pos_reserve_variants(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE type_name text;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter required'; END IF;
 SELECT coalesce(g.name,f.name) INTO type_name FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id
 JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 WHERE btrim(p_barcode) IN(v.code,t.barcode,bc.code) LIMIT 1;
 RETURN coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.production_fabric_projection(NULL)) x
 WHERE x->>'fabric_name'=type_name),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.pos_reserve_variants(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_reserve_variants(text) TO authenticated;

-- Safe projection; no Workshop/factory balances, CP, suppliers or staff fields.
CREATE FUNCTION public.showroom_stock(p_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'E-commerce role required'; END IF;
 IF p_kind IS NOT NULL AND p_kind NOT IN('fabric','product') THEN RAISE EXCEPTION 'Fabric or product required'; END IF;
 RETURN public.showroom_stock_projection(p_kind);
END; $$;

CREATE FUNCTION public.showroom_stock_projection(p_kind text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'name',r->>'barcode'),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('kind','fabric','id',t.id,'barcode',coalesce(v.code,t.barcode,bc.code),'name',coalesce(g.name,f.name),
 'colour',f.colour,'available_mm',sum(public.inventory_balance(i.id,l.id)),
 'locations',jsonb_agg(jsonb_build_object('name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 JOIN public.locations l ON public.is_showroom_location(l.id) AND public.inventory_balance(i.id,l.id)>0
 WHERE t.status='active' AND t.original_mm>0 AND coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),0)>0 AND (p_kind IS NULL OR p_kind='fabric') GROUP BY t.id,v.code,bc.code,f.name,f.colour,g.name
 UNION ALL
 SELECT jsonb_build_object('kind','product','id',p.id,'barcode',bc.code,'name',product.name,'design',coalesce(d.name,j.custom_design),'size',j.size,
 'available_pieces',1,'locations',jsonb_build_array(jsonb_build_object('name',l.name,'quantity',1)))
 FROM public.finished_products p JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id
 JOIN public.barcodes bc ON bc.id=p.barcode_id JOIN public.inventory_items i ON i.finished_product_id=p.id
 JOIN public.locations l ON l.id=p.current_location_id AND public.is_showroom_location(l.id)
 WHERE p.status='available' AND public.inventory_balance(i.id,l.id)=1 AND (p_kind IS NULL OR p_kind='product')
 )q;
$$;
REVOKE ALL ON FUNCTION public.showroom_stock_projection(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ecommerce_listing_stock() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'E-commerce role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('listing_id',l.id,'kind',CASE WHEN EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id) THEN 'product' ELSE 'fabric' END,'stock',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=l.id AND thaan_id=(x->>'id')::uuid)) OR (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id AND finished_product_id=(x->>'id')::uuid))),'[]'::jsonb))) FROM public.listings l),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ecommerce_listing_stock() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecommerce_listing_stock() TO authenticated;
REVOKE ALL ON FUNCTION public.showroom_stock(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.showroom_stock(text) TO authenticated;

CREATE TABLE public.listing_finished_product_links (
 listing_id uuid NOT NULL REFERENCES public.listings(id),finished_product_id uuid NOT NULL REFERENCES public.finished_products(id),
 PRIMARY KEY(listing_id,finished_product_id)
);
ALTER TABLE public.listing_finished_product_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_finished_product_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.listing_finished_product_links TO authenticated;
GRANT ALL ON public.listing_finished_product_links TO service_role;
CREATE POLICY listing_product_read ON public.listing_finished_product_links FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'ecommerce.link_stock'));
CREATE TRIGGER listing_product_audit AFTER INSERT OR DELETE ON public.listing_finished_product_links FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();

CREATE FUNCTION public.link_showroom_listing(p_listing uuid,p_kind text,p_stock uuid,p_link boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.link_stock') THEN RAISE EXCEPTION 'Listing link permission required'; END IF;
 IF p_listing IS NULL OR p_stock IS NULL OR p_link IS NULL OR p_kind NOT IN('fabric','product') OR p_kind IS NULL THEN RAISE EXCEPTION 'Listing and stock required'; END IF;
 PERFORM 1 FROM public.listings WHERE id=p_listing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing required'; END IF;
 IF p_link AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.showroom_stock_projection(p_kind)) x WHERE x->>'id'=p_stock::text) THEN RAISE EXCEPTION 'Stock must be available in Showroom'; END IF;
 IF p_link AND ((p_kind='fabric' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=p_listing)) OR (p_kind='product' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=p_listing))) THEN RAISE EXCEPTION 'Use separate listings for fabric metres and finished pieces'; END IF;
 IF p_link THEN UPDATE public.listings SET stock_mode='linked' WHERE id=p_listing; END IF;
 IF p_kind='fabric' THEN
  IF p_link THEN INSERT INTO public.listing_thaan_links VALUES(p_listing,p_stock) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.listing_thaan_links WHERE listing_id=p_listing AND thaan_id=p_stock; END IF;
 ELSE
  IF p_link THEN INSERT INTO public.listing_finished_product_links VALUES(p_listing,p_stock) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.listing_finished_product_links WHERE listing_id=p_listing AND finished_product_id=p_stock; END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.link_showroom_listing(uuid,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_showroom_listing(uuid,text,uuid,boolean) TO authenticated;
-- Do not permit direct browser linking of hidden Workshop Thaans.
REVOKE INSERT,UPDATE,DELETE ON public.listing_thaan_links FROM authenticated;

CREATE FUNCTION public.storefront_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'slug',l.slug,'title',l.title,'description',l.description,'images',l.images,
 'price_paise',l.price_paise,'sale_price_paise',l.sale_price_paise,'category',l.category,
 'availability',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=l.id AND thaan_id=(x->>'id')::uuid)) OR (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id AND finished_product_id=(x->>'id')::uuid))) THEN 'available' ELSE 'sold_out' END,
 'stock',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE
 (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links k WHERE k.listing_id=l.id AND k.thaan_id=(x->>'id')::uuid)) OR
 (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links k WHERE k.listing_id=l.id AND k.finished_product_id=(x->>'id')::uuid))),'[]'::jsonb)) ORDER BY l.slug),'[]'::jsonb)
 FROM public.listings l WHERE l.published AND l.stock_mode='linked';
$$;
REVOKE ALL ON FUNCTION public.storefront_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_catalog() TO anon,authenticated;

CREATE FUNCTION public.listing_showroom_availability() RETURNS TABLE(listing_id uuid,linked_thaans integer,largest_piece_mm integer,total_linked_mm integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT l.id,count(t.id)::integer,coalesce(max(greatest(0,z.qty-coalesce(h.held,0))),0)::integer,coalesce(sum(z.qty),0)::integer
 FROM public.listings l LEFT JOIN public.listing_thaan_links k ON k.listing_id=l.id
 LEFT JOIN public.thaans t ON t.id=k.thaan_id AND t.status='active' LEFT JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN LATERAL(SELECT sum(public.inventory_balance(i.id,loc.id)) qty FROM public.locations loc WHERE public.is_showroom_location(loc.id)) z ON true
 LEFT JOIN LATERAL(SELECT sum(length_mm) held FROM public.holds WHERE thaan_id=t.id AND status='active' AND expires_at>now()) h ON true
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) OR l.published
 GROUP BY l.id;
$$;
REVOKE ALL ON FUNCTION public.listing_showroom_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listing_showroom_availability() TO authenticated,anon;
CREATE OR REPLACE VIEW public.v_listing_availability WITH(security_invoker=true) AS SELECT * FROM public.listing_showroom_availability();

CREATE FUNCTION public.owner_register_staff(p_user uuid,p_name text,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE email_value text;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>120 OR cardinality(p_roles) NOT BETWEEN 1 AND 7 OR p_roles IS NULL OR EXISTS(SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN('owner','stock_entry','counter','ecommerce_manager','salesperson','tailor','production')) THEN RAISE EXCEPTION 'Name and defined roles required'; END IF;
 SELECT email INTO email_value FROM auth.users WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Auth account required'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user) THEN
  IF (SELECT array_agg(role_key ORDER BY role_key) FROM public.user_roles WHERE user_id=p_user)=(SELECT array_agg(DISTINCT role ORDER BY role) FROM unnest(p_roles) role)
   AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND full_name=btrim(p_name) AND email=email_value) THEN RETURN; END IF;
  RAISE EXCEPTION 'Account already has roles; use permission management';
 END IF;
 INSERT INTO public.profiles(id,full_name,email) VALUES(p_user,btrim(p_name),email_value) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,email=excluded.email;
 INSERT INTO public.user_roles(user_id,role_key) SELECT p_user,role FROM unnest(p_roles) role;
END; $$;
REVOKE ALL ON FUNCTION public.owner_register_staff(uuid,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_register_staff(uuid,text,text[]) TO authenticated;

CREATE FUNCTION public.update_account_name(p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) OR nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>120 THEN RAISE EXCEPTION 'Active account and a name up to 120 characters required'; END IF;
 UPDATE public.profiles SET full_name=btrim(p_name) WHERE id=auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.update_account_name(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_account_name(text) TO authenticated;
