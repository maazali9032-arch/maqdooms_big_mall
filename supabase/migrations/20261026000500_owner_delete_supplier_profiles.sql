BEGIN;

CREATE OR REPLACE FUNCTION public.owner_delete_supplier_profile(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  previous jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  SELECT to_jsonb(s) INTO previous
  FROM public.suppliers s
  WHERE s.id = p_id
  FOR UPDATE;

  IF previous IS NULL THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.receiving_batches b WHERE b.supplier_id = p_id) THEN
    RAISE EXCEPTION 'This supplier is linked to existing fabric batches and cannot be deleted';
  END IF;

  DELETE FROM public.suppliers WHERE id = p_id;

  INSERT INTO public.erp_audit_records(
    actor_id, action, entity_table, entity_id, previous_value, new_value, reference
  ) VALUES (
    auth.uid(), 'delete_supplier_profile', 'suppliers', p_id, previous, NULL,
    'SUPPLIER:' || p_id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.owner_delete_supplier_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_delete_supplier_profile(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
