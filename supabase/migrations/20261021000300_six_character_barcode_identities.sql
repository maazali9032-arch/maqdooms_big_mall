-- Six-character identities for new physical labels and document scan aliases only.
-- Historical labels/aliases and every UUID/business relationship are preserved.
CREATE TABLE public.barcode_identity_reservations (
 code text PRIMARY KEY CHECK(code ~ '^[TPFBJC][0-9A-Z]{5}$'),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.barcode_identity_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.barcode_identity_reservations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER barcode_reservation_permanent BEFORE UPDATE OR DELETE ON public.barcode_identity_reservations
 FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
-- Reserve any coincident six-character historical labels; never change them.
INSERT INTO public.barcode_identity_reservations(code)
SELECT DISTINCT code FROM (
 SELECT code FROM public.barcodes UNION ALL SELECT barcode FROM public.thaans
 UNION ALL SELECT code FROM public.stock_registration_variants
 UNION ALL SELECT code FROM public.orders UNION ALL SELECT scan_code FROM public.orders
 UNION ALL SELECT code FROM public.production_jobs UNION ALL SELECT scan_code FROM public.production_jobs
 UNION ALL SELECT code FROM public.customer_tailoring_jobs UNION ALL SELECT scan_code FROM public.customer_tailoring_jobs
) labels WHERE code ~ '^[TPFBJC][0-9A-Z]{5}$';
DO $$ DECLARE prefix text; BEGIN
 FOREACH prefix IN ARRAY ARRAY['T','P','F','B','J','C'] LOOP
  EXECUTE format('CREATE SEQUENCE public.barcode_six_%s MINVALUE 0 MAXVALUE 60466175 START 0 NO CYCLE',lower(prefix));
  EXECUTE format('REVOKE ALL ON SEQUENCE public.barcode_six_%s FROM PUBLIC,anon,authenticated,service_role',lower(prefix));
 END LOOP;
END; $$;
CREATE FUNCTION public.barcode_base36_five(p_number bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE value bigint:=p_number; result text:=''; n integer;
BEGIN
 IF value IS NULL OR value<0 OR value>60466175 THEN RAISE EXCEPTION 'Barcode ordinal outside five-digit base36 range'; END IF;
 FOR n IN 1..5 LOOP result:=substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',(value%36)::integer+1,1)||result;value:=value/36;END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.barcode_base36_five(bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.next_six_barcode(p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ordinal bigint; candidate text;
BEGIN
 IF p_prefix IS NULL OR p_prefix NOT IN('T','P','F','B','J','C') THEN RAISE EXCEPTION 'Unknown barcode type'; END IF;
 LOOP
  BEGIN
   ordinal:=nextval(('public.barcode_six_'||lower(p_prefix))::regclass);
  EXCEPTION WHEN SQLSTATE '2200H' THEN
   RAISE EXCEPTION 'Six-character barcode namespace % exhausted; identifiers cannot wrap or be reused',p_prefix USING ERRCODE='2200H';
  END;
  candidate:=p_prefix||public.barcode_base36_five(ordinal);
  INSERT INTO public.barcode_identity_reservations(code) VALUES(candidate) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN candidate; END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.next_six_barcode(text) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.orders DROP CONSTRAINT orders_scan_code_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_scan_code_check CHECK(scan_code ~ '^(B[0-9A-Z]{5}|BL-[23456789ABCDEFGH]{12})$');
ALTER TABLE public.production_jobs DROP CONSTRAINT production_jobs_scan_code_check;
ALTER TABLE public.production_jobs ADD CONSTRAINT production_jobs_scan_code_check CHECK(scan_code ~ '^(P[0-9A-Z]{5}|PJ-[23456789ABCDEFGH]{12})$');
ALTER TABLE public.customer_tailoring_jobs DROP CONSTRAINT customer_tailoring_jobs_scan_code_check;
ALTER TABLE public.customer_tailoring_jobs ADD CONSTRAINT customer_tailoring_jobs_scan_code_check CHECK(scan_code ~ '^(J[0-9A-Z]{5}|TJ-[23456789ABCDEFGH]{12})$');
CREATE OR REPLACE FUNCTION public.assign_document_scan_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 NEW.scan_code:=public.next_six_barcode(CASE TG_TABLE_NAME WHEN 'orders' THEN 'B' WHEN 'production_jobs' THEN 'P' WHEN 'customer_tailoring_jobs' THEN 'J' END);
 RETURN NEW;
END; $$;
ALTER TABLE public.stock_registration_variants DROP CONSTRAINT stock_registration_variants_code_check;
ALTER TABLE public.stock_registration_variants ADD CONSTRAINT stock_registration_variants_code_check CHECK(code ~ '^(T[0-9A-Z]{5}|[A-Z]{3}-[0-9]+[a-z]+)$');
DO $$ DECLARE original text; updated text; BEGIN
 original:=pg_get_functiondef('public.registration_insert_thans(uuid,jsonb)'::regprocedure);
 updated:=replace(original,'code:=g.code||public.registration_variant_suffix(g.next_ordinal);','code:=public.next_six_barcode(''T'');');
 IF updated=original THEN RAISE EXCEPTION 'Registration allocation insertion point missing'; END IF;
 EXECUTE updated;
END; $$;
-- Legacy internal fabric-group codes remain internal; give each new nonregistered physical roll its own label.
CREATE FUNCTION public.assign_legacy_thaan_six_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent_code text;
BEGIN
 SELECT b.code INTO parent_code FROM public.fabric_stock s JOIN public.barcodes b ON b.id=s.barcode_id WHERE s.id=NEW.fabric_stock_id;
 IF NEW.barcode IS NOT NULL OR parent_code IS NULL OR parent_code !~ '^T[0-9A-Z]{5}$' THEN NEW.barcode:=public.next_six_barcode('T'); END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.assign_legacy_thaan_six_code() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER assign_legacy_thaan_six_code BEFORE INSERT ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.assign_legacy_thaan_six_code();

CREATE FUNCTION public.new_typed_finished_barcode(p_prefix text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result uuid;
BEGIN
 IF p_prefix IS NULL OR p_prefix NOT IN('F','C') THEN RAISE EXCEPTION 'Finished barcode type required'; END IF;
 INSERT INTO public.barcodes(code,kind,created_by) VALUES(p_prefix,'product',auth.uid()) RETURNING id INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.new_typed_finished_barcode(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.new_finished_piece_barcode() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.new_typed_finished_barcode('F'); END; $$;
DO $$ DECLARE original text; updated text; BEGIN
 original:=pg_get_functiondef('public.receive_customer_tailoring_finished_item(uuid,uuid,text,text,bigint)'::regprocedure);
 updated:=replace(original,'barcode := public.new_finished_piece_barcode();','barcode := public.new_typed_finished_barcode(''C'');');
 IF updated=original THEN RAISE EXCEPTION 'Customer garment allocation insertion point missing'; END IF;
 EXECUTE updated;
END; $$;
CREATE FUNCTION public.enforce_product_six_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind='product' THEN NEW.code:=public.next_six_barcode(CASE WHEN NEW.code='C' THEN 'C' ELSE 'F' END); END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_product_six_code() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enforce_product_six_code BEFORE INSERT ON public.barcodes FOR EACH ROW EXECUTE FUNCTION public.enforce_product_six_code();
CREATE FUNCTION public.preserve_physical_label_code() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (to_jsonb(NEW)->TG_ARGV[0]) IS DISTINCT FROM (to_jsonb(OLD)->TG_ARGV[0]) THEN RAISE EXCEPTION 'Barcode identity is permanent'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.preserve_physical_label_code() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_barcode_code BEFORE UPDATE ON public.barcodes FOR EACH ROW EXECUTE FUNCTION public.preserve_physical_label_code('code');
CREATE TRIGGER preserve_variant_code BEFORE UPDATE ON public.stock_registration_variants FOR EACH ROW EXECUTE FUNCTION public.preserve_physical_label_code('code');
CREATE TRIGGER preserve_thaan_barcode BEFORE UPDATE ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.preserve_physical_label_code('barcode');

-- Resolve document aliases at the existing Owner-only inspector boundary; preserve input in the result.
DO $$ DECLARE original text; updated text; BEGIN
 original:=pg_get_functiondef('public.owner_barcode_inspect(text,timestamptz,text,integer)'::regprocedure);
 updated:=replace(original,'WHERE code=btrim(p_barcode) OR id::text=btrim(p_barcode)','WHERE code=public.resolve_document_scan_code(btrim(p_barcode)) OR id::text=btrim(p_barcode)');
 updated:=replace(updated, ' ), selected_thaans AS MATERIALIZED (',
 ' UNION ALL SELECT ''customer_job'',id FROM public.customer_tailoring_jobs WHERE code=public.resolve_document_scan_code(btrim(p_barcode)) OR id::text=btrim(p_barcode)
   UNION ALL SELECT ''customer_piece'',c.id FROM public.customer_tailoring_finished_items c JOIN public.barcodes b ON b.id=c.barcode_id WHERE b.code=btrim(p_barcode)
 ), selected_thaans AS MATERIALIZED (');
 updated:=replace(updated,'WHERE j.id IN(SELECT o.customer_tailoring_job_id', 'WHERE j.id IN(SELECT id FROM root WHERE kind=''customer_job'' UNION SELECT job_id FROM public.customer_tailoring_finished_items WHERE id IN(SELECT id FROM root WHERE kind=''customer_piece'') UNION SELECT o.customer_tailoring_job_id');
 updated:=replace(updated, ' )'||chr(10)||' SELECT jsonb_build_object(''barcode'',btrim(p_barcode)',
 ' UNION ALL SELECT jsonb_build_object(''kind'',''customer_finished_garment'',''id'',c.id,''name'',c.name,''barcode'',b.code,''size'',c.size,''latest_sp_paise'',c.sp_paise::text,''status'',c.status,''job_id'',c.job_id) FROM public.customer_tailoring_finished_items c JOIN public.barcodes b ON b.id=c.barcode_id WHERE c.id IN(SELECT id FROM root WHERE kind=''customer_piece'')'||chr(10)||' )'||chr(10)||' SELECT jsonb_build_object(''barcode'',btrim(p_barcode)');
 updated:=replace(updated,' ), evidence AS MATERIALIZED (',' UNION ALL SELECT ''customer_tailoring_finished_items:''||c.id,''customer_tailoring_finished_items'',c.id,c.created_at,c.created_by,''Customer garment received'',to_jsonb(c) FROM public.customer_tailoring_finished_items c WHERE c.job_id IN(SELECT id FROM selected_custom_jobs)'||chr(10)||' ), evidence AS MATERIALIZED (');
 IF updated NOT LIKE '%customer_finished_garment%' OR updated NOT LIKE '%customer_piece%' OR updated NOT LIKE '%resolve_document_scan_code%' THEN RAISE EXCEPTION 'Owner inspector extension insertion point missing'; END IF;
 EXECUTE updated;
END; $$;

-- Permanent logical-record map, kept independently of cancellable/deletable business rows.
CREATE TABLE public.barcode_identity_bindings (
 code text PRIMARY KEY REFERENCES public.barcode_identity_reservations(code),
 record_table text NOT NULL, record_id uuid NOT NULL,
 bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.barcode_identity_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.barcode_identity_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER barcode_binding_permanent BEFORE UPDATE OR DELETE ON public.barcode_identity_bindings FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE FUNCTION public.bind_six_barcode_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE code_value text; target_table text:=TG_TABLE_NAME; target_id uuid:=NEW.id;
BEGIN
 IF TG_TABLE_NAME='stock_registration_variants' THEN code_value:=NEW.code;target_table:='thaans';target_id:=NEW.thaan_id;
 ELSIF TG_TABLE_NAME='thaans' THEN code_value:=NEW.barcode;
 ELSIF TG_TABLE_NAME='barcodes' THEN IF NEW.kind<>'product' THEN RETURN NEW; END IF;code_value:=NEW.code;
 ELSE code_value:=NEW.scan_code;
 END IF;
 IF code_value IS NULL OR code_value !~ '^[TPFBJC][0-9A-Z]{5}$' THEN RETURN NEW; END IF;
 INSERT INTO public.barcode_identity_bindings(code,record_table,record_id) VALUES(code_value,target_table,target_id) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.barcode_identity_bindings b WHERE b.code=code_value AND b.record_table=target_table AND b.record_id=target_id) THEN RAISE EXCEPTION 'Barcode identity cannot be reused'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.bind_six_barcode_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bind_six_order AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();
CREATE TRIGGER bind_six_production AFTER INSERT ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();
CREATE TRIGGER bind_six_customer_job AFTER INSERT ON public.customer_tailoring_jobs FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();
CREATE TRIGGER bind_six_product AFTER INSERT ON public.barcodes FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();
CREATE TRIGGER bind_six_variant AFTER INSERT ON public.stock_registration_variants FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();
CREATE TRIGGER bind_six_legacy_thaan AFTER INSERT ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.bind_six_barcode_identity();

NOTIFY pgrst,'reload schema';
