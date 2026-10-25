import { reportQuantity } from "@/features/reports/report-value";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
import {
  calculateTaxPaise,
  garmentGstRate,
  selectedGstRule,
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
  cutUnit: FabricCutUnit;
  price: string;
  selected: boolean;
  group?: string;
};
export type FabricCutUnit = "m" | "cm" | "mm" | "in";

export function fabricCutQuantityMm(value: string, unit: FabricCutUnit) {
  if (unit === "m") return quantityInput(value, "mm");
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim()))
    throw new Error("Enter a positive cut quantity with at most three decimal places");
  const entered = Number(value);
  const multiplier = unit === "cm" ? 10 : unit === "in" ? 25.4 : 1;
  const millimetres = Math.round(entered * multiplier);
  if (
    !Number.isFinite(entered) ||
    entered <= 0 ||
    !Number.isSafeInteger(millimetres) ||
    millimetres <= 0
  )
    throw new Error("Enter a valid cut quantity");
  return millimetres;
}
export type TailoringGroup = {
  id: string;
  keys: string[];
  garment: string;
  delivery: string;
  factory: string;
  assignment: string;
  sp: string;
  size: string;
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
        const mm = fabricCutQuantityMm(r.metres, r.cutUnit);
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
    if (
      !g.garment.trim() ||
      !g.size.trim() ||
      !g.delivery ||
      !g.assignment ||
      !g.sp.trim() ||
      fabricMoneyInput(g.sp) <= 0 ||
      !g.keys.length
    )
      throw new Error(
        "Enter garment, size, delivery date, factory, tailor and selling price for each tailoring job",
      );
    return {
      items: g.keys.map((key) => {
        const r = rows.find((r) => r.key === key && r.group === g.id);
        if (!r?.cut) throw new Error("Tailoring fabric selection changed");
        return {
          inventory_item_id: r.cut.inventory_item_id,
          quantity: quantities.get(key)!,
          source_location_id: r.source.id,
        };
      }),
      garment: g.garment.trim(),
      delivery_date: g.delivery,
      assignment_id: g.assignment,
      sp_paise: fabricMoneyInput(g.sp),
      size: g.size.trim(),
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
    : (BigInt(fabricCutQuantityMm(row.metres, row.cutUnit)) * BigInt(fabricMoneyInput(row.price)) +
        500n) /
        1000n;
}
export function tailoringAmounts(rows: CounterRow[], group: TailoringGroup) {
  for (const key of group.keys) {
    const row = rows.find((candidate) => candidate.key === key && candidate.scan.kind === "fabric");
    if (!row) throw new Error("Tailoring fabric selection changed");
    fabricCutQuantityMm(row.metres, row.cutUnit);
  }
  return { total: BigInt(fabricMoneyInput(group.sp)) };
}
export function previewTotal(rows: CounterRow[], groups: TailoringGroup[], draftSp?: string) {
  try {
    return (
      rows
        .filter((row) => !row.group && !(draftSp !== undefined && row.selected))
        .reduce((sum, row) => sum + rowAmount(row), 0n) +
      groups.reduce((sum, group) => sum + BigInt(fabricMoneyInput(group.sp)), 0n) +
      (draftSp === undefined ? 0n : BigInt(fabricMoneyInput(draftSp)))
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
  discountMode: "percent" | "amount" = "percent",
  discountValue = 0n,
) {
  const config = configuration?.configuration;
  if (
    discountValue < 0n ||
    (discountMode === "percent" && discountValue > 10000n) ||
    !["percent", "amount"].includes(discountMode)
  )
    return null;
  const entries = [
    ...rows
      .filter((item) => !item.group)
      .map((row) => ({
        amount: rowAmount(row),
        category: (row.scan.kind === "product" ? "finished_sale" : "fabric_sale") as
          "fabric_sale" | "finished_sale",
        itemRef: `${row.scan.kind === "product" ? "PRODUCT" : "FABRIC"}:${row.scan.name.toUpperCase()}`,
      })),
    ...groups.map((group) => ({
      amount: tailoringAmounts(rows, group).total,
      category: "finished_sale" as const,
      itemRef: `PRODUCT:${group.garment.trim().toUpperCase()}`,
    })),
  ];
  const gross = entries.reduce((sum, entry) => sum + entry.amount, 0n);
  const target = discountMode === "amount" ? gross - discountValue : gross;
  if (target < 0n) return null;
  let allocated = 0n;
  const discountedEntries = entries.map((entry, index) => {
    if (discountMode === "percent") {
      return {
        ...entry,
        discountedAmount: (entry.amount * (10000n - discountValue) + 5000n) / 10000n,
      };
    }
    const amount =
      index === entries.length - 1
        ? target - allocated
        : gross === 0n
          ? 0n
          : (entry.amount * target + gross / 2n) / gross;
    const safeAmount = amount > target - allocated ? target - allocated : amount;
    allocated += safeAmount;
    return { ...entry, discountedAmount: safeAmount };
  });
  const discountedTotal = discountedEntries.reduce(
    (sum, entry) => sum + entry.discountedAmount,
    0n,
  );
  if (!config?.enabled) {
    return {
      taxable: discountedTotal,
      gst: 0n,
      cgst: 0n,
      sgst: 0n,
      igst: 0n,
      final: discountedTotal,
    };
  }
  try {
    let taxable = 0n,
      gst = 0n,
      cgst = 0n,
      sgst = 0n,
      igst = 0n,
      final = 0n;
    const add = (
      discountedAmount: bigint,
      category: "fabric_sale" | "finished_sale" | "tailoring",
      itemRef: string,
      rateOverride?: number,
    ) => {
      const rule = selectedGstRule(configuration, category, itemRef);
      if (!rule) throw new Error(`Configure the default ${category} GST rule`);
      const tax = calculateTaxPaise(
        discountedAmount,
        rateOverride ?? rule.rate_bps,
        "inclusive",
        supplyType,
      );
      taxable += tax.taxablePaise;
      gst += tax.gstPaise;
      cgst += tax.cgstPaise;
      sgst += tax.sgstPaise;
      igst += tax.igstPaise;
      final += tax.finalPaise;
    };
    for (const entry of discountedEntries) {
      add(
        entry.discountedAmount,
        entry.category,
        entry.itemRef,
        entry.category === "finished_sale"
          ? garmentGstRate(configuration, entry.discountedAmount)
          : undefined,
      );
    }
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
