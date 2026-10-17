import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { useProductionDocument } from "@/features/tailoring/ProductionDocument";
import { BarcodeSticker } from "./BarcodeSticker";
import { printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";
import { fabricMoneyInput as receiptCost } from "./fabric-entry-input";
import { reportMoney } from "@/features/reports/report-value";
import type { Database } from "@/integrations/supabase/types";
type Functions = Database["public"]["Functions"];
type ScanRequest = { p_request: string; p_code: string };
type Piece = {
  id: string;
  job_id: string;
  barcode: string;
  product: string;
  design: string;
  design_code?: string | null;
  size: string | null;
  piece_number: number;
  status: string;
  location_kind: string;
  sp_paise: number | null;
  cp_paise: number | null;
  cp_visible: boolean;
};
export function ProductionReceipt({
  onLoaded,
  embedded = false,
}: {
  onLoaded?: () => void;
  embedded?: boolean;
}) {
  const { isOwner, can } = useSession();
  const receiveAllowed = isOwner || can("production.receive");
  const priceAllowed = isOwner || can("stock.price_finished");
  const [code, setCode] = useState(""),
    [scanned, setScanned] = useState("");
  const [reason, setReason] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [allPrice, setAllPrice] = useState("");
  const [scanPending, setScanPending] = useState<ScanRequest | null>(null);
  const [pricePending, setPricePending] = useState<
    Functions["set_workshop_product_sp"]["Args"] | null
  >(null);
  const print = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const job = useProductionDocument(scanned);
  const pieces = useQuery({
    queryKey: ["finished-product-inventory", "production", job.data?.id],
    enabled: !!job.data?.id && (receiveAllowed || priceAllowed),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("workshop_production_pieces", {
        p_job: job.data!.id,
      });
      if (error) throw error;
      return data as unknown as Piece[];
    },
  });
  const refresh = () => {
    for (const key of [
      "production-document",
      "finished-product-inventory",
      "finished-products",
      "owner-production",
      "production-costs",
      "location-ledger",
      "finished-product-movements",
      "workshop-receipt-queue",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const scan = useMutation({
    mutationFn: async (request: ScanRequest) => {
      if (receiveAllowed) {
        setScanPending(request);
        const { data, error } = await supabase.rpc("receive_production_barcode", request);
        if (error) throw error;
        return data as string;
      }
      const { data, error } = await supabase.rpc("production_job_document", {
        p_code: request.p_code,
      });
      if (error) throw error;
      if (!data) throw new Error("No production matches this ID");
      return (data as unknown as { id: string }).id;
    },
    onSuccess: (id) => {
      setScanPending(null);
      setScanned(id);
      setPrices({});
      setAllPrice("");
      setReason("");
      refresh();
      onLoaded?.();
      if (receiveAllowed)
        toast.success("Complete batch is in Workshop. Set SP and print its piece labels.");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setScanPending(null);
      toast.error(e.message);
    },
  });
  const savePrice = useMutation({
    mutationFn: async () => {
      const edits = (pieces.data ?? []).filter(
        (p) => p.location_kind === "workshop" && p.status === "available" && prices[p.id]?.trim(),
      );
      if (!pricePending && (!job.data || !edits.length))
        throw new Error("Enter SP for the Workshop pieces");
      const args = pricePending ?? {
        p_request: crypto.randomUUID(),
        p_job: job.data!.id,
        p_updates: edits.map((p) => ({ piece_id: p.id, sp_paise: receiptCost(prices[p.id]!) })),
        p_reason: reason.trim() || "Finished product SP entered at Workshop",
      };
      setPricePending(args);
      const { error } = await supabase.rpc("set_workshop_product_sp", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPricePending(null);
      setPrices({});
      refresh();
      toast.success("SP saved. Labels use the saved prices.");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPricePending(null);
      toast.error(e.message);
    },
  });
  if (!receiveAllowed && !priceAllowed) return null;
  const frozen = scan.isPending || savePrice.isPending || !!scanPending || !!pricePending;
  const content = (
    <div className="space-y-4">
      <BarcodeEntry
        value={code}
        onChange={setCode}
        label="Workshop Production ID"
        placeholder="Scan or type Production ID"
        disabled={frozen}
        onScan={(value) => scan.mutate({ p_request: crypto.randomUUID(), p_code: value })}
      />
      {scanPending && !scan.isPending && (
        <div role="alert" className="space-y-2 text-sm">
          <p>The receipt result is uncertain. Retry the same scan before starting another batch.</p>
          <Button onClick={() => scan.mutate(scanPending)}>Retry same production scan</Button>
        </div>
      )}
      {job.error && (
        <p role="alert">
          {job.error.message}{" "}
          <Button variant="outline" onClick={() => void job.refetch()}>
            Retry details
          </Button>
        </p>
      )}
      {scanned && job.isPending && <p>Loading production…</p>}
      {job.data && (
        <>
          <div className="rounded-lg border p-3 text-sm">
            <h3 className="font-semibold">
              {job.data.product} · {job.data.quantity} pieces
            </h3>
            <p className="break-all font-mono text-xs">{job.data.code}</p>
            <p>{job.data.received_at ? "Received into Workshop" : "Not received into Workshop"}</p>
            {job.data.cp_total_paise != null && (
              <p>Total issued fabric CP: {reportMoney(String(job.data.cp_total_paise))}</p>
            )}
          </div>
          {pieces.error && (
            <p role="alert">
              Could not load pieces.{" "}
              <Button variant="outline" onClick={() => void pieces.refetch()}>
                Retry pieces
              </Button>
            </p>
          )}
          {pieces.isPending && <p>Loading pieces…</p>}
          {!!pieces.data?.length && (
            <>
              {priceAllowed && (
                <fieldset disabled={frozen} className="flex flex-wrap items-end gap-2">
                  <label className="min-w-0 text-sm">
                    SP per piece ₹
                    <Input
                      aria-label="SP for all Workshop pieces"
                      inputMode="decimal"
                      value={allPrice}
                      onChange={(e) => setAllPrice(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() => {
                      try {
                        receiptCost(allPrice);
                        setPrices(
                          Object.fromEntries(
                            pieces
                              .data!.filter(
                                (p) => p.location_kind === "workshop" && p.status === "available",
                              )
                              .map((p) => [p.id, allPrice]),
                          ),
                        );
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    Apply SP to all Workshop pieces
                  </Button>
                </fieldset>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {pieces.data.map((p) => (
                  <div key={p.id} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm">
                    <strong>
                      Piece {p.piece_number} · {p.product}
                    </strong>
                    <p>
                      {p.design_code || p.design} · Size {p.size ?? "Not recorded"}
                    </p>
                    <p className="break-all font-mono text-xs">{p.barcode}</p>
                    {p.cp_visible && p.cp_paise != null && (
                      <p>CP: {reportMoney(String(p.cp_paise))}</p>
                    )}
                    <p>
                      Saved SP: {p.sp_paise == null ? "Not set" : reportMoney(String(p.sp_paise))}
                    </p>
                    {priceAllowed && (
                      <label className="block">
                        New SP ₹
                        <Input
                          aria-label={`SP for piece ${p.piece_number}`}
                          inputMode="decimal"
                          disabled={
                            frozen || p.location_kind !== "workshop" || p.status !== "available"
                          }
                          value={prices[p.id] ?? ""}
                          onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
              {priceAllowed && (
                <div className="space-y-2">
                  <Input
                    aria-label="Pricing note optional"
                    placeholder="Pricing note (optional)"
                    disabled={frozen}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    disabled={savePrice.isPending || !!scanPending}
                    onClick={() => savePrice.mutate()}
                  >
                    {pricePending ? "Retry same SP request" : "Save Workshop SP"}
                  </Button>
                </div>
              )}
              <div ref={print} className="hidden">
                {pieces.data
                  .filter((p) => p.sp_paise != null)
                  .map((p) => (
                    <BarcodeSticker
                      key={p.id}
                      barcode={p.barcode}
                      name={p.product}
                      description={`${p.design_code || p.design || ""} · Size ${p.size ?? "Not recorded"}`}
                      price={reportMoney(String(p.sp_paise))}
                    />
                  ))}
              </div>
              {(isOwner || can("stock.print_barcode")) && (
                <Button
                  variant="outline"
                  disabled={frozen || !pieces.data.some((p) => p.sp_paise != null)}
                  onClick={() =>
                    print.current && printFabricLabel(print.current, "Finished product labels")
                  }
                >
                  Print saved product labels
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <Panel
      title="Scan Production Barcode"
      description={
        receiveAllowed
          ? "Scan only when every piece has arrived. This marks the complete batch finished and receives it into Workshop. Scanning again opens the same pieces."
          : "Scan an already received Production ID to set Workshop selling prices."
      }
    >
      {content}
    </Panel>
  );
}
