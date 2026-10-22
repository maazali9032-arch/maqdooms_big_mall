import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { SalespersonPicker } from "@/features/salesperson/SalespersonPicker";
import type { CounterReceipt } from "./CounterBillReceipt";

type Props = {
  receipt: CounterReceipt;
  disabled: boolean;
  onComplete: (receipt: CounterReceipt) => void;
};

export function FinishedProductExchange({ receipt, disabled, onComplete }: Props) {
  const [returnBarcode, setReturnBarcode] = useState("");
  const [replacementBarcode, setReplacementBarcode] = useState("");
  const [returns, setReturns] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<string[]>([]);
  const [salesperson, setSalesperson] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const finishedLines = receipt.lines.filter((line) => line.kind === "product" && line.barcode);
  const exchange = useMutation({
    mutationFn: async () => {
      if (!returns.length || !replacements.length || !salesperson)
        throw new Error("Add returned and replacement pieces, then select the Salesperson");
      const { data: code, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: Error | null }>
      )("complete_finished_product_exchange", {
        p_request: crypto.randomUUID(),
        p_original_bill: receipt.id,
        p_returns: returns,
        p_replacements: replacements,
        p_salesperson: salesperson,
        p_payment_method: paymentMethod,
      });
      if (error) throw error;
      if (!code) throw new Error("Exchange was saved but its new bill was not returned");
      const result = await supabase.rpc("counter_bill", { p_code: code });
      if (result.error || !result.data)
        throw result.error ?? new Error("New exchange bill could not load");
      return result.data as unknown as CounterReceipt;
    },
    onSuccess: (newReceipt) => {
      onComplete(newReceipt);
      setReturnBarcode("");
      setReplacementBarcode("");
      setReturns([]);
      setReplacements([]);
      setSalesperson("");
      setPaymentMethod("cash");
      toast.success("Exchange completed and new bill created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Exchange failed"),
  });
  if (!finishedLines.length) return null;
  return (
    <Panel
      title="Exchange shop-finished products"
      description="Only sold shop-finished pieces from this bill can be returned. Scan one or more replacements from active Showroom floors; the new bill records the amount collected or refunded. Fabric and customer stitching orders cannot be exchanged."
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Eligible original pieces: {finishedLines.map((line) => line.barcode).join(", ")}
        </p>
        <BarcodeList
          label="Returned finished product barcode"
          placeholder="Scan returned barcode, then add it"
          value={returnBarcode}
          values={returns}
          disabled={disabled || exchange.isPending}
          onChange={setReturnBarcode}
          onAdd={() => {
            const code = returnBarcode.trim();
            if (code && !returns.includes(code)) setReturns([...returns, code]);
            setReturnBarcode("");
          }}
          onRemove={(code) => setReturns(returns.filter((value) => value !== code))}
        />
        <BarcodeList
          label="Replacement finished product barcode"
          placeholder="Scan replacement barcode, then add it"
          value={replacementBarcode}
          values={replacements}
          disabled={disabled || exchange.isPending}
          onChange={setReplacementBarcode}
          onAdd={() => {
            const code = replacementBarcode.trim();
            if (code && !replacements.includes(code)) setReplacements([...replacements, code]);
            setReplacementBarcode("");
          }}
          onRemove={(code) => setReplacements(replacements.filter((value) => value !== code))}
        />
        <SalespersonPicker
          id="exchange-salesperson"
          value={salesperson}
          onChange={setSalesperson}
          disabled={disabled || exchange.isPending}
        />
        <select
          aria-label="Exchange payment or refund method"
          className="h-11 w-full rounded border bg-background p-2"
          value={paymentMethod}
          disabled={disabled || exchange.isPending}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="upi">UPI</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="mixed">Mixed</option>
        </select>
        <Button
          disabled={
            disabled ||
            exchange.isPending ||
            !returns.length ||
            !replacements.length ||
            !salesperson
          }
          onClick={() => exchange.mutate()}
        >
          {exchange.isPending ? "Completing exchange…" : "Complete exchange and create new bill"}
        </Button>
      </div>
    </Panel>
  );
}

function BarcodeList({
  label,
  placeholder,
  value,
  values,
  disabled,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  value: string;
  values: string[];
  disabled: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label={label}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !value.trim()}
          onClick={onAdd}
        >
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((code) => (
            <Button
              key={code}
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => onRemove(code)}
            >
              {code} ×
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
