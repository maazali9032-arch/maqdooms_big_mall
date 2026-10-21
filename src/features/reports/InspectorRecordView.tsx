import { useState, type ReactNode } from "react";
import {
  Barcode,
  Box,
  Check,
  ChevronDown,
  Copy,
  FileText,
  History,
  Home,
  IndianRupee,
  Link,
  List,
  Package,
  Plus,
  RefreshCw,
  Scissors,
  ShoppingCart,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldText } from "./EvidenceViews";
import { title } from "./evidence-model";
import { reportQuantity } from "./report-value";
import type { BarcodeInspection } from "./OwnerBarcodeInspector";

type Fields = Record<string, unknown>;
type Evidence = BarcodeInspection["events"][number];
const labels: Record<string, string> = {
  latest_cp_paise_per_m: "Current CP / lagat per metre",
  latest_cp_paise: "Current recorded piece CP / lagat",
  latest_sp_paise: "Current selling price",
  cp_paise_per_m: "Recorded CP / lagat per metre",
  cp_snapshot_paise: "Recorded sale CP snapshot",
  unlocated_legacy_quantity_mm: "Legacy balance (location not reconciled)",
  legacy_cp_record: "Legacy CP record",
};
const object = (value: unknown): Fields =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};
const present = (value: unknown) => value !== null && value !== undefined && value !== "";
const display = (value: unknown) => (present(value) ? String(value) : "Not recorded");
const isCost = (key: string) =>
  /(?:^|_)(?:cp|sp|cost|lagat)(?:_|$)/.test(key) || key === "unlocated_legacy_quantity_mm";

function CopyValue({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState("");
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("Copied");
          } catch {
            setState("Copy unavailable");
          }
        }}
      >
        {state === "Copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {state}
      </span>
    </span>
  );
}

function FieldsView({ data }: { data: Fields }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="min-w-0 border-b border-border/50 pb-2 last:border-0">
          <dt className="text-xs text-muted-foreground">{labels[key] ?? title(key)}</dt>
          <dd className="mt-1 flex items-start justify-between gap-1 break-words [overflow-wrap:anywhere]">
            {value !== null && typeof value === "object" ? (
              <details className="w-full rounded-lg border p-2">
                <summary className="cursor-pointer">
                  View recorded {title(key).toLowerCase()}
                </summary>
                <div className="mt-3 border-l pl-2">
                  {Array.isArray(value) ? (
                    value.length ? (
                      value.map((entry, index) => (
                        <div key={index} className="mb-3">
                          {entry && typeof entry === "object" ? (
                            <FieldsView data={object(entry)} />
                          ) : (
                            display(entry)
                          )}
                        </div>
                      ))
                    ) : (
                      "No recorded entries"
                    )
                  ) : (
                    <FieldsView data={object(value)} />
                  )}
                </div>
              </details>
            ) : (
              <>
                <span>{fieldText(key, value, data)}</span>
                {present(value) &&
                  (key === "id" ||
                    key.endsWith("_id") ||
                    key === "barcode" ||
                    key === "code" ||
                    key === "scan_code") && <CopyValue value={String(value)} label={title(key)} />}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  name,
  description,
  icon: Icon,
  children,
}: {
  name: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section aria-label={name.replace(/ \(\d+\)$/, "")}>
      <details className="group/section rounded-2xl border border-primary/20 bg-white shadow-sm open:border-primary/40">
        <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Icon className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold sm:text-base">{name}</h3>
            <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-primary transition-transform group-open/section:rotate-180" />
        </summary>
        <div className="mx-4 border-t border-border/60 py-4">{children}</div>
      </details>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-[#faf9f6] px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function eventStyle(event: Evidence): { icon: LucideIcon; tone: string; category: string } {
  const value = `${event.title} ${event.source}`.toLowerCase();
  if (/transfer/.test(value))
    return { icon: Truck, tone: "bg-orange-100 text-orange-700", category: "Transfer" };
  if (/sale|sold|order.*paid|payment/.test(value))
    return { icon: ShoppingCart, tone: "bg-amber-100 text-amber-800", category: "Sale / payment" };
  if (/return|wast/.test(value))
    return { icon: History, tone: "bg-rose-100 text-rose-700", category: "Return / usage" };
  if (/production|tailor|material_issue/.test(value))
    return { icon: Scissors, tone: "bg-blue-100 text-blue-700", category: "Production" };
  if (/inward|entry|receiv|stock_registration/.test(value))
    return { icon: Plus, tone: "bg-emerald-100 text-emerald-700", category: "Stock entry" };
  return { icon: FileText, tone: "bg-stone-100 text-stone-700", category: "Recorded event" };
}

function EvidenceCard({ event, timeline = false }: { event: Evidence; timeline?: boolean }) {
  const { icon: Icon, tone, category } = eventStyle(event);
  return (
    <details
      className={`group/event relative min-w-0 ${timeline ? "ml-4 border-l border-border pb-1 pl-6" : "rounded-xl border p-3"}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
        {timeline && (
          <span
            className={`absolute -left-4 top-2 flex size-8 items-center justify-center rounded-full ${tone}`}
          >
            <Icon className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <strong className="block break-words text-sm">{title(event.title)}</strong>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {event.event_at
              ? new Date(event.event_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) +
                " (India)"
              : "Timestamp not recorded"}
          </span>
        </span>
        <span className="hidden rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground sm:inline">
          {category}
        </span>
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/event:rotate-180" />
      </summary>
      <div className="space-y-3 py-3">
        <p className="text-xs text-muted-foreground">
          {event.actor ?? event.actor_id ?? "Responsible user not recorded"} · Evidence:{" "}
          {event.source}
        </p>
        <FieldsView data={event.data} />
      </div>
    </details>
  );
}

export function InspectorRecordView({
  record,
  events,
  refreshing,
  onRefresh,
  hasNextPage,
  loadingMore,
  onLoadMore,
}: {
  record: BarcodeInspection;
  events: Evidence[];
  refreshing: boolean;
  onRefresh: () => void;
  hasNextPage: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const first = record.items[0] ?? {};
  const kind = record.matches?.[0]?.kind ?? String(first["kind"] ?? "");
  const physical = [
    "fabric",
    "legacy_thaan",
    "variant",
    "piece",
    "finished_product",
    "customer_piece",
    "customer_finished_garment",
  ].includes(kind);
  const kindName: Record<string, string> = {
    fabric: "Fabric Thaan",
    legacy_thaan: "Fabric Thaan",
    variant: "Fabric Thaan",
    piece: "Shop finished garment",
    finished_product: "Shop finished garment",
    customer_piece: "Customer stitched garment",
    customer_finished_garment: "Customer stitched garment",
    order: "Customer bill",
    production: "Production order",
    customer_job: "Customer stitching order",
  };
  const thaan = object(first["thaan"]),
    piece = object(first["piece"]);
  const root = record.matches?.[0];
  const document = record.linked_records.find(
    (e) => root && String(e.data["id"]) === root.id,
  )?.data;
  const explicitStatus = physical
    ? (first["status"] ?? piece["status"] ?? thaan["status"])
    : document?.["status"];
  const status = present(explicitStatus)
    ? title(String(explicitStatus))
    : physical && typeof thaan["active"] === "boolean"
      ? thaan["active"]
        ? "Active"
        : "Inactive"
      : "Recorded";
  const stock = record.current_stock.flatMap((s) =>
    Array.isArray(s["locations"]) ? s["locations"].map(object) : [],
  );
  const units = [...new Set(stock.map((s) => String(s["unit"] ?? "")))];
  const quantitiesKnown =
    stock.length > 0 &&
    units.length === 1 &&
    !!units[0] &&
    stock.every((s) => /^-?\d+(?:\.0+)?$/.test(String(s["quantity"])));
  const quantity = quantitiesKnown
    ? reportQuantity(
        stock.reduce((sum, s) => sum + BigInt(String(s["quantity"]).split(".")[0]!), 0n).toString(),
        units[0]!,
      )
    : "Not recorded";
  const locations = [
    ...new Set(
      stock
        .filter((s) => !/^0(?:\.0+)?$/.test(String(s["quantity"])))
        .map((s) => String(s["location"] ?? ""))
        .filter(Boolean),
    ),
  ];
  const location =
    locations.length === 1
      ? locations[0]
      : locations.length > 1
        ? `${locations.length} recorded locations`
        : "Not recorded";
  const costKey = present(first["latest_cp_paise_per_m"])
    ? "latest_cp_paise_per_m"
    : "latest_cp_paise";
  const cp = present(first[costKey]) ? fieldText(costKey, first[costKey], first) : "Not recorded";
  const itemName =
    record.items.length === 1 && physical
      ? display(first["name"])
      : (kindName[kind] ?? "Recorded barcode");
  const visibleEvents = showAll ? events : events.slice(0, 6);
  const unit =
    units.length === 1
      ? units[0] === "mm"
        ? "m"
        : units[0]
      : units.length
        ? "Mixed units"
        : "Not recorded";
  const itemFields = (item: Fields) =>
    Object.fromEntries(
      Object.entries(item).filter(
        ([key]) => !["id", "thaan", "fabric_stock", "piece"].includes(key) && !isCost(key),
      ),
    );
  return (
    <div className="space-y-3">
      <section
        aria-label="Barcode summary"
        className="rounded-2xl border border-primary/20 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:size-20">
            <Package className="size-9" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-all text-xl font-bold tracking-tight">{record.barcode}</h2>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {status}
              </span>
            </div>
            <p className="mt-1 font-medium">{itemName}</p>
            <p className="text-xs text-muted-foreground">
              {kindName[kind] ?? title(kind || "Recorded item")}
              {record.items.length > 1 ? ` · ${record.items.length} related items` : ""}
            </p>
            {(present(first["batch"]) || present(first["supplier"])) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Tag className="size-3.5" />
                {present(first["batch"]) && <span>Batch {String(first["batch"])}</span>}
                {present(first["supplier"]) && <span>Supplier {String(first["supplier"])}</span>}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={refreshing}
            aria-label="Refresh inspection"
            onClick={onRefresh}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={physical ? "Current stock" : "Related stock"}>{quantity}</Stat>
          <Stat label="Display unit">{unit}</Stat>
          <Stat
            label={
              costKey === "latest_cp_paise_per_m" ? "CP / lagat per metre" : "Piece CP / lagat"
            }
          >
            {record.items.length === 1 ? cp : "See costing details"}
          </Stat>
        </dl>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Stat label={physical ? "Current location" : "Related stock locations"}>
            <span className="flex items-start gap-1.5">
              <Home className="mt-0.5 size-4 shrink-0" />
              {location}
            </span>
          </Stat>
          <Stat label="Total recorded events">
            <span className="flex items-center gap-1.5">
              <List className="size-4" />
              {record.total_events}
            </span>
          </Stat>
        </dl>
      </section>
      <Section
        name="Item details"
        description="Name, type, batch, supplier and barcode"
        icon={FileText}
      >
        <div className="space-y-4">
          {record.items.map((item, i) => (
            <FieldsView key={i} data={itemFields(item)} />
          ))}
          {!record.items.length && (
            <p className="text-sm">
              No physical item details recorded. See related records for this document.
            </p>
          )}
        </div>
      </Section>
      <Section
        name="Current stock & location"
        description="Quantity, unit, current location and links"
        icon={Box}
      >
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={physical ? "Current stock" : "Related stock"}>{quantity}</Stat>
          <Stat label="Display unit">{unit}</Stat>
          <Stat label="Location">{location}</Stat>
        </dl>
        {record.current_stock.length ? (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer">View recorded locations</summary>
            <div className="mt-3 space-y-4">
              {record.current_stock.map((s, i) => (
                <FieldsView key={i} data={s} />
              ))}
            </div>
          </details>
        ) : (
          <p className="text-sm">No reconciled location balance recorded.</p>
        )}
      </Section>
      <Section
        name="Costing details"
        description="Current CP / lagat, selling price and legacy costs"
        icon={IndianRupee}
      >
        <div className="space-y-4">
          {record.items.map((item, i) => (
            <div key={i} className="space-y-2">
              {record.items.length > 1 && (
                <p className="text-sm font-semibold">
                  {display(item["name"])} · {display(item["barcode"])}
                </p>
              )}
              <FieldsView
                data={Object.fromEntries(Object.entries(item).filter(([key]) => isCost(key)))}
              />
            </div>
          ))}
          {!record.items.length && <p className="text-sm">No physical item costs recorded.</p>}
        </div>
      </Section>
      <Section
        name="Related records"
        description="Customer bills, production and stitching jobs"
        icon={Link}
      >
        <div aria-label="Linked orders and jobs" className="space-y-2">
          {record.linked_records.map((e, i) => (
            <EvidenceCard key={e.key ?? i} event={e} />
          ))}
          {!record.linked_records.length && <p className="text-sm">No linked records recorded.</p>}
        </div>
      </Section>
      <Section
        name={`Recorded lifecycle (${record.total_events})`}
        description="Stock entry, transfers, production, sales and more"
        icon={History}
      >
        <div>
          {visibleEvents.map((e) => (
            <EvidenceCard key={e.key} event={e} timeline />
          ))}
          {!events.length && <p className="text-sm">No timestamped events recorded.</p>}
        </div>
        {!showAll && events.length > 6 ? (
          <Button
            variant="outline"
            className="mt-3 w-full justify-start"
            onClick={() => setShowAll(true)}
          >
            <List className="size-4" />
            View all {record.total_events} events
          </Button>
        ) : (
          hasNextPage && (
            <Button
              variant="outline"
              className="mt-3 w-full justify-start"
              disabled={loadingMore}
              onClick={() => {
                setShowAll(true);
                onLoadMore();
              }}
            >
              {loadingMore ? "Loading…" : "Load older events"}
            </Button>
          )
        )}
      </Section>
      <Section
        name="Technical details"
        description="IDs, raw recorded fields and undated evidence"
        icon={Barcode}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Checked{" "}
          {new Date(record.inspected_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{" "}
          (India). {record.history_note}
        </p>
        <FieldsView
          data={{
            barcode: record.barcode,
            matches: record.matches ?? [],
            items: record.items,
            current_stock: record.current_stock,
          }}
        />
        {!!record.undated_records.length && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-semibold">Records without captured timestamps</h4>
            {record.undated_records.map((e) => (
              <EvidenceCard key={e.key} event={e} />
            ))}
          </div>
        )}
      </Section>
      <p className="px-1 pb-2 text-xs leading-relaxed text-muted-foreground">
        Only recorded evidence is shown. Stock balances are current; related records can include
        other items. No records are changed by inspection.
      </p>
    </div>
  );
}
