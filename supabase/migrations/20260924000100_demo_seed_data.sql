
insert into public.suppliers(id,name,phone,city) values
 ('11111111-1111-1111-1111-111111111101','Raymond Mills (DEMO)','+91 98200 11223','Mumbai'),
 ('11111111-1111-1111-1111-111111111102','Siyaram Textiles (DEMO)','+91 98211 44556','Surat'),
 ('11111111-1111-1111-1111-111111111103','Noor Fabrics (DEMO)','+91 99400 77889','Chennai');

insert into public.fabrics(code,name,category,colour,design,width_mm,default_price_paise) values
 ('FB-NAVY-PS','Premium Navy Suiting','Suiting','Navy','Plain',1500,95000),
 ('FB-CHAR-WL','Charcoal Wool Blend','Suiting','Charcoal','Twill',1500,132000),
 ('FB-BEIGE-LN','Beige Linen','Shirting','Beige','Plain',1400,58000),
 ('FB-BLACK-SH','Black Sherwani Brocade','Ethnic','Black','Brocade',1200,245000),
 ('FB-WINE-VL','Wine Velvet','Ethnic','Wine','Solid',1200,180000),
 ('FB-GREY-CH','Grey Checks Trouser','Trouser','Grey','Checks',1500,76000),
 ('FB-WHITE-CT','White Cotton Lining','Lining','White','Plain',1100,22000);

insert into public.materials(name,unit,qty_on_hand,cost_paise,price_paise) values
 ('Canvas Padding','m',42,9000,15000),
 ('Horn Buttons (set)','set',60,12000,20000),
 ('Shoulder Pads','pair',35,7000,12000),
 ('Suit Lining Silk','m',80,18000,28000);

insert into public.receiving_batches(id,code,supplier_id,bill_no,received_on,status,committed_at,notes) values
 ('22222222-2222-2222-2222-222222222201','RB-2601','11111111-1111-1111-1111-111111111101','BL-4471', current_date - 21,'committed', now() - interval '21 days','Winter suiting lot (DEMO)'),
 ('22222222-2222-2222-2222-222222222202','RB-2602','11111111-1111-1111-1111-111111111102','BL-1180', current_date - 9,'committed', now() - interval '9 days','Ethnic + trouser lot (DEMO)'),
 ('22222222-2222-2222-2222-222222222203','RB-2603','11111111-1111-1111-1111-111111111103','BL-9032', current_date,'draft', null,'Open receiving session (DEMO)');

-- committed thaans
insert into public.thaans(barcode, fabric_id, batch_id, original_mm, width_mm, price_paise, rack, status)
select v.barcode, f.id, v.batch, v.len, f.width_mm, v.price, v.rack, 'active'
from (values
 ('TH-0001','FB-NAVY-PS','22222222-2222-2222-2222-222222222201'::uuid,28500,95000,'A-01'),
 ('TH-0002','FB-NAVY-PS','22222222-2222-2222-2222-222222222201'::uuid,30000,95000,'A-01'),
 ('TH-0003','FB-NAVY-PS','22222222-2222-2222-2222-222222222201'::uuid,26000,95000,'A-02'),
 ('TH-0004','FB-CHAR-WL','22222222-2222-2222-2222-222222222201'::uuid,32000,132000,'A-03'),
 ('TH-0005','FB-CHAR-WL','22222222-2222-2222-2222-222222222201'::uuid,29500,132000,'A-03'),
 ('TH-0006','FB-BEIGE-LN','22222222-2222-2222-2222-222222222201'::uuid,24000,58000,'B-01'),
 ('TH-0007','FB-BEIGE-LN','22222222-2222-2222-2222-222222222201'::uuid,25500,58000,'B-01'),
 ('TH-0008','FB-WHITE-CT','22222222-2222-2222-2222-222222222201'::uuid,40000,22000,'B-04'),
 ('TH-0009','FB-BLACK-SH','22222222-2222-2222-2222-222222222202'::uuid,18000,245000,'C-01'),
 ('TH-0010','FB-WINE-VL','22222222-2222-2222-2222-222222222202'::uuid,16500,180000,'C-02'),
 ('TH-0011','FB-GREY-CH','22222222-2222-2222-2222-222222222202'::uuid,31000,76000,'D-01'),
 ('TH-0012','FB-GREY-CH','22222222-2222-2222-2222-222222222202'::uuid,28000,76000,'D-01'),
 ('TH-0013','FB-NAVY-PS','22222222-2222-2222-2222-222222222202'::uuid,27000,95000,'A-02'),
 ('TH-0014','FB-CHAR-WL','22222222-2222-2222-2222-222222222202'::uuid,30500,132000,'A-04')
) as v(barcode, fcode, batch, len, price, rack)
join public.fabrics f on f.code = v.fcode;

-- draft (open receiving session) thaans, some incomplete
insert into public.thaans(barcode, fabric_id, batch_id, original_mm, width_mm, price_paise, rack, status)
select v.barcode, f.id, '22222222-2222-2222-2222-222222222203'::uuid, v.len, f.width_mm, v.price, 'E-01','draft'
from (values
 ('TH-0015','FB-BEIGE-LN',26000,58000),
 ('TH-0016','FB-BEIGE-LN',null::int,58000),
 ('TH-0017','FB-WINE-VL',15000,null::int)
) as v(barcode, fcode, len, price)
join public.fabrics f on f.code = v.fcode;

insert into public.thaan_costs(thaan_id, cost_paise)
select id, round(price_paise * 0.62)::int from public.thaans where price_paise is not null;

-- INWARD ledger for committed thaans
insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reference, cost_snapshot_paise, price_snapshot_paise, created_at)
select t.id,'INWARD',t.original_mm,'receiving',b.code,c.cost_paise,t.price_paise, b.committed_at
from public.thaans t join public.receiving_batches b on b.id=t.batch_id
left join public.thaan_costs c on c.thaan_id=t.id
where t.status='active';

insert into public.customers(id,name,phone,notes) values
 ('33333333-3333-3333-3333-333333333301','Imran Qureshi','+91 90000 10001','Regular suiting customer (DEMO)'),
 ('33333333-3333-3333-3333-333333333302','Abdul Rahman','+91 90000 10002','Wedding sherwani (DEMO)'),
 ('33333333-3333-3333-3333-333333333303','Sana Begum','+91 90000 10003','DEMO'),
 ('33333333-3333-3333-3333-333333333304','Vikram Shetty','+91 90000 10004','DEMO');

-- demo sales with ledger entries
do $$
declare r record; v_sale uuid; v_bill text; v_amt int; i int := 0;
begin
  for r in
    select * from (values
      ('TH-0001', 5000, '33333333-3333-3333-3333-333333333301'::uuid, 3),
      ('TH-0002', 3250, '33333333-3333-3333-3333-333333333303'::uuid, 2),
      ('TH-0004', 7000, '33333333-3333-3333-3333-333333333304'::uuid, 1),
      ('TH-0006', 4500, null::uuid, 1),
      ('TH-0011', 12500,'33333333-3333-3333-3333-333333333301'::uuid, 0),
      ('TH-0003', 26000,'33333333-3333-3333-3333-333333333302'::uuid, 5)
    ) as s(barcode, len, cust, days_ago)
  loop
    i := i + 1;
    select id, price_paise into strict v_sale, v_amt from public.thaans where barcode = r.barcode;
    v_amt := round(r.len::numeric/1000 * v_amt)::int;
    v_bill := 'INV-DEMO-' || lpad(i::text,4,'0');
    insert into public.sales(bill_no, customer_id, total_paise, created_at)
      values (v_bill, r.cust, v_amt, now() - make_interval(days => r.days_ago)) returning id into v_sale;
    insert into public.sale_items(sale_id, thaan_id, length_mm, price_paise_per_m, amount_paise)
      select v_sale, t.id, r.len, t.price_paise, v_amt from public.thaans t where t.barcode = r.barcode;
    insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reference, sale_id, cost_snapshot_paise, price_snapshot_paise, created_at)
      select t.id,'SALE',-r.len,'sale',v_bill,v_sale,c.cost_paise,t.price_paise, now() - make_interval(days => r.days_ago)
      from public.thaans t left join public.thaan_costs c on c.thaan_id=t.id where t.barcode = r.barcode;
  end loop;
  update public.thaans t set status='depleted'
   where (select coalesce(sum(delta_mm),0) from public.stock_movements m where m.thaan_id=t.id) <= 0 and t.status='active';
end $$;

-- tailoring
insert into public.tailoring_jobs(id,code,garment,tailor_name,customer_id,status,notes) values
 ('44444444-4444-4444-4444-444444444401','TJ-1041','Two-piece Suit','Salim Bhai','33333333-3333-3333-3333-333333333301','in_progress','Demo job'),
 ('44444444-4444-4444-4444-444444444402','TJ-1042','Sherwani','Rafiq','33333333-3333-3333-3333-333333333302','open','Wedding delivery'),
 ('44444444-4444-4444-4444-444444444403','TJ-1043','Trouser','Salim Bhai',null,'ready','Shop stock');

do $$
declare r record; v_cost int; v_price int; v_tid uuid;
begin
  for r in select * from (values
    ('44444444-4444-4444-4444-444444444401'::uuid,'TH-0004',3500,'outer fabric'),
    ('44444444-4444-4444-4444-444444444401'::uuid,'TH-0008',2000,'lining'),
    ('44444444-4444-4444-4444-444444444403'::uuid,'TH-0012',1400,'outer fabric')
  ) as s(job, barcode, len, cat)
  loop
    select t.id, t.price_paise, c.cost_paise into v_tid, v_price, v_cost
      from public.thaans t left join public.thaan_costs c on c.thaan_id=t.id where t.barcode=r.barcode;
    insert into public.tailoring_job_lines(job_id,thaan_id,category,length_mm,cost_snapshot_paise,price_snapshot_paise)
      values (r.job, v_tid, r.cat, r.len, v_cost, v_price);
    insert into public.stock_movements(thaan_id,kind,delta_mm,purpose,reference,job_id,cost_snapshot_paise,price_snapshot_paise,created_at)
      select v_tid,'TAILORING',-r.len,'tailoring',j.code,r.job,v_cost,v_price, now() - interval '2 days'
      from public.tailoring_jobs j where j.id = r.job;
  end loop;
end $$;

insert into public.tailoring_job_lines(job_id, material_id, category, qty, cost_snapshot_paise, price_snapshot_paise)
select '44444444-4444-4444-4444-444444444401', id, 'padding', 1.5, cost_paise, price_paise from public.materials where name='Canvas Padding';

-- adjustments / wastage
insert into public.stock_movements(thaan_id,kind,delta_mm,purpose,reason,created_at)
select id,'WASTAGE',-250,'wastage','Damaged edge found during cutting', now() - interval '4 days' from public.thaans where barcode='TH-0005';
insert into public.stock_movements(thaan_id,kind,delta_mm,purpose,reason,created_at)
select id,'ADJUSTMENT',300,'adjustment','Physical count correction after audit', now() - interval '1 day' from public.thaans where barcode='TH-0007';

-- e-commerce
insert into public.listings(id,title,slug,description,category,collection,tags,price_paise,stock_mode,published) values
 ('55555555-5555-5555-5555-555555555501','Premium Navy Suiting','premium-navy-suiting','Fine wool-blend navy suiting, sold by the metre.','Suiting','Winter 26','{"navy","suiting","wool"}',99000,'linked',true),
 ('55555555-5555-5555-5555-555555555502','Charcoal Wool Blend','charcoal-wool-blend','Structured charcoal twill for formal tailoring.','Suiting','Winter 26','{"charcoal"}',139000,'linked',true),
 ('55555555-5555-5555-5555-555555555503','Designer Black Sherwani','designer-black-sherwani','Single-piece hand-finished sherwani.','Ethnic','Wedding','{"sherwani"}',1850000,'manual',true),
 ('55555555-5555-5555-5555-555555555504','Wine Velvet Jacket','wine-velvet-jacket','Showcase piece — enquire in store.','Ethnic','Wedding','{"velvet"}',null,'untracked',false);

insert into public.listing_thaan_links(listing_id, thaan_id)
select '55555555-5555-5555-5555-555555555501', id from public.thaans where barcode in ('TH-0001','TH-0002','TH-0013');
insert into public.listing_thaan_links(listing_id, thaan_id)
select '55555555-5555-5555-5555-555555555502', id from public.thaans where barcode in ('TH-0004','TH-0005','TH-0014');
insert into public.listing_variants(listing_id,label,qty) values
 ('55555555-5555-5555-5555-555555555503','M',2),('55555555-5555-5555-5555-555555555503','L',1),('55555555-5555-5555-5555-555555555503','XL',0);

insert into public.online_orders(order_no,customer_name,phone,listing_id,length_mm,amount_paise,status) values
 ('ON-2041','Faisal Ahmed','+91 90000 20001','55555555-5555-5555-5555-555555555501',3500,346500,'new'),
 ('ON-2042','Deepa Nair','+91 90000 20002','55555555-5555-5555-5555-555555555502',2500,347500,'picking'),
 ('ON-2043','Zoya Khan','+91 90000 20003','55555555-5555-5555-5555-555555555503',null,1850000,'fulfilled');

insert into public.holds(thaan_id,length_mm,reference,expires_at)
select id, 3500, 'ON-2041', now() + interval '25 minutes' from public.thaans where barcode='TH-0002';

insert into public.whatsapp_templates(key,name,body,trigger_event) values
 ('sale_receipt','Sale receipt','Assalamu alaikum {{customer}}, thank you for shopping at Maqdoom''s Big Mall.\n\nBill: {{bill_no}}\n{{lines}}\nTotal: {{total}}\n\nWe look forward to serving you again.','sale.completed'),
 ('tailoring_ready','Tailoring ready','Dear {{customer}}, your {{garment}} (Job {{job_code}}) is ready for collection at Maqdoom''s Big Mall.','tailoring.ready'),
 ('order_picked','Online order picked','Hello {{customer}}, order {{order_no}} has been picked and is being prepared for dispatch.','order.picked');

insert into public.audit_log(actor_name,action,entity,entity_ref,detail,created_at) values
 ('Demo Owner','commit_receiving_batch','receiving_batch','RB-2601','{"activated":8}',now() - interval '21 days'),
 ('Demo Stock Entry','edit_thaan','thaan','TH-0007','{"field":"price_paise","from":56000,"to":58000}',now() - interval '10 days'),
 ('Demo Counter','cut_thaan','thaan','TH-0001','{"length_mm":5000,"purpose":"sale"}',now() - interval '3 days'),
 ('Demo Counter','cut_thaan','thaan','TH-0004','{"length_mm":7000,"purpose":"sale"}',now() - interval '1 day'),
 ('Demo Owner','adjust_stock','thaan','TH-0007','{"delta_mm":300,"reason":"Physical count correction"}',now() - interval '1 day'),
 ('Demo Owner','access_change','user','stock@demo','{"role":"stock_entry","action":"granted"}',now() - interval '6 days');
