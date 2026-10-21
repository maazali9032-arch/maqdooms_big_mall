import { supabase } from "@/integrations/supabase/client";
import type { CounterReceipt } from "./CounterBillReceipt";
import type { ScanRecord } from "./counter-workspace-model";
import type { ProductionRecord } from "@/features/tailoring/ProductionDocument";

export type CounterJob = {
  id: string;
  code: string;
  scan_code?: string | null;
  garment?: string;
  product?: string;
  status: string;
  bill_id?: string | null;
  factory?: string;
  tailor?: string;
  delivery_date?: string | null;
  fabrics?: ProductionRecord["fabrics"];
};
export type CounterWork = { kind: "customer" | "production"; code: string; jobs: CounterJob[] };
export type CounterBarcode =
  | { kind: "item"; item: ScanRecord }
  | { kind: "document"; work: CounterWork | null; receipt: CounterReceipt | null };

/** Exact recorded identities only. Resolving a scan never posts an operation. */
export async function resolveCounterBarcode(code: string): Promise<CounterBarcode> {
  const value = code.trim();
  if (!value) throw new Error("Enter a barcode");
  const [stock, bill, customer, production] = await Promise.all([
    (
      supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: Error | null }>
    )("counter_scan_barcode_any", { p_barcode: value }),
    supabase.rpc("counter_bill", { p_code: value }),
    supabase.rpc("customer_tailoring_work", { p_code: value }),
    supabase.rpc("production_job_document", { p_code: value }),
  ]);
  for (const result of [stock, bill, customer, production]) if (result.error) throw result.error;
  const jobs = (customer.data ?? []) as unknown as CounterJob[];
  let receipt = bill.data as unknown as CounterReceipt | null;
  const job = production.data as unknown as CounterJob | null;
  const matches = Number(!!stock.data) + Number(!!receipt || !!jobs.length) + Number(!!job);
  if (matches > 1 || (receipt && jobs.some((j) => j.bill_id !== receipt!.id)))
    throw new Error(
      "This barcode matches different records. Use the exact item, bill or Production ID.",
    );
  if (stock.data) return { kind: "item", item: stock.data as unknown as ScanRecord };
  if (!matches) throw new Error("No item, customer bill or Production ID matches this barcode");
  if (jobs.length && !receipt) {
    const billIds = [...new Set(jobs.map((j) => j.bill_id).filter(Boolean))];
    if (billIds.length === 1) {
      const linked = await supabase.rpc("counter_bill", { p_code: billIds[0]! });
      if (linked.error) throw linked.error;
      receipt = linked.data as unknown as CounterReceipt | null;
    }
  }
  return {
    kind: "document",
    work: jobs.length
      ? { kind: "customer", code: receipt?.code ?? value, jobs }
      : job
        ? { kind: "production", code: job.code, jobs: [job] }
        : null,
    receipt,
  };
}
