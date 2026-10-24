import { useEffect, useRef, useState } from "react";
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
import { StockImageInput } from "./StockImageInput";
import { saveStockImages } from "./stock-images";
import type { Database } from "@/integrations/supabase/types";
type Functions = Database["public"]["Functions"];
type ScanRequest = { p_request: string; p_code: string };
type PricedReceipt = ScanRequest & {
  p_prices: { piece_number: number; sp_paise: number }[];
  stitching_paise: number;
  images: { all: File | null; pieces: Record<number, File | null> };
};
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
  initialCode,
  hideScanner = false,
  onBusyChange,
}: {
  onLoaded?: () => void;
  embedded?: boolean;
  initialCode?: string;
  hideScanner?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { isOwner, can, userId } = useSession();
  const receiveAllowed = isOwner || can("production.receive");
  const priceAllowed = isOwner || can("stock.price_finished");
  const [code, setCode] = useState(""),
    [scanned, setScanned] = useState("");
  const [reason, setReason] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [allPrice, setAllPrice] = useState("");
  const [stitchingCost, setStitchingCost] = useState("");
  const [jobImage, setJobImage] = useState<File | null>(null);
  const [pieceImages, setPieceImages] = useState<Record<number, File | null>>({});
  const [receiptPending, setReceiptPending] = useState<PricedReceipt | null>(null);
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
      // Identification is read-only. New pieces are received only after every SP is entered.
      const { data, error } = await supabase.rpc("production_job_document", {
        p_code: request.p_code,
      });
      if (error) throw error;
      if (!data) throw new Error("No production matches this ID");
      return (data as unknown as { id: string }).id;
    },
    onSuccess: (id) => {
      setScanned(id);
      setPrices({});
      setAllPrice("");
      setStitchingCost("");
      setJobImage(null);
      setPieceImages({});
      setReason("");
      refresh();
      onLoaded?.();
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });
  const receivePriced = useMutation({
    mutationFn: async (request: PricedReceipt) => {
      setReceiptPending(request);
      const { images, stitching_paise, ...rpcRequest } = request;
      const saveCost = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: Error | null }>
      ).call(supabase, "save_production_completion_cost", {
        p_job: job.data!.id,
        p_stitching_total_paise: stitching_paise,
      });
      if (saveCost.error) throw saveCost.error;
      const { error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: Error | null }>
      ).call(supabase, "receive_production_barcode_priced", rpcRequest);
      if (error) throw error;
      const { data: received, error: piecesError } = await supabase.rpc(
        "workshop_production_pieces",
        { p_job: job.data!.id },
      );
      if (piecesError) throw piecesError;
      if (!userId) throw new Error("Sign in again before saving stock images");
      await saveStockImages(
        userId,
        (received as unknown as Piece[]).flatMap((piece) => {
          const file = images.pieces[piece.piece_number] ?? images.all;
          return file ? [{ kind: "finished_product" as const, itemId: piece.id, file }] : [];
        }),
      );
    },
    onSuccess: () => {
      setReceiptPending(null);
      setPrices({});
      setJobImage(null);
      setPieceImages({});
      refresh();
      onLoaded?.();
      toast.success("Finished pieces received with saved SP and barcodes");
    },
    onError: (error) => {
      if (definiteDatabaseRejection(error)) setReceiptPending(null);
      toast.error(error.message);
    },
  });
  function confirmPricedReceipt() {
    try {
      if (receiptPending) {
        receivePriced.mutate(receiptPending);
        return;
      }
      if (!receiveAllowed || !priceAllowed || !job.data)
        throw new Error("Receiving and finished-product pricing permissions required");
      const p_prices = Array.from({ length: job.data.quantity }, (_, i) => {
        const sp = receiptCost(prices[`piece-${i + 1}`] ?? "");
        if (sp <= 0) throw new Error(`Enter a positive SP for piece ${i + 1}`);
        return { piece_number: i + 1, sp_paise: sp };
      });
      receivePriced.mutate({
        p_request: crypto.randomUUID(),
        p_code: job.data.code,
        p_prices,
        stitching_paise: receiptCost(stitchingCost),
        images: { all: jobImage, pieces: pieceImages },
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
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
  const frozen =
    scan.isPending ||
    savePrice.isPending ||
    receivePriced.isPending ||
    !!receiptPending ||
    !!pricePending;
  const initialPricesReady = (() => {
    try {
      return (
        !!job.data &&
        Array.from(
          { length: job.data.quantity },
          (_, i) => receiptCost(prices[`piece-${i + 1}`] ?? "") > 0,
        ).every(Boolean)
      );
    } catch {
      return false;
    }
  })();
  const started = useRef(false);
  const startScan = scan.mutate;
  useEffect(() => {
    if (initialCode && !started.current) {
      started.current = true;
      startScan({ p_request: crypto.randomUUID(), p_code: initialCode });
    }
  }, [initialCode, startScan]);
  useEffect(() => {
    onBusyChange?.(frozen);
  }, [frozen, onBusyChange]);
  if (!receiveAllowed && !priceAllowed) return null;
  const content = (
    <div className="space-y-4">
      {!hideScanner && (
        <BarcodeEntry
          value={code}
          onChange={setCode}
          label="Workshop Production ID"
          placeholder="Scan or type Production ID"
          disabled={frozen}
          onScan={(value) => scan.mutate({ p_request: crypto.randomUUID(), p_code: value })}
        />
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
          {!job.data.received_at && pieces.data?.length === 0 && (
            <fieldset disabled={frozen} className="space-y-3 rounded-xl border p-3">
              <h3 className="font-semibold">Set SP before generating finished-item barcodes</h3>
              <p className="text-sm">
                Confirm every piece has arrived. Enter a positive SP for each piece, then receive
                the batch and generate its barcodes together.
              </p>
              {!priceAllowed && (
                <p role="alert">
                  Finished-product pricing permission is required before these pieces can be
                  received.
                </p>
              )}
              {priceAllowed && (
                <>
                  <label className="block text-sm">
                    Whole-job stitching CP ₹
                    <Input
                      inputMode="decimal"
                      value={stitchingCost}
                      onChange={(event) => setStitchingCost(event.target.value)}
                      placeholder="Total stitching cost for this complete job"
                    />
                    <span className="text-xs text-muted-foreground">
                      The complete amount is divided equally across all pieces when CP is finalized.
                    </span>
                  </label>
                  <div className="rounded-lg bg-muted/30 p-3">
                    <StockImageInput
                      label="Add one image for all finished pieces"
                      file={jobImage}
                      onChange={setJobImage}
                      disabled={frozen}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Each piece uses this image unless its own row has another image.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-sm">
                      SP for all pieces ₹
                      <Input
                        aria-label="Initial SP for all pieces"
                        inputMode="decimal"
                        value={allPrice}
                        onChange={(e) => setAllPrice(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      onClick={() => {
                        try {
                          if (receiptCost(allPrice) <= 0) throw new Error("Enter a positive SP");
                          setPrices(
                            Object.fromEntries(
                              Array.from({ length: job.data.quantity }, (_, i) => [
                                `piece-${i + 1}`,
                                allPrice,
                              ]),
                            ),
                          );
                        } catch (error) {
                          toast.error((error as Error).message);
                        }
                      }}
                    >
                      Apply SP to all pieces
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Array.from({ length: job.data.quantity }, (_, i) => {
                      const spec = job.data.pieces?.find((p) => p.piece_number === i + 1);
                      return (
                        <div key={i} className="space-y-1 rounded-lg border p-3 text-sm">
                          <strong>
                            Piece {i + 1} · {spec?.product ?? job.data.product}
                          </strong>
                          <p>
                            {spec?.design ?? job.data.design} · Size{" "}
                            {spec?.size ?? job.data.size ?? "Not recorded"}
                          </p>
                          SP ₹
                          <Input
                            aria-label={`Initial SP for piece ${i + 1}`}
                            inputMode="decimal"
                            value={prices[`piece-${i + 1}`] ?? ""}
                            onChange={(e) =>
                              setPrices({ ...prices, [`piece-${i + 1}`]: e.target.value })
                            }
                          />
                          <StockImageInput
                            label="Add image for this piece"
                            file={pieceImages[i + 1] ?? null}
                            inheritedFile={jobImage}
                            inheritedText="From production"
                            onChange={(image) =>
                              setPieceImages((current) => ({ ...current, [i + 1]: image }))
                            }
                            disabled={frozen}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <Button
                disabled={
                  !receiveAllowed || !priceAllowed || receivePriced.isPending || !initialPricesReady
                }
                onClick={confirmPricedReceipt}
              >
                Receive and generate priced barcodes
              </Button>
            </fieldset>
          )}
          {receiptPending && !receivePriced.isPending && (
            <div role="alert" className="space-y-2">
              <p>
                The receipt result is uncertain. Retry the same prices and request before changing
                this order.
              </p>
              <Button onClick={confirmPricedReceipt}>Retry same priced receipt</Button>
            </div>
          )}
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
                  <Button disabled={savePrice.isPending} onClick={() => savePrice.mutate()}>
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
          ? "Scan to review the batch, enter SP for every finished piece, then confirm receipt and barcode generation. Existing receipts open their saved pieces."
          : "Scan an already received Production ID to set Workshop selling prices."
      }
    >
      {content}
    </Panel>
  );
}
