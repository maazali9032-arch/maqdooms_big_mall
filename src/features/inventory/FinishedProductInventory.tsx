import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/shared/utils/format";
import { definiteDatabaseRejection } from "./consumable-input";

type Piece = {
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
  const { isOwner } = useSession();
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
    enabled: isOwner,
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
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["finished-product-movements", pieceHistory],
    enabled: isOwner,
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
      if (!isOwner) throw new Error("Owner required");
      if (
        !pending &&
        (!selected.length || selected.length > 200 || !source || !destination || !reason.trim())
      )
        throw new Error("Select 1–200 pieces, source, destination and a reason");
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
  if (!isOwner) return null;
  const rows = inventory.data?.pages.flat() ?? [];
  const src = locations.data?.find((l) => l.id === source);
  const destinations =
    locations.data?.filter(
      (l) =>
        l.active &&
        ((src?.kind === "workshop" && l.kind === "showroom") ||
          (src?.kind === "showroom" && (l.kind === "workshop" || l.parent_id === src.id)) ||
          (src?.kind === "showroom_sublocation" && l.id === src.parent_id)),
    ) ?? [];
  const frozen = Boolean(pending) || transfer.isPending;
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
      <Panel
        title="Finished Product inventory & transfers"
        description="Each Product Barcode represents one physical piece. Move Workshop → Showroom → its sublocation; returns follow the same path in reverse."
      >
        <div className="space-y-3">
          {loadingError ? (
            <p role="alert">Inventory could not load. Refresh before posting.</p>
          ) : null}
          <Input
            aria-label="Filter loaded Finished Products"
            placeholder="Filter loaded pieces by barcode, Product, Design or job"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={frozen}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="product-transfer-source">Source location</Label>
              <select
                id="product-transfer-source"
                className="h-11 w-full rounded border bg-background p-2"
                value={source}
                disabled={frozen}
                onChange={(e) => {
                  setSource(e.target.value);
                  setDestination("");
                  setSelected([]);
                }}
              >
                <option value="">All locations / select source to transfer</option>
                {locations.data
                  ?.filter((l) => l.active)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="product-transfer-destination">Destination location</Label>
              <select
                id="product-transfer-destination"
                className="h-11 w-full rounded border bg-background p-2"
                value={destination}
                disabled={frozen || !source}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Select next location</option>
                {destinations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
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
