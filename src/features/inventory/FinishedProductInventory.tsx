import { locationLabel } from "@/shared/utils/location-label";
import { useId, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/shared/utils/format";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";
import { ProductionReceipt } from "./ProductionReceipt";

type Piece = {
  size?: string | null;
  design_code?: string | null;
  sp_paise?: number | null;
  cp_paise?: number | null;
  cp_visible?: boolean;
  production_quantity?: number;
  issued_at?: string | null;
  finished_at?: string | null;
  id: string;
  barcode: string;
  piece_number: number;
  product: string;
  design: string;
  job_code: string;
  status: string;
  location_id: string;
  location: string;
  location_active: boolean;
  quantity: number;
  available: boolean;
};
type Movement = {
  id: string;
  piece_id: string;
  barcode: string;
  product: string;
  design: string;
  job_code: string;
  kind: string;
  quantity: number;
  source: string | null;
  destination: string | null;
  actor: string | null;
  actor_id: string;
  occurred_at: string;
  reason: string;
  reference: string;
  transfer_id: string | null;
};
type Request = {
  p_request: string;
  p_source: string;
  p_destination: string;
  p_pieces: string[];
  p_reason: string;
};

export function FinishedProductInventory() {
  const { isOwner, roles, can } = useSession();
  const allowed = isOwner || (roles.includes("stock_entry") && can("stock.transfer_finished"));
  const workshopAllowed = isOwner || can("production.receive") || can("stock.price_finished");
  const formId = useId();
  const label = useRef<HTMLDivElement>(null);
  const [barcode, setBarcode] = useState("");
  const [scanned, setScanned] = useState<Piece | null>(null);
  const [scannedPieces, setScannedPieces] = useState<Piece[]>([]);
  const qc = useQueryClient();
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [pieceHistory, setPieceHistory] = useState("");
  const [pending, setPending] = useState<Request | null>(null);
  const [posted, setPosted] = useState<string | null>(null);
  const inventory = useInfiniteQuery({
    queryKey: ["finished-product-inventory"],
    enabled: allowed,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("finished_product_inventory", {
        ...(pageParam ? { p_after: pageParam } : {}),
        p_limit: 100,
      });
      if (error) throw error;
      return data as unknown as Piece[];
    },
    getNextPageParam: (page) => (page.length === 100 ? page.at(-1)?.id : undefined),
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["finished-product-movements", pieceHistory],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_movement_history", {
        ...(pieceHistory ? { p_piece: pieceHistory } : {}),
        p_limit: 200,
      });
      if (error) throw error;
      return data as unknown as Movement[];
    },
  });
  const transfer = useMutation({
    mutationFn: async () => {
      if (!allowed) throw new Error("Authorized finished-product transfer staff required");
      if (!pending && (!selected.length || selected.length > 200 || !source || !destination))
        throw new Error("Select 1–200 pieces, source and destination");
      const request = pending ?? {
        p_request: crypto.randomUUID(),
        p_source: source,
        p_destination: destination,
        p_pieces: [...selected].sort(),
        p_reason: reason.trim(),
      };
      setPending(request);
      const { data, error } = await supabase.rpc("transfer_finished_products", request);
      if (error) {
        if (definiteDatabaseRejection(error)) setPending(null);
        throw error;
      }
      setPending(null);
      setSelected([]);
      setScanned(null);
      setScannedPieces([]);
      setBarcode("");
      setReason("");
      setPosted(data);
    },
    onSuccess: () => toast.success("Finished Product transfer posted"),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : ((error as { message?: string }).message ?? "Transfer failed"),
      ),
    onSettled: async () => {
      await Promise.all(
        [
          ["finished-product-inventory"],
          ["finished-product-movements"],
          ["finished-products"],
          ["finished-product-sale"],
          ["location-ledger"],
          ["stock-transfer-history"],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
  const scanPiece = useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("finished_product_transfer_scan", {
        p_barcode: code,
      });
      if (error) throw error;
      const piece = (data as unknown as Piece[])[0];
      if (!piece) throw new Error("No Finished Product matches this barcode");
      if (!piece.available || !piece.location_active)
        throw new Error("This piece is not available at an active location");
      if (!isOwner && locations.data?.find((l) => l.id === piece.location_id)?.kind !== "workshop")
        throw new Error("Staff can transfer only from Workshop");
      if (selected.length && source !== piece.location_id)
        throw new Error("All selected pieces must share one source");
      if (selected.length >= 200 && !selected.includes(piece.id))
        throw new Error("Transfer up to 200 pieces at a time");
      return piece;
    },
    onSuccess: (piece) => {
      if (source !== piece.location_id) setDestination("");
      setSource(piece.location_id);
      setScanned(piece);
      setScannedPieces((current) => [...current.filter((p) => p.id !== piece.id), piece]);
      setSelected((current) => (current.includes(piece.id) ? current : [...current, piece.id]));
      setBarcode("");
    },
    onError: (e) => toast.error(e.message),
  });
  if (!allowed) return workshopAllowed ? <ProductionReceipt /> : null;
  const loaded = inventory.data?.pages.flat() ?? [];
  const rows = [
    ...loaded.filter((p) => !scannedPieces.some((s) => s.id === p.id)),
    ...scannedPieces,
  ];
  const src = locations.data?.find((l) => l.id === source);
  const destinations =
    locations.data?.filter(
      (l) =>
        l.active &&
        ((src?.kind === "workshop" && l.kind === "showroom_sublocation") ||
          (isOwner && src?.kind === "showroom_sublocation" && l.kind === "workshop")),
    ) ?? [];
  const frozen = Boolean(pending) || transfer.isPending || scanPiece.isPending;
  const loadingError = inventory.error || locations.error;
  const filtered = rows.filter(
    (p) =>
      (!source || p.location_id === source) &&
      `${p.barcode} ${p.product} ${p.design} ${p.job_code}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <ProductionReceipt />
      <Panel
        title="Finished Product inventory & transfers"
        description="Each Product Barcode represents one physical piece. Transfer Workshop stock directly to a Showroom floor; Owner returns go directly back to Workshop."
      >
        <div className="space-y-3">
          {loadingError ? (
            <p role="alert">Inventory could not load. Refresh before posting.</p>
          ) : null}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!frozen && barcode.trim()) scanPiece.mutate(barcode.trim());
            }}
          >
            <Input
              aria-label="Finished Product transfer barcode"
              placeholder="Scan existing Product Barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              disabled={frozen}
            />
            <Button
              disabled={frozen || !barcode.trim() || locations.isPending || !!locations.error}
            >
              Scan piece to transfer
            </Button>
          </form>
          {scanned && (
            <p>
              {scanned.barcode} · {scanned.product} / {scanned.design} · {scanned.job_code} ·{" "}
              {scanned.location}
            </p>
          )}
          {scanned && can("stock.print_barcode") && (
            <div>
              <div ref={label} className="max-w-sm rounded border p-3">
                <p>
                  {scanned.product} / {scanned.design_code ?? scanned.design} · Piece{" "}
                  {scanned.piece_number}
                </p>
                <p>
                  Size: {scanned.size ?? "Not recorded"} · SP:{" "}
                  {scanned.sp_paise != null ? `₹${(scanned.sp_paise / 100).toFixed(2)}` : "Not set"}
                </p>
                <svg
                  role="img"
                  aria-label={`Product Barcode ${scanned.barcode}`}
                  viewBox={`0 0 ${fabricBarcodeBars(scanned.barcode).length + 20} 54`}
                  className="h-16 w-full"
                  shapeRendering="crispEdges"
                >
                  <rect width="100%" height="100%" fill="white" />
                  {[...fabricBarcodeBars(scanned.barcode)].map((bit, i) =>
                    bit === "1" ? (
                      <rect key={i} x={i + 10} width="1" height="54" fill="black" />
                    ) : null,
                  )}
                </svg>
                <p className="break-all">{scanned.barcode}</p>
                <p>{scanned.job_code}</p>
              </div>
              <Button
                variant="outline"
                disabled={frozen}
                onClick={() => {
                  if (label.current) printFabricLabel(label.current, "Finished Product Barcode");
                }}
              >
                Reprint same Product Barcode
              </Button>
            </div>
          )}
          {scanned && (
            <div className="rounded border p-3 text-sm">
              <p>
                Production ID: {scanned.job_code} · Produced together:{" "}
                {scanned.production_quantity ?? "Not recorded"}
              </p>
              <p>
                Issued: {scanned.issued_at ? formatDateTime(scanned.issued_at) : "Not recorded"} ·
                Finished:{" "}
                {scanned.finished_at ? formatDateTime(scanned.finished_at) : "Not recorded"}
              </p>
              {scanned.cp_visible && (
                <p>
                  CP per piece:{" "}
                  {scanned.cp_paise != null
                    ? `₹${(scanned.cp_paise / 100).toFixed(2)}`
                    : "Not recorded"}
                </p>
              )}
            </div>
          )}
          <Input
            aria-label="Filter loaded Finished Products"
            placeholder="Filter loaded pieces by barcode, Product, Design or job"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={frozen}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${formId}-source`}>Source location</Label>
              <select
                id={`${formId}-source`}
                className="h-11 w-full rounded border bg-background p-2"
                value={source}
                disabled={frozen}
                onChange={(e) => {
                  setSource(e.target.value);
                  setDestination("");
                  setSelected([]);
                  setScanned(null);
                  setScannedPieces([]);
                }}
              >
                <option value="">All locations / select source to transfer</option>
                {locations.data
                  ?.filter((l) => l.active && (isOwner || l.kind === "workshop"))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {locationLabel(l)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${formId}-destination`}>Destination location</Label>
              <select
                id={`${formId}-destination`}
                className="h-11 w-full rounded border bg-background p-2"
                value={destination}
                disabled={frozen || !source}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Select next location</option>
                {destinations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locationLabel(l)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Product Barcode / piece</th>
                  <th>Product / Design / job</th>
                  <th>Current location</th>
                  <th>Status</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Move ${p.barcode}`}
                        checked={selected.includes(p.id)}
                        disabled={
                          frozen ||
                          !source ||
                          !p.available ||
                          !p.location_active ||
                          (selected.length >= 200 && !selected.includes(p.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </td>
                    <td className="break-all py-2">
                      {p.barcode}
                      <p>Piece {p.piece_number}</p>
                    </td>
                    <td>
                      {p.product} / {p.design}
                      <p>{p.job_code}</p>
                    </td>
                    <td>{p.location}</td>
                    <td>
                      {p.status} · {p.quantity} pc
                      {!p.available && p.status === "available"
                        ? " · Review stock reconciliation"
                        : ""}
                    </td>
                    <td>
                      <Button variant="outline" size="sm" onClick={() => setPieceHistory(p.id)}>
                        History
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!inventory.isPending && !filtered.length ? (
            <p>No matching pieces in loaded inventory.</p>
          ) : null}
          <p>
            {rows.length} pieces loaded.{" "}
            {inventory.hasNextPage
              ? "Load more to search additional pieces."
              : "All pieces loaded."}
          </p>
          {inventory.hasNextPage ? (
            <Button
              variant="outline"
              disabled={inventory.isFetchingNextPage || frozen}
              onClick={() => inventory.fetchNextPage()}
            >
              Load more pieces
            </Button>
          ) : null}
          <p>
            {selected.length} whole pieces selected. Total stock remains unchanged by a transfer.
          </p>
          <Input
            aria-label="Finished Product transfer reason"
            placeholder="Reason / reference"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={frozen}
          />
          {pending && !transfer.isPending ? (
            <p role="alert">
              The previous result is uncertain. Retry the same request to confirm it without posting
              twice.
            </p>
          ) : null}
          <Button
            disabled={
              transfer.isPending ||
              scanPiece.isPending ||
              (!pending &&
                (Boolean(loadingError) ||
                  !selected.length ||
                  !source ||
                  !destination ||
                  !reason.trim()))
            }
            onClick={() => transfer.mutate()}
          >
            {pending ? "Retry same transfer" : "Post Finished Product transfer"}
          </Button>
          {posted ? (
            <p role="status" className="break-all">
              Posted transfer {posted}
            </p>
          ) : null}
        </div>
      </Panel>
      <Panel
        title="Finished Product movement history"
        description="Latest 200 movements, including Workshop receipts, transfers and any recorded corrections. History retains the piece, locations, user, time and reference."
      >
        {pieceHistory ? (
          <Button variant="outline" onClick={() => setPieceHistory("")}>
            Show all recent movements
          </Button>
        ) : null}
        {history.error ? (
          <p role="alert">Movement history could not load.</p>
        ) : history.isPending ? (
          <p>Loading movement history…</p>
        ) : !history.data?.length ? (
          <p>No movements recorded.</p>
        ) : (
          history.data.map((m) => (
            <div key={m.id} className="border-b py-3 text-sm">
              <p className="break-all">
                {m.barcode} · {m.product} / {m.design} · {m.job_code}
              </p>
              <p>
                {m.kind} · {m.quantity} pc · {m.source ?? "Receipt"} → {m.destination ?? "Outward"}
              </p>
              <p>
                {formatDateTime(m.occurred_at)} · {m.actor ?? m.actor_id}
              </p>
              <p>{m.reason}</p>
              <p className="break-all text-xs">
                {m.reference} · Movement {m.id}
                {m.transfer_id ? ` · Transfer ${m.transfer_id}` : ""}
              </p>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
