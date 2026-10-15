-- General Showroom remains only as the internal parent and historical identity.
-- Operational choices and new ledger entries must identify a physical floor.
CREATE OR REPLACE FUNCTION public.inventory_locations()
RETURNS TABLE(id uuid,code text,name text,kind text,parent_id uuid,active boolean)
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT l.id,l.code,l.name,l.kind,l.parent_id,
  l.active AND (l.kind<>'showroom_sublocation' OR EXISTS(
   SELECT 1 FROM public.locations parent WHERE parent.id=l.parent_id AND parent.kind='showroom' AND parent.active
  ))
 FROM public.locations l
 WHERE l.kind<>'showroom' AND public.definition_available('floor',l.id)
 ORDER BY l.kind,l.name;
$$;

CREATE OR REPLACE FUNCTION public.owner_location_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object(
  'fabric_thaans',(SELECT count(*) FROM public.inventory_items i WHERE i.thaan_id IS NOT NULL AND public.inventory_balance(i.id,l.id)>0),
  'fabric_mm',(SELECT coalesce(sum(public.inventory_balance(i.id,l.id)),0)::text FROM public.inventory_items i WHERE i.thaan_id IS NOT NULL),
  'finished_pieces',(SELECT coalesce(sum(public.inventory_balance(i.id,l.id)),0)::text FROM public.inventory_items i WHERE i.finished_product_id IS NOT NULL)
 ) ORDER BY CASE l.kind WHEN 'showroom_sublocation' THEN 0 ELSE 1 END,l.name,l.id)
 FROM public.locations l WHERE l.kind<>'showroom' AND public.definition_available('floor',l.id)),'[]');
END; $$;

CREATE FUNCTION public.guard_showroom_floor_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.locations WHERE kind='showroom' AND id IN(NEW.source_location_id,NEW.destination_location_id)) THEN
  RAISE EXCEPTION 'General Showroom is unavailable; select a defined Showroom floor' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_showroom_floor_movement() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inventory_movement_showroom_floor_guard BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_showroom_floor_movement();

-- Returning a finished piece goes directly from its floor to Workshop now that
-- general Showroom is no longer an operational stop. Existing role checks stay.
CREATE OR REPLACE FUNCTION public.guard_finished_product_transfer_path() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE source public.locations%rowtype; destination public.locations%rowtype; piece public.finished_products%rowtype;
BEGIN
 IF NEW.kind<>'TRANSFER' OR NEW.finished_product_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO source FROM public.locations WHERE id=NEW.source_location_id;
 SELECT * INTO destination FROM public.locations WHERE id=NEW.destination_location_id;
 IF NOT source.active OR NOT destination.active OR NOT (
  (source.kind='workshop' AND destination.kind='showroom_sublocation' AND EXISTS(SELECT 1 FROM public.locations parent WHERE parent.id=destination.parent_id AND parent.kind='showroom' AND parent.active)) OR
  (source.kind='showroom_sublocation' AND destination.kind='workshop' AND EXISTS(SELECT 1 FROM public.locations parent WHERE parent.id=source.parent_id AND parent.kind='showroom' AND parent.active))
 ) THEN RAISE EXCEPTION 'Finished Product transfer requires Workshop and an active Showroom floor'; END IF;
 SELECT * INTO piece FROM public.finished_products WHERE id=NEW.finished_product_id;
 IF piece.id IS NULL OR piece.status<>'available' OR piece.current_location_id IS DISTINCT FROM NEW.source_location_id OR NEW.quantity<>1 OR NEW.unit<>'pc' THEN RAISE EXCEPTION 'Available whole Finished Product at the selected source required'; END IF;
 RETURN NEW;
END; $$;

NOTIFY pgrst,'reload schema';
