BEGIN;
-- Owner definitions are shared by every work picker. Existing assignments stay historical.
CREATE TABLE public.factory_user_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.profiles(id), payload jsonb NOT NULL,
 result_id uuid NOT NULL REFERENCES public.tailor_assignments(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.factory_user_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.factory_user_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.factory_user_requests TO authenticated;
GRANT ALL ON public.factory_user_requests TO service_role;
CREATE POLICY factory_user_owner_read ON public.factory_user_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER factory_user_requests_immutable BEFORE UPDATE OR DELETE ON public.factory_user_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.owner_factory_users() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'roles',(SELECT jsonb_agg(role_key ORDER BY role_key) FROM public.user_roles WHERE user_id=p.id)) ORDER BY p.full_name,p.id) FROM public.profiles p WHERE p.active),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.owner_factory_users() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_factory_users() TO authenticated;

CREATE FUNCTION public.owner_assign_factory_user(p_request uuid,p_user uuid,p_factory uuid,p_expected uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.factory_user_requests%rowtype; payload_value jsonb;person public.profiles%rowtype;business_tailor public.tailors%rowtype;result uuid;added_role boolean;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_user IS NULL OR p_factory IS NULL THEN RAISE EXCEPTION 'Request, existing user and factory required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'user',p_user,'factory',p_factory,'expected',p_expected);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,48));
 SELECT * INTO saved FROM public.factory_user_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Retry requires unchanged factory and user'; END IF; RETURN saved.result_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 SELECT * INTO person FROM public.profiles WHERE id=p_user AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active existing user required'; END IF;
 PERFORM 1 FROM public.tailoring_factories WHERE id=p_factory AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active factory required'; END IF;
 added_role:=NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role_key='tailor');
 INSERT INTO public.user_roles(user_id,role_key) VALUES(p_user,'tailor') ON CONFLICT DO NOTHING;
 IF added_role THEN INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'factory_tailor_role_added','profiles',p_user,jsonb_build_object('role','tailor'),'FACTORY:'||p_request); END IF;
 SELECT * INTO business_tailor FROM public.tailors WHERE profile_id=p_user ORDER BY id LIMIT 1 FOR UPDATE;
 IF business_tailor.id IS NULL THEN
  business_tailor.id:=public.manage_tailoring_entity(gen_random_uuid(),'tailor',NULL,'USR-'||p_user::text,person.full_name,true,NULL,p_user,'Owner added existing user as factory Tailor');
 ELSIF NOT business_tailor.active THEN
  PERFORM public.manage_tailoring_entity(gen_random_uuid(),'tailor',business_tailor.id,business_tailor.code,person.full_name,true,NULL,p_user,'Owner reactivated factory Tailor');
 END IF;
 result:=public.assign_tailor(gen_random_uuid(),business_tailor.id,p_factory,NULL,p_expected,'Owner assigned existing user to factory');
 INSERT INTO public.factory_user_requests(request_id,actor_id,payload,result_id) VALUES(p_request,auth.uid(),payload_value,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.owner_assign_factory_user(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_assign_factory_user(uuid,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.workshop_receipt_queue() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') THEN RAISE EXCEPTION 'Workshop receipt permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'quantity',j.quantity,'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed')) ORDER BY j.created_at,j.id) FROM public.production_jobs j WHERE j.status='completed' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id)),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.workshop_receipt_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_receipt_queue() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
