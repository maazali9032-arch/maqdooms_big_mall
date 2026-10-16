BEGIN;

-- A terminal belongs to one Counter account.  Owners intentionally do not have
-- a terminal identity: their activity is already attributable to their account.
CREATE TABLE public.pos_terminals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK (btrim(code) <> '' AND length(btrim(code)) <= 32),
 assigned_user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_bills ADD COLUMN pos_terminal_id uuid REFERENCES public.pos_terminals(id);
CREATE INDEX counter_bills_pos_terminal_idx ON public.counter_bills(pos_terminal_id);
ALTER TABLE public.pos_terminals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_terminals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pos_terminals TO authenticated;
GRANT ALL ON public.pos_terminals TO service_role;
CREATE POLICY pos_terminal_owner_read ON public.pos_terminals FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR assigned_user_id=auth.uid());

-- Give already-created Counter accounts stable identities without guessing a
-- floor.  The first current Counter is POS-1, then POS-2, etc.; the Owner may
-- edit these labels in Administration.
INSERT INTO public.pos_terminals(code,assigned_user_id)
SELECT 'POS-' || row_number() OVER (ORDER BY p.created_at,p.id), p.id
FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id AND r.role_key='counter'
ON CONFLICT (assigned_user_id) DO NOTHING;

CREATE FUNCTION public.owner_pos_terminals() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'active',t.active,'user_id',p.id,'user_name',p.full_name,'user_active',p.active) ORDER BY t.code)
 FROM public.pos_terminals t JOIN public.profiles p ON p.id=t.assigned_user_id),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.owner_save_pos_terminal(p_user uuid,p_code text,p_active boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_user IS NULL OR nullif(btrim(p_code),'') IS NULL THEN RAISE EXCEPTION 'Counter user and POS code required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id AND r.role_key='counter' WHERE p.id=p_user AND p.active) THEN RAISE EXCEPTION 'Assign a currently active Counter user'; END IF;
 INSERT INTO public.pos_terminals(code,assigned_user_id,active) VALUES(btrim(p_code),p_user,coalesce(p_active,true))
 ON CONFLICT (assigned_user_id) DO UPDATE SET code=excluded.code,active=excluded.active,updated_at=clock_timestamp()
 RETURNING id INTO result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value) VALUES(auth.uid(),'save_pos_terminal','pos_terminals',result,jsonb_build_object('user_id',p_user,'code',btrim(p_code),'active',coalesce(p_active,true)));
 RETURN result;
END; $$;
CREATE FUNCTION public.current_pos_terminal() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.has_role(auth.uid(),'owner') THEN RETURN jsonb_build_object('code',NULL,'owner',true); END IF;
 RETURN (SELECT jsonb_build_object('id',id,'code',code,'owner',false) FROM public.pos_terminals WHERE assigned_user_id=auth.uid() AND active);
END; $$;

-- A payment is an immutable collection event.  Previous single-payment rows
-- remain valid and new bills can collect an advance followed by the balance.
ALTER TABLE public.counter_bill_payments DROP CONSTRAINT counter_bill_payments_pkey;
ALTER TABLE public.counter_bill_payments ADD COLUMN id uuid DEFAULT gen_random_uuid();
UPDATE public.counter_bill_payments SET id=gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.counter_bill_payments ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.counter_bill_payments ADD PRIMARY KEY(id);
CREATE INDEX counter_bill_payments_bill_idx ON public.counter_bill_payments(bill_id);
CREATE OR REPLACE FUNCTION public.record_counter_bill_payment(p_request uuid,p_bill uuid,p_amount_paise bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE total bigint; collected bigint; result uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Counter payment permission required'; END IF;
 IF p_request IS NULL OR p_bill IS NULL OR p_amount_paise IS NULL OR p_amount_paise<=0 THEN RAISE EXCEPTION 'Payment request, bill and a positive amount are required'; END IF;
 SELECT id INTO result FROM public.counter_bill_payments WHERE request_id=p_request;
 IF result IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE id=result AND bill_id=p_bill AND amount_paise=p_amount_paise) THEN RAISE EXCEPTION 'Payment request reused with different data'; END IF;
   RETURN result;
 END IF;
 SELECT final_customer_price_paise INTO total FROM public.orders WHERE id=p_bill AND kind='counter_bill' AND status='completed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed counter bill required'; END IF;
 SELECT coalesce(sum(amount_paise),0) INTO collected FROM public.counter_bill_payments WHERE bill_id=p_bill;
 IF p_amount_paise > total-collected THEN RAISE EXCEPTION 'Advance cannot exceed the bill balance'; END IF;
 INSERT INTO public.counter_bill_payments(id,bill_id,request_id,amount_paise,actor_id) VALUES(gen_random_uuid(),p_bill,p_request,p_amount_paise,auth.uid()) RETURNING id INTO result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'counter_bill_payment','orders',p_bill,jsonb_build_object('amount_paise',p_amount_paise,'balance_paise',total-collected-p_amount_paise),'PAYMENT:'||p_request::text);
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.mark_counter_bill_paid(p_request uuid,p_bill uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE total bigint; collected bigint;
BEGIN
 SELECT final_customer_price_paise INTO total FROM public.orders WHERE id=p_bill AND kind='counter_bill' AND status='completed';
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed counter bill required'; END IF;
 SELECT coalesce(sum(amount_paise),0) INTO collected FROM public.counter_bill_payments WHERE bill_id=p_bill;
 IF collected<total THEN PERFORM public.record_counter_bill_payment(p_request,p_bill,total-collected); END IF;
 RETURN p_bill;
END; $$;

CREATE TABLE public.counter_bill_terminal_records (
 bill_id uuid PRIMARY KEY REFERENCES public.counter_bills(order_id),
 terminal_id uuid REFERENCES public.pos_terminals(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_bill_terminal_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_bill_terminal_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counter_bill_terminal_records TO authenticated;
GRANT ALL ON public.counter_bill_terminal_records TO service_role;
CREATE POLICY counter_bill_terminal_read ON public.counter_bill_terminal_records FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));

CREATE FUNCTION public.complete_counter_bill_with_advance(p_request uuid,p_source uuid,p_items jsonb,p_tailoring jsonb,p_advance_paise bigint,p_salesperson uuid,p_name text DEFAULT NULL,p_contact text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid; terminal uuid;
BEGIN
 IF p_advance_paise IS NULL OR p_advance_paise<0 THEN RAISE EXCEPTION 'Advance must be zero or a positive exact amount'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') THEN
   SELECT id INTO terminal FROM public.pos_terminals WHERE assigned_user_id=auth.uid() AND active;
   IF terminal IS NULL THEN RAISE EXCEPTION 'This Counter account has no active POS terminal code. Ask the Owner to assign one in Administration.'; END IF;
 END IF;
 bill:=public.complete_counter_bill(p_request,p_source,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
 INSERT INTO public.counter_bill_terminal_records(bill_id,terminal_id) VALUES(bill,terminal) ON CONFLICT (bill_id) DO NOTHING;
 IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
 RETURN bill;
END; $$;

CREATE OR REPLACE FUNCTION public.counter_bill(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter billing access required'; END IF;
 SELECT print.document || jsonb_build_object('paid_amount_paise',coalesce(payment.collected,0)::text,'balance_paise',(o.final_customer_price_paise-coalesce(payment.collected,0))::text,'paid',coalesce(payment.collected,0)>=o.final_customer_price_paise,'paid_at',payment.last_paid_at,'pos_code',terminal.code)
 INTO result
 FROM public.counter_bill_print_records print JOIN public.orders o ON o.id=print.bill_id LEFT JOIN public.counter_bill_terminal_records terminal_record ON terminal_record.bill_id=o.id LEFT JOIN public.pos_terminals terminal ON terminal.id=terminal_record.terminal_id
 LEFT JOIN LATERAL(SELECT sum(amount_paise) collected,max(paid_at) last_paid_at FROM public.counter_bill_payments WHERE bill_id=o.id) payment ON true
 WHERE o.code=btrim(p_code) OR o.id::text=btrim(p_code);
 RETURN result;
END; $$;

-- This compact floor tree powers the Showroom-only inventory tab. Workshop and
-- the hidden Showroom parent cannot appear in it.
CREATE FUNCTION public.showroom_floor_distribution() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Authorized inventory role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',floor.id,'code',floor.code,'name',floor.name,'available_mm',coalesce((SELECT sum(public.inventory_balance(i.id,floor.id)) FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id WHERE t.status='active'),0)::text,
 'thaans',coalesce((SELECT count(*) FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id WHERE t.status='active' AND public.inventory_balance(i.id,floor.id)>0),0)) ORDER BY floor.name)
 FROM public.locations floor JOIN public.locations parent ON parent.id=floor.parent_id AND parent.active AND parent.kind='showroom' WHERE floor.active AND floor.kind='showroom_sublocation'),'[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.owner_pos_terminals(),public.owner_save_pos_terminal(uuid,text,boolean),public.current_pos_terminal(),public.record_counter_bill_payment(uuid,uuid,bigint),public.complete_counter_bill_with_advance(uuid,uuid,jsonb,jsonb,bigint,uuid,text,text),public.showroom_floor_distribution() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_pos_terminals(),public.owner_save_pos_terminal(uuid,text,boolean),public.current_pos_terminal(),public.record_counter_bill_payment(uuid,uuid,bigint),public.complete_counter_bill_with_advance(uuid,uuid,jsonb,jsonb,bigint,uuid,text,text),public.showroom_floor_distribution() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
