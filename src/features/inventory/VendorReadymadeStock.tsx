import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel, EmptyState } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/shared/utils/units";
import { useSession } from "@/app/providers/session";
import { loadStockImageUrls } from "./stock-images";
import { StockImage } from "./StockImage";
import { ExistingStockImageEditor } from "./ExistingStockImageEditor";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { LayoutGrid, List } from "lucide-react";

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
  const { isOwner, can } = useSession();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
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
  const imageUrls = useQuery({
    queryKey: [
      "stock-item-images",
      "finished_product",
      (stock.data ?? []).map((piece) => piece.id),
    ],
    enabled: !!stock.data?.length,
    queryFn: () =>
      loadStockImageUrls(
        "finished_product",
        (stock.data ?? []).map((piece) => piece.id),
      ),
  });
  const batches = new Map<string, VendorPiece[]>();
  for (const piece of stock.data ?? []) {
    batches.set(piece.batch_code, [...(batches.get(piece.batch_code) ?? []), piece]);
  }

  return (
    <Panel
      title="Vendor readymade stock"
      description="Purchased ready-made garments, grouped by their vendor batch and tracked as individual R-barcode pieces."
    >
      <div className="mb-4 space-y-3">
        <BarcodeEntry
          value={search}
          onChange={setSearch}
          onScan={(value) => setApplied(value.trim())}
          label="Search or scan vendor readymade stock"
          placeholder="Barcode, garment, style, size, vendor batch or supplier"
          action="Search"
          showCameraOnDesktop
        />
        <div className="flex justify-end gap-2" aria-label="Readymade stock display style">
          <Button
            type="button"
            variant={view === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="size-4" /> Grid view
          </Button>
          <Button
            type="button"
            variant={view === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("list")}
          >
            <List className="size-4" /> List view
          </Button>
        </div>
      </div>
      <QueryState
        loading={stock.isPending}
        error={stock.error}
        retry={() => void stock.refetch()}
      />
      {!stock.isPending && !stock.error && !stock.data?.length && (
        <EmptyState
          title="No vendor readymade stock"
          description="Vendor-purchased garments will appear here after their R barcodes are generated."
        />
      )}
      {!!stock.data?.length && view === "grid" && (
        <div className="space-y-4">
          {[...batches.entries()].map(([batchCode, pieces]) => (
            <section key={batchCode} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/5 px-4 py-3">
                <div>
                  <h3 className="font-mono font-semibold">{batchCode}</h3>
                  <p className="text-xs text-muted-foreground">
                    Supplier: {pieces[0]!.supplier} · Received: {pieces[0]!.arrival_date} ·{" "}
                    {pieces.length} garment{pieces.length === 1 ? "" : "s"}
                  </p>
                </div>
              </header>
              <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {pieces.map((piece) => {
                  const image = imageUrls.data?.get(piece.id);
                  return (
                    <article
                      key={piece.id}
                      className="overflow-hidden rounded-xl border bg-background shadow-sm"
                    >
                      <div className="flex gap-3 p-3">
                        {image ? (
                          <img
                            src={image}
                            alt={`${piece.product} ${piece.barcode}`}
                            loading="lazy"
                            className="h-32 w-24 shrink-0 rounded-lg border bg-muted object-cover"
                          />
                        ) : (
                          <div className="grid h-32 w-24 shrink-0 place-items-center rounded-lg border bg-muted/40 text-xs text-muted-foreground">
                            No image
                          </div>
                        )}
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-semibold">{piece.product}</h4>
                              <p className="font-mono text-xs">{piece.barcode}</p>
                            </div>
                            <span
                              className={
                                piece.available
                                  ? "rounded-full bg-emerald-100 px-2 py-1 text-[10px] text-emerald-800"
                                  : "rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                              }
                            >
                              {piece.available ? "Available" : piece.status}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <dt className="text-muted-foreground">Style</dt>
                              <dd>{piece.style ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Size</dt>
                              <dd>{piece.size ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">SP</dt>
                              <dd className="font-medium">{formatMoney(piece.sp_paise, true)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">CP</dt>
                              <dd className="font-medium">
                                {piece.cp_paise === undefined
                                  ? "Restricted"
                                  : formatMoney(piece.cp_paise, true)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 border-t p-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">Location</span>
                          <p>{piece.location}</p>
                        </div>
                        <ExistingStockImageEditor
                          itemId={piece.id}
                          kind="finished_product"
                          name={piece.product}
                          barcode={piece.barcode}
                          imageUrl={image}
                          canManage={isOwner || can("inventory.receive")}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {!!stock.data?.length && view === "list" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {[
                  "Image",
                  "R barcode",
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
                  <td className="p-2">
                    <StockImage
                      src={imageUrls.data?.get(piece.id)}
                      alt={`${piece.product} ${piece.barcode}`}
                    />
                    <div className="mt-1">
                      <ExistingStockImageEditor
                        itemId={piece.id}
                        kind="finished_product"
                        name={piece.product}
                        barcode={piece.barcode}
                        imageUrl={imageUrls.data?.get(piece.id)}
                        canManage={isOwner || can("inventory.receive")}
                      />
                    </div>
                  </td>
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
