import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Panel, StatusBadge } from "@/shared/components/page";
import { formatMoney } from "@/shared/utils/units";
import { SECTION_LABEL, useCategories, useEcomAction, type ScanResult } from "./admin-api";
import { ProductEditor } from "./ProductEditor";

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/**
 * Scan a showroom piece (or fabric roll): its details come from the ERP. Add it to an
 * existing page for the same design, or start a new product page, then add photos.
 */
export function PublishByScan() {
  const actions = useEcomAction();
  const categories = useCategories();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const scan = (barcode: string) =>
    actions.scan.mutate(barcode, {
      onSuccess: (r) => {
        setResult(r);
        setTitle(r.suggested_title);
      },
      onError: (e) => {
        setResult(null);
        toast.error(e.message);
      },
    });

  const addTo = async (listingId: string) => {
    if (!result) return;
    try {
      await actions.addStock.mutateAsync({ listingId, barcode: result.barcode });
      toast.success("Added to the product page");
      setEditing(listingId);
      setResult(null);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    }
  };

  const create = async () => {
    if (!result) return;
    try {
      const id = await actions.createProduct.mutateAsync({
        barcode: result.barcode,
        title: title.trim(),
        categoryId: categoryId || null,
      });
      toast.success("Product page created — add photos next");
      setEditing(id);
      setResult(null);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
    }
  };

  return (
    <Panel
      title="Publish by scan"
      description="Scan a ready-made or finished piece on a showroom floor (or a fabric roll). Identical pieces share one product page; sizes can differ."
    >
      <div className="space-y-4">
        <BarcodeEntry
          label="Showroom item barcode"
          value={code}
          onChange={setCode}
          onScan={scan}
          disabled={actions.scan.isPending}
        />
        {result ? (
          <section className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {result.product}
                  {result.design ? ` · ${result.design}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {result.barcode}
                  {result.size ? ` · Size ${result.size}` : ""}
                  {result.sp_paise ? ` · SP ${formatMoney(result.sp_paise)}` : ""}
                  {result.location ? ` · ${result.location}` : ""}
                </p>
              </div>
              <StatusBadge
                status={result.available ? "active" : "depleted"}
                label={
                  result.available ? "Available on showroom" : "Not available on a showroom floor"
                }
              />
            </div>

            {result.current_listing ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>Already on “{result.current_listing.title}”.</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(result.current_listing!.id)}
                >
                  Open it
                </Button>
              </div>
            ) : !result.available ? (
              <p className="text-sm text-muted-foreground">
                Only items on a showroom floor (finished pieces with a saved SP) can be published.
              </p>
            ) : (
              <>
                {result.matching_listings.length ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      Add to an existing page for the same design
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.matching_listings.map((m) => (
                        <Button
                          key={m.id}
                          variant="outline"
                          size="sm"
                          onClick={() => void addTo(m.id)}
                        >
                          {m.title} {m.published ? "" : "(draft)"}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label htmlFor="new-title">New product page name</Label>
                    <Input
                      id="new-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-category">Category (can be set later)</Label>
                    <select
                      id="new-category"
                      className={selectClass}
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    >
                      <option value="">Choose later</option>
                      {(categories.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {SECTION_LABEL[c.section]} · {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    disabled={!title.trim() || actions.createProduct.isPending}
                    onClick={() => void create()}
                  >
                    Create product page
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>
      {editing ? <ProductEditor productId={editing} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}
