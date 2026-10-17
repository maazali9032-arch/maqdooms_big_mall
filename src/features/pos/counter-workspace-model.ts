import { reportQuantity } from "@/features/reports/report-value";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
import {
  calculateTaxPaise,
  defaultGstRule,
  type GstSupplyType,
  type GstTransactionConfiguration,
} from "@/features/gst/tax";
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
  source_location_id?: string;
  source_name?: string;
  cuts?: ReserveCut[];
  variants?: ReserveVariant[];
};
export type CounterRow = {
  key: string;
  scan: ScanRecord;
  cut?: ReserveCut;
  source: { id: string; name: string };
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
  stitching: string;
  design?: string;
  customDesign?: string;
  notes?: string;
};
export function availableAt(row: CounterRow) {
  return Number(row.cut?.locations.find((l) => l.id === row.source.id)?.quantity_mm ?? 0);
}
export function counterPayload(rows: CounterRow[], groups: TailoringGroup[]) {
  if (!rows.length) throw new Error("Scan at least one item");
  const quantities = new Map(
    rows
      .filter((r) => r.scan.kind === "fabric")
      .map((r) => {
        const mm = quantityInput(r.metres, "mm");
        if (mm > availableAt(r)) throw new Error(`${r.scan.barcode}: cut exceeds available stock`);
        return [r.key, mm];
      }),
  );
  const items = rows
    .filter((r) => !r.group)
    .map((r) =>
      r.scan.kind === "product"
        ? {
            kind: "product",
            piece_id: r.scan.id!,
            sp_version_id: r.scan.sp_version_id!,
            source_location_id: r.source.id,
          }
        : {
            kind: "fabric",
            inventory_item_id: r.cut!.inventory_item_id,
            quantity: quantities.get(r.key)!,
            sp_paise_per_m: fabricMoneyInput(r.price),
            source_location_id: r.source.id,
          },
    );
  const tailoring = groups.map((g) => {
    if (!g.garment.trim() || !g.delivery || !g.assignment || !g.keys.length)
      throw new Error(
        "Enter garment, delivery date, factory, tailor and stitching charge for each tailoring job",
      );
    return {
      items: g.keys.map((key) => {
        const r = rows.find((r) => r.key === key && r.group === g.id);
        if (!r?.cut) throw new Error("Tailoring fabric selection changed");
        return {
          inventory_item_id: r.cut.inventory_item_id,
          quantity: quantities.get(key)!,
          sp_paise_per_m: fabricMoneyInput(r.price),
          source_location_id: r.source.id,
        };
      }),
      garment: g.garment.trim(),
      delivery_date: g.delivery,
      assignment_id: g.assignment,
      stitching_paise: fabricMoneyInput(g.stitching),
      ...(g.design ? { design_id: g.design === "custom" ? null : g.design } : {}),
      ...(g.design === "custom" ? { custom_design: g.customDesign?.trim() } : {}),
      ...(g.notes?.trim() ? { notes: g.notes.trim() } : {}),
    };
  });
  return { items, tailoring };
}
function rowAmount(row: CounterRow) {
  return row.scan.kind === "product"
    ? BigInt(row.scan.sp_paise!)
    : (BigInt(quantityInput(row.metres, "mm")) * BigInt(fabricMoneyInput(row.price)) + 500n) /
        1000n;
}
export function tailoringAmounts(rows: CounterRow[], group: TailoringGroup) {
  const fabric = group.keys.reduce((sum, key) => {
    const row = rows.find((r) => r.key === key && r.scan.kind === "fabric");
    if (!row) throw new Error("Tailoring fabric selection changed");
    return sum + rowAmount(row);
  }, 0n);
  const stitching = BigInt(fabricMoneyInput(group.stitching));
  return { fabric, stitching, total: fabric + stitching };
}
export function previewTotal(
  rows: CounterRow[],
  groups: TailoringGroup[],
  draftStitching?: string,
) {
  try {
    return (
      rows.reduce((sum, r) => sum + rowAmount(r), 0n) +
      groups.reduce((sum, g) => sum + BigInt(fabricMoneyInput(g.stitching)), 0n) +
      (draftStitching === undefined ? 0n : BigInt(fabricMoneyInput(draftStitching)))
    );
  } catch {
    return null;
  }
}

export function gstPreview(
  rows: CounterRow[],
  groups: TailoringGroup[],
  configuration: GstTransactionConfiguration | undefined,
  supplyType: GstSupplyType,
) {
  const config = configuration?.configuration;
  if (!config?.enabled) {
    const total = previewTotal(rows, groups);
    return total === null
      ? null
      : { taxable: total, gst: 0n, cgst: 0n, sgst: 0n, igst: 0n, final: total };
  }
  try {
    let taxable = 0n,
      gst = 0n,
      cgst = 0n,
      sgst = 0n,
      igst = 0n,
      final = 0n;
    const add = (amount: bigint, category: "fabric_sale" | "finished_sale" | "tailoring") => {
      const rule = defaultGstRule(configuration, category);
      if (!rule) throw new Error(`Configure the default ${category} GST rule`);
      const tax = calculateTaxPaise(amount, rule.rate_bps, config.price_mode, supplyType);
      taxable += tax.taxablePaise;
      gst += tax.gstPaise;
      cgst += tax.cgstPaise;
      sgst += tax.sgstPaise;
      igst += tax.igstPaise;
      final += tax.finalPaise;
    };
    for (const row of rows)
      add(rowAmount(row), row.scan.kind === "product" ? "finished_sale" : "fabric_sale");
    for (const group of groups) add(BigInt(fabricMoneyInput(group.stitching)), "tailoring");
    return { taxable, gst, cgst, sgst, igst, final };
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
