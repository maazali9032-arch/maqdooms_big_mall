-- Phase 5: transfer-document history on the existing atomic location ledger.
-- No balances, posting rules, stock data, roles or financial policies changed.
BEGIN;
CREATE FUNCTION public.stock_transfer_history(p_stock uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required for transfer document history'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.posted_at DESC,x.id DESC) FROM (
 SELECT t.id,t.code,t.status,t.request_id,t.source_location_id,s.name source_name,
 t.destination_location_id,d.name destination_name,t.reason,t.created_by,t.created_at,t.posted_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'fabric_stock_id',l.fabric_stock_id,
 'thaan_id',l.thaan_id,'material_id',l.material_id,'finished_product_id',l.finished_product_id,
 'quantity',l.quantity,'unit',l.unit,'barcode',bc.code,'fabric_name',f.name,'batch_code',b.code,
 'movement_id',m.id,'actor_id',m.actor_id,'occurred_at',m.occurred_at) ORDER BY l.id)
 FROM public.stock_transfer_lines l
 LEFT JOIN public.fabric_stock fs ON fs.id=l.fabric_stock_id
 LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id
 LEFT JOIN public.inventory_movements m ON m.stock_transfer_line_id=l.id
 WHERE l.transfer_id=t.id),'[]'::jsonb) lines
 FROM public.stock_transfers t JOIN public.locations s ON s.id=t.source_location_id
 JOIN public.locations d ON d.id=t.destination_location_id
 WHERE t.status='posted' AND (p_stock IS NULL OR EXISTS(
 SELECT 1 FROM public.stock_transfer_lines l WHERE l.transfer_id=t.id AND l.fabric_stock_id=p_stock))
 ORDER BY t.posted_at DESC,t.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.stock_transfer_history(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_history(uuid,integer) TO authenticated;
COMMIT;
