import { useRef } from "react";
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
    job_id: string | null;
    job_code: string | null;
    delivery_date: string | null;
    fabrics: { barcode: string; name: string; quantity_mm: string }[] | null;
  }[];
};
export function CounterBillReceipt({ receipt }: { receipt: CounterReceipt }) {
  const printable = useRef<HTMLDivElement>(null);
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
                  <p>Customer tailoring · Entire job total · Delivery: {line.delivery_date}</p>
                  <p className="break-all font-mono text-xs">{line.job_code}</p>
                  {line.design && <p>Design: {line.design}</p>}
                  {line.fabrics?.map((cut, i) => (
                    <p key={i} className="break-words">
                      {cut.name} · {cut.barcode} · {reportQuantity(cut.quantity_mm, "mm")}
                    </p>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t pt-3">
          <strong>Total {reportMoney(receipt.total_paise)}</strong>
          <strong>{receipt.paid ? "Paid" : "Unpaid"}</strong>
        </div>
        {receipt.paid_at && (
          <p className="text-xs">Paid: {new Date(receipt.paid_at).toLocaleString("en-IN")}</p>
        )}
      </div>
    </Panel>
  );
}
