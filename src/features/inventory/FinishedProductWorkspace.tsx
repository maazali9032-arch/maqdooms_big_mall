import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { ProductionReceipt } from "./ProductionReceipt";
import { FinishedProductInventory } from "./FinishedProductInventory";
import { CustomerTailoringReceipt } from "./CustomerTailoringReceipt";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import type { FinishedReceiptMatch } from "./finished-receipt-lookup";
export function FinishedProductWorkspace() {
  const { isOwner, roles, can } = useSession();
  const customerReceiptAllowed =
    isOwner ||
    (roles.includes("counter") && can("pos.issue_to_tailoring")) ||
    can("production.receive");
  const productionReceiptAllowed =
    isOwner || can("production.receive") || can("stock.price_finished");
  const transferAllowed =
    isOwner || (roles.includes("stock_entry") && can("stock.transfer_finished"));
  const [loaded, setLoaded] = useState(false),
    [expanded, setExpanded] = useState(false),
    [code, setCode] = useState("");
  const [childBusy, setChildBusy] = useState(false);
  const [match, setMatch] = useState<FinishedReceiptMatch | null>(null);
  const [matchVersion, setMatchVersion] = useState(0);
  const scan = useMutation({
    mutationFn: async (value: string) => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      ).call(supabase, "resolve_finished_receipt", { p_code: value });
      if (error) throw error;
      const result = data as FinishedReceiptMatch | null;
      if (!result) throw new Error("No matching customer stitching or shop production document");
      if (
        (result.kind === "customer" && !customerReceiptAllowed) ||
        (result.kind === "production" && !productionReceiptAllowed)
      )
        throw new Error("You do not have permission to receive this document type");
      return result;
    },
    onSuccess: (result) => {
      setMatch(result);
      setMatchVersion((version) => version + 1);
      setCode("");
    },
  });
  const existing = useQuery({
    queryKey: ["finished-product-inventory", "exists"],
    enabled: transferAllowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_inventory", { p_limit: 1 });
      if (error) throw error;
      return data as unknown as { id: string }[];
    },
  });
  return (
    <div className="space-y-4">
      <Panel
        title="Receive finished garments"
        description="Scan a customer bill, tailoring job or Production ID. Its source is detected automatically."
      >
        {(customerReceiptAllowed || productionReceiptAllowed) && (
          <BarcodeEntry
            label="Finished garment receipt barcode"
            placeholder="Scan bill, tailoring job or Production ID"
            value={code}
            onChange={setCode}
            onScan={(value) => scan.mutate(value)}
            disabled={scan.isPending || childBusy}
          />
        )}
        {scan.isPending && (
          <p role="status" className="mt-3 text-sm">
            Identifying scanned document…
          </p>
        )}
        {scan.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {scan.error.message}
          </p>
        )}
        {match && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm" role="status">
              <strong>
                {match.kind === "customer" ? "Customer stitching" : "Shop production"}
              </strong>
              <p className="break-all font-mono text-xs">{match.scan_code ?? match.code}</p>
              {match.kind === "production" && (
                <p>
                  {match.name} · {match.status}
                </p>
              )}
            </div>
            <fieldset disabled={scan.isPending}>
              {match.kind === "customer" ? (
                <CustomerTailoringReceipt
                  key={`${match.id}:${matchVersion}`}
                  embedded
                  resolvedJobs={match.jobs}
                  onBusyChange={setChildBusy}
                />
              ) : (
                <ProductionReceipt
                  key={`${match.id}:${matchVersion}`}
                  embedded
                  initialCode={match.id}
                  hideScanner
                  onLoaded={() => setLoaded(true)}
                  onBusyChange={setChildBusy}
                />
              )}
            </fieldset>
          </div>
        )}
      </Panel>
      {existing.error && (
        <p role="alert">
          Could not check existing pieces.{" "}
          <button className="underline" onClick={() => void existing.refetch()}>
            Retry
          </button>
        </p>
      )}
      {transferAllowed && (loaded || !!existing.data?.length) && (
        <details
          className="rounded-xl border bg-card p-4"
          onToggle={(e) => setExpanded(e.currentTarget.open)}
        >
          <summary className="cursor-pointer font-semibold">
            Existing Pieces, Transfers & History
          </summary>
          {expanded && (
            <div className="mt-4">
              <FinishedProductInventory />
            </div>
          )}
        </details>
      )}
    </div>
  );
}
