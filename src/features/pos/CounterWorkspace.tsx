import { FabricReserveTree } from "./FabricReserveTree";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { FactoryTailorPicker } from "@/shared/components/factory-tailor-picker";
import { SalespersonPicker } from "@/features/salesperson/SalespersonPicker";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { CounterBillReceipt, type CounterReceipt } from "./CounterBillReceipt";
import { AdditionalCounterFabric } from "./AdditionalCounterFabric";
import { resolveCounterBarcode, type CounterWork } from "./counter-barcode";
import {
  reserveTotals,
  counterPayload,
  previewTotal,
  gstPreview,
  tailoringAmounts,
  availableAt,
  type CounterRow,
  type ScanRecord,
  type TailoringGroup,
} from "./counter-workspace-model";
import { useGstConfiguration, type GstSupplyType } from "@/features/gst/tax";
type BillRequest = {
  p_request: string;
  p_items: ReturnType<typeof counterPayload>["items"];
  p_tailoring: ReturnType<typeof counterPayload>["tailoring"];
  p_paid: boolean;
  p_salesperson: string;
  p_name: string;
  p_contact: string;
  p_advance_paise?: number;
  p_tax_context: {
    supply_type: GstSupplyType;
    customer_gstin: string;
    customer_state_code: string;
    payment_method: string;
  };
};
const blankGroup = () => ({
  garment: "",
  delivery: "",
  factory: "",
  assignment: "",
  stitching: "",
  design: "",
  customDesign: "",
  notes: "",
});
export function CounterWorkspace() {
  const { isOwner, roles, can } = useSession();
  if (!isOwner && !roles.includes("counter")) return <p>Counter access required.</p>;
  return (
    <CounterContent
      canSell={isOwner || can("pos.sell")}
      canTailor={isOwner || (can("pos.issue_to_tailoring") && can("pos.enter_tailoring_total"))}
      canIssue={isOwner || can("pos.issue_to_tailoring")}
    />
  );
}
function CounterContent({
  canSell,
  canTailor,
  canIssue,
}: {
  canSell: boolean;
  canTailor: boolean;
  canIssue: boolean;
}) {
  const qc = useQueryClient();
  const gst = useGstConfiguration();
  const billCommitted = useRef(false);
  const [extraSource, setExtraSource] = useState<{ id: string; name: string } | null>(null);
  const [work, setWork] = useState<CounterWork | null>(null);
  const [extraScanned, setExtraScanned] = useState<ScanRecord | null>(null);
  const [extraLocked, setExtraLocked] = useState(false);
  const contextVersion = useRef(0);
  const [barcode, setBarcode] = useState(""),
    [rows, setRows] = useState<CounterRow[]>([]),
    [groups, setGroups] = useState<TailoringGroup[]>([]);
  const [salesperson, setSalesperson] = useState(""),
    [name, setName] = useState(""),
    [contact, setContact] = useState(""),
    [paid, setPaid] = useState(true),
    [advance, setAdvance] = useState("");
  const [supplyType, setSupplyType] = useState<GstSupplyType>("intra_state");
  const [customerGstin, setCustomerGstin] = useState("");
  const [customerStateCode, setCustomerStateCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [form, setForm] = useState(blankGroup),
    [reserves, setReserves] = useState<ScanRecord | null>(null),
    [ambiguous, setAmbiguous] = useState<ScanRecord | null>(null);
  const [pending, setPending] = useState<BillRequest | null>(null),
    [receipt, setReceipt] = useState<CounterReceipt | null>(null);
  const definitions = useQuery({
    queryKey: ["production-catalog"],
    enabled: canTailor,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tailoring_work_catalog");
      if (error) throw error;
      return data as unknown as {
        products: { id: string; name: string }[];
        designs: { id: string; name: string; code: string }[];
      };
    },
  });
  const scan = useMutation({
    mutationFn: (code: string) => resolveCounterBarcode(code),
    onSuccess: (result) => {
      if (result.kind === "document") {
        if (rows.length) {
          toast.error("Complete or clear the current bill before opening an existing ID");
          return;
        }
        contextVersion.current++;
        setWork(result.work);
        setReceipt(result.receipt);
        setExtraScanned(null);
        setExtraSource(null);
        setBarcode("");
        return;
      }
      const record = result.item;
      if (work && record.kind !== "fabric") {
        toast.error(
          "This ID is loaded for extra fabric. Start a new bill to sell a finished piece.",
        );
        return;
      }
      if (record.kind === "product" && !record.available) {
        toast.error("This finished piece is not available on a Showroom floor");
        return;
      }
      const cuts = record.cuts ?? [];
      const choices = cuts.flatMap((cut) =>
        cut.locations
          .filter(
            (location) =>
              location.kind === "showroom_sublocation" && Number(location.quantity_mm) > 0,
          )
          .map((location) => ({ cut, location })),
      );
      if (record.kind === "fabric" && !cuts.length) {
        setReserves(record);
        toast.error("No fabric is available on a Showroom floor");
        return;
      }
      if (work) {
        if (choices.length !== 1) {
          setAmbiguous(record);
          toast.info("Choose the Showroom floor holding this fabric");
          return;
        }
        const choice = choices[0];
        if (!choice) return;
        setExtraScanned({ ...record, cuts: [choice.cut] });
        setExtraSource(choice.location);
        setBarcode("");
        return;
      }
      if (!canSell) {
        toast.error("Selling permission required");
        return;
      }
      setReceipt(null);
      if (record.kind === "product") {
        addRow(record, undefined, {
          id: record.source_location_id!,
          name: record.source_name!,
        });
        return;
      }
      if (choices.length > 1) {
        setAmbiguous({ ...record, cuts });
        return;
      }
      if (!choices.length) {
        setReserves(record);
        toast.error("No fabric is available on a Showroom floor");
        return;
      }
      const choice = choices[0];
      if (!choice) return;
      addRow(record, choice.cut, choice.location);
    },
    onError: (e) => toast.error(e.message),
  });
  function addRow(
    record: ScanRecord,
    cut: CounterRow["cut"],
    source: { id: string; name: string },
  ) {
    if (work) {
      setExtraScanned({ ...record, cuts: cut ? [cut] : [] });
      setExtraSource(source);
      setBarcode("");
      setAmbiguous(null);
      return;
    }
    const key = record.kind === "product" ? record.id! : `${cut!.inventory_item_id}:${source.id}`;
    if (rows.some((r) => r.key === key)) {
      toast.info("This barcode is already listed");
      setBarcode("");
      return;
    }
    setRows([...rows, { key, scan: record, cut, source, metres: "", price: "", selected: false }]);
    setBarcode("");
    setAmbiguous(null);
  }
  const bill = useMutation({
    mutationFn: async (args: BillRequest) => {
      setPending(args);
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: Error | null }>
      )("complete_counter_bill_gst", { ...args, p_advance_paise: args.p_advance_paise ?? null });
      if (error) throw error;
      if (!data)
        throw new Error("The bill was saved but its ID was not returned. Retry the same bill.");
      billCommitted.current = true;
      const result = await supabase.rpc("counter_bill", { p_code: data });
      if (result.error) throw result.error;
      return result.data as unknown as CounterReceipt;
    },
    onSuccess: (doc) => {
      setReceipt(doc);
      billCommitted.current = false;
      setPending(null);
      setRows([]);
      setGroups([]);
      setForm(blankGroup());
      setName("");
      setContact("");
      setPaid(true);
      setAdvance("");
      setCustomerGstin("");
      setCustomerStateCode("");
      void qc.invalidateQueries();
      toast.success("Bill saved; stock updated");
    },
    onError: (e) => {
      if (!billCommitted.current && definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const settle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_counter_bill_paid", {
        p_request: crypto.randomUUID(),
        p_bill: receipt!.id,
      });
      if (error) throw error;
      const result = await supabase.rpc("counter_bill", { p_code: receipt!.id });
      if (result.error) throw result.error;
      return result.data as unknown as CounterReceipt;
    },
    onSuccess: (doc) => {
      setReceipt(doc);
      void qc.invalidateQueries();
      toast.success("Full payment recorded");
    },
    onError: (e) => toast.error(e.message),
  });
  const frozen = bill.isPending || !!pending || extraLocked || settle.isPending;
  async function refreshWork() {
    if (!work) return;
    const version = contextVersion.current;
    try {
      const result = await resolveCounterBarcode(work.code);
      if (version !== contextVersion.current) return;
      if (result.kind === "document") {
        setWork(result.work);
        setReceipt(result.receipt);
      }
    } catch {
      toast.warning("Fabric was issued. Scan the ID again to refresh its recorded details.");
    }
  }
  function addGroup() {
    try {
      const selected = rows.filter((r) => r.selected && !r.group && r.scan.kind === "fabric");
      if (!selected.length) throw new Error("Select one or more fabric rows");
      if (!form.delivery) throw new Error("Select a delivery date before adding the tailoring job");
      if (!form.garment.trim() || !form.assignment || !form.stitching.trim())
        throw new Error("Enter garment, factory, tailor and stitching charge");
      const group = { ...form, id: crypto.randomUUID(), keys: selected.map((r) => r.key) };
      counterPayload(
        selected.map((r) => ({ ...r, group: group.id })),
        [group],
      );
      setGroups([...groups, group]);
      setRows(
        rows.map((r) =>
          group.keys.includes(r.key) ? { ...r, group: group.id, selected: false } : r,
        ),
      );
      setForm(blankGroup());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check tailoring details");
    }
  }
  function submit() {
    if (pending) {
      bill.mutate(pending);
      return;
    }
    try {
      if (rows.some((r) => r.selected && !r.group))
        throw new Error("Add the selected tailoring job before completing this bill");
      if (!salesperson) throw new Error("Select the credited Salesperson");
      const payload = counterPayload(rows, groups);
      const tax = gstPreview(rows, groups, gst.data, supplyType);
      const billTotal = tax?.final ?? previewTotal(rows, groups);
      const advancePaise = groups.length && advance.trim() ? fabricMoneyInput(advance) : null;
      if (advancePaise !== null && (billTotal === null || BigInt(advancePaise) > billTotal))
        throw new Error("Advance cannot exceed the bill total");
      bill.mutate({
        p_request: crypto.randomUUID(),
        p_items: payload.items,
        p_tailoring: payload.tailoring,
        p_paid: groups.length
          ? advancePaise === null
            ? paid
            : billTotal === BigInt(advancePaise)
          : true,
        p_salesperson: salesperson,
        p_name: name,
        p_contact: contact,
        p_tax_context: {
          supply_type: supplyType,
          customer_gstin: customerGstin.trim().toUpperCase(),
          customer_state_code: customerStateCode.trim(),
          payment_method: paymentMethod,
        },
        ...(groups.length && advancePaise !== null && billTotal !== BigInt(advancePaise)
          ? { p_advance_paise: advancePaise }
          : {}),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the bill");
    }
  }
  const pendingTailoring = canTailor && rows.some((r) => r.selected && !r.group);
  const taxPreview = gstPreview(rows, groups, gst.data, supplyType);
  const total = pendingTailoring
    ? previewTotal(rows, groups, form.stitching)
    : (taxPreview?.final ?? previewTotal(rows, groups));
  const updateRow = (key: string, change: Partial<CounterRow>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <div className="space-y-4">
      <Panel
        title="Scan item, customer bill or Production ID"
        description={
          work
            ? `Extra fabric for ${work.code}`
            : "Scan any Showroom item. Its recorded floor is attached automatically to this bill."
        }
        actions={
          (work || receipt) && (
            <Button
              variant="outline"
              disabled={frozen || scan.isPending}
              onClick={() => {
                contextVersion.current++;
                setWork(null);
                setReceipt(null);
                setExtraScanned(null);
                setExtraSource(null);
                setBarcode("");
              }}
            >
              New bill
            </Button>
          )
        }
      >
        <BarcodeEntry
          value={barcode}
          onChange={(value) => {
            setBarcode(value);
            setExtraScanned(null);
            setExtraSource(null);
          }}
          onScan={(code) => scan.mutate(code)}
          label="Counter barcode"
          placeholder={
            work
              ? "Scan a Thaan to issue, or another bill / Production ID"
              : "Scan or type an item, customer bill or Production ID"
          }
          disabled={frozen || scan.isPending}
        />
      </Panel>
      {work && extraSource && (
        <AdditionalCounterFabric
          key={`${extraSource.id}:${work.kind}:${work.code}`}
          source={extraSource}
          work={work}
          scanned={extraScanned}
          onScannedChange={setExtraScanned}
          onLocked={setExtraLocked}
          onIssued={() => void refreshWork()}
          disabled={scan.isPending || settle.isPending}
          canIssue={canIssue}
        />
      )}
      {!work && !receipt && (
        <>
          <Panel
            title="Current bill"
            description="Fabric prices are per metre. Finished pieces use their saved fixed SP. A tailored item combines its fabric price and one stitching charge."
          >
            <fieldset disabled={frozen || scan.isPending} className="space-y-4">
              <div className="space-y-2">
                {rows.map((r) => (
                  <div
                    key={r.key}
                    className="grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_130px_180px_auto]"
                  >
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <div className="flex items-start gap-2">
                        {r.scan.kind === "fabric" && !r.group && canTailor && (
                          <input
                            aria-label={`Select ${r.scan.barcode} for tailoring`}
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={r.selected}
                            onChange={(e) => updateRow(r.key, { selected: e.target.checked })}
                          />
                        )}
                        <div className="min-w-0">
                          <strong className="text-sm">{r.scan.name}</strong>
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {r.scan.barcode}
                          </p>
                          {r.scan.kind === "product" ? (
                            <p className="text-xs">
                              Size {r.scan.size ?? "Not recorded"} · {r.scan.design}
                            </p>
                          ) : (
                            <>
                              <p className="text-xs">
                                {r.source.name} · Available:{" "}
                                {reportQuantity(String(availableAt(r)), "mm")}
                              </p>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-auto max-w-full justify-start px-0 text-left whitespace-normal"
                                onClick={() => setReserves(r.scan)}
                              >
                                {reserveTotals(r.scan, r.cut)}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {r.scan.kind === "fabric" ? (
                      <label className="text-xs">
                        Cut metres
                        <Input
                          aria-label={`Cut metres ${r.scan.barcode}`}
                          inputMode="decimal"
                          value={r.metres}
                          onChange={(e) => updateRow(r.key, { metres: e.target.value })}
                        />
                      </label>
                    ) : (
                      <p className="self-center text-sm">1 piece</p>
                    )}
                    {r.scan.kind === "fabric" ? (
                      <label className="text-xs">
                        Fabric price ₹ / metre
                        <Input
                          aria-label={`Fabric price per metre ${r.scan.barcode}`}
                          inputMode="decimal"
                          value={r.price}
                          onChange={(e) => updateRow(r.key, { price: e.target.value })}
                        />
                      </label>
                    ) : (
                      <p className="self-center text-sm">
                        {reportMoney(String(r.scan.sp_paise))} · fixed SP
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      className="col-span-2 justify-self-end md:col-span-1"
                      disabled={!!r.group}
                      aria-label={`Remove ${r.scan.barcode}`}
                      onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              {canTailor && rows.some((r) => r.selected && !r.group) && (
                <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                  <h3 className="font-semibold">Tailoring for selected fabric</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Garment / order
                      <Input
                        list="counter-garments"
                        aria-label="Tailoring garment"
                        value={form.garment}
                        onChange={(e) => setForm({ ...form, garment: e.target.value })}
                        placeholder="Sherwani, suit, kurta or custom order"
                      />
                      <datalist id="counter-garments">
                        {definitions.data?.products.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                    </label>
                    <label className="text-sm">
                      Delivery date
                      <Input
                        type="date"
                        aria-label="Tailoring delivery date"
                        value={form.delivery}
                        onChange={(e) => setForm({ ...form, delivery: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      Stitching charge ₹ (entire job)
                      <Input
                        aria-label="Stitching charge"
                        inputMode="decimal"
                        value={form.stitching}
                        onChange={(e) => setForm({ ...form, stitching: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      Design (optional)
                      <select
                        aria-label="Customer design"
                        className="min-h-11 w-full rounded border bg-background p-2"
                        value={form.design}
                        onChange={(e) => setForm({ ...form, design: e.target.value })}
                      >
                        <option value="">No design specified</option>
                        {definitions.data?.designs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.code} · {d.name}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {form.design === "custom" && (
                      <Input
                        aria-label="Custom customer design"
                        value={form.customDesign}
                        onChange={(e) => setForm({ ...form, customDesign: e.target.value })}
                        placeholder="Describe custom design"
                      />
                    )}
                    <label className="text-sm sm:col-span-2">
                      Tailor notes (optional)
                      <Textarea
                        aria-label="Tailor notes"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Measurements, finishing instructions or customer requests"
                      />
                    </label>
                  </div>
                  <FactoryTailorPicker
                    factory={form.factory}
                    onFactory={(factory) => setForm({ ...form, factory, assignment: "" })}
                    selected={form.assignment ? [form.assignment] : []}
                    onSelected={(selected) =>
                      setForm((current) => ({ ...current, assignment: selected[0] ?? "" }))
                    }
                  />
                  <Button onClick={addGroup}>Add tailoring job</Button>
                  <p role="status" className="text-sm text-muted-foreground">
                    Tailoring job pending. Complete its details and click Add tailoring job before
                    completing the bill.
                  </p>
                </div>
              )}
              {groups.map((g) => {
                let amounts;
                try {
                  amounts = tailoringAmounts(rows, g);
                } catch {
                  amounts = null;
                }
                return (
                  <div
                    key={g.id}
                    className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <strong>{g.garment}</strong>
                      <p>
                        {g.keys.length} fabrics · Delivery {g.delivery}
                      </p>
                      <p>
                        {amounts
                          ? `Fabric ${reportMoney(String(amounts.fabric))} + Stitching ${reportMoney(String(amounts.stitching))} · Bill line ${reportMoney(String(amounts.total))}`
                          : "Enter valid fabric quantities and prices"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGroups(groups.filter((x) => x.id !== g.id));
                        setRows(
                          rows.map((r) =>
                            r.group === g.id
                              ? { ...r, group: undefined, selected: true }
                              : { ...r, selected: false },
                          ),
                        );
                        setForm({ ...blankGroup(), ...g });
                      }}
                    >
                      Edit job
                    </Button>
                  </div>
                );
              })}
              {!!rows.length && (
                <div className="space-y-3 rounded-xl border p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      aria-label="Customer name optional"
                      placeholder="Customer name (optional)"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Input
                      aria-label="Customer contact optional"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="tel"
                      placeholder="Contact (optional; saved contacts are reused)"
                      value={contact}
                      onChange={(e) => setContact(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>
                  {gst.data?.configuration?.enabled && (
                    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
                      <select
                        aria-label="GST supply type"
                        className="h-11 rounded border bg-background p-2"
                        value={supplyType}
                        onChange={(e) => setSupplyType(e.target.value as GstSupplyType)}
                      >
                        <option value="intra_state">Intra-state · CGST + SGST</option>
                        <option value="inter_state">Inter-state · IGST</option>
                      </select>
                      <Input
                        aria-label="Customer GSTIN"
                        placeholder="Customer GSTIN (optional)"
                        value={customerGstin}
                        onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                      />
                      <Input
                        aria-label="Customer state code"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="State code (optional)"
                        value={customerStateCode}
                        onChange={(e) =>
                          setCustomerStateCode(e.target.value.replace(/\D/g, "").slice(0, 2))
                        }
                      />
                      <select
                        aria-label="Payment method"
                        className="h-11 rounded border bg-background p-2"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="upi">UPI</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </div>
                  )}
                  <SalespersonPicker
                    id="combined-salesperson"
                    value={salesperson}
                    onChange={setSalesperson}
                    disabled={frozen}
                  />
                  {!!groups.length && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        Advance received ₹
                        <Input
                          aria-label="Advance received"
                          inputMode="decimal"
                          value={advance}
                          onChange={(event) => {
                            setAdvance(event.target.value);
                            setPaid(false);
                          }}
                          placeholder="Enter amount paid now"
                        />
                      </label>
                      <div className="self-end rounded-lg border bg-muted/30 p-3 text-sm">
                        Balance ₹{" "}
                        {(() => {
                          try {
                            const received = advance.trim()
                              ? BigInt(fabricMoneyInput(advance))
                              : 0n;
                            return total === null ? "—" : reportMoney(String(total - received));
                          } catch {
                            return "—";
                          }
                        })()}
                      </div>
                      <label className="block text-sm">
                        Or payment status
                        <select
                          aria-label="Bill payment status"
                          className="ml-3 min-h-11 rounded border bg-background p-2"
                          value={paid ? "paid" : "unpaid"}
                          disabled={!!advance.trim()}
                          onChange={(e) => setPaid(e.target.value === "paid")}
                        >
                          <option value="paid">Paid in full</option>
                          <option value="unpaid">No advance yet</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <p className="font-semibold">
                    Bill total{" "}
                    {total === null ? "Enter quantities and prices" : reportMoney(String(total))}
                  </p>
                  {gst.data?.configuration?.enabled && taxPreview && !pendingTailoring && (
                    <div className="grid gap-1 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
                      <span>Taxable {reportMoney(String(taxPreview.taxable))}</span>
                      {supplyType === "intra_state" ? (
                        <span>
                          CGST {reportMoney(String(taxPreview.cgst))} · SGST{" "}
                          {reportMoney(String(taxPreview.sgst))}
                        </span>
                      ) : (
                        <span>IGST {reportMoney(String(taxPreview.igst))}</span>
                      )}
                      <strong>GST {reportMoney(String(taxPreview.gst))}</strong>
                      <strong>Invoice total {reportMoney(String(taxPreview.final))}</strong>
                    </div>
                  )}
                  {pendingTailoring && (
                    <p role="status" className="text-sm">
                      Add the selected tailoring job before completing this bill.
                    </p>
                  )}
                  <Button
                    disabled={!canSell || bill.isPending || pendingTailoring}
                    onClick={submit}
                  >
                    {pending
                      ? "Retry unchanged bill"
                      : groups.length
                        ? "Complete bill"
                        : "Complete paid bill"}
                  </Button>
                </div>
              )}
            </fieldset>
            {pending && !bill.isPending && (
              <div className="mt-3 space-y-2">
                <p role="alert">
                  The result is uncertain. Retry the same bill before changing its contents.
                </p>
                <Button onClick={submit}>Retry unchanged bill</Button>
              </div>
            )}
          </Panel>
        </>
      )}
      {receipt && !receipt.paid && (
        <Button disabled={frozen || scan.isPending || !canSell} onClick={() => settle.mutate()}>
          Record full payment {reportMoney(receipt.total_paise)}
        </Button>
      )}
      {receipt &&
        (work ? (
          <details className="rounded-xl border bg-card p-3">
            <summary className="cursor-pointer font-semibold">
              Original customer bill · {receipt.code}
            </summary>
            <div className="mt-3">
              <CounterBillReceipt receipt={receipt} />
            </div>
          </details>
        ) : (
          <CounterBillReceipt receipt={receipt} />
        ))}
      <Dialog
        open={!!reserves || !!ambiguous}
        onOpenChange={(open) => {
          if (!open) {
            setReserves(null);
            setAmbiguous(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {ambiguous ? "Choose the physical Thaan" : "Fabric locations & variants"}
            </DialogTitle>
            <DialogDescription>
              Recorded stock across Showroom floors and Workshop. Costs are protected.
            </DialogDescription>
          </DialogHeader>
          {ambiguous ? (
            <FabricReserveTree
              scan={ambiguous}
              onChoose={(c, location) => addRow(ambiguous, c, location)}
            />
          ) : (
            reserves && <FabricReserveTree scan={reserves} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
