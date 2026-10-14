import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fabricBarcodeBars, printFabricLabel } from "@/features/inventory/fabric-label";

export type ProductionRecord = {
  id: string;
  code: string;
  product: string;
  design: string;
  size: string | null;
  quantity: number;
  status: string;
  tailors: { code: string; name: string }[];
  issued_at: string | null;
  finished_at: string | null;
  received_at: string | null;
  cp_total_paise?: number | null;
  cost_known?: boolean;
  fabrics: {
    barcode: string;
    name: string;
    quantity_mm: number;
    source: string;
    issued_at: string;
    issue_type: string;
  }[];
};
export function BarcodeGraphic({ code }: { code: string }) {
  const bars = fabricBarcodeBars(code);
  return (
    <svg
      role="img"
      aria-label={`Barcode ${code}`}
      viewBox={`0 0 ${bars.length + 20} 54`}
      className="h-16 w-full"
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      {[...bars].map((bit, i) =>
        bit === "1" ? <rect key={i} x={i + 10} width="1" height="54" fill="black" /> : null,
      )}
    </svg>
  );
}
export function useProductionDocument(code: string) {
  return useQuery({
    queryKey: ["production-document", code],
    enabled: !!code,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_job_document", { p_code: code });
      if (error) throw error;
      if (!data) throw new Error("No production matches this ID");
      return data as unknown as ProductionRecord;
    },
  });
}
export function ProductionDocument({ code }: { code: string }) {
  const query = useProductionDocument(code);
  const print = useRef<HTMLDivElement>(null);
  if (query.isPending) return <p>Loading Production ID…</p>;
  if (query.error)
    return (
      <p role="alert">
        {query.error.message}{" "}
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </p>
    );
  const job = query.data;
  // Explicit printable fields: server may return CP to Owner, but it is never printed here.
  return (
    <div className="space-y-2 rounded border p-3">
      <div ref={print}>
        <h3 className="font-semibold">Production ID · {job.code}</h3>
        <BarcodeGraphic code={job.code} />
        <p>
          {job.product} · {job.design} · Size {job.size ?? "Not recorded"} · {job.quantity} pieces
        </p>
        <p>
          Tailors: {job.tailors.map((t) => `${t.code} · ${t.name}`).join(", ")} · {job.status}
        </p>
        {job.issued_at && <p>Issued: {new Date(job.issued_at).toLocaleString()}</p>}
        {job.finished_at && <p>Finished: {new Date(job.finished_at).toLocaleString()}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Fabric / barcode</th>
                <th>Source</th>
                <th>Issued metres</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {job.fabrics.map((f, i) => (
                <tr key={i}>
                  <td className="py-2">
                    {f.name}
                    <br />
                    <span className="break-all font-mono text-xs">{f.barcode}</span>
                  </td>
                  <td>{f.source}</td>
                  <td>{(f.quantity_mm / 1000).toFixed(3)} m</td>
                  <td>{f.issue_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => print.current && printFabricLabel(print.current, "Production ID")}
      >
        Print Production ID
      </Button>
    </div>
  );
}
