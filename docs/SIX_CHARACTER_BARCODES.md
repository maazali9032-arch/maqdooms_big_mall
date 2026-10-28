# Six-character barcode identities — 21 October 2026

> **Current implementation note (29 October 2026):** This document records the original six-identity rollout. Material-unit (`M`) barcodes were added later; use [the current system reference](CURRENT_SYSTEM_REFERENCE.md) for the complete current barcode contract.

New identities use one uppercase type letter plus five base-36 characters (`0–9`, `A–Z`), exactly six decoded characters. CODE128 encodes that identity, and the same identity is printed under the bars. The namespace includes `00000` through `ZZZZZ`: 60,466,176 slots per type. Sequence gaps are normal; no promise of consecutive invoice/label numbering is made.

| Type | Prefix | Example |
| --- | --- | --- |
| Physical fabric Thaan | T | T00001 |
| Production order scanner alias | P | P00001 |
| Shop finished piece | F | F00001 |
| Customer bill scanner alias | B | B00001 |
| Customer stitching work order scanner alias | J | J00001 |
| Customer finished garment | C | C00001 |
| Material / consumable physical unit | M | M00001 |

## Database and permanence

0075 (`20261021000300_six_character_barcode_identities.sql`, mirrored in Drizzle) creates six private PostgreSQL `NO CYCLE` sequences bounded at 60,466,175, an exact five-digit encoder, private allocation helpers, immutable reservation and logical-record binding tables, and generation/update guards. PostgreSQL `nextval` allocation is concurrent and not rolled back. Reservation keys prevent collisions with existing coincident six-character labels. No user-facing random retry/collision scheme is used. Exhaustion fails explicitly without wrapping or producing longer IDs.

UUID primary keys, foreign keys, business codes, immutable invoice snapshots and inventory relationships remain unchanged. Document scanner aliases live in their existing `scan_code` fields. Physical Thaan labels remain in registered variant/barcode records or the legacy per-roll field. Binding records associate T with the Thaan UUID, B/P/J with document UUIDs, and F/C with barcode UUIDs joined to their corresponding finished records. Bindings/reservations remain independently of deletions; browser and service roles cannot directly allocate IDs or alter/reset sequences and mappings.

Registration receives a T identity for every new physical roll; draft completion, pricing changes and reprints retain it. Legacy internal fabric-group entry retains its internal grouping reference and gives each physical roll its own T label. Finished product generation allocates F only after the existing per-piece SP/receiving checks. Customer receipts allocate C through their existing positive-SP gate. Transferring stock keeps the original item label; it does not allocate another physical ID.

## Existing data and transition

No reset is needed or performed. Existing physical labels, 12-digit finished codes, BL/PJ/TJ aliases and earlier internal document codes/UUID lookup paths remain unchanged. Reprints preserve the original recorded identity, including historical values longer than six characters. The new format applies to new records after 0075. Historical labels are not truncated, backfilled, regenerated or renumbered. Internal batch/catalog/location/POS identifiers are not physical barcode families and remain as recorded.

0076 (`20261021000400_six_character_work_references.sql`, mirrored in Drizzle) adds the recorded aliases to existing work/receipt projections. Customer tailoring work displays and searches J/B aliases alongside legacy references; ongoing production and loaded receiving/extra-fabric panels prefer aliases for display while retaining UUID/business-code arguments for operations. This is a forward follow-up; applied 0075 bytes were not rewritten.

## Scanner compatibility

| Workflow | Identity families |
| --- | --- |
| Thaan details, measurement, fabric stock, fabric transfer and production allocation | T and valid historical fabric labels |
| POS | T/F stock, B/J/P existing documents; historical labels remain accepted |
| Finished garment receiving | B/J customer work or P shop production; output is C or F |
| Finished stock transfers/sale | F and historical shop piece labels |
| E-commerce listing scan | Available showroom T/F, keeping product SP and showroom eligibility rules |
| Customer-finished lookup/reprint | C and historical customer garment labels |
| Owner dashboard inspector | All six families plus existing supported historical labels |

These identities do not grant new access or make customer-owned garments saleable shop stock. Existing server-side role/ownership/permission checks stay authoritative. The Owner inspector now resolves document aliases and customer-job/customer-finished roots; its customer garment receipt evidence includes the actual saved event and actor. Scans remain read-only; retries and original receiving/payment/transfer transactions retain their existing protections.

## Verification and recovery

Full disposable migration replay plus GST/POS/production/customer receiving/e-commerce regressions passed with new T/P/F/B/J/C identities. Tests cover old aliases and labels, all six inspector roots, base-36 digit boundaries, concurrent queued uniqueness, rolled-back allocation gaps, private helper/sequence permissions, immutable mappings, SP gates, transfer-out availability and maximum-value/exhaustion on a disposable database only. Real-component camera checks total 44, including exact six-character decoding for every family through CODE128 MediaStreams. Receipt tests cover B/J print identities and old receipts; Counter/production receipt checks retain canonical operation arguments.

Both migrations were dry-run against the actual schema, then applied with native migration records and SHA256 execution tracking. All existing public business row fingerprints were preserved. Two real concurrent PostgreSQL sessions obtained different B IDs; both allocations and a subsequent rollback check were rolled back while intentionally consuming three sequence slots. No test bill, stock, garment or transaction was created. Hardware printer/physical camera acceptance remains separate from synthetic browser checks.

Backups/restores must include the reservation/binding tables and six sequence states. Never restart sequences, truncate identity history or restore an older high-water mark into a database that may have issued later labels. Retain a later reservation/high-water-mark record before a restore; test restoration in isolation. Administrative database owners can override permissions, so reset/restore procedures must explicitly preserve issued identity history.
