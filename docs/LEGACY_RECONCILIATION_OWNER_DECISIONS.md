# Legacy reconciliation — complete 26-record review

Analysis completed before database changes. One objectively resolved current-stock location issue; 25 Owner decisions remain. No historical physical location, quantity, cost, price or assignment is inferred.

## All records and required decisions

### Wine Velvet / RB-2603 / TH-0017 — owner_input_required

- Reconciliation ID: `799885f3-f620-4bfa-b2f3-658cb8a10946`
- Record: `fabric_stock` / `a1919ba4-31d9-4091-b249-c6545a82ffaf`
- Issue: `cp_requires_reconciliation`
- Evidence: {"fabric_stock_id":"a1919ba4-31d9-4091-b249-c6545a82ffaf","fabric_name":"Wine Velvet","batch_code":"RB-2603","thaans":[{"id":"989fd388-42fd-4e9d-929e-e76b8e8f3148","barcode":"TH-0017","status":"draft","legacy_cp_present":false,"sp_present":false}],"batch_specific_cost_evidence":false}
- Owner decision: Provide documented CP per metre for Wine Velvet / RB-2603 / TH-0017 (fabric_stock a1919ba4-31d9-4091-b249-c6545a82ffaf). A different batch CP, SP, old demo formula, or zero is not evidence for this batch. SP remains optional at receiving.

### TJ-1041 — owner_input_required

- Reconciliation ID: `f712c9a9-4d88-4edd-ab2c-3f457e3f6b50`
- Record: `tailoring_jobs` / `44444444-4444-4444-4444-444444444401`
- Issue: `job_domain_and_assignment_unverified`
- Evidence: {"code":"TJ-1041","garment":"Two-piece Suit","status":"in_progress","customer_id":"33333333-3333-3333-3333-333333333301","legacy_tailor_profile_id":"c4745497-db11-4b3f-9c05-93538d623f0c","legacy_tailor_active":true,"notes":"Demo job","domain_evidence":"Customer Tailoring customer link is established","issued_lines":[{"id":"6f002475-9399-4bbf-9425-21927b6ca6b5","thaan_id":null,"material_id":"000c3b67-1b95-4b22-bd46-8878f71f3c17","length_mm":null,"qty":"1.5"},{"id":"70fa7f0a-86a6-4d5b-a7c2-5fce9dd275af","thaan_id":"fd27265b-755c-4672-a353-180332c8b863","material_id":null,"length_mm":3500,"qty":null},{"id":"dd165b61-cf7d-4919-884c-1d78b4a86734","thaan_id":"eaf4197f-c4fd-4109-a8af-dbac9a4cb6ba","material_id":null,"length_mm":2000,"qty":null}],"factory_assignment_evidence":false}
- Owner decision: Customer Tailoring is already identified. Supply verified factory, optional section and real business Tailor/current and historical assignment context; applicable historical charge/bill evidence or explicit preserve-as-legacy disposition. Do not reprice or issue already-consumed material again.

### TJ-1042 — owner_input_required

- Reconciliation ID: `296895ff-5e76-4149-af5b-978f2657ef15`
- Record: `tailoring_jobs` / `44444444-4444-4444-4444-444444444402`
- Issue: `job_domain_and_assignment_unverified`
- Evidence: {"code":"TJ-1042","garment":"Sherwani","status":"open","customer_id":"33333333-3333-3333-3333-333333333302","legacy_tailor_profile_id":null,"legacy_tailor_active":null,"notes":"Wedding delivery","domain_evidence":"Customer Tailoring customer link is established","issued_lines":[],"factory_assignment_evidence":false}
- Owner decision: Customer Tailoring is already identified. Supply verified factory, optional section and real business Tailor/current and historical assignment context; applicable historical charge/bill evidence or explicit preserve-as-legacy disposition. Do not reprice or issue already-consumed material again.

### TJ-1043 — owner_input_required

- Reconciliation ID: `920e2d5d-7402-4a47-8a7d-ea385564fadd`
- Record: `tailoring_jobs` / `44444444-4444-4444-4444-444444444403`
- Issue: `job_domain_and_assignment_unverified`
- Evidence: {"code":"TJ-1043","garment":"Trouser","status":"ready","customer_id":null,"legacy_tailor_profile_id":"4fb63ae1-9d6d-4d33-99c1-13775f86e577","legacy_tailor_active":true,"notes":"Shop stock","domain_evidence":"Shop-stock production intent is indicated; full production genealogy absent","issued_lines":[{"id":"d40be65e-6a4d-4f22-ab51-1e086e364c64","thaan_id":"0934b643-0dbd-4a57-a566-8105c8b6a4c7","material_id":null,"length_mm":1400,"qty":null}],"factory_assignment_evidence":false}
- Owner decision: Confirm job domain (Owner Production/internal stock or Customer Tailoring with the correct customer). Supply verified factory, optional section and real business Tailor assignment; for production, actual product/design/quantity or preserve-as-legacy disposition. Historical material issues must not be duplicated.

### TJ-EB397165 — owner_input_required

- Reconciliation ID: `b1329075-d13c-4d7c-a54a-869325c94197`
- Record: `tailoring_jobs` / `eb397165-f46b-4f97-85a9-480530280ea2`
- Issue: `job_domain_and_assignment_unverified`
- Evidence: {"code":"TJ-EB397165","garment":"Two-piece Suit","status":"open","customer_id":null,"legacy_tailor_profile_id":"c4745497-db11-4b3f-9c05-93538d623f0c","legacy_tailor_active":true,"notes":null,"domain_evidence":"No customer or unambiguous domain evidence","issued_lines":[{"id":"4284a199-6062-439b-a38e-4c27abdfc9d6","thaan_id":"f2ef011e-a4fc-4d05-978c-4a68c35fee30","material_id":null,"length_mm":1000,"qty":null},{"id":"9791bc11-397a-4eae-a825-7461c273d7d1","thaan_id":"02d9bec3-eaaa-46d6-97c8-31f33573f828","material_id":null,"length_mm":3000,"qty":null},{"id":"a6555d61-0940-4885-b4f0-aa1fe3249d25","thaan_id":"eaf4197f-c4fd-4109-a8af-dbac9a4cb6ba","material_id":null,"length_mm":2000,"qty":null}],"factory_assignment_evidence":false}
- Owner decision: Confirm job domain (Owner Production/internal stock or Customer Tailoring with the correct customer). Supply verified factory, optional section and real business Tailor assignment; for production, actual product/design/quantity or preserve-as-legacy disposition. Historical material issues must not be duplicated.

### TH-0006 — owner_input_required

- Reconciliation ID: `0648622a-bab6-407d-9b33-e5f811dcd651`
- Record: `thaans` / `02d9bec3-eaaa-46d6-97c8-31f33573f828`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0006","legacy_rack":"B-01","status":"active","batch_code":"RB-2601","fabric_stock_id":"a2a9688d-a3e1-4c5a-b59c-b61c70aeb7dd","original_mm":24000,"recognized_ledger_mm":16500,"movement_ids":["d254ae00-4e62-4574-ad0f-8dbe7000f941","feacc518-bcd9-4c76-98eb-f0c01b363380","e6df33e6-9349-45d0-8d06-bd507799fbc1"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 16500 mm. Rack B-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0012 — owner_input_required

- Reconciliation ID: `a35612e8-dac7-4998-928a-b25cadba4233`
- Record: `thaans` / `0934b643-0dbd-4a57-a566-8105c8b6a4c7`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0012","legacy_rack":"D-01","status":"active","batch_code":"RB-2602","fabric_stock_id":"308de661-0ad4-439a-bef4-0016567ab012","original_mm":28000,"recognized_ledger_mm":26600,"movement_ids":["1a3d2ccc-d005-4f96-bba6-7cc5ca99f689","eed1457c-dd64-4b51-84fc-6526fb7a3e95"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 26600 mm. Rack D-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0014 — owner_input_required

- Reconciliation ID: `be7ebf85-645b-415b-8d1a-c232c3f65e79`
- Record: `thaans` / `1eaffab4-4aa7-4fa6-a10c-bb54650e66f9`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0014","legacy_rack":"A-04","status":"active","batch_code":"RB-2602","fabric_stock_id":"883b0204-c758-4d29-86b5-6c3cdc90b18c","original_mm":30500,"recognized_ledger_mm":30500,"movement_ids":["21f49e31-9012-4f3d-aec6-a58d6bc65308"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 30500 mm. Rack A-04 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0013 — owner_input_required

- Reconciliation ID: `f4b1b9ac-e897-4201-8942-5af64e07faa7`
- Record: `thaans` / `242d349e-01cd-4d2e-8c69-d534a03fb729`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0013","legacy_rack":"A-02","status":"active","batch_code":"RB-2602","fabric_stock_id":"c7c0feed-e382-41bb-a113-4fb358c2cdad","original_mm":27000,"recognized_ledger_mm":27000,"movement_ids":["d2269a0b-2a83-42cc-bbbc-aa91e391c46b"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 27000 mm. Rack A-02 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0011 — owner_input_required

- Reconciliation ID: `30d6d855-0769-4ffc-bcdb-0cf02ecb8c46`
- Record: `thaans` / `4133c2d2-6d02-49b9-b9a1-83823fe51b2e`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0011","legacy_rack":"D-01","status":"active","batch_code":"RB-2602","fabric_stock_id":"308de661-0ad4-439a-bef4-0016567ab012","original_mm":31000,"recognized_ledger_mm":18500,"movement_ids":["699d61c4-e32d-4391-a88e-54257f0ead23","ed8cddd9-0275-4815-9b4c-ceb83e05319d"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 18500 mm. Rack D-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0001 — owner_input_required

- Reconciliation ID: `02a83998-8015-4001-a580-99c927c591f9`
- Record: `thaans` / `442fe81d-12c2-4bb5-b983-f53e2ad7411d`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0001","legacy_rack":"A-01","status":"active","batch_code":"RB-2601","fabric_stock_id":"9fcd9ec3-44a9-4b75-b1ae-4a10ada2feac","original_mm":28500,"recognized_ledger_mm":23500,"movement_ids":["4b6c389c-63dc-4157-9e39-51d015c52033","a08bee17-7e6b-40e5-a1d3-ff9c880c5820"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 23500 mm. Rack A-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0010 — owner_input_required

- Reconciliation ID: `665f452a-d401-4f97-9a10-b0a3eace9f83`
- Record: `thaans` / `57a2dd59-95fe-4e33-9fc3-134bc7d4816d`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0010","legacy_rack":"C-02","status":"active","batch_code":"RB-2602","fabric_stock_id":"85702a34-cb77-40d3-9c04-6b5bfa00e690","original_mm":16500,"recognized_ledger_mm":16500,"movement_ids":["251e6362-5002-4b8a-b3ed-0142241edbf8"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 16500 mm. Rack C-02 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0017 — owner_input_required

- Reconciliation ID: `876d54e9-153f-4c4c-b085-c44cc5b5f088`
- Record: `thaans` / `989fd388-42fd-4e9d-929e-e76b8e8f3148`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0017","legacy_rack":"E-01","status":"draft","batch_code":"RB-2603","fabric_stock_id":"a1919ba4-31d9-4091-b249-c6545a82ffaf","original_mm":15000,"recognized_ledger_mm":0,"movement_ids":[],"historical_location_known":false}
- Owner decision: Confirm whether this legacy draft receipt is physically received and its actual current location/receipt disposition. No INWARD exists; zero recognized ledger stock does not prove zero physical stock. Do not treat original_mm as an opening balance or assume Workshop retrospectively.

### TH-0016 — owner_input_required

- Reconciliation ID: `0fe57d8a-24da-4063-a002-0ea350864c57`
- Record: `thaans` / `ae30649f-bdce-4aeb-a6ae-02b0f32b46fb`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0016","legacy_rack":"E-01","status":"draft","batch_code":"RB-2603","fabric_stock_id":"747936e2-9465-4291-b15b-2fd43bcf080c","original_mm":26000,"recognized_ledger_mm":0,"movement_ids":[],"historical_location_known":false}
- Owner decision: Confirm whether this legacy draft receipt is physically received and its actual current location/receipt disposition. No INWARD exists; zero recognized ledger stock does not prove zero physical stock. Do not treat original_mm as an opening balance or assume Workshop retrospectively.

### TH-0003 — resolved_no_current_stock

- Reconciliation ID: `5b35b172-0d1a-4ca3-834a-c3f61279b4fe`
- Record: `thaans` / `d7bc14e3-a672-4277-8b88-be1d751b767b`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0003","legacy_rack":"A-02","status":"depleted","batch_code":"RB-2601","fabric_stock_id":"9fcd9ec3-44a9-4b75-b1ae-4a10ada2feac","original_mm":26000,"recognized_ledger_mm":0,"movement_ids":["4ff46a04-cef9-4ce9-94a5-71610c15e144","01d7d557-acb0-4f6d-9c87-6167f43279a7"],"historical_location_known":false,"explanation":"Fully depleted with matched 26000 mm INWARD and SALE. No current positive stock requires a location allocation. Historical location remains unknown; no inventory item or opening movement is created."}
- Resolution: Fully depleted with matched 26000 mm INWARD and SALE. No current positive stock requires a location allocation. Historical location remains unknown; no inventory item or opening movement is created.

### TH-0007 — owner_input_required

- Reconciliation ID: `5b242f9c-800b-4f5c-bfa2-82f1bbf59130`
- Record: `thaans` / `d8ddd5f7-7b1b-4f4f-bcd4-770dfcb4e10e`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0007","legacy_rack":"B-01","status":"active","batch_code":"RB-2601","fabric_stock_id":"a2a9688d-a3e1-4c5a-b59c-b61c70aeb7dd","original_mm":25500,"recognized_ledger_mm":25800,"movement_ids":["a28959db-d709-4d17-a0c1-ec2d9a1f302d","1d3bfff7-8dbe-4e9a-8050-b671cd3979ba"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 25800 mm. Rack B-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0015 — owner_input_required

- Reconciliation ID: `11a8fa66-b681-441d-9783-56df1de4bb67`
- Record: `thaans` / `dae8dfd0-8087-4924-aab8-113670b4cf22`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0015","legacy_rack":"E-01","status":"draft","batch_code":"RB-2603","fabric_stock_id":"747936e2-9465-4291-b15b-2fd43bcf080c","original_mm":26000,"recognized_ledger_mm":0,"movement_ids":[],"historical_location_known":false}
- Owner decision: Confirm whether this legacy draft receipt is physically received and its actual current location/receipt disposition. No INWARD exists; zero recognized ledger stock does not prove zero physical stock. Do not treat original_mm as an opening balance or assume Workshop retrospectively.

### TH-0009 — owner_input_required

- Reconciliation ID: `3da6f7f0-8c55-4233-8aec-a63ba9d619c9`
- Record: `thaans` / `e5d97da7-8c0e-45ca-8546-8ff75bc82635`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0009","legacy_rack":"C-01","status":"active","batch_code":"RB-2602","fabric_stock_id":"cc1fa084-0859-4240-b1c9-51e54be38d37","original_mm":18000,"recognized_ledger_mm":18000,"movement_ids":["049ecd59-0174-437f-ace1-d57c5d984ea7"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 18000 mm. Rack C-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0008 — owner_input_required

- Reconciliation ID: `30128f0f-6889-47cd-a013-2564ed9f45df`
- Record: `thaans` / `eaf4197f-c4fd-4109-a8af-dbac9a4cb6ba`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0008","legacy_rack":"B-04","status":"active","batch_code":"RB-2601","fabric_stock_id":"f7836142-45e0-477e-a35d-5550771e8e70","original_mm":40000,"recognized_ledger_mm":36000,"movement_ids":["3922ca08-be9a-45ac-a0bc-80ef3087ea8e","9b9d0542-ed5f-4ebf-b480-b0058270a905","9c538fa7-6084-4846-a7a8-e31d23d505f7"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 36000 mm. Rack B-04 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0002 — owner_input_required

- Reconciliation ID: `775d212a-55fb-4b79-b6d6-72fab4551107`
- Record: `thaans` / `f2ef011e-a4fc-4d05-978c-4a68c35fee30`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0002","legacy_rack":"A-01","status":"active","batch_code":"RB-2601","fabric_stock_id":"9fcd9ec3-44a9-4b75-b1ae-4a10ada2feac","original_mm":30000,"recognized_ledger_mm":25750,"movement_ids":["f798e0e1-0374-4a76-9c16-dcd6614d8df5","c07a64ca-32f6-402c-9400-9e56dd33ab8b","040e5d0b-ba5b-4a36-ba3c-fa4909f14408"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 25750 mm. Rack A-01 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0005 — owner_input_required

- Reconciliation ID: `3ebe91be-90fa-426b-8b07-967111502862`
- Record: `thaans` / `f9416b8e-0547-4e1d-af27-affdc2c01f1f`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0005","legacy_rack":"A-03","status":"active","batch_code":"RB-2601","fabric_stock_id":"9a71b97f-c86e-4e0c-981e-f0c42b416b88","original_mm":29500,"recognized_ledger_mm":29250,"movement_ids":["5cb66610-171f-42d0-920a-8df9a61cb216","3a5fdaf2-9961-45cd-8e55-31a1713d4120"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 29250 mm. Rack A-03 has no canonical location mapping; do not infer a location or manufacture a transfer.

### TH-0004 — owner_input_required

- Reconciliation ID: `bb9b2668-6aea-42c1-8a57-49a568e445ca`
- Record: `thaans` / `fd27265b-755c-4672-a353-180332c8b863`
- Issue: `location_unverified`
- Evidence: {"barcode":"TH-0004","legacy_rack":"A-03","status":"active","batch_code":"RB-2601","fabric_stock_id":"9a71b97f-c86e-4e0c-981e-f0c42b416b88","original_mm":32000,"recognized_ledger_mm":21500,"movement_ids":["aaec5410-d45f-4210-8553-a02fd6401c62","82e7eb01-cf34-4adc-839a-e201382c8f20","df2c402e-5d58-4444-b22d-007ae3501a77"],"historical_location_known":false}
- Owner decision: Provide exact current Workshop/Showroom/named Showroom sublocation allocations totaling 21500 mm. Rack A-03 has no canonical location mapping; do not infer a location or manufacture a transfer.

### Canvas Padding — owner_input_required

- Reconciliation ID: `b185af34-e7b4-4b37-8f44-cd333b7a76b8`
- Record: `materials` / `000c3b67-1b95-4b22-bd46-8878f71f3c17`
- Issue: `opening_stock_location_unverified`
- Evidence: {"name":"Canvas Padding","unit":"m","recorded_qty_on_hand":"42","legacy_issue_lines":[{"id":"6f002475-9399-4bbf-9425-21927b6ca6b5","qty":"1.5","job_id":"44444444-4444-4444-4444-444444444401"}],"canonical_location_evidence":false}
- Owner decision: Provide current location allocations for recorded 42 m. Do not subtract historical issue lines again: qty_on_hand is the Phase 3 legacy snapshot source. If a physical count differs, report that separately with correction evidence.

### Horn Buttons (set) — owner_input_required

- Reconciliation ID: `00d3203e-9841-4858-9be6-9ef1631aa1bb`
- Record: `materials` / `038c4ca5-5670-476f-84cc-fcd458419ba1`
- Issue: `opening_stock_location_unverified`
- Evidence: {"name":"Horn Buttons (set)","unit":"set","recorded_qty_on_hand":"60","legacy_issue_lines":[],"canonical_location_evidence":false}
- Owner decision: Provide current location allocations for recorded 60 set. Do not subtract historical issue lines again: qty_on_hand is the Phase 3 legacy snapshot source. If a physical count differs, report that separately with correction evidence.

### Shoulder Pads — owner_input_required

- Reconciliation ID: `dbb9ae48-50f9-4a63-b75c-8f561ae44a65`
- Record: `materials` / `529710b8-3cca-49d3-b741-7cb139622e18`
- Issue: `opening_stock_location_unverified`
- Evidence: {"name":"Shoulder Pads","unit":"pair","recorded_qty_on_hand":"35","legacy_issue_lines":[],"canonical_location_evidence":false}
- Owner decision: Provide current location allocations for recorded 35 pair. Do not subtract historical issue lines again: qty_on_hand is the Phase 3 legacy snapshot source. If a physical count differs, report that separately with correction evidence.

### Suit Lining Silk — owner_input_required

- Reconciliation ID: `c32f567c-7b10-46cc-9578-89d396b66b9d`
- Record: `materials` / `bcfcb3ea-c497-4dcd-8c2d-5f1898a67fe4`
- Issue: `opening_stock_location_unverified`
- Evidence: {"name":"Suit Lining Silk","unit":"m","recorded_qty_on_hand":"80","legacy_issue_lines":[],"canonical_location_evidence":false}
- Owner decision: Provide current location allocations for recorded 80 m. Do not subtract historical issue lines again: qty_on_hand is the Phase 3 legacy snapshot source. If a physical count differs, report that separately with correction evidence.

## Scope and limits

Live verification confirms legacy Tailor name text: TJ-1041 = `tailor`, TJ-1042 =
`Rafiq`, TJ-1043 = `counter`, TJ-EB397165 = `tailor`. Rafiq is an existing name
clue, not a verified business Tailor/factory assignment. TJ-1041 and TJ-1043 staff
assignments were recorded on 1 October after their earlier material issues; do not
backdate these later staff assignments into historical factory genealogy.

TH-0007's 25,800 mm balance includes an explicit +300 mm physical-count adjustment;
do not clamp it to its original 25,500 mm length. Canvas Padding's recorded 42 m
must not have its historical 1.5 m issue subtracted again without evidence of a
separate missing stock correction. Wine Velvet / RB-2603 has bill reference
`BL-9032`, but no stored batch-line CP evidence; an invoice number is not a price.

TH-0003 closure concerns current available stock only. Its historical location remains unknown; its original rack, labels, sale and movements are retained. No inventory item/opening balance is created and no Owner identity is impersonated. Draft rows remain unresolved because non-receipt in the ledger does not prove physical absence. All customer/job/material history is retained without repricing or double deduction. Owner answers will require a subsequent documented migration; Phase 8 has not begun.
