BEGIN;
CREATE FUNCTION public.validate_production_piece_prices(p_prices jsonb,p_quantity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb; count_value integer;
BEGIN
 IF jsonb_typeof(p_prices) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Positive SP is required for every finished piece before barcode generation'; END IF;
 count_value:=jsonb_array_length(p_prices);
 IF count_value NOT BETWEEN 1 AND 5000 OR (p_quantity IS NOT NULL AND count_value<>p_quantity) THEN RAISE EXCEPTION 'Enter SP for every piece of the production batch'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_prices) p WHERE jsonb_typeof(p)<>'object' OR (p-ARRAY['piece_number','sp_paise'])<>'{}'::jsonb
  OR jsonb_typeof(p->'piece_number') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'sp_paise') IS DISTINCT FROM 'number') THEN RAISE EXCEPTION 'Only piece number and positive SP are accepted'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_prices) p WHERE (p->>'piece_number')::numeric NOT BETWEEN 1 AND count_value OR (p->>'piece_number')::numeric<>trunc((p->>'piece_number')::numeric)
  OR (p->>'sp_paise')::numeric NOT BETWEEN 1 AND 9007199254740991 OR (p->>'sp_paise')::numeric<>trunc((p->>'sp_paise')::numeric))
  OR (SELECT count(DISTINCT (p->>'piece_number')::numeric) FROM jsonb_array_elements(p_prices) p)<>count_value THEN RAISE EXCEPTION 'Every piece needs one positive SP in whole paise'; END IF;
 SELECT jsonb_agg(jsonb_build_object('piece_number',(p->>'piece_number')::integer,'sp_paise',(p->>'sp_paise')::bigint) ORDER BY (p->>'piece_number')::integer) INTO result FROM jsonb_array_elements(p_prices) p;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.validate_production_piece_prices(jsonb,integer) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE original text; revised text;
BEGIN
 original:=pg_get_functiondef('public.complete_production_batch(uuid,uuid,text,text)'::regprocedure);
 revised:=replace(original,'FUNCTION public.complete_production_batch(', 'FUNCTION public.complete_production_batch_priced(');
 revised:=replace(revised,'p_reason text)','p_reason text, p_prices jsonb)');
 revised:=replace(revised,'BEGIN','BEGIN'||chr(10)||' IF NOT public.has_perm(auth.uid(),''stock.price_finished'') THEN RAISE EXCEPTION ''Workshop finished-product price permission required''; END IF; p_prices:=public.validate_production_piece_prices(p_prices);');
 revised:=replace(revised,'''cost_basis'',''issued_fabric''','''prices'',p_prices,''cost_basis'',''issued_fabric''');
 revised:=replace(revised,'IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job)',
   'PERFORM public.validate_production_piece_prices(p_prices,job.quantity);'||chr(10)||' IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job)');
 revised:=replace(revised,' RETURN p_job;',
   ' PERFORM public.set_workshop_product_sp(gen_random_uuid(),p_job,(SELECT jsonb_agg(jsonb_build_object(''piece_id'',f.id,''sp_paise'',p->''sp_paise'') ORDER BY f.piece_number) FROM public.finished_products f JOIN jsonb_array_elements(p_prices) p ON f.piece_number=(p->>''piece_number'')::integer WHERE f.production_job_id=p_job),''Initial positive SP supplied before barcode generation'');'||chr(10)||' RETURN p_job;');
 IF revised=original OR position('p_prices jsonb' IN revised)=0 OR position('Initial positive SP' IN revised)=0 THEN RAISE EXCEPTION 'Expected production receipt implementation not found'; END IF;
 EXECUTE revised;
 -- Legacy no-price callers can only replay a previously recorded receipt, never generate new pieces.
 revised:=replace(original,'BEGIN','BEGIN'||chr(10)||' IF NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE request_id=p_request) THEN RAISE EXCEPTION ''Positive SP is required for every finished piece. Use the priced production receipt''; END IF;');
 EXECUTE revised;
END; $$;
REVOKE ALL ON FUNCTION public.complete_production_batch_priced(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE original text; revised text;
BEGIN
 original:=pg_get_functiondef('public.receive_production_barcode(uuid,text)'::regprocedure);
 revised:=replace(original,'FUNCTION public.receive_production_barcode(', 'FUNCTION public.receive_production_barcode_priced(');
 revised:=replace(revised,'p_code text)','p_code text, p_prices jsonb)');
 revised:=replace(revised,'BEGIN','BEGIN'||chr(10)||' IF NOT public.has_perm(auth.uid(),''stock.price_finished'') THEN RAISE EXCEPTION ''Workshop finished-product price permission required''; END IF; p_prices:=public.validate_production_piece_prices(p_prices);');
 revised:=replace(revised,'''action'',''scan_workshop_receipt''','''prices'',p_prices,''action'',''scan_workshop_receipt''');
 revised:=replace(revised,'public.complete_production_batch(p_request,job.id,''completed'',reason_value)', 'public.complete_production_batch_priced(p_request,job.id,''completed'',reason_value,p_prices)');
 IF revised=original OR position('p_prices jsonb' IN revised)=0 OR position('complete_production_batch_priced' IN revised)=0 THEN RAISE EXCEPTION 'Expected production scan receipt implementation not found'; END IF;
 EXECUTE revised;
END; $$;
REVOKE ALL ON FUNCTION public.receive_production_barcode_priced(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_production_barcode_priced(uuid,text,jsonb) TO authenticated;

-- The older Owner material-allocation API must also require SP before creating each piece.
DO $$
DECLARE original text; revised text;
BEGIN
 original:=pg_get_functiondef('public.receive_finished_products(uuid,uuid,jsonb,text)'::regprocedure);
 revised:=replace(original,'IF jsonb_array_length(p_pieces)<>job.quantity',
   'PERFORM public.validate_production_piece_prices((SELECT jsonb_agg(jsonb_build_object(''piece_number'',p->''piece_number'',''sp_paise'',p->''sp_paise'')) FROM jsonb_array_elements(p_pieces) p),job.quantity);'||chr(10)||' IF jsonb_array_length(p_pieces)<>job.quantity');
 revised:=replace(revised,'INSERT INTO public.finished_product_receipt_pieces VALUES(result,p_request);',
   'INSERT INTO public.finished_product_receipt_pieces VALUES(result,p_request);'||chr(10)||' INSERT INTO public.finished_product_prices(finished_product_id,revision,sp_paise,recorded_by) VALUES(result,1,(piece->>''sp_paise'')::bigint,auth.uid());');
 IF revised=original OR position('validate_production_piece_prices' IN revised)=0 THEN RAISE EXCEPTION 'Expected Owner allocation receipt implementation not found'; END IF;
 EXECUTE revised;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
