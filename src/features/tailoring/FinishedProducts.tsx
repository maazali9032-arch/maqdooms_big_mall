import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantityInput, quantityText } from "@/features/inventory/ledger-quantity";
import {
  definiteDatabaseRejection,
  consumableQuantity,
} from "@/features/inventory/consumable-input";
import {
  fabricBarcodeBars as productBarcodeBars,
  printFabricLabel,
} from "@/features/inventory/fabric-label";

type Job = {
  id: string;
  code: string;
  product: string;
  design: string;
  quantity: number;
  status: string;
};
type Issue = {
  lines: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    thaan_id: string | null;
    batch_code: string | null;
  }[];
};
type Piece = {
  id: string;
  barcode: string;
  piece_number: number;
  product: string;
  design: string;
  production_job: string;
  production_job_id: string;
  job_quantity: number;
  job_status: string;
  factory: string;
  section: string | null;
  tailor: string;
  location: string;
  status: string;
  available: boolean;
  quantity_at_location: number | null;
  sp_paise: number | null;
  production_cost_paise?: number | null;
  materials: {
    name: string;
    batch: string | null;
    fabric_barcode: string | null;
    thaan_id: string | null;
    quantity: number;
    unit: string;
  }[];
  production_history: { status: string; reason: string; recorded_at: string }[];
  receipt: { reason: string; recorded_at: string } | null;
};
type Args = Database["public"]["Functions"]["receive_finished_products"]["Args"];

export function FinishedProducts() {
  const { isOwner, roles } = useSession();
  const permitted = isOwner || roles.includes("counter") || roles.includes("tailor");
  const qc = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [scan, setScan] = useState("");
  const [barcode, setBarcode] = useState<string | undefined>();
  const [pending, setPending] = useState<Args | null>(null);
  const labels = useRef<HTMLDivElement>(null);
  const jobs = useQuery({
    queryKey: ["owner-production", "history"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_history");
      if (error) throw error;
      return data as unknown as Job[];
    },
  });
  const issues = useQuery({
    queryKey: ["finished-products", "issue-options", jobId],
    enabled: isOwner && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("material_issue_history", {
        p_job: jobId,
        p_limit: 100,
      });
      if (error) throw error;
      return data as unknown as Issue[];
    },
  });
  const products = useQuery({
    queryKey: ["finished-products", "catalog", barcode],
    enabled: permitted,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "finished_product_catalog",
        barcode ? { p_barcode: barcode } : {},
      );
      if (error) throw error;
      return data as unknown as Piece[];
    },
  });
  const receive = useMutation({
    mutationFn: async (args: Args) => {
      setPending(args);
      const { data, error } = await supabase.rpc("receive_finished_products", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setPending(null);
      setUsage({});
      setReason("");
      for (const key of [
        "finished-products",
        "finished-product-sale",
        "finished-product-inventory",
        "finished-product-movements",
        "location-ledger",
        "inventory",
        "owner-production",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      toast.success("Finished Products received into Workshop with unique barcodes");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const job = jobs.data?.find((j) => j.id === jobId);
  const lines = issues.data?.flatMap((i) => i.lines) ?? [];
  if (!permitted) return null;
  const submit = () => {
    if (pending) {
      receive.mutate(pending);
      return;
    }
    try {
      if (!job || job.status !== "completed" || !reason.trim())
        throw new Error("Choose a completed job and enter a receipt reason");
      const payload = Array.from({ length: job.quantity }, (_, index) => {
        const number = index + 1;
        const materials = lines
          .filter((line) => usage[number + ":" + line.id]?.trim())
          .map((line) => {
            const input = usage[number + ":" + line.id]!;
            const quantity =
              line.unit === "mm"
                ? quantityInput(input, "mm")
                : consumableQuantity(input, line.unit);
            return { issue_line_id: line.id, quantity };
          })
          .sort((a, b) => a.issue_line_id.localeCompare(b.issue_line_id));
        if (!materials.some((m) => lines.some((l) => l.id === m.issue_line_id && l.thaan_id)))
          throw new Error("Record actual fabric usage for piece " + number);
        return { piece_number: number, materials };
      });
      receive.mutate({
        p_request: crypto.randomUUID(),
        p_job: job.id,
        p_pieces: payload,
        p_reason: reason.trim(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel
      title="Finished Products / Product Barcodes"
      description="One physical piece, one unique Product Barcode. Finished Products are first received into Workshop."
    >
      {[jobs.error, issues.error, products.error].filter(Boolean).map((e, i) => (
        <p key={i} role="alert">
          {e!.message}
        </p>
      ))}
      {isOwner && (
        <details className="mb-4">
          <summary>Receive completed production into Workshop</summary>
          <fieldset disabled={receive.isPending || !!pending} className="space-y-3 py-3">
            <select
              aria-label="Completed Production Job"
              className="w-full rounded border bg-background p-2"
              value={jobId}
              onChange={(e) => {
                setJobId(e.target.value);
                setUsage({});
              }}
            >
              <option value="">Completed Production Job</option>
              {jobs.data
                ?.filter((j) => j.status === "completed")
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} · {j.product} · {j.design} · {j.quantity} pieces
                  </option>
                ))}
            </select>
            {job && (
              <p>
                Confirm all {job.quantity} physical pieces. Enter actual material usage separately
                for each piece. Unallocated issued material is retained in job history; no usage or
                waste is inferred.
              </p>
            )}
            {job && (
              <div className="overflow-auto">
                <p>
                  Enter actual quantities for each piece: fabric in metres, consumables in their
                  native unit. Leave unused materials blank.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th>Issued material</th>
                      {Array.from({ length: job.quantity }, (_, index) => (
                        <th key={index}>Piece {index + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="min-w-48 p-2">
                          {line.name} {line.batch_code && " · " + line.batch_code}{" "}
                          {line.thaan_id && " · Than " + line.thaan_id.slice(0, 8)} · issued{" "}
                          {quantityText(Number(line.quantity), line.unit)}
                        </td>
                        {Array.from({ length: job.quantity }, (_, index) => (
                          <td key={index} className="min-w-28 p-1">
                            <Input
                              aria-label={line.name + " usage for piece " + (index + 1)}
                              inputMode="decimal"
                              placeholder={line.unit === "mm" ? "Metres" : line.unit}
                              value={usage[index + 1 + ":" + line.id] ?? ""}
                              onChange={(e) =>
                                setUsage({ ...usage, [index + 1 + ":" + line.id]: e.target.value })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Input
              aria-label="Finished Product receipt reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Receipt / physical completion confirmation"
            />
          </fieldset>
          <Button disabled={receive.isPending} onClick={submit}>
            {pending ? "Retry same receipt" : "Confirm pieces and receive into Workshop"}
          </Button>
          {pending && <p>Receipt awaiting confirmation. Retry this same request.</p>}
        </details>
      )}
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!scan.trim()) return;
          setBarcode(scan.trim());
          void qc.invalidateQueries({ queryKey: ["finished-products", "catalog", scan.trim()] });
        }}
      >
        <Input
          aria-label="Scan Product Barcode"
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Scan or enter Product Barcode"
        />
        <Button type="submit">Scan</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setBarcode(undefined);
            setScan("");
          }}
        >
          Recent pieces
        </Button>
      </form>
      {products.isFetching && <p>Loading Finished Products…</p>}
      {products.data?.length === 0 && (
        <p>
          {barcode
            ? "No permitted Finished Product matches this barcode."
            : "No Finished Products available."}
        </p>
      )}
      {(products.data?.length ?? 0) > 0 && (
        <>
          <p>
            Showing {products.data!.length} pieces (up to 100). SP setup and production costing
            await Phase 12.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              if (labels.current) printFabricLabel(labels.current, "Product Barcode labels");
            }}
          >
            Print displayed Product Barcode labels
          </Button>
          <div ref={labels} className="my-3 grid gap-3 md:grid-cols-2">
            {products.data!.map((p) => (
              <ProductLabel key={p.id} piece={p} />
            ))}
          </div>
        </>
      )}
      <div className="space-y-3">
        {products.data?.map((p) => (
          <article key={p.id} className="rounded border p-3">
            <p className="font-medium">
              {p.product} · {p.design} · Piece {p.piece_number} / {p.job_quantity}
            </p>
            <p>
              {p.production_job} · {p.job_status} · {p.factory} → {p.section ?? "No Section"} →{" "}
              {p.tailor}
            </p>
            <p>
              {p.location} · {p.status} · {p.available ? "In stock" : "Unavailable"} · Ledger
              quantity {p.quantity_at_location ?? "Unreconciled"}
            </p>
            {(isOwner || roles.includes("counter")) && (
              <p>
                SP: {p.sp_paise == null ? "Not set" : `₹${(Number(p.sp_paise) / 100).toFixed(2)}`}
              </p>
            )}
            {isOwner && (
              <p>
                Complete Production Cost:{" "}
                {p.production_cost_paise == null
                  ? "Not finalized"
                  : "₹" + (Number(p.production_cost_paise) / 100).toFixed(2)}
              </p>
            )}
            <p className="font-medium">Actual material usage for this piece</p>
            {p.materials.map((m, i) => (
              <p key={i}>
                {m.name} {m.batch && `· ${m.batch}`}{" "}
                {m.thaan_id && `· Than ${m.thaan_id.slice(0, 8)}`} ·{" "}
                {quantityText(Number(m.quantity), m.unit)}{" "}
                {m.fabric_barcode && `· Fabric Barcode ${m.fabric_barcode}`}
              </p>
            ))}
            <details>
              <summary>Production and receipt history</summary>
              {p.production_history.map((e, i) => (
                <p key={i}>
                  {e.status} · {e.reason} · {new Date(e.recorded_at).toLocaleString()}
                </p>
              ))}
              {p.receipt && (
                <p>
                  Workshop receipt · {p.receipt.reason} ·{" "}
                  {new Date(p.receipt.recorded_at).toLocaleString()}
                </p>
              )}
            </details>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ProductLabel({ piece }: { piece: Piece }) {
  const bars = productBarcodeBars(piece.barcode);
  return (
    <div className="break-inside-avoid rounded border bg-white p-3 text-black">
      <p>
        {piece.product} · {piece.design} · Piece {piece.piece_number}
      </p>
      <svg
        role="img"
        aria-label={`Product Barcode ${piece.barcode}`}
        viewBox={`0 0 ${bars.length + 20} 60`}
        width="100%"
        height="70"
        shapeRendering="crispEdges"
      >
        <rect width={bars.length + 20} height="60" fill="white" />
        {[...bars].map((bit, i) =>
          bit === "1" ? <rect key={i} x={i + 10} y="0" width="1" height="60" fill="black" /> : null,
        )}
      </svg>
      <p className="break-all font-mono text-xs">{piece.barcode}</p>
      <p>{piece.production_job}</p>
    </div>
  );
}
