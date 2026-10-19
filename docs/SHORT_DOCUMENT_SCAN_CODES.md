# Compact document scan codes

New documents receive a separate fixed-length scan identity. UUID primary keys, accounting invoice numbers and business references keep their existing meaning.

| Document           | Scan-code format                | Length |
| ------------------ | ------------------------------- | ------ |
| Bill/order         | `BL-` plus 12 random characters | 15     |
| Owner production   | `PJ-` plus 12 random characters | 15     |
| Customer tailoring | `TJ-` plus 12 random characters | 15     |

The alphabet is `23456789ABCDEFGH`, with 16^12 possible tokens per family. The server uses UUID randomness, checks collisions under a transaction advisory lock, and enforces uniqueness. Collisions regenerate at the same length. A trigger prevents identity changes. These scan codes do not use a global sequence.

Nullable `scan_code` columns are added to `orders`, `production_jobs` and `customer_tailoring_jobs`. There is no backfill: historical documents and previously printed codes remain unchanged. New rows receive an identity on insert. Existing authorized RPCs normalize aliases to original references before their existing permission and ownership checks. UUID and original-code lookups remain supported. The private normalizer has no authenticated or anonymous execute grant.

Counter receipts and 58/80 mm invoices print Code 128 using `scan_code` when available. They retain the invoice reference and print the short code beneath the bars. Production documents and price-free tailor work orders follow the same rule. Older records fall back to the original barcode. Graphics retain ten-module quiet zones. Fabric and 12-digit finished-piece codes remain unchanged.

## Release and verification

The optional application field supports old server responses. The complete feature requires forward migration `20261019000200_short_document_scan_codes.sql`, mirrored in Drizzle `0066_short_document_scan_codes.sql`. It replaces existing RPC definitions in place, preserving grants and business logic, and fails if expected lookup definitions cannot be found. This task does not deploy or change production.

Run `node scripts/short-document-codes-test.mjs <absolute-path-to-pglite/dist/index.js>` with a disposable PGlite runtime outside application dependencies. It replays the full migration chain locally and checks 300 compact identities, real order alias resolution, immutable identities, old-code fallback and resolver permissions. It never loads `.env` or connects to a network database.

Before rollout, test actual printers/scanners with new bill, production and tailoring documents and reprint an old document. Check 58/80 mm bar thickness and quiet zones. No physical printer test was performed during implementation.
