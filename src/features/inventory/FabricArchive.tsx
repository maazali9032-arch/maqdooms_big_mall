import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
type Row = {
  id: string;
  barcode: string;
  batch: string;
  fabric: string;
  name: string;
  colour: string | null;
  recorded_mm: number | null;
  status: string;
  cp_paise_per_m: number | null;
};
export function FabricArchive() {
  const query = useQuery({
    queryKey: ["fabric-archive"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fabric_inventory_archive");
      if (error) throw error;
      return data as unknown as Row[];
    },
  });
  return (
    <Panel
      title="Depleted / archived fabric"
      description="These records stay traceable after their stock is depleted or archived."
    >
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {query.data && !query.data.length && <p>No depleted or archived fabric.</p>}
      <div className="space-y-4">
        {[...new Set((query.data ?? []).map((r) => r.batch))].map((batch) => (
          <section key={batch} className="rounded-lg border p-3">
            <h3 className="font-semibold">Batch {batch}</h3>
            <div className="ml-3 border-l pl-3">
              {[...new Set(query.data!.filter((r) => r.batch === batch).map((r) => r.fabric))].map(
                (type) => (
                  <section key={type} className="mt-3">
                    <h4 className="font-medium">{type}</h4>
                    {query
                      .data!.filter((r) => r.batch === batch && r.fabric === type)
                      .map((row) => (
                        <div
                          key={row.id}
                          className="ml-3 mt-2 flex flex-wrap gap-3 border-l py-2 pl-3 text-sm"
                        >
                          <span className="font-mono">{row.barcode}</span>
                          <span>{row.name}</span>
                          <span>
                            {row.recorded_mm === null
                              ? "Length not recorded"
                              : reportQuantity(String(row.recorded_mm), "mm")}
                          </span>
                          <span>
                            {row.cp_paise_per_m === null
                              ? "CP not available"
                              : reportMoney(row.cp_paise_per_m)}
                          </span>
                          <span>{row.status}</span>
                        </div>
                      ))}
                  </section>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}
