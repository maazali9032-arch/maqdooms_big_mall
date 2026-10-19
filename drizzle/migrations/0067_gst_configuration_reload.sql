BEGIN;
-- Owner editing reads the last saved version, even when its effective date is earlier.
-- Transaction screens, including an Owner using POS, read only the active version.
CREATE FUNCTION public.owner_gst_configuration() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  SELECT * INTO config FROM public.gst_configuration_versions ORDER BY created_at DESC,id DESC LIMIT 1;
  IF config.id IS NULL THEN RETURN jsonb_build_object('configuration',NULL,'rules','[]'::jsonb); END IF;
  RETURN jsonb_build_object('configuration',to_jsonb(config)-'created_by'-'created_at',
    'rules',coalesce((SELECT jsonb_agg(to_jsonb(r)-'created_at'-'configuration_id' ORDER BY r.category,r.item_ref NULLS FIRST)
      FROM public.gst_tax_rules r WHERE r.configuration_id=config.id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.owner_gst_configuration() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_gst_configuration() TO authenticated;
DO $$
DECLARE original text; revised text;
BEGIN
  original:=pg_get_functiondef('public.gst_transaction_configuration()'::regprocedure);
  revised:=replace(original,$old$IF public.has_role(auth.uid(),'owner') THEN
    SELECT * INTO config FROM public.gst_configuration_versions ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1;
  ELSE config:=public.gst_active_configuration(); END IF;$old$,
    'config:=public.gst_active_configuration();');
  IF revised=original THEN RAISE EXCEPTION 'Expected GST configuration reader not found'; END IF;
  EXECUTE revised;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
