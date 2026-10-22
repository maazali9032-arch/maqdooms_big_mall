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

/** A no-cash swap: only a physical shop-finished piece on the original bill may be returned. */
export function FinishedProductExchange({ receipt, disabled, onComplete }: Props) {
  const [returnBarcode, setReturnBarcode] = useState("");
  const [replacementBarcode, setReplacementBarcode] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const finishedLines = receipt.lines.filter((line) => line.kind === "product" && line.barcode);
  const exchange = useMutation({
    mutationFn: async () => {
      if (!returnBarcode.trim() || !replacementBarcode.trim() || !salesperson)
        throw new Error("Scan the returned and replacement pieces, then select the Salesperson");
      const { data: code, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: Error | null }>
      )("complete_finished_product_exchange", {
        p_request: crypto.randomUUID(),
        p_original_bill: receipt.id,
        p_return_barcode: returnBarcode.trim(),
        p_replacement_barcode: replacementBarcode.trim(),
        p_salesperson: salesperson,
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
      setSalesperson("");
      toast.success("Exchange completed and new bill created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Exchange failed"),
  });

  if (!finishedLines.length) return null;
  return (
    <Panel
      title="Exchange shop-finished product"
      description="Only a sold shop-finished piece from this bill can be exchanged. The replacement must be an available Showroom piece at the same selling price. Fabric and customer stitching orders cannot be exchanged."
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Eligible original piece{finishedLines.length === 1 ? "" : "s"}:{" "}
          {finishedLines.map((line) => line.barcode).join(", ")}
        </p>
        <Input
          aria-label="Returned finished product barcode"
          placeholder="Scan returned finished product barcode"
          value={returnBarcode}
          disabled={disabled || exchange.isPending}
          onChange={(event) => setReturnBarcode(event.target.value)}
        />
        <Input
          aria-label="Replacement finished product barcode"
          placeholder="Scan replacement finished product barcode"
          value={replacementBarcode}
          disabled={disabled || exchange.isPending}
          onChange={(event) => setReplacementBarcode(event.target.value)}
        />
        <SalespersonPicker
          id="exchange-salesperson"
          value={salesperson}
          onChange={setSalesperson}
          disabled={disabled || exchange.isPending}
        />
        <Button
          disabled={
            disabled ||
            exchange.isPending ||
            !returnBarcode.trim() ||
            !replacementBarcode.trim() ||
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
