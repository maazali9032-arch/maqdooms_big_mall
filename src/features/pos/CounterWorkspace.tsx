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
import { FinishedProductExchange } from "./FinishedProductExchange";
import { DefectiveReturnWorkflow } from "./DefectiveReturnWorkflow";
import { counterPayment } from "./counter-payment";
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
  p_birth_date: string | null;
  p_advance_paise?: number;
  p_discount_mode: "percent" | "amount";
  p_discount_value: number;
  p_tax_context: {
    configuration_id: string | null;
    customer_gstin: string;
    payment_method: string;
  };
};
const blankGroup = () => ({
  garment: "",
  delivery: "",
  factory: "",
  assignment: "",
  sp: "",
  size: "",
  design: "",
  customDesign: "",
  notes: "",
});
const birthMonths = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
function parsedBirthDate(day: string, month: string, year: string) {
  if (!day.trim() && !month.trim() && !year.trim()) return null;
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  const monthNumber = birthMonths.indexOf(month.trim().toUpperCase()) + 1;
  if (!Number.isInteger(dayNumber) || !Number.isInteger(yearNumber) || monthNumber < 1)
    throw new Error("Enter the complete birth date as day, three-letter month and year");
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    year.length !== 4 ||
    yearNumber < 1900 ||
    date.getUTCFullYear() !== yearNumber ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber ||
    date > new Date()
  )
    throw new Error("Enter a valid customer birth date");
  return `${yearNumber}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}
function discountInput(mode: "percent" | "amount", value: string) {
  if (mode === "amount") return fabricMoneyInput(value || "0");
  const bps = Math.round(Number(value || "0") * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 10000)
    throw new Error("Enter a discount from 0 to 100%");
  return bps;
}
export function CounterWorkspace() {
  const { isOwner, roles, can } = useSession();
  if (!isOwner && !roles.includes("counter")) return <p>Counter access required.</p>;
  return (
    <CounterContent
      canSell={isOwner || can("pos.sell")}
      canTailor={isOwner || (can("pos.issue_to_tailoring") && can("pos.enter_tailoring_total"))}
      canIssue={isOwner || can("pos.issue_to_tailoring")}
      isOwner={isOwner}
    />
  );
}
function CounterContent({
  canSell,
  canTailor,
  canIssue,
  isOwner,
}: {
  canSell: boolean;
  canTailor: boolean;
  canIssue: boolean;
  isOwner: boolean;
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
    [advance, setAdvance] = useState("0");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("0");
  const [ownerDiscountMode, setOwnerDiscountMode] = useState<"percent" | "amount">("percent");
  const [ownerDiscount, setOwnerDiscount] = useState("");
  const [businessInvoice, setBusinessInvoice] = useState(false);
  const [customerGstin, setCustomerGstin] = useState("");
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
    setRows([
      ...rows,
      {
        key,
        scan: record,
        cut,
        source,
        metres: "",
        cutUnit: "m",
        price: "",
        selected: false,
      },
    ]);
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
      )("complete_counter_bill_gst_discount_value", {
        ...args,
        p_advance_paise: args.p_advance_paise ?? null,
      });
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
      setBirthDay("");
      setBirthMonth("");
      setBirthYear("");
      setAdvance("0");
      setDiscountMode("percent");
      setDiscountValue("0");
      setBusinessInvoice(false);
      setCustomerGstin("");
      void qc.invalidateQueries();
      toast.success("Bill saved; stock updated");
    },
    onError: (e) => {
      if (!billCommitted.current && definiteDatabaseRejection(e)) setPending(null);
      if (e.message.includes("GST configuration changed")) void gst.refetch();
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
  const reviseDiscount = useMutation({
    mutationFn: async () => {
      const value = discountInput(ownerDiscountMode, ownerDiscount);
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: Error | null }>
      )("owner_revise_counter_bill_discount_value", {
        p_bill: receipt!.id,
        p_discount_mode: ownerDiscountMode,
        p_discount_value: value,
      });
      if (error) throw error;
      const result = await supabase.rpc("counter_bill", { p_code: data ?? receipt!.id });
      if (result.error) throw result.error;
      return result.data as unknown as CounterReceipt;
    },
    onSuccess: (doc) => {
      setReceipt(doc);
      setOwnerDiscount("");
      void qc.invalidateQueries();
      toast.success("Discount saved on the same bill");
    },
    onError: (e) => toast.error(e.message),
  });
  const frozen =
    bill.isPending || !!pending || extraLocked || settle.isPending || reviseDiscount.isPending;
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
      if (
        !form.garment.trim() ||
        !form.size.trim() ||
        !form.assignment ||
        !form.sp.trim() ||
        fabricMoneyInput(form.sp) <= 0
      )
        throw new Error("Enter garment, size, factory, master tailor and selling price");
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
      if (gst.isPending || gst.error)
        throw new Error("Load the current GST configuration before completing this bill");
      if (businessInvoice && !/^\d{2}[A-Z0-9]{13}$/.test(customerGstin.trim().toUpperCase()))
        throw new Error("Enter the customer's valid GSTIN for a GST business invoice");
      const payload = counterPayload(rows, groups);
      const selectedDiscount = discountInput(discountMode, discountValue);
      const tax = gstPreview(
        rows,
        groups,
        gst.data,
        derivedSupplyType,
        discountMode,
        BigInt(selectedDiscount),
      );
      if (gst.data?.configuration?.enabled && !tax)
        throw new Error("Check the configured GST rules and bill prices");
      const billTotal = tax?.final ?? previewTotal(rows, groups);
      const payment = counterPayment(billTotal, !!groups.length, advance);
      bill.mutate({
        p_request: crypto.randomUUID(),
        p_items: payload.items,
        p_tailoring: payload.tailoring,
        p_paid: payment.paid,
        p_salesperson: salesperson,
        p_discount_mode: discountMode,
        p_discount_value: selectedDiscount,
        p_name: name,
        p_contact: contact,
        p_birth_date: parsedBirthDate(birthDay, birthMonth, birthYear),
        p_tax_context: {
          configuration_id: gst.data?.configuration?.enabled ? gst.data.configuration.id : null,
          customer_gstin: businessInvoice ? customerGstin.trim().toUpperCase() : "",
          payment_method: paymentMethod,
        },
        ...(payment.advancePaise !== undefined ? { p_advance_paise: payment.advancePaise } : {}),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the bill");
    }
  }
  const pendingTailoring = canTailor && rows.some((r) => r.selected && !r.group);
  const businessStateCode = gst.data?.configuration?.state_code;
  const customerStateCode = customerGstin.trim().slice(0, 2);
  const derivedSupplyType: GstSupplyType =
    businessInvoice && /^\d{2}$/.test(customerStateCode) && customerStateCode !== businessStateCode
      ? "inter_state"
      : "intra_state";
  let previewDiscount: bigint | null = null;
  try {
    previewDiscount = BigInt(discountInput(discountMode, discountValue));
  } catch {
    previewDiscount = null;
  }
  const taxPreview = gstPreview(
    rows,
    groups,
    gst.data,
    derivedSupplyType,
    discountMode,
    previewDiscount ?? -1n,
  );
  const total = pendingTailoring
    ? previewTotal(rows, groups, form.sp)
    : (taxPreview?.final ?? previewTotal(rows, groups));
  const updateRow = (key: string, change: Partial<CounterRow>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <div className="space-y-4">
      <Panel
        title="Scan item, customer bill, tailor work order or Production ID"
        description={
          work
            ? "Order loaded below. Scan a Thaan next to issue extra fabric."
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
              ? "Scan a Thaan to issue, or another work order / bill / Production ID"
              : "Scan an item, customer bill, tailor work order or Production ID"
          }
          disabled={frozen || scan.isPending}
        />
      </Panel>
      {work && (
        <AdditionalCounterFabric
          key={`${work.kind}:${work.code}`}
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
            description="Fabric-only sales use a per-metre price. Finished and customer-tailored garments use one final SP."
          >
            <fieldset disabled={frozen || scan.isPending} className="space-y-4">
              <div className="space-y-2">
                {rows.map((r) => (
                  <div
                    key={r.key}
                    className="grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_110px_130px_180px_auto]"
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
                        Cut unit
                        <select
                          aria-label={`Cut unit ${r.scan.barcode}`}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={r.cutUnit}
                          onChange={(e) =>
                            updateRow(r.key, {
                              cutUnit: e.target.value as CounterRow["cutUnit"],
                            })
                          }
                        >
                          <option value="m">Metre</option>
                          <option value="cm">Centimetre</option>
                          <option value="mm">Millimetre</option>
                          <option value="in">Inch</option>
                        </select>
                      </label>
                    ) : (
                      <span className="hidden md:block" />
                    )}
                    {r.scan.kind === "fabric" ? (
                      <label className="text-xs">
                        Cut quantity
                        <Input
                          aria-label={`Cut quantity ${r.scan.barcode}`}
                          inputMode="decimal"
                          value={r.metres}
                          onChange={(e) => updateRow(r.key, { metres: e.target.value })}
                        />
                      </label>
                    ) : (
                      <p className="self-center text-sm">1 piece</p>
                    )}
                    {r.scan.kind === "fabric" && !r.group && !r.selected ? (
                      <label className="text-xs">
                        Fabric price ₹ / metre
                        <Input
                          aria-label={`Fabric price per metre ${r.scan.barcode}`}
                          inputMode="decimal"
                          value={r.price}
                          onChange={(e) => updateRow(r.key, { price: e.target.value })}
                        />
                      </label>
                    ) : r.scan.kind === "product" ? (
                      <p className="self-center text-sm">
                        {reportMoney(String(r.scan.sp_paise))} · fixed SP
                      </p>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">
                        Included in tailored garment SP
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
                      Selling price (SP) ₹
                      <Input
                        aria-label="Tailored garment selling price"
                        inputMode="decimal"
                        value={form.sp}
                        onChange={(e) => setForm({ ...form, sp: e.target.value })}
                        placeholder="Final customer price"
                      />
                    </label>
                    <label className="text-sm">
                      Size
                      <Input
                        aria-label="Tailored garment size"
                        maxLength={60}
                        value={form.size}
                        onChange={(e) => setForm({ ...form, size: e.target.value })}
                        placeholder="For example: 38 or 40"
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
                        Size {g.size} · SP {amounts ? reportMoney(String(amounts.total)) : "—"}
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
                  <div className="grid gap-3 lg:grid-cols-3">
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
                    <fieldset className="grid grid-cols-[72px_96px_minmax(100px,1fr)] gap-2">
                      <legend className="sr-only">Customer birth date optional</legend>
                      <Input
                        aria-label="Customer birth day optional"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="DD"
                        value={birthDay}
                        onChange={(event) =>
                          setBirthDay(event.target.value.replace(/[^0-9]/g, "").slice(0, 2))
                        }
                      />
                      <Input
                        aria-label="Customer birth month optional"
                        list="birth-months"
                        maxLength={3}
                        placeholder="MON"
                        value={birthMonth}
                        onChange={(event) =>
                          setBirthMonth(
                            event.target.value
                              .replace(/[^a-z]/gi, "")
                              .toUpperCase()
                              .slice(0, 3),
                          )
                        }
                      />
                      <datalist id="birth-months">
                        {birthMonths.map((month) => (
                          <option key={month} value={month} />
                        ))}
                      </datalist>
                      <Input
                        aria-label="Customer birth year optional"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="YYYY"
                        value={birthYear}
                        onChange={(event) =>
                          setBirthYear(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))
                        }
                      />
                    </fieldset>
                  </div>
                  {gst.data?.configuration?.enabled && (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">Payment and tax invoice</p>
                          <p className="text-xs text-muted-foreground">
                            Ordinary retail bills use the registered business state automatically.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBusinessInvoice((current) => !current);
                            if (businessInvoice) setCustomerGstin("");
                          }}
                        >
                          {businessInvoice
                            ? "Use ordinary retail bill"
                            : "Add GST business invoice details"}
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {businessInvoice && (
                          <div>
                            <Input
                              aria-label="Customer GSTIN"
                              placeholder="Customer GSTIN"
                              value={customerGstin}
                              onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              Supply type is derived from this GSTIN and the registered business
                              state.
                            </p>
                          </div>
                        )}
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
                    </div>
                  )}
                  <label className="block text-sm">
                    Discount
                    <div className="mt-1 grid grid-cols-[140px_minmax(0,1fr)] gap-2">
                      <select
                        aria-label="Bill discount type"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={discountMode}
                        onChange={(event) => {
                          setDiscountMode(event.target.value as "percent" | "amount");
                          setDiscountValue("0");
                        }}
                      >
                        <option value="percent">Percentage %</option>
                        <option value="amount">Amount ₹</option>
                      </select>
                      <Input
                        aria-label={
                          discountMode === "percent"
                            ? "Bill discount percentage"
                            : "Bill discount amount"
                        }
                        inputMode="decimal"
                        value={discountValue}
                        onChange={(event) => setDiscountValue(event.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Enter either an exact rupee discount or a percentage. Applied before GST is
                      extracted from the inclusive selling price.
                    </span>
                  </label>
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
                          onChange={(event) => setAdvance(event.target.value)}
                          placeholder="Enter amount paid now"
                        />
                      </label>
                      <div className="self-end rounded-lg border bg-muted/30 p-3 text-sm">
                        Balance due{" "}
                        {(() => {
                          try {
                            return reportMoney(
                              String(counterPayment(total, true, advance).balance),
                            );
                          } catch {
                            return "—";
                          }
                        })()}
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Enter the amount collected now. Use 0 for no payment, or the bill total for
                        full payment. Balance is calculated automatically.
                      </p>
                    </div>
                  )}
                  <p className="font-semibold">
                    Bill total{" "}
                    {total === null ? "Enter quantities and prices" : reportMoney(String(total))}
                  </p>
                  {gst.error && (
                    <p role="alert" className="text-sm text-destructive">
                      Could not load current GST settings.{" "}
                      <button className="underline" onClick={() => void gst.refetch()}>
                        Retry
                      </button>
                    </p>
                  )}
                  {gst.data?.configuration?.enabled && taxPreview && !pendingTailoring && (
                    <div className="grid gap-1 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
                      <span>Taxable {reportMoney(String(taxPreview.taxable))}</span>
                      {derivedSupplyType === "intra_state" ? (
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
                    disabled={
                      !canSell || bill.isPending || pendingTailoring || gst.isPending || !!gst.error
                    }
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
        !work &&
        isOwner &&
        !receipt.exchange &&
        receipt.discount_edit_until &&
        new Date(receipt.discount_edit_until).getTime() > Date.now() && (
          <Panel
            title="Owner discount correction"
            description="This updates the same bill and barcode. Available for one hour after billing."
          >
            <div className="flex max-w-xl flex-wrap items-end gap-2">
              <label className="min-w-36 text-sm">
                Discount type
                <select
                  aria-label="Owner bill discount type"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={ownerDiscountMode}
                  onChange={(event) => {
                    setOwnerDiscountMode(event.target.value as "percent" | "amount");
                    setOwnerDiscount("");
                  }}
                >
                  <option value="percent">Percentage %</option>
                  <option value="amount">Amount ₹</option>
                </select>
              </label>
              <label className="min-w-48 flex-1 text-sm">
                Discount {ownerDiscountMode === "percent" ? "%" : "₹"}
                <Input
                  aria-label={
                    ownerDiscountMode === "percent"
                      ? "Owner bill discount percentage"
                      : "Owner bill discount amount"
                  }
                  inputMode="decimal"
                  placeholder={
                    ownerDiscountMode === "amount"
                      ? String(Number(receipt.discount_paise ?? 0) / 100)
                      : String((receipt.discount_bps ?? 0) / 100)
                  }
                  value={ownerDiscount}
                  onChange={(event) => setOwnerDiscount(event.target.value)}
                />
              </label>
              <Button
                disabled={reviseDiscount.isPending || !ownerDiscount.trim()}
                onClick={() => reviseDiscount.mutate()}
              >
                {reviseDiscount.isPending ? "Saving…" : "Save discount"}
              </Button>
            </div>
          </Panel>
        )}
      {receipt && !work && receipt.paid && !receipt.exchange && (
        <>
          <DefectiveReturnWorkflow
            receipt={receipt}
            disabled={frozen || scan.isPending || !canSell}
          />
          <FinishedProductExchange
            receipt={receipt}
            disabled={frozen || scan.isPending || !canSell}
            onComplete={(newReceipt) => {
              setReceipt(newReceipt);
              void qc.invalidateQueries();
            }}
          />
        </>
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
