import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Panel } from "@/shared/components/page";
import { BarcodeGraphic } from "@/features/tailoring/ProductionDocument";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { printFabricLabel } from "@/features/inventory/fabric-label";
export type CounterReceipt = {
  id: string;
  code: string;
  created_at: string;
  total_paise: string;
  paid_amount_paise?: string;
  balance_paise?: string;
  pos_code?: string | null;
  paid: boolean;
  paid_at: string | null;
  source: string;
  salesperson: string;
  customer: { name: string | null; phone: string | null };
  lines: {
    id: string;
    kind: string;
    barcode: string | null;
    name: string;
    size: string | null;
    design: string | null;
    quantity: string;
    unit: string;
    price_paise: string | null;
    amount_paise: string;
    source?: string | null;
    fabric_amount_paise?: string | null;
    stitching_paise?: string | null;
    job_id: string | null;
    job_code: string | null;
    delivery_date: string | null;
    fabrics:
      { barcode: string; name: string; quantity_mm: string; source?: string | null }[] | null;
  }[];
};
export function CounterBillReceipt({ receipt }: { receipt: CounterReceipt }) {
  const printable = useRef<HTMLDivElement>(null);
  const tailorPrintable = useRef<HTMLDivElement>(null);
  const tailorOrder = useQuery({
    queryKey: ["tailor-work-order", receipt.id],
    enabled: false,
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("tailor_work_order", {
        p_bill: receipt.id,
      });
      if (error) throw error;
      return (data ?? []) as TailorOrder[];
    },
  });
  return (
    <Panel
      title="Customer bill"
      actions={
        <Button
          onClick={() => {
            if (printable.current)
              printFabricLabel(printable.current, "Customer bill " + receipt.code);
          }}
        >
          Print bill
        </Button>
      }
    >
      <div ref={printable} className="space-y-3">
        <h2 className="text-xl font-semibold">MAQDOOM’S Big Mall</h2>
        <p className="break-all font-mono text-xs">{receipt.code}</p>
        <BarcodeGraphic code={receipt.code} />
        <p className="text-sm">
          {new Date(receipt.created_at).toLocaleString("en-IN")} · {receipt.source}
          {receipt.pos_code ? ` · ${receipt.pos_code}` : ""}
        </p>
        {(receipt.customer?.name || receipt.customer?.phone) && (
          <p className="text-sm">
            {receipt.customer.name} {receipt.customer.phone}
          </p>
        )}
        <div className="divide-y rounded-lg border">
          {receipt.lines.map((line) => (
            <div key={line.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{line.name}</strong>
                <strong>{reportMoney(line.amount_paise)}</strong>
              </div>
              {line.barcode && <p className="break-all font-mono text-xs">{line.barcode}</p>}
              {line.source && <p className="text-xs">Stock source: {line.source}</p>}
              {line.size && (
                <p>
                  Size {line.size} · {line.design}
                </p>
              )}
              {line.kind === "fabric" && (
                <p>
                  {reportQuantity(line.quantity, line.unit)} × {reportMoney(line.price_paise!)} / m
                </p>
              )}
              {line.kind === "tailoring" && (
                <>
                  <p>
                    {line.fabric_amount_paise != null && line.stitching_paise != null
                      ? `Fabric ${reportMoney(line.fabric_amount_paise)} + Stitching ${reportMoney(line.stitching_paise)} · Delivery: ${line.delivery_date}`
                      : `Customer tailoring · Entire job total · Delivery: ${line.delivery_date}`}
                  </p>
                  <p className="break-all font-mono text-xs">{line.job_code}</p>
                  {line.design && <p>Design: {line.design}</p>}
                  {line.fabrics?.map((cut, i) => (
                    <p key={i} className="break-words">
                      {cut.name} · {cut.barcode} · {reportQuantity(cut.quantity_mm, "mm")}
                      {cut.source ? ` · ${cut.source}` : ""}
                    </p>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t pt-3">
          <strong>Total {reportMoney(receipt.total_paise)}</strong>
          <strong>
            {receipt.paid ? "Paid" : receipt.paid_amount_paise ? "Advance received" : "Unpaid"}
          </strong>
        </div>
        {receipt.paid_amount_paise !== undefined && (
          <div className="flex justify-between text-sm">
            <span>Advance {reportMoney(receipt.paid_amount_paise)}</span>
            <strong>Balance {reportMoney(receipt.balance_paise ?? "0")}</strong>
          </div>
        )}
        {receipt.paid_at && (
          <p className="text-xs">Paid: {new Date(receipt.paid_at).toLocaleString("en-IN")}</p>
        )}
      </div>
      {receipt.lines.some((line) => line.kind === "tailoring") && (
        <div className="mt-5 border-t pt-4">
          <Button
            variant="outline"
            disabled={tailorOrder.isFetching}
            onClick={() =>
              void tailorOrder.refetch().then((result) => {
                if (result.error) toast.error(result.error.message);
              })
            }
          >
            {tailorOrder.isFetching ? "Preparing tailor work order…" : "Prepare tailor work order"}
          </Button>
          {tailorOrder.data?.length ? (
            <div className="mt-4 space-y-3">
              <div ref={tailorPrintable} className="space-y-4 bg-white p-4 text-black">
                <h2 className="text-xl font-semibold">MAQDOOM’S Big Mall · Tailor work order</h2>
                <p className="font-mono text-xs">Customer bill: {receipt.code}</p>
                {tailorOrder.data.map((job) => (
                  <section key={job.job_code} className="rounded border p-3 text-sm">
                    <strong>{job.garment}</strong>
                    <p className="font-mono text-xs">{job.job_code}</p>
                    <p>
                      Delivery: {job.delivery_date} · {job.factory} → {job.tailor}
                    </p>
                    {job.design && <p>Design: {job.design}</p>}
                    {job.notes && <p>Notes: {job.notes}</p>}
                    <div className="mt-2 border-t pt-2">
                      <strong>Fabric to stitch</strong>
                      {job.fabrics.map((fabric, index) => (
                        <p key={index}>
                          {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")} ·{" "}
                          {fabric.barcode}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <Button
                onClick={() =>
                  tailorPrintable.current &&
                  printFabricLabel(tailorPrintable.current, `Tailor work order ${receipt.code}`)
                }
              >
                Print tailor work order
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

type TailorOrder = {
  job_code: string;
  garment: string;
  delivery_date: string;
  design: string | null;
  notes: string | null;
  factory: string;
  tailor: string;
  fabrics: { barcode: string; name: string; quantity_mm: string }[];
};
