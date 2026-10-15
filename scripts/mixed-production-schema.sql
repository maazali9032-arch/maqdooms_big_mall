-- One Production ID, explicit immutable per-piece descriptors; whole-batch receipt.
CREATE TABLE public.production_piece_specs (
 production_job_id uuid NOT NULL REFERENCES public.production_jobs(id),piece_number integer NOT NULL CHECK(piece_number>0),
 product_id uuid NOT NULL REFERENCES public.products(id),design_id uuid REFERENCES public.designs(id),custom_design text,size text NOT NULL CHECK(length(btrim(size)) BETWEEN 1 AND 40),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(production_job_id,piece_number),CHECK((design_id IS NULL)<>(custom_design IS NULL)),CHECK(custom_design IS NULL OR length(btrim(custom_design)) BETWEEN 1 AND 120)
);
CREATE TABLE public.mixed_production_requests (
 request_id uuid PRIMARY KEY REFERENCES public.production_batch_requests(request_id),production_job_id uuid NOT NULL UNIQUE REFERENCES public.production_jobs(id),actor_id uuid NOT NULL REFERENCES public.profiles(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_piece_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mixed_production_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_piece_specs,public.mixed_production_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_piece_specs,public.mixed_production_requests TO authenticated;
GRANT ALL ON public.production_piece_specs,public.mixed_production_requests TO service_role;
CREATE POLICY production_specs_read ON public.production_piece_specs FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'production.view') OR public.has_perm(auth.uid(),'production.receive') OR (public.has_role(auth.uid(),'tailor') AND public.owns_production_job(production_job_id)));
CREATE POLICY mixed_production_request_read ON public.mixed_production_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER production_piece_specs_immutable BEFORE UPDATE OR DELETE ON public.production_piece_specs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER mixed_production_request_immutable BEFORE UPDATE OR DELETE ON public.mixed_production_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
DO $$ DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.finished_products'::regclass AND confrelid='public.production_jobs'::regclass AND contype='f' LOOP
  EXECUTE format('ALTER TABLE public.finished_products DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END; $$;
CREATE TRIGGER production_piece_update_descriptor BEFORE UPDATE OF product_id,design_id ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
ALTER TABLE public.finished_products ADD CONSTRAINT piece_production_job_fkey FOREIGN KEY(production_job_id) REFERENCES public.production_jobs(id);
ALTER TABLE public.finished_products ADD CONSTRAINT piece_product_fkey FOREIGN KEY(product_id) REFERENCES public.products(id);
ALTER TABLE public.finished_products ADD CONSTRAINT piece_design_fkey FOREIGN KEY(design_id) REFERENCES public.designs(id);

CREATE OR REPLACE FUNCTION public.guard_production_descriptor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='finished_products' THEN
  IF EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id) THEN
   IF NOT EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id AND piece_number=NEW.piece_number AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece must match its recorded production specification'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.production_jobs WHERE id=NEW.production_job_id AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece must match its recorded production'; END IF;
 ELSE
  IF (NEW.size,NEW.custom_design) IS DISTINCT FROM(OLD.size,OLD.custom_design) AND NOT(OLD.size IS NULL AND OLD.custom_design IS NULL AND OLD.status='open' AND OLD.created_by=auth.uid() AND NOT EXISTS(SELECT 1 FROM public.production_batch_requests WHERE production_job_id=OLD.id)) THEN RAISE EXCEPTION 'Issued production descriptors are permanent'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.create_mixed_production(p_request uuid,p_source uuid,p_items jsonb,p_specs jsonb,p_assignments jsonb,p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.mixed_production_requests%rowtype;payload_value jsonb;spec jsonb;first_spec jsonb;job_id uuid;n integer:=0;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 IF p_request IS NULL OR jsonb_typeof(p_specs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_specs) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Request and 1–10,000 explicit finished-piece specifications required'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x LEFT JOIN public.inventory_items i ON i.id=(x->>'inventory_item_id')::uuid WHERE i.id IS NULL OR i.thaan_id IS NULL) THEN RAISE EXCEPTION 'Explicit scanned fabric cuts required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'source',p_source,'items',p_items,'specs',p_specs,'assignments',p_assignments,'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.mixed_production_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production retry requires unchanged specifications'; END IF;RETURN saved.production_job_id;END IF;
 IF EXISTS(SELECT 1 FROM public.production_requests WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another production'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 FOR spec IN SELECT value FROM jsonb_array_elements(p_specs) LOOP
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR (spec-ARRAY['product_id','design_id','custom_design','size'])<>'{}' THEN RAISE EXCEPTION 'Only explicit product, design and size specifications accepted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=(spec->>'product_id')::uuid AND active) THEN RAISE EXCEPTION 'Active product required for each piece'; END IF;
  IF nullif(btrim(spec->>'size'),'') IS NULL OR length(btrim(spec->>'size'))>40 THEN RAISE EXCEPTION 'Size required for every piece'; END IF;
  IF (nullif(spec->>'design_id','') IS NULL)=(nullif(btrim(spec->>'custom_design'),'') IS NULL) THEN RAISE EXCEPTION 'Choose a defined design or enter a custom design for each piece'; END IF;
  IF nullif(spec->>'design_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.designs WHERE id=(spec->>'design_id')::uuid AND active) THEN RAISE EXCEPTION 'Active design required'; END IF;
  IF length(btrim(spec->>'custom_design'))>120 THEN RAISE EXCEPTION 'Custom design exceeds 120 characters'; END IF;
 END LOOP;
 first_spec:=p_specs->0;
 job_id:=public.create_production_batch(p_request,(first_spec->>'product_id')::uuid,(first_spec->>'design_id')::uuid,first_spec->>'custom_design',first_spec->>'size',jsonb_array_length(p_specs),p_assignments,p_source,p_items,p_notes,'Production fabric issued for recorded piece specifications');
 FOR spec IN SELECT value FROM jsonb_array_elements(p_specs) LOOP
  n:=n+1;
  INSERT INTO public.production_piece_specs VALUES(job_id,n,(spec->>'product_id')::uuid,(spec->>'design_id')::uuid,nullif(btrim(spec->>'custom_design'),''),btrim(spec->>'size'),auth.uid(),clock_timestamp());
 END LOOP;
 INSERT INTO public.mixed_production_requests VALUES(p_request,job_id,auth.uid(),payload_value,clock_timestamp());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'create_mixed_production','production_jobs',job_id,payload_value,'PRODUCTION:'||p_request::text);
 RETURN job_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_mixed_production(uuid,uuid,jsonb,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_mixed_production(uuid,uuid,jsonb,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.production_specifications(p_job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('piece_number',s.piece_number,'product_id',s.product_id,'product',p.name,'design_id',s.design_id,'design',coalesce(d.name,s.custom_design),'design_code',d.code,'custom_design',s.custom_design,'size',s.size) ORDER BY s.piece_number),'[]') FROM public.production_piece_specs s JOIN public.products p ON p.id=s.product_id LEFT JOIN public.designs d ON d.id=s.design_id WHERE s.production_job_id=p_job;
$$;
REVOKE ALL ON FUNCTION public.production_specifications(uuid) FROM PUBLIC,anon,authenticated;
