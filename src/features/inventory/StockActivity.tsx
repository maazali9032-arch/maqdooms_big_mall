import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reportQuantity } from "@/features/reports/report-value";
import { Camera } from "lucide-react";
import { BarcodeCamera } from "@/shared/components/barcode-camera";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
type Activity = {
  id: string;
  occurred_at: string;
  kind: string;
  quantity: string;
  unit: string;
  barcode: string | null;
  item: string | null;
  source: string | null;
  destination: string | null;
  reference: string | null;
  note: string | null;
  actor: string | null;
  actor_id: string | null;
};
export function StockActivity() {
  const [search, setSearch] = useState(""),
    [applied, setApplied] = useState(""),
    [cameraOpen, setCameraOpen] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["stock-activity", applied],
    initialPageParam: null as Activity | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("stock_activity", {
        p_limit: 100,
        ...(pageParam ? { p_after: pageParam.occurred_at, p_after_id: pageParam.id } : {}),
        p_search: applied,
      });
      if (error) throw error;
      return data as unknown as Activity[];
    },
    getNextPageParam: (last) => (last.length === 100 ? last.at(-1) : undefined),
  });
  const rows = query.data?.pages.flat() ?? [];
  return (
    <Panel
      title="Stock movements"
      description="Recorded stock entries, transfers, sales and material issues from the current location ledger."
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <Input
          aria-label="Search stock movements"
          placeholder="Barcode, item, floor or reference"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Scan a stock barcode with camera"
          title="Scan barcode with camera"
          onClick={() => setCameraOpen(true)}
        >
          <Camera className="size-4" />
        </Button>
        <Button>Search</Button>
      </form>
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan stock barcode</DialogTitle>
          </DialogHeader>
          <BarcodeCamera
            onScan={(code) => {
              const value = code.trim();
              setSearch(value);
              setApplied(value);
              setCameraOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.error && !rows.length && <p>No matching stock movements.</p>}
      {!!rows.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[740px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {[
                  "Date / time",
                  "Item / barcode",
                  "Movement",
                  "Quantity",
                  "From → To",
                  "Recorded by",
                  "Reference",
                ].map((label) => (
                  <th key={label} className="p-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="p-2">
                    {new Date(row.occurred_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="p-2">
                    {row.item ?? "Not recorded"}
                    <small className="block font-mono">{row.barcode ?? "No barcode"}</small>
                  </td>
                  <td className="p-2">{row.kind.replaceAll("_", " ")}</td>
                  <td className="p-2 whitespace-nowrap">
                    {reportQuantity(row.quantity, row.unit)}
                  </td>
                  <td className="p-2">
                    {row.source ?? "Receipt"} → {row.destination ?? "Issued out"}
                  </td>
                  <td className="p-2">{row.actor ?? row.actor_id ?? "Not recorded"}</td>
                  <td className="p-2 break-all">{row.reference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          className="mt-3"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more movements
        </Button>
      )}
    </Panel>
  );
}
