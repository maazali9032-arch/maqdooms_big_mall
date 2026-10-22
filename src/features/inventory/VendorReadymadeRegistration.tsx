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

type Entry = {
  id: string;
  productName: string;
  vendorStyle: string;
  size: string;
  quantity: string;
  cp: string;
  sp: string;
};
type ResultPiece = { id: string; barcode: string; product: string; size: string; sp_paise: string };
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
  vendorStyle: "",
  size: "",
  quantity: "",
  cp: "",
  sp: "",
});
const validCount = (value: string) =>
  /^[1-9]\d*$/.test(value) && Number(value) <= 500 ? Number(value) : 0;

export function VendorReadymadeRegistration({ onBack }: { onBack: () => void }) {
  const { isOwner, roles, can } = useSession();
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
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<Entry[]>([emptyEntry()]);
  const [printed, setPrinted] = useState<ResultPiece[]>([]);
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
      const { data, error } = await customRpc("receive_vendor_finished_products", {
        p_request: crypto.randomUUID(),
        p_supplier: supplier.trim(),
        p_arrival_date: arrivalDate,
        p_remarks: remarks.trim() || null,
        p_items: rows.map((row) => ({
          product_name: row.productName.trim(),
          vendor_style: row.vendorStyle.trim() || null,
          size: row.size.trim(),
          quantity: validCount(row.quantity),
          cp_paise: fabricMoneyInput(row.cp),
          sp_paise: fabricMoneyInput(row.sp),
        })),
      });
      if (error) throw error;
      return (data as { pieces: ResultPiece[] }).pieces;
    },
    onSuccess: async (pieces) => {
      setPrinted(pieces);
      setRows([emptyEntry()]);
      setSupplier("");
      setRemarks("");
      await qc.invalidateQueries();
      toast.success(`${pieces.length} ready-made garment barcodes created`);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Ready-made stock could not be received",
      ),
  });
  if (!allowed) return null;
  const total = rows.reduce((sum, row) => sum + validCount(row.quantity), 0);
  const productNames = catalog.data?.products.map((product) => product.name) ?? [];
  return (
    <div className="space-y-4">
      <Panel
        title="Vendor Readymade Garments"
        description="Receive purchased garments as individual finished pieces. CP and a positive selling price are required before each F barcode is created."
        actions={
          <Button variant="outline" onClick={onBack} disabled={receive.isPending}>
            Fabric / Thaan entry
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <Label htmlFor="vendor-supplier">Supplier / provider</Label>
            <Input
              id="vendor-supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              placeholder="Vendor name"
              disabled={receive.isPending}
            />
          </div>
          <div>
            <Label htmlFor="vendor-arrival">Arrival date</Label>
            <Input
              id="vendor-arrival"
              type="date"
              value={arrivalDate}
              onChange={(event) => setArrivalDate(event.target.value)}
              disabled={receive.isPending}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="vendor-remarks">Remarks (optional)</Label>
            <Input
              id="vendor-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Invoice reference or delivery note"
              disabled={receive.isPending}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Garment details & quantities"
        description="A quantity creates that many separately barcoded physical garments. They initially enter the Workshop / Godown, then transfer to a showroom floor normally."
      >
        <div className="space-y-3">
          {rows.map((row, index) => (
            <section key={row.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="size-4 text-primary" /> Garment type {index + 1}
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <Label htmlFor={`vendor-product-${row.id}`}>Product / garment</Label>
                  <PickOrTypeInput
                    id={`vendor-product-${row.id}`}
                    value={row.productName}
                    options={productNames}
                    placeholder="For example: Shirt"
                    onChange={(productName) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id ? { ...entry, productName } : entry,
                        ),
                      )
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`vendor-style-${row.id}`}>Style / model (optional)</Label>
                  <Input
                    id={`vendor-style-${row.id}`}
                    value={row.vendorStyle}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id
                            ? { ...entry, vendorStyle: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Vendor style or design"
                    disabled={receive.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor={`vendor-size-${row.id}`}>Size</Label>
                  <Input
                    id={`vendor-size-${row.id}`}
                    value={row.size}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id ? { ...entry, size: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="For example: 40 / L"
                    disabled={receive.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor={`vendor-count-${row.id}`}>Piece count</Label>
                  <Input
                    id={`vendor-count-${row.id}`}
                    inputMode="numeric"
                    value={row.quantity}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id ? { ...entry, quantity: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="For example: 12"
                    disabled={receive.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor={`vendor-cp-${row.id}`}>CP per piece, excluding GST (₹)</Label>
                  <Input
                    id={`vendor-cp-${row.id}`}
                    inputMode="decimal"
                    value={row.cp}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id ? { ...entry, cp: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Required CP"
                    disabled={receive.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor={`vendor-sp-${row.id}`}>Selling price per piece (₹)</Label>
                  <Input
                    id={`vendor-sp-${row.id}`}
                    inputMode="decimal"
                    value={row.sp}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.id === row.id ? { ...entry, sp: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Required SP"
                    disabled={receive.isPending}
                  />
                </div>
              </div>
            </section>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-start gap-2"
            disabled={receive.isPending || rows.length >= 100}
            onClick={() => setRows((current) => [...current, emptyEntry()])}
          >
            <Plus className="size-4" /> Add another garment type
          </Button>
        </div>
      </Panel>

      <Panel bodyClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Total ready-made pieces: {total}. Every piece will receive a unique F barcode.
        </p>
        <Button
          disabled={
            receive.isPending ||
            !supplier.trim() ||
            !arrivalDate ||
            !total ||
            total > 5000 ||
            rows.some(
              (row) =>
                !row.productName.trim() ||
                !row.size.trim() ||
                !validCount(row.quantity) ||
                !row.cp.trim() ||
                !row.sp.trim(),
            )
          }
          onClick={() => {
            try {
              for (const row of rows) {
                if (fabricMoneyInput(row.cp) < 0 || fabricMoneyInput(row.sp) <= 0)
                  throw new Error("CP must be zero or more and SP must be positive");
              }
              receive.mutate();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Check CP and SP");
            }
          }}
        >
          <Barcode className="size-4" /> Generate F barcodes
        </Button>
      </Panel>

      {printed.length > 0 && (
        <Panel
          title="Ready-made garment labels"
          description="Each barcode belongs to one physical purchased garment. Print and attach one label to each piece."
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
                description="Vendor purchased"
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
