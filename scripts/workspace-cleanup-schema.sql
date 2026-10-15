-- Read the current ledger; historical data and old movement views stay intact.
CREATE FUNCTION public.stock_activity(p_limit integer DEFAULT 100,p_after timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Stock workflow role required'; END IF;
 IF (p_after IS NULL)<>(p_after_id IS NULL) OR p_limit NOT BETWEEN 1 AND 200 OR p_limit IS NULL THEN RAISE EXCEPTION 'Valid stock history cursor and limit required'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY occurred_at DESC,id DESC),'[]') INTO result FROM(
 SELECT m.id,m.occurred_at,jsonb_build_object('id',m.id,'occurred_at',m.occurred_at,'kind',m.kind,'quantity',m.quantity::text,'unit',m.unit,
 'barcode',coalesce(v.code,t.barcode,b.code,pb.code),'item',coalesce(f.name,product.name,material.name),
 'source',source.name,'destination',destination.name,'reference',m.reference,'note',m.reason,'actor_id',m.actor_id,'actor',actor.full_name) row_value
 FROM public.inventory_movements m LEFT JOIN public.thaans t ON t.id=m.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
 LEFT JOIN public.fabric_stock fs ON fs.id=m.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 LEFT JOIN public.finished_products p ON p.id=m.finished_product_id LEFT JOIN public.products product ON product.id=p.product_id LEFT JOIN public.barcodes pb ON pb.id=p.barcode_id
 LEFT JOIN public.materials material ON material.id=m.material_id LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles actor ON actor.id=m.actor_id
 WHERE (p_after IS NULL OR (m.occurred_at,m.id)<(p_after,p_after_id)) AND (nullif(btrim(p_search),'') IS NULL OR concat_ws(' ',v.code,t.barcode,b.code,pb.code,f.name,product.name,material.name,m.reference,source.name,destination.name) ILIKE '%'||btrim(p_search)||'%')
 ORDER BY m.occurred_at DESC,m.id DESC LIMIT p_limit) rows;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.stock_activity(integer,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stock_activity(integer,timestamptz,uuid,text) TO authenticated;

CREATE FUNCTION public.fabric_inventory_archive() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Stock workflow role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'barcode',coalesce(v.code,t.barcode,bc.code),'batch',batch.code,'fabric',coalesce(g.name,f.name),'name',f.name,'colour',f.colour,'recorded_mm',t.original_mm,'status',t.status,'cp_paise_per_m',CASE WHEN public.can_view_thaan_cp(NULL) THEN (SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1) END) ORDER BY batch.created_at DESC,batch.id,g.name,v.ordinal,t.id)
 FROM public.thaans t LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 LEFT JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id LEFT JOIN public.receiving_batches batch ON batch.id=coalesce(fs.batch_id,t.batch_id) LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 WHERE t.status IN('depleted','archived')),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.fabric_inventory_archive() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fabric_inventory_archive() TO authenticated;
