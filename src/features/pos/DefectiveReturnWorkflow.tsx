import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, StatusBadge } from "@/shared/components/page";
import { BarcodeCameraButton } from "@/shared/components/barcode-camera";
import { SalespersonPicker } from "@/features/salesperson/SalespersonPicker";
import { reportMoney } from "@/features/reports/report-value";
import type { CounterReceipt } from "./CounterBillReceipt";

type Props = { receipt: CounterReceipt; disabled: boolean };
type ReturnResult = {
  code: string;
  status: string;
  credit_note?: string | null;
  credit_paise?: number | string;
  exchange_bill?: string | null;
};

export function DefectiveReturnWorkflow({ receipt, disabled }: Props) {
  const eligible = useMemo(
    () =>
      receipt.lines.filter(
        (line) => line.kind === "product" || line.kind === "fabric" || line.kind === "tailoring",
      ),
    [receipt.lines],
  );
  const [lineId, setLineId] = useState(eligible[0]?.id ?? "");
  const [quantity, setQuantity] = useState(
    eligible[0]?.kind === "fabric" ? eligible[0].quantity : "1",
  );
  const [resolution, setResolution] = useState<"refund" | "exchange" | "repair">("refund");
  const [disposition, setDisposition] = useState(
    eligible[0]?.kind === "fabric" ? "fabric_remnant" : "quarantine",
  );
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [result, setResult] = useState<ReturnResult | null>(null);
  const selected = eligible.find((line) => line.id === lineId);
  const fabric = selected?.kind === "fabric";
  const tailoring = selected?.kind === "tailoring";
  const submit = useMutation({
    mutationFn: async () => {
      if (!selected || !reason.trim())
        throw new Error("Select the returned item and enter the defect");
      if (resolution === "exchange" && (!replacement.trim() || !salesperson))
        throw new Error("Scan the replacement and select its credited Salesperson");
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("record_defective_return", {
        p_request: crypto.randomUUID(),
        p_original_bill: receipt.id,
        p_order_item: selected.id,
        p_quantity: Number(quantity),
        p_resolution: resolution,
        p_disposition: disposition,
        p_reason: reason.trim(),
        p_replacement_barcode: resolution === "exchange" ? replacement.trim() : null,
        p_salesperson: resolution === "exchange" ? salesperson : null,
        p_payment_method: paymentMethod,
      });
      if (error) throw error;
      return data as ReturnResult;
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(`Defective return ${data.code} recorded`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Return failed"),
  });
  if (!eligible.length) return null;
  const changeResolution = (value: "refund" | "exchange" | "repair") => {
    setResolution(value);
    setDisposition(value === "repair" ? "repair" : "quarantine");
  };
  return (
    <Panel
      title="Defective item return"
      description="Creates a separate return case against this permanent bill. Defective goods are never restored as normal sellable stock."
    >
      {result ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <RotateCcw className="size-5" />
          <strong>{result.code}</strong>
          <StatusBadge status={result.status.replaceAll("_", " ")} />
          {result.credit_note ? (
            <span>
              Credit note {result.credit_note} · {reportMoney(result.credit_paise ?? 0)}
            </span>
          ) : null}
          {result.exchange_bill ? <span>Exchange bill {result.exchange_bill}</span> : null}
          <Button variant="outline" size="sm" onClick={() => setResult(null)}>
            Record another
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="text-sm lg:col-span-2">
            Bill item
            <select
              className="mt-1 h-11 w-full rounded border bg-background px-3"
              value={lineId}
              disabled={disabled || submit.isPending}
              onChange={(event) => {
                const next = eligible.find((line) => line.id === event.target.value);
                setLineId(event.target.value);
                setQuantity(next?.kind === "fabric" ? next.quantity : "1");
                if (resolution === "repair") setDisposition("repair");
                else setDisposition(next?.kind === "fabric" ? "fabric_remnant" : "quarantine");
                if (next?.kind !== "product" && resolution === "exchange") {
                  setResolution("refund");
                  setDisposition(next?.kind === "fabric" ? "fabric_remnant" : "quarantine");
                }
              }}
            >
              {eligible.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} · {line.barcode ?? `${line.quantity} ${line.unit}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Resolution
            <select
              className="mt-1 h-11 w-full rounded border bg-background px-3"
              value={resolution}
              disabled={disabled || submit.isPending}
              onChange={(event) =>
                changeResolution(event.target.value as "refund" | "exchange" | "repair")
              }
            >
              <option value="refund">Refund / credit note</option>
              {!fabric && !tailoring ? <option value="exchange">Exchange</option> : null}
              <option value="repair">Repair</option>
            </select>
          </label>
          <label className="text-sm">
            Stock handling
            <select
              className="mt-1 h-11 w-full rounded border bg-background px-3"
              value={disposition}
              disabled={disabled || submit.isPending || resolution === "repair"}
              onChange={(event) => setDisposition(event.target.value)}
            >
              {fabric ? <option value="fabric_remnant">Quarantine as fabric remnant</option> : null}
              <option value="quarantine">Quarantine</option>
              <option value="depleted">Deplete / discard</option>
              {resolution === "repair" ? <option value="repair">Held for repair</option> : null}
            </select>
          </label>
          {fabric ? (
            <label className="text-sm">
              Returned metres
              <Input
                className="mt-1"
                type="number"
                min="0.001"
                step="0.001"
                max={selected?.quantity}
                value={quantity}
                disabled={disabled || submit.isPending}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          ) : null}
          <label className={fabric ? "text-sm" : "text-sm lg:col-span-2"}>
            Defect / reason
            <Input
              className="mt-1"
              placeholder="Damage, incorrect size, colour issue…"
              value={reason}
              disabled={disabled || submit.isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {resolution === "exchange" ? (
            <>
              <label className="text-sm lg:col-span-2">
                Replacement garment barcode
                <div className="mt-1 flex gap-2">
                  <Input
                    value={replacement}
                    disabled={disabled || submit.isPending}
                    onChange={(event) => setReplacement(event.target.value)}
                  />
                  <BarcodeCameraButton
                    disabled={disabled || submit.isPending}
                    onScan={setReplacement}
                  />
                </div>
              </label>
              <SalespersonPicker
                id="defective-exchange-salesperson"
                value={salesperson}
                onChange={setSalesperson}
                disabled={disabled || submit.isPending}
              />
            </>
          ) : null}
          {resolution !== "repair" ? (
            <label className="text-sm">
              {resolution === "refund" ? "Refund method" : "Settlement method"}
              <select
                className="mt-1 h-11 w-full rounded border bg-background px-3"
                value={paymentMethod}
                disabled={disabled || submit.isPending}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
          ) : null}
          <div className="flex items-end lg:col-span-2">
            <Button
              disabled={disabled || submit.isPending || !reason.trim() || Number(quantity) <= 0}
              onClick={() => submit.mutate()}
            >
              <AlertTriangle className="mr-2 size-4" />
              {submit.isPending ? "Recording return…" : "Record defective return"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
