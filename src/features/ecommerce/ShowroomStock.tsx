import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { useListings } from "./index";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = {
  id: string;
  kind: string;
  name: string;
  barcode: string;
  colour?: string | null;
  design?: string;
  available_mm?: number;
  available_pieces?: number;
  locations: { name: string; quantity_mm?: number; quantity?: number }[];
};
export function ShowroomStock({
  kind,
  onManageListings,
}: {
  kind: "fabric" | "product";
  onManageListings: () => void;
}) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const listings = useListings();
  const stock = useQuery({
    queryKey: ["showroom-stock", kind],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("showroom_stock", { p_kind: kind });
      if (error) throw error;
      return data as unknown as Row[];
    },
  });
  const link = useMutation({
    mutationFn: async (row: Row) => {
      const listing = chosen[row.id];
      if (!listing) throw new Error("Choose an online listing");
      const { error } = await supabase.rpc("link_showroom_listing", {
        p_listing: listing,
        p_kind: kind,
        p_stock: row.id,
        p_link: true,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["listings"] });
      await qc.invalidateQueries({ queryKey: ["listing-availability"] });
      toast.success("Showroom stock linked to listing");
    },
    onError: (error) => toast.error(error.message),
  });
  const term = search.trim().toLowerCase();
  const rows = (stock.data ?? []).filter((row) =>
    `${row.name} ${row.barcode} ${row.colour ?? ""} ${row.design ?? ""}`
      .toLowerCase()
      .includes(term),
  );
  return (
    <Panel
      title={kind === "fabric" ? "Showroom Fabric" : "Showroom Finished Products"}
      description="Only stock currently available in Showroom and its floors. Counter sales update availability automatically."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label="Search Showroom stock"
          placeholder="Search name, colour or barcode"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="outline" onClick={() => void stock.refetch()}>
          Refresh
        </Button>
        <Button variant="outline" onClick={onManageListings}>
          Manage online listings
        </Button>
      </div>
      {(stock.error || listings.error) && (
        <p role="alert">{(stock.error || listings.error)?.message}</p>
      )}
      {stock.isPending && <p>Loading Showroom stock…</p>}
      {!stock.isPending && !stock.error && rows.length === 0 && (
        <p className="text-muted-foreground">No matching stock available in Showroom.</p>
      )}
      <div className="divide-y rounded-lg border">
        {rows.map((row) => (
          <article key={row.id} className="grid gap-3 p-4 md:grid-cols-[2fr_1fr_2fr]">
            <div>
              <p className="font-medium">
                {row.name}
                {row.colour ? ` · ${row.colour}` : ""}
                {row.design ? ` · ${row.design}` : ""}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">{row.barcode}</p>
            </div>
            <div>
              <p className="font-semibold">
                {kind === "fabric"
                  ? `${Number(row.available_mm ?? 0) / 1000} m`
                  : `${row.available_pieces ?? 0} piece`}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.locations.map((l) => l.name).join(" · ")}
              </p>
            </div>
            {can("ecommerce.link_stock") && (
              <div className="flex flex-wrap items-start gap-2">
                <select
                  aria-label={`Online listing for ${row.barcode}`}
                  className="min-w-0 flex-1 rounded border bg-background p-2"
                  value={chosen[row.id] ?? ""}
                  onChange={(e) =>
                    setChosen((previous) => ({ ...previous, [row.id]: e.target.value }))
                  }
                >
                  <option value="">Choose online listing</option>
                  {listings.data?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={!chosen[row.id] || link.isPending}
                  onClick={() => link.mutate(row)}
                >
                  Link
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}
