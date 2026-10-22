import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel, EmptyState } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/shared/utils/units";

type VendorPiece = {
  id: string;
  barcode: string;
  product: string;
  style: string | null;
  size: string | null;
  sp_paise: number | null;
  cp_paise?: number | null;
  batch_code: string;
  supplier: string;
  arrival_date: string;
  location: string;
  location_kind: string;
  status: string;
  available: boolean;
};

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

export function VendorReadymadeStock() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const stock = useQuery({
    queryKey: ["vendor-readymade-stock", applied],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("vendor_readymade_stock", {
        p_search: applied,
        p_limit: 500,
      });
      if (error) throw error;
      return data as VendorPiece[];
    },
  });

  return (
    <Panel
      title="Vendor readymade stock"
      description="Purchased ready-made garments, grouped by their vendor batch and tracked as individual F-barcode pieces."
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(search.trim());
        }}
      >
        <Input
          aria-label="Search vendor readymade stock"
          placeholder="Barcode, garment, style, size, vendor batch or supplier"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button>Search</Button>
      </form>
      <QueryState
        loading={stock.isPending}
        error={stock.error}
        retry={() => void stock.refetch()}
      />
      {!stock.isPending && !stock.error && !stock.data?.length && (
        <EmptyState
          title="No vendor readymade stock"
          description="Vendor-purchased garments will appear here after their F barcodes are generated."
        />
      )}
      {!!stock.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {[
                  "F barcode",
                  "Garment",
                  "Style / size",
                  "Vendor batch",
                  "Supplier / received",
                  "SP",
                  "CP",
                  "Current location",
                  "Status",
                ].map((label) => (
                  <th key={label} className="p-2 font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stock.data.map((piece) => (
                <tr key={piece.id} className="border-b">
                  <td className="p-2 font-mono text-xs">{piece.barcode}</td>
                  <td className="p-2 font-medium">{piece.product}</td>
                  <td className="p-2">
                    {piece.style ?? "—"}
                    <span className="block text-muted-foreground">Size {piece.size ?? "—"}</span>
                  </td>
                  <td className="p-2 font-mono text-xs">{piece.batch_code}</td>
                  <td className="p-2">
                    {piece.supplier}
                    <span className="block text-muted-foreground">{piece.arrival_date}</span>
                  </td>
                  <td className="p-2">{formatMoney(piece.sp_paise, true)}</td>
                  <td className="p-2">
                    {piece.cp_paise === undefined
                      ? "Restricted"
                      : formatMoney(piece.cp_paise, true)}
                  </td>
                  <td className="p-2">
                    {piece.location}
                    <span className="block text-muted-foreground">
                      {piece.location_kind.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={piece.available ? "text-emerald-700" : "text-muted-foreground"}
                    >
                      {piece.available ? "Available" : piece.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
