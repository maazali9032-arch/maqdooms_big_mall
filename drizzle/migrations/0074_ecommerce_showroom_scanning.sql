-- Active showroom stock and barcode-assisted online listing authoring.
-- Preserve physical inventory, archived demo metadata, orders and audit history.
ALTER TABLE public.listings ADD COLUMN archived_at timestamptz;
UPDATE public.listings l SET archived_at=now(),published=false
FROM (VALUES
 ('55555555-5555-5555-5555-555555555501'::uuid,'premium-navy-suiting','Premium Navy Suiting'),
 ('55555555-5555-5555-5555-555555555502'::uuid,'charcoal-wool-blend','Charcoal Wool Blend'),
 ('55555555-5555-5555-5555-555555555503'::uuid,'designer-black-sherwani','Designer Black Sherwani'),
 ('55555555-5555-5555-5555-555555555504'::uuid,'wine-velvet-jacket','Wine Velvet Jacket')
) seed(id,slug,title) WHERE l.id=seed.id AND l.slug=seed.slug AND l.title=seed.title;

CREATE OR REPLACE FUNCTION public.showroom_stock_projection(p_kind text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'name',r->>'barcode'),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('kind','fabric','id',t.id,'barcode',coalesce(v.code,t.barcode,bc.code),'name',coalesce(g.name,f.name),
 'colour',f.colour,'available_mm',sum(public.inventory_balance(i.id,l.id)),
 'locations',jsonb_agg(jsonb_build_object('name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 JOIN public.locations l ON l.active AND l.kind='showroom_sublocation' AND public.is_showroom_location(l.id) AND public.inventory_balance(i.id,l.id)>0
 WHERE t.status='active' AND t.original_mm>0 AND (p_kind IS NULL OR p_kind='fabric') GROUP BY t.id,v.code,bc.code,f.name,f.colour,g.name
 UNION ALL
 SELECT jsonb_build_object('kind','product','id',p.id,'barcode',bc.code,'name',product.name,'design',coalesce(d.name,j.custom_design),'size',j.size,
 'sp_paise',sp.sp_paise::text,'available_pieces',1,'locations',jsonb_build_array(jsonb_build_object('name',l.name,'quantity',1)))
 FROM public.finished_products p JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id
 JOIN public.barcodes bc ON bc.id=p.barcode_id JOIN public.inventory_items i ON i.finished_product_id=p.id
 JOIN LATERAL(SELECT price.sp_paise FROM public.finished_product_prices price WHERE price.finished_product_id=p.id ORDER BY price.revision DESC LIMIT 1) sp ON sp.sp_paise>0
 JOIN public.locations l ON l.id=p.current_location_id AND l.active AND l.kind='showroom_sublocation' AND public.is_showroom_location(l.id)
 WHERE p.status='available' AND public.inventory_balance(i.id,l.id)=1 AND (p_kind IS NULL OR p_kind='product')
 )q;
$$;
REVOKE ALL ON FUNCTION public.showroom_stock_projection(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.link_showroom_listing(p_listing uuid,p_kind text,p_stock uuid,p_link boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.link_stock') THEN RAISE EXCEPTION 'Listing link permission required'; END IF;
 IF p_listing IS NULL OR p_stock IS NULL OR p_link IS NULL OR p_kind NOT IN('fabric','product') OR p_kind IS NULL THEN RAISE EXCEPTION 'Listing and stock required'; END IF;
 PERFORM 1 FROM public.listings WHERE id=p_listing AND archived_at IS NULL FOR UPDATE;
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

CREATE FUNCTION public.ecommerce_scan_stock(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE matches jsonb;
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.link_stock') THEN RAISE EXCEPTION 'Listing link permission required'; END IF;
 IF nullif(btrim(p_barcode),'') IS NULL OR length(btrim(p_barcode))>200 THEN RAISE EXCEPTION 'Scan a physical item barcode'; END IF;
 SELECT jsonb_agg(x) INTO matches FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x
 WHERE x->>'barcode'=btrim(p_barcode)
 OR (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.barcodes b ON b.id=s.barcode_id WHERE t.id=(x->>'id')::uuid AND btrim(p_barcode) IN(t.barcode,b.code)));
 IF matches IS NULL THEN RAISE EXCEPTION 'No available showroom item matches this barcode. Finished pieces need a saved positive SP; fabric needs available showroom metres.'; END IF;
 IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION 'Barcode matches several Thaans. Scan an individual Thaan barcode'; END IF;
 RETURN matches->0;
END; $$;
REVOKE ALL ON FUNCTION public.ecommerce_scan_stock(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecommerce_scan_stock(text) TO authenticated;

CREATE FUNCTION public.ecommerce_listing_links(p_listing uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.manage_listings') THEN RAISE EXCEPTION 'Listing management permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row) FROM (
 SELECT jsonb_build_object('id',t.id,'kind','fabric','barcode',coalesce(v.code,t.barcode),'name',coalesce(g.name,f.name)) row
 FROM public.listing_thaan_links k JOIN public.thaans t ON t.id=k.thaan_id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id WHERE k.listing_id=p_listing
 UNION ALL
 SELECT jsonb_build_object('id',p.id,'kind','product','barcode',b.code,'name',product.name)
 FROM public.listing_finished_product_links k JOIN public.finished_products p ON p.id=k.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id WHERE k.listing_id=p_listing
 ) q),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ecommerce_listing_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecommerce_listing_links(uuid) TO authenticated;

-- Save descriptive fields and physical links together; a rejected scan/link cannot partially edit metadata.
CREATE FUNCTION public.save_ecommerce_listing_details(p_listing uuid,p_details jsonb,p_stock jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE details public.listings%rowtype; item jsonb; kinds integer;
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.manage_listings') THEN RAISE EXCEPTION 'Listing management permission required'; END IF;
 PERFORM 1 FROM public.listings WHERE id=p_listing AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active listing required'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Listing details required'; END IF;
 SELECT * INTO details FROM jsonb_populate_record(NULL::public.listings,p_details);
 IF nullif(btrim(details.title),'') IS NULL THEN RAISE EXCEPTION 'Product name is required'; END IF;
 IF cardinality(details.images)>6 OR coalesce(details.price_paise,0)<0 OR coalesce(details.sale_price_paise,0)<0 THEN RAISE EXCEPTION 'Invalid images or online price'; END IF;
 IF p_stock IS NOT NULL THEN
  IF NOT public.has_perm(auth.uid(),'ecommerce.link_stock') THEN RAISE EXCEPTION 'Listing link permission required'; END IF;
  IF jsonb_typeof(p_stock) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Stock links must be an array'; END IF;
  IF jsonb_array_length(p_stock)>200 THEN RAISE EXCEPTION 'Maximum 200 linked barcodes per listing'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_stock) x WHERE x->>'kind' NOT IN('fabric','product') OR x->>'kind' IS NULL OR x->>'id' IS NULL) THEN RAISE EXCEPTION 'Invalid physical stock'; END IF;
  SELECT count(DISTINCT x->>'kind') INTO kinds FROM jsonb_array_elements(p_stock) x;
  IF kinds>1 THEN RAISE EXCEPTION 'Use separate listings for fabric metres and finished pieces'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_stock))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_stock) x) THEN RAISE EXCEPTION 'Duplicate stock barcode'; END IF;
  -- Remove only omitted links; retained sold-out links remain valid historical associations.
  DELETE FROM public.listing_thaan_links k WHERE k.listing_id=p_listing AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_stock) x WHERE x->>'kind'='fabric' AND (x->>'id')::uuid=k.thaan_id);
  DELETE FROM public.listing_finished_product_links k WHERE k.listing_id=p_listing AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_stock) x WHERE x->>'kind'='product' AND (x->>'id')::uuid=k.finished_product_id);
  FOR item IN SELECT x FROM jsonb_array_elements(p_stock) x LOOP
   IF NOT EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=p_listing AND thaan_id=(item->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=p_listing AND finished_product_id=(item->>'id')::uuid) THEN
    PERFORM public.link_showroom_listing(p_listing,item->>'kind',(item->>'id')::uuid,true);
   END IF;
  END LOOP;
 END IF;
 UPDATE public.listings SET title=btrim(details.title),description=details.description,category=details.category,collection=details.collection,tags=coalesce(details.tags,'{}'),seo_title=details.seo_title,seo_description=details.seo_description,price_paise=details.price_paise,sale_price_paise=details.sale_price_paise,images=coalesce(details.images,'{}') WHERE id=p_listing;
END; $$;
REVOKE ALL ON FUNCTION public.save_ecommerce_listing_details(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ecommerce_listing_details(uuid,jsonb,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.listing_showroom_availability() RETURNS TABLE(listing_id uuid,linked_thaans integer,largest_piece_mm integer,total_linked_mm integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT l.id,count(x.item)::integer,coalesce(max(greatest(0,(x.item->>'available_mm')::numeric-coalesce(h.held,0))),0)::integer,coalesce(sum((x.item->>'available_mm')::numeric),0)::integer
 FROM public.listings l LEFT JOIN public.listing_thaan_links k ON k.listing_id=l.id
 LEFT JOIN LATERAL(SELECT item FROM jsonb_array_elements(public.showroom_stock_projection('fabric')) item WHERE (item->>'id')::uuid=k.thaan_id) x ON true
 LEFT JOIN LATERAL(SELECT sum(length_mm) held FROM public.holds WHERE thaan_id=k.thaan_id AND status='active' AND expires_at>now()) h ON true
 WHERE l.archived_at IS NULL AND (public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) OR l.published)
 GROUP BY l.id;
$$;
CREATE OR REPLACE FUNCTION public.storefront_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'slug',l.slug,'title',l.title,'description',l.description,'images',l.images,
 'price_paise',l.price_paise,'sale_price_paise',l.sale_price_paise,'category',l.category,
 'availability',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=l.id AND thaan_id=(x->>'id')::uuid)) OR (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id AND finished_product_id=(x->>'id')::uuid))) THEN 'available' ELSE 'sold_out' END,
 'stock',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE
 (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links k WHERE k.listing_id=l.id AND k.thaan_id=(x->>'id')::uuid)) OR
 (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links k WHERE k.listing_id=l.id AND k.finished_product_id=(x->>'id')::uuid))),'[]'::jsonb)) ORDER BY l.slug),'[]'::jsonb)
 FROM public.listings l WHERE l.published AND l.archived_at IS NULL AND l.stock_mode='linked';
$$;

NOTIFY pgrst, 'reload schema';
