BEGIN;

-- A current total across physical Showroom floors only. The hidden general
-- Showroom parent and all Workshop stock are deliberately excluded.
CREATE FUNCTION public.showroom_fabric_available_total() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN
  RAISE EXCEPTION 'Authorized inventory role required' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((
  SELECT sum(public.inventory_balance(i.id,l.id))
  FROM public.inventory_items i
  JOIN public.thaans t ON t.id=i.thaan_id
  JOIN public.locations l ON l.active AND l.kind='showroom_sublocation'
  JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom'
  WHERE t.status='active'
 ),0)::bigint;
END; $$;
REVOKE ALL ON FUNCTION public.showroom_fabric_available_total() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.showroom_fabric_available_total() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
