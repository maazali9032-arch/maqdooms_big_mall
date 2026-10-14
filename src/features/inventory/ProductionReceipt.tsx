import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { BarcodeGraphic, useProductionDocument } from "@/features/tailoring/ProductionDocument";
import { printFabricLabel } from "./fabric-label";
import { receiptCost, definiteDatabaseRejection } from "./consumable-input";
import type { Database } from "@/integrations/supabase/types";
type Functions = Database["public"]["Functions"];
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
export function ProductionReceipt() {
  const { isOwner, can } = useSession();
  const receiveAllowed = isOwner || can("production.receive");
  const priceAllowed = isOwner || can("stock.price_finished");
  const [code, setCode] = useState("");
  const [scanned, setScanned] = useState("");
  const [reason, setReason] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [allPrice, setAllPrice] = useState("");
  const [receiptPending, setReceiptPending] = useState<
    Functions["complete_production_batch"]["Args"] | null
  >(null);
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
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const receive = useMutation({
    mutationFn: async () => {
      if (!receiptPending && (!job.data || job.data.status !== "completed" || !reason.trim()))
        throw new Error("Load a completed Production ID and confirm receipt of every piece");
      const args = receiptPending ?? {
        p_request: crypto.randomUUID(),
        p_job: job.data!.id,
        p_expected_status: "completed",
        p_reason: reason.trim(),
      };
      setReceiptPending(args);
      const { error } = await supabase.rpc("complete_production_batch", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setReceiptPending(null);
      refresh();
      toast.success("All pieces received into Workshop; barcodes and fabric CP generated");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setReceiptPending(null);
      toast.error(e.message);
    },
  });
  const savePrice = useMutation({
    mutationFn: async () => {
      const edits = (pieces.data ?? []).filter(
        (p) => p.location_kind === "workshop" && p.status === "available" && prices[p.id]?.trim(),
      );
      if (!pricePending && (!job.data || !edits.length || !reason.trim()))
        throw new Error("Enter SP for Workshop pieces and a pricing confirmation");
      const args = pricePending ?? {
        p_request: crypto.randomUUID(),
        p_job: job.data!.id,
        p_updates: edits.map((p) => ({ piece_id: p.id, sp_paise: receiptCost(prices[p.id]!) })),
        p_reason: reason.trim(),
      };
      setPricePending(args);
      const { error } = await supabase.rpc("set_workshop_product_sp", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPricePending(null);
      setPrices({});
      refresh();
      toast.success("Workshop SP saved; labels show the saved price");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPricePending(null);
      toast.error(e.message);
    },
  });
  if (!receiveAllowed && !priceAllowed) return null;
  const frozen = receive.isPending || savePrice.isPending || !!receiptPending || !!pricePending;
  return (
    <Panel
      title="Receive finished production & set SP"
      description="Scan its Production ID when every piece arrives at Workshop. Set SP and print labels before transferring pieces to Showroom."
    >
      <div className="space-y-3">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPrices({});
            setScanned(code.trim());
          }}
        >
          <Input
            aria-label="Workshop Production ID"
            placeholder="Scan or type Production ID"
            disabled={frozen}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button disabled={frozen || !code.trim()}>Load production</Button>
        </form>
        {job.error && <p role="alert">{job.error.message}</p>}
        {scanned && job.isPending && <p>Loading production…</p>}
        {job.data && (
          <>
            <p className="font-semibold">
              {job.data.code} · {job.data.product} · {job.data.design} · Size{" "}
              {job.data.size ?? "Not recorded"} · {job.data.quantity} pieces
            </p>
            <div className="divide-y rounded border">
              {job.data.fabrics.map((f, i) => (
                <div key={i} className="flex flex-wrap justify-between gap-2 p-2">
                  <span>
                    {f.name} · <span className="break-all font-mono text-xs">{f.barcode}</span>
                  </span>
                  <span>
                    {(f.quantity_mm / 1000).toFixed(3)} m · {f.source} · {f.issue_type}
                  </span>
                </div>
              ))}
            </div>
            {job.data.cp_total_paise != null && (
              <p>
                Total issued fabric CP: ₹{(job.data.cp_total_paise / 100).toFixed(2)} · CP per
                piece: ₹{(job.data.cp_total_paise / job.data.quantity / 100).toFixed(2)}
              </p>
            )}
            <p>
              Cost basis: all recorded fabric issues, including additional fabric. Actual
              consumption is not recorded.
            </p>
            <Input
              aria-label="Workshop receipt or price confirmation"
              disabled={frozen}
              placeholder="Receipt / pricing confirmation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {!job.data.received_at && receiveAllowed && (
              <Button
                disabled={receive.isPending || (!receiptPending && job.data.status !== "completed")}
                onClick={() => receive.mutate()}
              >
                {receiptPending
                  ? "Retry same whole receipt"
                  : `Receive all ${job.data.quantity} pieces into Workshop`}
              </Button>
            )}
            {!job.data.received_at && job.data.status !== "completed" && (
              <p>Production must be marked finished before Workshop receipt.</p>
            )}
            {pieces.error && <p role="alert">{pieces.error.message}</p>}
            {!!pieces.data?.length && (
              <>
                {priceAllowed && (
                  <fieldset disabled={frozen} className="flex flex-wrap gap-2">
                    <Input
                      aria-label="SP for all Workshop pieces"
                      placeholder="SP per piece (₹)"
                      value={allPrice}
                      onChange={(e) => setAllPrice(e.target.value)}
                    />
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
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Piece / barcode</th>
                        <th>CP per piece</th>
                        <th>Saved SP</th>
                        {priceAllowed && <th>New SP (₹)</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pieces.data.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2">
                            Piece {p.piece_number}
                            <br />
                            <span className="break-all font-mono text-xs">{p.barcode}</span>
                          </td>
                          <td>
                            {p.cp_visible && p.cp_paise != null
                              ? `₹${(p.cp_paise / 100).toFixed(2)}`
                              : "Restricted"}
                          </td>
                          <td>
                            {p.sp_paise != null ? `₹${(p.sp_paise / 100).toFixed(2)}` : "Not set"}
                          </td>
                          {priceAllowed && (
                            <td>
                              <Input
                                aria-label={`SP for piece ${p.piece_number}`}
                                disabled={
                                  frozen ||
                                  p.location_kind !== "workshop" ||
                                  p.status !== "available"
                                }
                                value={prices[p.id] ?? ""}
                                onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {priceAllowed && (
                  <Button disabled={savePrice.isPending} onClick={() => savePrice.mutate()}>
                    {pricePending ? "Retry same SP request" : "Save Workshop SP"}
                  </Button>
                )}
                <div ref={print} className="grid gap-3 sm:grid-cols-2">
                  {pieces.data
                    .filter((p) => p.sp_paise != null)
                    .map((p) => (
                      <article key={p.id} className="break-inside-avoid rounded border p-3">
                        <p className="font-semibold">{p.product}</p>
                        <p>
                          {p.design_code ? `${p.design_code} · ` : ""}
                          {p.design} · Size {p.size ?? "Not recorded"}
                        </p>
                        <p>SP: ₹{(p.sp_paise! / 100).toFixed(2)}</p>
                        <BarcodeGraphic code={p.barcode} />
                        <p className="break-all font-mono text-xs">{p.barcode}</p>
                      </article>
                    ))}
                </div>
                {can("stock.print_barcode") && (
                  <Button
                    variant="outline"
                    disabled={!pieces.data.some((p) => p.sp_paise != null) || frozen}
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
    </Panel>
  );
}
