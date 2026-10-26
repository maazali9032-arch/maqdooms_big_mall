-- Owner-managed material categories keep the stock-entry unit consistent.
CREATE TABLE public.material_category_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE CHECK(btrim(name)<>''),
  measurement_unit text NOT NULL CHECK(btrim(measurement_unit)<>''),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.material_category_definitions(code,name,measurement_unit,created_by) VALUES
  ('buttons','Buttons','pc',NULL),
  ('thread','Thread','spool',NULL),
  ('padding','Shoulder pads / padding','pc',NULL),
  ('other','Fusing / other','m',NULL)
ON CONFLICT (code) DO NOTHING;

-- Categories are now owner-defined rather than limited to the legacy four values.
ALTER TABLE public.materials DROP CONSTRAINT IF EXISTS materials_category_check;
ALTER TABLE public.material_batches ADD COLUMN IF NOT EXISTS arrival_date date;
UPDATE public.material_batches SET arrival_date=received_at::date WHERE arrival_date IS NULL;
ALTER TABLE public.material_batches ALTER COLUMN arrival_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.material_batches ALTER COLUMN arrival_date SET NOT NULL;

ALTER TABLE public.material_category_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.material_category_definitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.material_category_definitions TO authenticated;
GRANT ALL ON public.material_category_definitions TO service_role;
CREATE POLICY material_categories_read ON public.material_category_definitions
  FOR SELECT TO authenticated
  USING(public.has_any_role(auth.uid(), ARRAY['owner','stock_entry']));

CREATE FUNCTION public.material_category_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','stock_entry']) THEN
    RAISE EXCEPTION 'Material category access required';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'code', code, 'name', name, 'measurement_unit', measurement_unit
    ) ORDER BY name)
    FROM public.material_category_definitions
    WHERE active
  ), '[]'::jsonb);
END; $$;

CREATE FUNCTION public.owner_material_category_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'code', code, 'name', name, 'measurement_unit', measurement_unit, 'active', active
    ) ORDER BY name)
    FROM public.material_category_definitions
  ), '[]'::jsonb);
END; $$;

CREATE FUNCTION public.owner_save_material_category(
  p_id uuid, p_name text, p_measurement_unit text, p_active boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; generated_code text;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF nullif(btrim(p_name),'') IS NULL OR nullif(btrim(p_measurement_unit),'') IS NULL THEN
    RAISE EXCEPTION 'Category name and measurement unit are required';
  END IF;
  IF p_id IS NULL THEN
    generated_code:=trim(both '_' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '_', 'g'));
    IF generated_code='' THEN RAISE EXCEPTION 'Category name needs letters or numbers'; END IF;
    IF EXISTS(SELECT 1 FROM public.material_category_definitions WHERE code=generated_code) THEN
      RAISE EXCEPTION 'A category with that name already exists';
    END IF;
    INSERT INTO public.material_category_definitions(code,name,measurement_unit,active,created_by)
    VALUES(generated_code,btrim(p_name),btrim(p_measurement_unit),coalesce(p_active,true),auth.uid())
    RETURNING id INTO result;
  ELSE
    UPDATE public.material_category_definitions
    SET name=btrim(p_name), measurement_unit=btrim(p_measurement_unit), active=coalesce(p_active,true), updated_at=clock_timestamp()
    WHERE id=p_id
    RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Material category not found'; END IF;
  END IF;
  RETURN result;
END; $$;

CREATE FUNCTION public.owner_delete_material_category(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE category_code text;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  SELECT code INTO category_code FROM public.material_category_definitions WHERE id=p_id FOR UPDATE;
  IF category_code IS NULL THEN RAISE EXCEPTION 'Material category not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.materials WHERE category=category_code) THEN
    RAISE EXCEPTION 'This category is already used by material stock and cannot be deleted';
  END IF;
  DELETE FROM public.material_category_definitions WHERE id=p_id;
END; $$;

-- Arrival date is part of the purchase snapshot while retaining the existing RPC signature.
CREATE OR REPLACE FUNCTION public.receive_material_unit_batch_with_purchase(
  p_request uuid,p_supplier text,p_reference text,p_shared_expense_paise bigint,p_lines jsonb,p_purchase jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; saved public.material_batches%rowtype; unit_count integer; base_share bigint; remainder bigint; arrival date;
BEGIN
  arrival:=coalesce(nullif(p_purchase->>'arrival_date','')::date,CURRENT_DATE);
  SELECT * INTO saved FROM public.material_batches WHERE request_id=p_request FOR UPDATE;
  IF FOUND THEN
    IF saved.arrival_date IS DISTINCT FROM arrival THEN RAISE EXCEPTION 'Retry requires the unchanged material batch'; END IF;
    RETURN saved.id;
  END IF;
  result:=public.receive_material_unit_batch(p_request,p_supplier,p_reference,p_shared_expense_paise,p_lines);
  UPDATE public.material_batches SET arrival_date=arrival WHERE id=result;
  SELECT count(*) INTO unit_count FROM public.material_units WHERE batch_id=result;
  IF unit_count<=0 THEN RAISE EXCEPTION 'Material batch has no physical units'; END IF;
  base_share:=p_shared_expense_paise/unit_count; remainder:=p_shared_expense_paise%unit_count;
  WITH ranked AS (
    SELECT id,row_number() OVER(ORDER BY material_id,ordinal,id) AS position FROM public.material_units WHERE batch_id=result
  )
  UPDATE public.material_units u SET
    allocated_expense_paise=base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END,
    landed_cost_paise=u.net_purchase_paise+u.nonrecoverable_gst_paise+u.direct_cost_paise+base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END,
    cp_per_quantity_paise=(u.net_purchase_paise+u.nonrecoverable_gst_paise+u.direct_cost_paise+base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END)::numeric/u.initial_quantity
  FROM ranked r WHERE u.id=r.id;
  PERFORM public.record_required_stock_purchase(NULL,NULL,result,p_supplier,p_purchase);
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.material_category_catalog(), public.owner_material_category_catalog(), public.owner_save_material_category(uuid,text,text,boolean), public.owner_delete_material_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.material_category_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_material_category_catalog(), public.owner_save_material_category(uuid,text,text,boolean), public.owner_delete_material_category(uuid) TO authenticated;
