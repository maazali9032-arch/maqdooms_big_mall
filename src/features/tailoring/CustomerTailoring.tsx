import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { CustomerTailoringSetup } from "./CustomerTailoringSetup";
import { hierarchySections, hierarchyTailors } from "./hierarchy-options";
import { CustomerTailoringCustomer } from "./CustomerTailoringCustomer";
import { customerTailoringCut, customerTailoringItems } from "./customer-tailoring-input";
import { printCustomerTailoringBill, type CustomerTailoringBill } from "./customer-tailoring-bill";

type Stock = {
  id: string;
  fabric_name: string;
  batch_code: string;
  barcode: string;
  cuts: {
    inventory_item_id: string;
    thaan_id: string;
    locations: { id: string; name: string; quantity_mm: number }[];
  }[];
};
type Assignment = {
  id: string;
  factory_id: string;
  factory_name: string;
  section_id: string | null;
  section_name: string | null;
  tailor_name: string;
  tailor_code: string;
};
type Catalogue = {
  stocks: Stock[];
  assignments: Assignment[];
  charges: { id: string; name: string; code: string; amount_paise?: number }[];
};
type Cut = { inventory_item_id: string; thaan_id: string; quantity: number; label: string };
type Quote = { quote_id: string; final_customer_price_paise: number };
type Job = Omit<CustomerTailoringBill, "issues"> & {
  id: string;
  code: string;
  status: string;
  notes: string | null;
  factory_name: string;
  section_name: string | null;
  tailor_name: string;
  tailor_code: string;
  created_by: string;
  order_id: string;
  issues: (CustomerTailoringBill["issues"][number] & {
    barcode: string;
    thaan_id: string;
    issue_code: string;
    movement_id: string;
    issued_by: string;
    issued_at: string;
  })[];
};
type Costs = {
  fabric_cp_total_paise: number;
  tailoring_charge_paise: number;
  cuts: { thaan_id: string; quantity: number; cp_paise_per_m: number; cp_amount_paise: number }[];
};

export function CustomerTailoring() {
  const { isOwner, roles, can } = useSession();
  const mayBook = isOwner || roles.includes("counter");
  const qc = useQueryClient();
  const options = useQuery({
    queryKey: ["tailoring-hierarchy", "options"],
    enabled: mayBook,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tailoring_assignment_options");
      if (error) throw error;
      return data as unknown as Assignment[];
    },
  });
  const catalog = useQuery({
    queryKey: ["customer-tailoring", "catalog"],
    enabled: mayBook,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_catalog");
      if (error) throw error;
      return data as unknown as Catalogue;
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: mayBook,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["customer-tailoring", "history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_history", {});
      if (error) throw error;
      return data as unknown as Job[];
    },
  });
  const [barcode, setBarcode] = useState("");
  const [stockId, setStockId] = useState("");
  const [source, setSource] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [customer, setCustomer] = useState("");
  const [factory, setFactory] = useState("");
  const [section, setSection] = useState("");
  const [assignment, setAssignment] = useState("");
  useEffect(() => {
    if (
      options.data &&
      assignment &&
      !hierarchyTailors(options.data, factory, section).some((a) => a.id === assignment)
    )
      setAssignment("");
  }, [options.data, assignment, factory, section]);
  const [charge, setCharge] = useState("");
  const [garment, setGarment] = useState("");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [selectedJob, setSelectedJob] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<{ id: string; signature: string } | null>(null);
  const stock = catalog.data?.stocks.find((s) => s.id === stockId);
  const costs = useQuery({
    queryKey: ["customer-tailoring", "costs", selectedJob],
    enabled: isOwner && !!selectedJob,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_customer_tailoring_costs", {
        p_job: selectedJob,
      });
      if (error) throw error;
      return data as unknown as Costs | null;
    },
  });
  async function refresh() {
    await Promise.all(
      [
        "customer-tailoring",
        "material-issues",
        "direct-fabric-sale",
        "fabric-stock",
        "fabric-stock-history",
        "location-ledger",
        "thaans",
        "movements",
        "dashboard-metrics",
        "customers",
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
  }
  const pricing = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("quote_customer_tailoring", {
        p_source: source,
        p_items: customerTailoringItems(cuts),
        p_charge: charge,
      });
      if (error) throw error;
      return data as unknown as Quote;
    },
    onSuccess: (q) => setQuote(q),
    onError: (e) => {
      setQuote(null);
      toast.error(e.message);
      void catalog.refetch();
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!quote || !customer || !assignment || !garment.trim())
        throw new Error("Select customer, assignment, garment and calculate final price");
      const signature = JSON.stringify({
        quote: quote.quote_id,
        customer,
        assignment,
        garment: garment.trim(),
        notes: notes.trim(),
      });
      if (request.current && request.current.signature !== signature)
        throw new Error("Resolve the pending job before edits");
      request.current ??= { id: crypto.randomUUID(), signature };
      const { data, error } = await supabase.rpc("create_customer_tailoring", {
        p_request: request.current.id,
        p_quote: quote.quote_id,
        p_customer: customer,
        p_assignment: assignment,
        p_garment: garment.trim(),
        p_notes: notes.trim() || undefined,
      });
      if (error) {
        if (error.code?.startsWith("P") || /^[234]/.test(error.code ?? "")) {
          request.current = null;
          setUncertain(false);
          setQuote(null);
        } else setUncertain(true);
        throw error;
      }
      return data;
    },
    onSuccess: (id) => {
      request.current = null;
      setUncertain(false);
      setSelectedJob(id);
      setCuts([]);
      setChoices({});
      setQuote(null);
      toast.success("Customer Tailoring Job, Material Issue and Order recorded");
    },
    onError: (e) => {
      if (request.current) setUncertain(true);
      toast.error(e.message);
    },
    onSettled: refresh,
  });
  const status = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.rpc("set_customer_tailoring_status", {
        p_job: input.id,
        p_status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Job status updated");
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const frozen = pricing.isPending || create.isPending || uncertain;
  function addCuts() {
    try {
      if (!stock || !source) throw new Error("Scan Fabric Barcode and choose source");
      const additions: Cut[] = [];
      for (const c of stock.cuts) {
        const value = choices[c.inventory_item_id]?.trim();
        if (!value || /^0(?:\.0+)?$/.test(value)) continue;
        if (cuts.some((x) => x.inventory_item_id === c.inventory_item_id))
          throw new Error("Remove the existing Than cut before changing it");
        additions.push({
          inventory_item_id: c.inventory_item_id,
          thaan_id: c.thaan_id,
          quantity: customerTailoringCut(
            value,
            c.locations.find((l) => l.id === source)?.quantity_mm ?? 0,
          ),
          label: `${stock.fabric_name} / ${stock.batch_code}`,
        });
      }
      customerTailoringItems([...cuts, ...additions]);
      if (!additions.length) throw new Error("Enter required quantity");
      setCuts([...cuts, ...additions]);
      setChoices({});
      setQuote(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const selected = history.data?.find((j) => j.id === selectedJob);
  const assignments = options.data ?? [];
  const factories = [...new Map(assignments.map((a) => [a.factory_id, a.factory_name])).entries()];
  const sections = hierarchySections(assignments, factory);
  return (
    <div className="space-y-4">
      {isOwner && <CustomerTailoringSetup />}
      {mayBook && (
        <Panel
          title="Customer Tailoring"
          description="Scan a Fabric Barcode, select the customer and Factory → Section → Tailor, then calculate the final customer price."
        >
          <div className="space-y-3">
            {(catalog.error || options.error || locations.error) && (
              <p role="alert" className="text-destructive">
                {(catalog.error || options.error || locations.error)?.message}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                aria-label="Customer Tailoring Fabric Barcode"
                placeholder="Scan Fabric Barcode"
                value={barcode}
                disabled={frozen}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const found = catalog.data?.stocks.find((s) => s.barcode === barcode.trim());
                    if (found) {
                      setStockId(found.id);
                      setChoices({});
                    } else toast.error("Fabric Barcode not found");
                  }
                }}
              />
              <Button
                disabled={frozen}
                onClick={() => {
                  const found = catalog.data?.stocks.find((s) => s.barcode === barcode.trim());
                  if (found) {
                    setStockId(found.id);
                    setChoices({});
                  } else toast.error("Fabric Barcode not found");
                }}
              >
                Scan
              </Button>
              <Button
                variant="outline"
                disabled={frozen}
                onClick={() => {
                  setQuote(null);
                  void catalog.refetch();
                }}
              >
                Refresh
              </Button>
            </div>
            <Label htmlFor="ct-source">Source location</Label>
            <select
              id="ct-source"
              className="w-full rounded border bg-background p-2"
              value={source}
              disabled={frozen || cuts.length > 0}
              onChange={(e) => {
                setSource(e.target.value);
                setQuote(null);
                setChoices({});
              }}
            >
              <option value="">Select Workshop / Showroom</option>
              {locations.data
                ?.filter(
                  (l) =>
                    l.active && ["workshop", "showroom", "showroom_sublocation"].includes(l.kind),
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            {stock && (
              <div className="space-y-2">
                <p>
                  {stock.fabric_name} / {stock.batch_code} · {stock.barcode}
                </p>
                {stock.cuts.map((c, index) => (
                  <div key={c.inventory_item_id} className="flex items-center gap-2">
                    <Label className="flex-1" htmlFor={`ct-cut-${c.inventory_item_id}`}>
                      Than {index + 1} ({c.thaan_id.slice(0, 8)}) ·{" "}
                      {(c.locations.find((l) => l.id === source)?.quantity_mm ?? 0) / 1000} m
                      available
                    </Label>
                    <Input
                      id={`ct-cut-${c.inventory_item_id}`}
                      className="w-32"
                      placeholder="Required m"
                      inputMode="decimal"
                      disabled={frozen || !source}
                      value={choices[c.inventory_item_id] ?? ""}
                      onChange={(e) =>
                        setChoices({ ...choices, [c.inventory_item_id]: e.target.value })
                      }
                    />
                  </div>
                ))}
                <Button disabled={frozen} onClick={addCuts}>
                  Add required quantity
                </Button>
              </div>
            )}
            {cuts.map((c) => (
              <div key={c.inventory_item_id} className="flex gap-2">
                <span className="flex-1">
                  {c.label} · Than {c.thaan_id.slice(0, 8)} · {c.quantity / 1000} m
                </span>
                <Button
                  variant="outline"
                  disabled={frozen}
                  onClick={() => {
                    setCuts(cuts.filter((x) => x !== c));
                    setQuote(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <CustomerTailoringCustomer value={customer} onChange={setCustomer} disabled={frozen} />
            <Input
              aria-label="Customer Tailoring garment"
              placeholder="Garment / work description"
              value={garment}
              disabled={frozen}
              onChange={(e) => setGarment(e.target.value)}
            />
            <Label htmlFor="ct-factory">Factory</Label>
            <select
              id="ct-factory"
              className="w-full rounded border bg-background p-2"
              value={factory}
              disabled={frozen}
              onChange={(e) => {
                setFactory(e.target.value);
                setSection("");
                setAssignment("");
              }}
            >
              <option value="">Select Factory</option>
              {factories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <Label htmlFor="ct-section">Section</Label>
            <select
              id="ct-section"
              className="w-full rounded border bg-background p-2"
              value={section}
              disabled={frozen || !factory}
              onChange={(e) => {
                setSection(e.target.value);
                setAssignment("");
              }}
            >
              <option value="">Select Section</option>
              {sections.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <Label htmlFor="ct-tailor">Tailor</Label>
            <select
              id="ct-tailor"
              className="w-full rounded border bg-background p-2"
              value={assignment}
              disabled={frozen || !section}
              onChange={(e) => setAssignment(e.target.value)}
            >
              <option value="">Select Tailor</option>
              {hierarchyTailors(assignments, factory, section).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tailor_code} · {a.tailor_name}
                </option>
              ))}
            </select>
            <Label htmlFor="ct-charge">Applicable Tailoring Charge</Label>
            <select
              id="ct-charge"
              className="w-full rounded border bg-background p-2"
              value={charge}
              disabled={frozen}
              onChange={(e) => {
                setCharge(e.target.value);
                setQuote(null);
              }}
            >
              <option value="">Select charge</option>
              {catalog.data?.charges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {isOwner && c.amount_paise !== undefined
                    ? ` · ${formatMoney(c.amount_paise)}`
                    : ""}
                </option>
              ))}
            </select>
            <Input
              aria-label="Customer Tailoring notes"
              placeholder="Job notes (optional)"
              value={notes}
              disabled={frozen}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={frozen || !source || !cuts.length || !charge}
              onClick={() => pricing.mutate()}
            >
              Calculate final customer price
            </Button>
            {quote && (
              <p className="font-semibold">
                Final customer price: {formatMoney(quote.final_customer_price_paise)}
              </p>
            )}
            {uncertain && (
              <p role="alert">
                Response interrupted. Keep this page open and retry the unchanged job to resolve it
                without issuing material twice.
              </p>
            )}
            <Button
              disabled={
                create.isPending ||
                pricing.isPending ||
                !quote ||
                !customer ||
                !assignment ||
                !garment.trim() ||
                !can("pos.issue_to_tailoring")
              }
              onClick={() => create.mutate()}
            >
              {create.isPending
                ? "Recording…"
                : uncertain
                  ? "Retry pending job"
                  : "Create Job / Issue Material to Job / Record Order"}
            </Button>
          </div>
        </Panel>
      )}
      <Panel
        title="Customer Tailoring Jobs / Order History"
        description={
          mayBook
            ? "Select an existing job to review its order, material issue and status."
            : "Your assigned Customer Tailoring Jobs."
        }
      >
        {history.error && (
          <p role="alert" className="text-destructive">
            {history.error.message}
          </p>
        )}
        <select
          aria-label="Customer Tailoring Job"
          className="w-full rounded border bg-background p-2"
          value={selectedJob}
          onChange={(e) => setSelectedJob(e.target.value)}
        >
          <option value="">Select job (latest 50)</option>
          {history.data?.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} · {j.garment} · {j.status}
            </option>
          ))}
        </select>
        {selected && (
          <div className="mt-3 space-y-2">
            <p>
              {selected.code} · {selected.garment} · {selected.status}
            </p>
            <p>
              {selected.customer_snapshot.name} · Phone {selected.customer_snapshot.phone || "—"} ·
              WhatsApp {selected.customer_snapshot.whatsapp_phone || "Not provided"}
            </p>
            <p>
              {selected.factory_name} → {selected.section_name || "No section"} →{" "}
              {selected.tailor_code} · {selected.tailor_name}
            </p>
            <p>
              {selected.source_name} · {formatDateTime(selected.created_at)} · User{" "}
              {selected.created_by}
            </p>
            {selected.issues?.map((i) => (
              <div key={i.movement_id}>
                <p>
                  {i.fabric_name} / {i.batch_code} · {i.barcode} · Than {i.thaan_id.slice(0, 8)} ·{" "}
                  {i.quantity_mm / 1000} m
                </p>
                <p className="text-xs text-muted-foreground">
                  {i.issue_code} · {formatDateTime(i.issued_at)} · Issued by {i.issued_by} ·
                  Movement {i.movement_id}
                </p>
              </div>
            ))}
            {selected.notes && <p>{selected.notes}</p>}
            {mayBook && (
              <>
                <p>
                  {selected.order_code} · Final customer price:{" "}
                  {formatMoney(selected.final_customer_price_paise ?? 0)}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    try {
                      printCustomerTailoringBill(selected);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  Print customer bill
                </Button>
              </>
            )}
            {isOwner && (
              <div className="rounded border p-3">
                {costs.error ? (
                  <p role="alert" className="text-destructive">
                    {costs.error.message}
                  </p>
                ) : costs.data ? (
                  <>
                    <p>
                      Fabric CP total: {formatMoney(costs.data.fabric_cp_total_paise)} · Applicable
                      Tailoring Charge: {formatMoney(costs.data.tailoring_charge_paise)}
                    </p>
                    {costs.data.cuts.map((c) => (
                      <p key={c.thaan_id}>
                        Than {c.thaan_id.slice(0, 8)} · {c.quantity / 1000} m · CP{" "}
                        {formatMoney(c.cp_paise_per_m)} / m · {formatMoney(c.cp_amount_paise)}
                      </p>
                    ))}
                  </>
                ) : (
                  <p>Loading saved costs…</p>
                )}
              </div>
            )}
            <Label htmlFor="ct-job-status">Job status</Label>
            <select
              id="ct-job-status"
              className="w-full rounded border bg-background p-2"
              value={selected.status}
              disabled={status.isPending}
              onChange={(e) => status.mutate({ id: selected.id, status: e.target.value })}
            >
              {["open", "in_progress", "ready", "delivered", "cancelled"].map((value) => (
                <option key={value} value={value}>
                  {value.replace("_", " ")}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">
              Status changes keep issued material and the booked price unchanged.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
