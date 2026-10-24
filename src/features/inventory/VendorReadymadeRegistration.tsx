import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/shared/components/page";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { reportMoney } from "@/features/reports/report-value";
import { BarcodeSticker } from "./BarcodeSticker";
import { printFabricLabel } from "./fabric-label";
import { fabricMoneyInput } from "./fabric-entry-input";
import { StockImageInput } from "./StockImageInput";
import { saveStockImages } from "./stock-images";

type Piece = { style: string; size: string; cp: string; sp: string; image?: File | null };
type Entry = {
  id: string;
  productName: string;
  quantity: string;
  sharedStyle: string;
  sharedSize: string;
  sharedCp: string;
  sharedSp: string;
  image: File | null;
  pieces: Piece[];
};
type ResultPiece = { id: string; barcode: string; product: string; size: string; sp_paise: string };
type ReceiveResult = { receipt_id: string; batch_code?: string; pieces: ResultPiece[] };
type CustomRpcResult = { data: unknown; error: { message: string } | null };
const customRpc = (name: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      functionName: string,
      parameters?: Record<string, unknown>,
    ) => Promise<CustomRpcResult>
  )(name, args);
const emptyEntry = (): Entry => ({
  id: crypto.randomUUID(),
  productName: "",
  quantity: "",
  sharedStyle: "",
  sharedSize: "",
  sharedCp: "",
  sharedSp: "",
  image: null,
  pieces: [],
});
const validCount = (value: string) =>
  /^[1-9]\d*$/.test(value) && Number(value) <= 500 ? Number(value) : 0;
const pieceFor = (entry: Entry, index: number): Piece => ({
  style: entry.sharedStyle,
  size: entry.sharedSize,
  cp: entry.sharedCp,
  sp: entry.sharedSp,
  ...entry.pieces[index],
});

export function VendorReadymadeRegistration({ onCancel }: { onCancel: () => void }) {
  const { isOwner, roles, can, userId } = useSession();
  const allowed = isOwner || (roles.includes("stock_entry") && can("inventory.receive"));
  const labels = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState("");
  const [arrivalDate, setArrivalDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [supplierGstin, setSupplierGstin] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [taxableAmount, setTaxableAmount] = useState("");
  const [gstAmount, setGstAmount] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [transportCharges, setTransportCharges] = useState("0");
  const [itcStatus, setItcStatus] = useState("pending");
  const [rows, setRows] = useState<Entry[]>([emptyEntry()]);
  const [printed, setPrinted] = useState<ResultPiece[]>([]);
  const [batchCode, setBatchCode] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["vendor-finished-catalog"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await customRpc("vendor_finished_receiving_catalog");
      if (error) throw error;
      return data as { products: { id: string; name: string }[] };
    },
  });
  const receive = useMutation({
    mutationFn: async () => {
      const effectiveImages = rows.flatMap((row) =>
        Array.from(
          { length: validCount(row.quantity) },
          (_, index) => pieceFor(row, index).image ?? row.image,
        ),
      );
      const transportPaise = fabricMoneyInput(transportCharges);
      const pieceCount = rows.reduce((sum, row) => sum + validCount(row.quantity), 0);
      const items = rows.flatMap((row) =>
        Array.from({ length: validCount(row.quantity) }, (_, index) => {
          const piece = pieceFor(row, index);
          const flatIndex =
            rows
              .slice(0, rows.indexOf(row))
              .reduce((sum, item) => sum + validCount(item.quantity), 0) + index;
          const allocatedTransport =
            Math.floor(transportPaise / pieceCount) +
            (flatIndex < transportPaise % pieceCount ? 1 : 0);
          return {
            product_name: row.productName.trim(),
            vendor_style: piece.style.trim() || null,
            size: piece.size.trim(),
            quantity: 1,
            cp_paise: fabricMoneyInput(piece.cp) + allocatedTransport,
            sp_paise: fabricMoneyInput(piece.sp),
          };
        }),
      );
      const { data, error } = await customRpc("receive_vendor_finished_products_with_purchase", {
        p_request: crypto.randomUUID(),
        p_supplier: supplier.trim(),
        p_arrival_date: arrivalDate,
        p_remarks: null,
        p_items: items,
        p_purchase: {
          supplier_gstin: supplierGstin.trim(),
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          itc_status: itcStatus,
          actual_taxable_paise: fabricMoneyInput(taxableAmount),
          actual_gst_paise: fabricMoneyInput(gstAmount),
          actual_supplier_paise: fabricMoneyInput(invoiceTotal),
          transport_paise: transportPaise,
        },
      });
      if (error) throw error;
      const result = data as ReceiveResult;
      if (!userId) throw new Error("Sign in again before saving stock images");
      await saveStockImages(
        userId,
        result.pieces.flatMap((piece, index) =>
          effectiveImages[index]
            ? [
                {
                  kind: "finished_product" as const,
                  itemId: piece.id,
                  file: effectiveImages[index]!,
                },
              ]
            : [],
        ),
      );
      return result;
    },
    onSuccess: async (result) => {
      setPrinted(result.pieces);
      setBatchCode(result.batch_code ?? null);
      setRows([emptyEntry()]);
      setSupplier("");
      setSupplierGstin("");
      setInvoiceNumber("");
      setInvoiceDate("");
      setTaxableAmount("");
      setGstAmount("");
      setInvoiceTotal("");
      setTransportCharges("0");
      await qc.invalidateQueries();
      toast.success(`${result.pieces.length} finished garments added to the vendor batch`);
    },
    onError: (error) => toast.error(error.message || "Ready-made stock could not be received"),
  });
  if (!allowed) return null;
  const total = rows.reduce((sum, row) => sum + validCount(row.quantity), 0);
  const productNames = catalog.data?.products.map((product) => product.name) ?? [];
  const updateRow = (id: string, update: Partial<Entry>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  const updatePiece = (entry: Entry, index: number, update: Partial<Piece>) =>
    updateRow(entry.id, {
      pieces: Array.from({ length: Math.max(entry.pieces.length, index + 1) }, (_, itemIndex) =>
        itemIndex === index
          ? { ...pieceFor(entry, itemIndex), ...update }
          : pieceFor(entry, itemIndex),
      ),
    });
  const valid = rows.every(
    (row) =>
      row.productName.trim() &&
      validCount(row.quantity) &&
      Array.from({ length: validCount(row.quantity) }, (_, index) => pieceFor(row, index)).every(
        (piece) => piece.size.trim() && piece.cp.trim() && piece.sp.trim(),
      ),
  );
  return (
    <div className="space-y-4">
      <Panel
        title="2. Batch Information"
        description="This vendor batch groups all purchased garments from one supplier. It receives a batch ID automatically when saved."
        actions={
          <Button variant="outline" onClick={onCancel} disabled={receive.isPending}>
            Cancel batch
          </Button>
        }
      >
        <fieldset disabled={receive.isPending} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <Label>Batch ID</Label>
            <Input className="bg-muted/30" value="Auto-generated on save" readOnly />
          </div>
          <div>
            <Label htmlFor="vendor-arrival">Arrival date</Label>
            <Input
              id="vendor-arrival"
              type="date"
              value={arrivalDate}
              onChange={(event) => setArrivalDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="vendor-supplier">Supplier / provider</Label>
            <Input
              id="vendor-supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              placeholder="Vendor name"
            />
          </div>
          <div>
            <Label htmlFor="vendor-transport">Transport / other charges (₹)</Label>
            <Input
              id="vendor-transport"
              inputMode="decimal"
              value={transportCharges}
              onChange={(e) => setTransportCharges(e.target.value)}
            />
          </div>
        </fieldset>
      </Panel>
      <Panel
        title="3. Supplier GST & purchase invoice"
        description="Enter the supplier invoice exactly as received. Garment CP is GST-inclusive; the system does not add GST again."
      >
        <fieldset disabled={receive.isPending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            aria-label="Supplier GSTIN"
            placeholder="Supplier GSTIN"
            value={supplierGstin}
            onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
          />
          <Input
            aria-label="Supplier invoice number"
            placeholder="Invoice number"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
          <Input
            aria-label="Supplier invoice date"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
          <select
            aria-label="Input tax credit status"
            className="h-11 rounded border bg-background p-2"
            value={itcStatus}
            onChange={(e) => setItcStatus(e.target.value)}
          >
            <option value="pending">ITC pending review</option>
            <option value="eligible">ITC eligible</option>
            <option value="ineligible">ITC ineligible</option>
            <option value="reversed">ITC reversed</option>
          </select>
          <Input
            aria-label="Invoice taxable amount"
            inputMode="decimal"
            placeholder="Taxable amount ₹"
            value={taxableAmount}
            onChange={(e) => setTaxableAmount(e.target.value)}
          />
          <Input
            aria-label="Invoice GST amount"
            inputMode="decimal"
            placeholder="GST amount ₹"
            value={gstAmount}
            onChange={(e) => setGstAmount(e.target.value)}
          />
          <Input
            aria-label="Invoice total"
            inputMode="decimal"
            placeholder="Invoice total incl. GST ₹"
            value={invoiceTotal}
            onChange={(e) => setInvoiceTotal(e.target.value)}
          />
        </fieldset>
      </Panel>
      <Panel
        title="4. Readymade Types & Quantities"
        description="Enter the piece count. One editable physical-garment row is created for every piece, and each receives its own R barcode."
      >
        <div className="space-y-4">
          {rows.map((row, index) => {
            const count = validCount(row.quantity);
            return (
              <section key={row.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <FileText className="size-4 text-primary" /> Readymade type {index + 1}
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={receive.isPending || rows.length === 1}
                    onClick={() =>
                      setRows((current) => current.filter((entry) => entry.id !== row.id))
                    }
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                </div>
                <fieldset
                  disabled={receive.isPending}
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                >
                  <div>
                    <Label>Product / garment</Label>
                    <PickOrTypeInput
                      value={row.productName}
                      options={productNames}
                      placeholder="For example: Shirt"
                      onChange={(productName) => updateRow(row.id, { productName })}
                    />
                  </div>
                  <div>
                    <Label>Piece count</Label>
                    <Input
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(event) => updateRow(row.id, { quantity: event.target.value })}
                      placeholder="For example: 12"
                    />
                  </div>
                  <div>
                    <Label>Image for this type (optional)</Label>
                    <div className="mt-1 min-h-10 rounded-md border bg-background px-2 py-1.5">
                      <StockImageInput
                        compact
                        label="Add image"
                        file={row.image}
                        onChange={(image) => updateRow(row.id, { image })}
                        disabled={receive.isPending}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Used by its garments unless a row has its own image.
                    </p>
                  </div>
                </fieldset>
                <>
                  <fieldset
                    disabled={receive.isPending}
                    className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4"
                  >
                    <div>
                      <Label>Style / model for all (optional)</Label>
                      <Input
                        value={row.sharedStyle}
                        onChange={(event) => updateRow(row.id, { sharedStyle: event.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Size for all</Label>
                      <Input
                        value={row.sharedSize}
                        onChange={(event) => updateRow(row.id, { sharedSize: event.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Purchase CP for all, including GST (₹)</Label>
                      <Input
                        inputMode="decimal"
                        value={row.sharedCp}
                        onChange={(event) => updateRow(row.id, { sharedCp: event.target.value })}
                      />
                    </div>
                    <div>
                      <Label>SP for all (₹)</Label>
                      <Input
                        inputMode="decimal"
                        value={row.sharedSp}
                        onChange={(event) => updateRow(row.id, { sharedSp: event.target.value })}
                      />
                    </div>
                  </fieldset>
                  {count > 0 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        disabled={receive.isPending}
                        onClick={() =>
                          updateRow(row.id, {
                            pieces: Array.from({ length: count }, (_, pieceIndex) => ({
                              style: row.sharedStyle,
                              size: row.sharedSize,
                              cp: row.sharedCp,
                              sp: row.sharedSp,
                              ...row.pieces[pieceIndex],
                            })),
                          })
                        }
                      >
                        Apply to all {count} garments
                      </Button>
                      <div className="mt-4 space-y-2">
                        {Array.from({ length: count }, (_, pieceIndex) => {
                          const piece = pieceFor(row, pieceIndex);
                          return (
                            <div
                              key={pieceIndex}
                              className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[180px_repeat(4,minmax(0,1fr))_auto]"
                            >
                              <div className="self-center text-sm font-semibold">
                                Garment {String(pieceIndex + 1).padStart(2, "0")}
                                <p className="font-normal text-xs text-muted-foreground">
                                  R barcode on save
                                </p>
                              </div>
                              <Input
                                value={piece.style}
                                placeholder="Style / model"
                                onChange={(event) =>
                                  updatePiece(row, pieceIndex, { style: event.target.value })
                                }
                              />
                              <StockImageInput
                                compact
                                label="Image"
                                file={piece.image ?? null}
                                inheritedFile={row.image}
                                inheritedText={row.image ? "From type" : undefined}
                                onChange={(image) => updatePiece(row, pieceIndex, { image })}
                                disabled={receive.isPending}
                              />
                              <Input
                                value={piece.size}
                                placeholder="Size"
                                onChange={(event) =>
                                  updatePiece(row, pieceIndex, { size: event.target.value })
                                }
                              />
                              <Input
                                inputMode="decimal"
                                value={piece.cp}
                                placeholder="CP ₹"
                                onChange={(event) =>
                                  updatePiece(row, pieceIndex, { cp: event.target.value })
                                }
                              />
                              <Input
                                inputMode="decimal"
                                value={piece.sp}
                                placeholder="SP ₹"
                                onChange={(event) =>
                                  updatePiece(row, pieceIndex, { sp: event.target.value })
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              </section>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-start gap-2"
            disabled={receive.isPending || rows.length >= 100}
            onClick={() => setRows((current) => [...current, emptyEntry()])}
          >
            <Plus className="size-4" /> Add another readymade type
          </Button>
        </div>
      </Panel>
      <Panel bodyClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Total garments: {total}. Every piece will receive a unique R barcode and belongs to this
          vendor batch.
        </p>
        <Button
          disabled={
            receive.isPending ||
            !supplier.trim() ||
            !arrivalDate ||
            !total ||
            total > 5000 ||
            !valid
          }
          onClick={() => {
            try {
              for (const row of rows)
                for (let index = 0; index < validCount(row.quantity); index++) {
                  const piece = pieceFor(row, index);
                  if (fabricMoneyInput(piece.cp) < 0 || fabricMoneyInput(piece.sp) <= 0)
                    throw new Error("CP must be zero or more and SP must be positive");
                }
              if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(supplierGstin.trim()))
                throw new Error("Enter the supplier's valid 15-character GSTIN");
              if (!invoiceNumber.trim() || !invoiceDate)
                throw new Error("Supplier invoice number and date are required");
              if (
                fabricMoneyInput(invoiceTotal) !==
                fabricMoneyInput(taxableAmount) + fabricMoneyInput(gstAmount)
              )
                throw new Error("Invoice total must equal taxable amount plus GST");
              fabricMoneyInput(transportCharges);
              receive.mutate();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Check CP and SP");
            }
          }}
        >
          <Barcode className="size-4" /> Generate R barcodes
        </Button>
      </Panel>
      {printed.length > 0 && (
        <Panel
          title={batchCode ? `Vendor batch ${batchCode} labels` : "Vendor batch labels"}
          description="Each barcode belongs to one physical purchased garment in this batch."
          actions={
            <Button
              onClick={() =>
                labels.current && printFabricLabel(labels.current, "Vendor ready-made labels")
              }
            >
              Print all labels
            </Button>
          }
        >
          <div ref={labels} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {printed.map((piece) => (
              <BarcodeSticker
                key={piece.id}
                barcode={piece.barcode}
                name={piece.product}
                description={batchCode ? `Vendor batch ${batchCode}` : "Vendor purchased"}
                detail={`Size ${piece.size}`}
                price={reportMoney(piece.sp_paise)}
              />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
