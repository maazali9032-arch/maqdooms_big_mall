import { reportQuantity } from "@/features/reports/report-value";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
export type ReserveCut = {
  inventory_item_id: string;
  thaan_id: string;
  locations: { id: string; name: string; kind?: string; quantity_mm: number }[];
};
export type ReserveVariant = {
  barcode: string;
  fabric_name: string;
  batch_code: string;
  cuts: ReserveCut[];
};
export type ScanRecord = {
  kind: "fabric" | "product";
  id?: string;
  barcode: string;
  name: string;
  batch?: string;
  design?: string | null;
  size?: string | null;
  sp_paise?: number;
  sp_version_id?: string;
  available?: boolean;
  cuts?: ReserveCut[];
  variants?: ReserveVariant[];
};
export type CounterRow = {
  key: string;
  scan: ScanRecord;
  cut?: ReserveCut;
  metres: string;
  price: string;
  selected: boolean;
  group?: string;
};
export type TailoringGroup = {
  id: string;
  keys: string[];
  garment: string;
  delivery: string;
  factory: string;
  assignment: string;
  total: string;
  design?: string;
  customDesign?: string;
};
export function availableAt(row: CounterRow, source: string) {
  return Number(row.cut?.locations.find((l) => l.id === source)?.quantity_mm ?? 0);
}
export function counterPayload(rows: CounterRow[], groups: TailoringGroup[], source: string) {
  if (!rows.length) throw new Error("Scan at least one item");
  const quantities = new Map(
    rows
      .filter((r) => r.scan.kind === "fabric")
      .map((r) => {
        const mm = quantityInput(r.metres, "mm");
        if (mm > availableAt(r, source))
          throw new Error(`${r.scan.barcode}: cut exceeds available stock`);
        return [r.key, mm];
      }),
  );
  const items = rows
    .filter((r) => !r.group)
    .map((r) =>
      r.scan.kind === "product"
        ? { kind: "product", piece_id: r.scan.id!, sp_version_id: r.scan.sp_version_id! }
        : {
            kind: "fabric",
            inventory_item_id: r.cut!.inventory_item_id,
            quantity: quantities.get(r.key)!,
            sp_paise_per_m: fabricMoneyInput(r.price),
          },
    );
  const tailoring = groups.map((g) => {
    if (!g.garment.trim() || !g.delivery || !g.assignment || !g.keys.length)
      throw new Error(
        "Enter garment, delivery date, factory, tailor and total for each tailoring job",
      );
    return {
      items: g.keys.map((key) => {
        const r = rows.find((r) => r.key === key && r.group === g.id);
        if (!r?.cut) throw new Error("Tailoring fabric selection changed");
        return { inventory_item_id: r.cut.inventory_item_id, quantity: quantities.get(key)! };
      }),
      garment: g.garment.trim(),
      delivery_date: g.delivery,
      assignment_id: g.assignment,
      total_paise: fabricMoneyInput(g.total),
      ...(g.design ? { design_id: g.design === "custom" ? null : g.design } : {}),
      ...(g.design === "custom" ? { custom_design: g.customDesign?.trim() } : {}),
    };
  });
  return { items, tailoring };
}
export function previewTotal(rows: CounterRow[], groups: TailoringGroup[]) {
  try {
    return (
      rows
        .filter((r) => !r.group)
        .reduce(
          (sum, r) =>
            sum +
            (r.scan.kind === "product"
              ? BigInt(r.scan.sp_paise!)
              : (BigInt(quantityInput(r.metres, "mm")) * BigInt(fabricMoneyInput(r.price)) + 500n) /
                1000n),
          0n,
        ) + groups.reduce((sum, g) => sum + BigInt(fabricMoneyInput(g.total)), 0n)
    );
  } catch {
    return null;
  }
}

export function reserveTotals(scan: ScanRecord, selectedCut?: ReserveCut) {
  const totals = { showroom: 0, workshop: 0 };
  // The row describes this physical Thaan; variants are available in the drawer.
  for (const c of selectedCut ? [selectedCut] : (scan.cuts ?? []))
    for (const l of c.locations) {
      if (l.kind === "workshop") totals.workshop += Number(l.quantity_mm);
      else if (l.kind === "showroom" || l.kind === "showroom_sublocation")
        totals.showroom += Number(l.quantity_mm);
    }
  return `Showroom ${reportQuantity(String(totals.showroom), "mm")} · Workshop ${reportQuantity(String(totals.workshop), "mm")} · ${scan.variants?.length ?? 1} variants`;
}
