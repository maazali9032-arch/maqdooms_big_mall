# Authorized test-stock scenarios

The user confirmed the reviewed stock is testing data and authorized deliberate distributions. These are synthetic test allocations, not inferred historical locations. The reviewed set contains 21 unique stock records, rather than 24: 17 Thaans and 4 materials. The separate CP issue belongs to TH-0017. Four tailoring jobs were left unchanged pending scope clarification.

| Record | State/scenario | Recorded quantity | Deliberate location allocations |
| --- | --- | --- | --- |
| Canvas Padding | material_unit_split | 42 m | WORKSHOP: 30 m; SHOWROOM: 12 m |
| Horn Buttons (set) | material_unit_split | 60 set | WORKSHOP: 40 set; TEST-DISPLAY-A: 20 set |
| Shoulder Pads | material_unit_split | 35 pair | WORKSHOP: 20 pair; SHOWROOM: 10 pair; TEST-DISPLAY-B: 5 pair |
| Suit Lining Silk | material_unit_split | 80 m | WORKSHOP: 50 m; TEST-DISPLAY-B: 30 m |
| TH-0001 | single_location_stock | 23500 mm | WORKSHOP: 23500 mm |
| TH-0002 | single_location_stock | 25750 mm | SHOWROOM: 25750 mm |
| TH-0003 | fully_depleted | 0 mm | No opening allocation |
| TH-0004 | split_than_locations | 21500 mm | WORKSHOP: 11500 mm; SHOWROOM: 10000 mm |
| TH-0005 | single_location_stock | 29250 mm | TEST-DISPLAY-A: 29250 mm |
| TH-0006 | single_location_stock | 16500 mm | WORKSHOP: 16500 mm |
| TH-0007 | split_than_locations | 25800 mm | WORKSHOP: 15800 mm; SHOWROOM: 10000 mm |
| TH-0008 | split_than_locations | 36000 mm | WORKSHOP: 16000 mm; SHOWROOM: 10000 mm; TEST-DISPLAY-B: 10000 mm |
| TH-0009 | single_location_stock | 18000 mm | SHOWROOM: 18000 mm |
| TH-0010 | single_location_stock | 16500 mm | TEST-DISPLAY-A: 16500 mm |
| TH-0011 | single_location_stock | 18500 mm | WORKSHOP: 18500 mm |
| TH-0012 | single_location_stock | 26600 mm | TEST-DISPLAY-B: 26600 mm |
| TH-0013 | split_than_locations | 27000 mm | WORKSHOP: 17000 mm; TEST-DISPLAY-A: 10000 mm |
| TH-0014 | single_location_stock | 30500 mm | WORKSHOP: 30500 mm |
| TH-0015 | unreceived_draft | 0 mm | No opening allocation |
| TH-0016 | unreceived_draft | 0 mm | No opening allocation |
| TH-0017 | unreceived_missing_cp_sp | 0 mm | No opening allocation |

18 inventory items and 27 opening ADJUSTMENT events were created, with quantity totals conserved: {"mm":315400,"m":122,"set":60,"pair":35}. Three draft rolls remain unreceived; their original lengths remain unchanged and do not become stock. TH-0017 keeps missing CP/SP intentionally for negative validation. No cost/price, sale, transfer, receipt or material issue was fabricated. New named Showroom sublocations are TEST-DISPLAY-A and TEST-DISPLAY-B.

Migration: `20261003001000_live_test_stock_scenarios.sql`; identical mirror `0020_live_test_stock_scenarios.sql`. All original IDs, legacy ledgers, original CP/SP and job history are preserved. Automated rows have NULL actor plus immutable migration provenance; ordinary Owner workflows still require their real profile. The temporary actorless opening exception is closed by the recorded migration version and cannot be reused after commit.

All 21 previously unresolved stock issues were dispositioned as explicit test scenarios. The earlier TH-0003 zero-stock resolution was not overwritten. Four job issues remain: TJ-1041, TJ-1042, TJ-1043 and TJ-EB397165. No Phase 8 workflow was implemented.
