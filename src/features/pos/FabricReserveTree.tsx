import { Button } from "@/components/ui/button";
import { reportQuantity } from "@/features/reports/report-value";
import type { ScanRecord, ReserveCut, ReserveVariant } from "./counter-workspace-model";
export function FabricReserveTree({
  scan,
  onChoose,
}: {
  scan: ScanRecord;
  onChoose?: (cut: ReserveCut) => void;
}) {
  const variants: ReserveVariant[] = onChoose
    ? [
        {
          barcode: scan.barcode,
          fabric_name: scan.name,
          batch_code: scan.batch ?? "",
          cuts: scan.cuts ?? [],
        },
      ]
    : (scan.variants ?? []);
  const batches = [...new Set(variants.map((v) => v.batch_code))];
  return (
    <div className="space-y-3">
      {batches.map((batch) => (
        <details open key={batch} className="rounded-xl border p-3">
          <summary className="font-semibold">Batch {batch || "Not recorded"}</summary>
          <div className="mt-2 ml-2 space-y-2 border-l pl-3">
            {[
              ...new Set(variants.filter((v) => v.batch_code === batch).map((v) => v.fabric_name)),
            ].map((type) => (
              <details open key={type}>
                <summary className="text-sm font-semibold">{type}</summary>
                <div className="mt-2 ml-2 space-y-2 border-l pl-3">
                  {variants
                    .filter((v) => v.batch_code === batch && v.fabric_name === type)
                    .map((v) => (
                      <div key={v.barcode} className="rounded border p-3 text-sm">
                        <p className="break-all font-mono text-xs">{v.barcode}</p>
                        {v.cuts.map((c) => (
                          <div key={c.inventory_item_id} className="py-1">
                            {c.locations.map((l) => (
                              <p key={l.id}>
                                {l.name}: {reportQuantity(String(l.quantity_mm), "mm")}
                              </p>
                            ))}
                            {onChoose && (
                              <Button variant="outline" size="sm" onClick={() => onChoose(c)}>
                                Select Thaan {c.thaan_id.slice(0, 8)}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
