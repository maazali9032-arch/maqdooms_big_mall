import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantityInput, quantityText } from "@/features/inventory/ledger-quantity";
import {
  consumableQuantity,
  issueItems,
  receiptCost,
  definiteDatabaseRejection,
} from "@/features/inventory/consumable-input";
import type { Consumable } from "@/features/inventory/Consumables";
import { hierarchySections, hierarchyTailors, type HierarchyOption } from "./hierarchy-options";
import type { Database } from "@/integrations/supabase/types";

type Functions = Database["public"]["Functions"];
type CatalogItem = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  charge_paise?: number | null;
};
type Job = {
  id: string;
  code: string;
  product: string;
  design: string;
  quantity: number;
  status: string;
  notes: string | null;
  factory: string;
  section: string | null;
  tailor: string;
  requirements: {
    id: string;
    quantity: number;
    unit: string;
    name: string;
    batch: string | null;
    thaan_id: string | null;
  }[];
  events: { status: string; reason: string; recorded_at: string }[];
};
type Fabric = {
  fabric_name: string;
  batch_code: string;
  cuts: {
    inventory_item_id: string;
    thaan_id: string;
    locations: { id: string; quantity_mm: number }[];
  }[];
};
type Item = { id: string; name: string; unit: string; quantity: number; fabric: boolean };

export function OwnerProduction() {
  const { isOwner, roles, can } = useSession();
  const allowed = isOwner || roles.includes("tailor");
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of [
      "owner-production",
      "material-issues",
      "consumables",
      "location-ledger",
      "customer-tailoring",
      "direct-fabric-sale",
      "inventory",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const catalog = useQuery({
    queryKey: ["owner-production", "catalog"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_catalog");
      if (error) throw error;
      return data as unknown as { products: CatalogItem[]; designs: CatalogItem[] };
    },
  });
  const jobs = useQuery({
    queryKey: ["owner-production", "history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_history");
      if (error) throw error;
      return data as unknown as Job[];
    },
  });
  const assignments = useQuery({
    queryKey: ["tailoring-hierarchy", "options"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tailoring_assignment_options");
      if (error) throw error;
      return data as unknown as HierarchyOption[];
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const fabrics = useQuery({
    queryKey: ["material-issues", "fabrics"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_catalog");
      if (error) throw error;
      return (data as unknown as { stocks: Fabric[] }).stocks;
    },
  });
  const materials = useQuery({
    queryKey: ["consumables", "catalog"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumable_catalog");
      if (error) throw error;
      return data as unknown as Consumable[];
    },
  });
  const [product, setProduct] = useState("");
  const [design, setDesign] = useState("");
  const [quantity, setQuantity] = useState("");
  const [factory, setFactory] = useState("");
  const [section, setSection] = useState("");
  const [assignment, setAssignment] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ item: "", quantity: "" }]);
  const [pending, setPending] = useState<Functions["create_owner_production"]["Args"] | null>(null);
  const [config, setConfig] = useState({
    kind: "product",
    id: "",
    code: "",
    name: "",
    active: true,
    charge: "",
    reason: "",
  });
  const [configPending, setConfigPending] = useState<
    Functions["manage_production_catalog"]["Args"] | null
  >(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusPending, setStatusPending] = useState<
    Functions["progress_owner_production"]["Args"] | null
  >(null);
  const create = useMutation({
    mutationFn: async (args: Functions["create_owner_production"]["Args"]) => {
      setPending(args);
      const { data, error } = await supabase.rpc("create_owner_production", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setPending(null);
      setLines([{ item: "", quantity: "" }]);
      setQuantity("");
      setNotes("");
      setReason("");
      refresh();
      toast.success("Production Job and required materials posted");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const configure = useMutation({
    mutationFn: async (args: Functions["manage_production_catalog"]["Args"]) => {
      setConfigPending(args);
      const { data, error } = await supabase.rpc("manage_production_catalog", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setConfigPending(null);
      setConfig({
        kind: "product",
        id: "",
        code: "",
        name: "",
        active: true,
        charge: "",
        reason: "",
      });
      refresh();
      toast.success("Production catalogue saved");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setConfigPending(null);
      toast.error(e.message);
    },
  });
  const progress = useMutation({
    mutationFn: async (args: Functions["progress_owner_production"]["Args"]) => {
      setStatusPending(args);
      const { data, error } = await supabase.rpc("progress_owner_production", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setStatusPending(null);
      setStatusReason("");
      refresh();
      toast.success("Production status recorded");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setStatusPending(null);
      toast.error(e.message);
    },
  });
  const items: Item[] = (materials.data ?? [])
    .filter((m) => m.active && m.inventory_item_id)
    .flatMap((m) =>
      m.locations
        .filter((l) => l.id === source)
        .map((l) => ({
          id: m.inventory_item_id!,
          name: m.name,
          unit: m.unit,
          quantity: Number(l.quantity),
          fabric: false,
        })),
    );
  for (const f of fabrics.data ?? [])
    for (const c of f.cuts)
      for (const l of c.locations)
        if (l.id === source && l.quantity_mm > 0)
          items.push({
            id: c.inventory_item_id,
            name: `${f.fabric_name} · ${f.batch_code} · Than ${c.thaan_id.slice(0, 8)}`,
            unit: "mm",
            quantity: Number(l.quantity_mm),
            fabric: true,
          });
  if (!allowed) return null;
  const submit = () => {
    if (pending) {
      create.mutate(pending);
      return;
    }
    try {
      if (
        !product ||
        !design ||
        !source ||
        !reason.trim() ||
        !assignments.data?.some(
          (a) =>
            a.id === assignment && a.factory_id === factory && (a.section_id ?? "none") === section,
        )
      )
        throw new Error(
          "Choose Product, Design, current Factory / Section / Tailor, source and reason",
        );
      if (!/^[1-9]\d*$/.test(quantity) || Number(quantity) > 2147483647)
        throw new Error("Enter a positive whole piece count");
      let hasFabric = false;
      const payload = issueItems(
        lines.map((line) => {
          const i = items.find((i) => i.id === line.item);
          if (!i) throw new Error("Choose an available item for every line");
          hasFabric ||= i.fabric;
          const amount = i.fabric
            ? quantityInput(line.quantity, "mm")
            : consumableQuantity(line.quantity, i.unit);
          if (amount > i.quantity) throw new Error(`Insufficient ${i.name}`);
          return { inventory_item_id: i.id, quantity: amount };
        }),
      );
      if (!hasFabric) throw new Error("At least one required fabric line is mandatory");
      create.mutate({
        p_request: crypto.randomUUID(),
        p_product: product,
        p_design: design,
        p_quantity: Number(quantity),
        p_assignment: assignment,
        p_source: source,
        p_items: payload,
        p_notes: notes || null,
        p_reason: reason.trim(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const selectClass = "w-full rounded border bg-background p-2";
  const options = assignments.data ?? [];
  return (
    <Panel
      title="Owner Production"
      description="Internal manufacturing of identical products. A different Design requires a separate Production Job."
    >
      {[
        catalog.error,
        jobs.error,
        assignments.error,
        locations.error,
        fabrics.error,
        materials.error,
      ]
        .filter(Boolean)
        .map((e, i) => (
          <p role="alert" key={i}>
            {e!.message}
          </p>
        ))}
      {isOwner && (
        <details className="mb-4">
          <summary>Product and Design configuration</summary>
          <fieldset disabled={configure.isPending || !!configPending} className="grid gap-2 py-3">
            <select
              aria-label="Catalogue kind"
              className={selectClass}
              value={config.kind}
              onChange={(e) =>
                setConfig({
                  ...config,
                  kind: e.target.value,
                  id: "",
                  code: "",
                  name: "",
                  charge: "",
                })
              }
            >
              <option value="product">Product</option>
              <option value="design">Design</option>
            </select>
            <select
              aria-label="Existing catalogue record"
              className={selectClass}
              value={config.id}
              onChange={(e) => {
                const x = (
                  config.kind === "product" ? catalog.data?.products : catalog.data?.designs
                )?.find((i) => i.id === e.target.value);
                setConfig({
                  ...config,
                  id: e.target.value,
                  code: x?.code ?? "",
                  name: x?.name ?? "",
                  active: x?.active ?? true,
                  charge: "",
                });
              }}
            >
              <option value="">Create new</option>
              {(config.kind === "product" ? catalog.data?.products : catalog.data?.designs)?.map(
                (i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                    {!i.active ? " (inactive)" : ""}
                    {i.charge_paise != null
                      ? ` · Design charge ₹${(Number(i.charge_paise) / 100).toFixed(2)}`
                      : ""}
                  </option>
                ),
              )}
            </select>
            <Input
              aria-label="Catalogue code"
              placeholder="Code"
              disabled={!!config.id}
              value={config.code}
              onChange={(e) => setConfig({ ...config, code: e.target.value })}
            />
            <Input
              aria-label="Catalogue name"
              placeholder="Name"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
            />
            <label>
              <input
                type="checkbox"
                checked={config.active}
                onChange={(e) => setConfig({ ...config, active: e.target.checked })}
              />{" "}
              Active
            </label>
            {config.kind === "design" && (
              <Input
                aria-label="Design charge rupees"
                placeholder="Optional Design / Embroidery Charge (₹); blank keeps existing charge"
                value={config.charge}
                onChange={(e) => setConfig({ ...config, charge: e.target.value })}
              />
            )}
            <Input
              aria-label="Catalogue change reason"
              placeholder="Reason"
              value={config.reason}
              onChange={(e) => setConfig({ ...config, reason: e.target.value })}
            />
          </fieldset>
          <Button
            disabled={configure.isPending}
            onClick={() => {
              if (configPending) {
                configure.mutate(configPending);
                return;
              }
              try {
                if (!config.code.trim() || !config.name.trim() || !config.reason.trim())
                  throw new Error("Code, name and reason required");
                configure.mutate({
                  p_request: crypto.randomUUID(),
                  p_kind: config.kind,
                  p_id: config.id || null,
                  p_code: config.code,
                  p_name: config.name,
                  p_active: config.active,
                  p_charge_paise:
                    config.kind === "design" && config.charge ? receiptCost(config.charge) : null,
                  p_reason: config.reason,
                });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {configPending ? "Retry same catalogue request" : "Save catalogue"}
          </Button>
        </details>
      )}
      {isOwner && (
        <div className="space-y-3">
          <fieldset disabled={create.isPending || !!pending} className="grid gap-3 md:grid-cols-2">
            <select
              aria-label="Production Product"
              className={selectClass}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">Product</option>
              {catalog.data?.products
                .filter((i) => i.active)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="Production Design"
              className={selectClass}
              value={design}
              onChange={(e) => setDesign(e.target.value)}
            >
              <option value="">Design</option>
              {catalog.data?.designs
                .filter((i) => i.active)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                  </option>
                ))}
            </select>
            <Input
              aria-label="Production piece count"
              placeholder="Quantity (identical pieces)"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <select
              aria-label="Production Factory"
              className={selectClass}
              value={factory}
              onChange={(e) => {
                setFactory(e.target.value);
                setSection("");
                setAssignment("");
              }}
            >
              <option value="">Factory</option>
              {[...new Map(options.map((a) => [a.factory_id, a.factory_name])).entries()].map(
                ([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="Production Section"
              className={selectClass}
              value={section}
              onChange={(e) => {
                setSection(e.target.value);
                setAssignment("");
              }}
            >
              <option value="">Section</option>
              {hierarchySections(options, factory).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Production Tailor"
              className={selectClass}
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
            >
              <option value="">Tailor</option>
              {hierarchyTailors(options, factory, section).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tailor_code} · {a.tailor_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Production material source"
              className={selectClass}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setLines([{ item: "", quantity: "" }]);
              }}
            >
              <option value="">Source location</option>
              {locations.data
                ?.filter((l) => l.active)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <Input
              aria-label="Production notes"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="md:col-span-2">
              Enter total required quantities for this entire job. Fabric is entered in metres;
              other materials use their listed unit.
            </p>
            {lines.map((line, index) => (
              <div key={index} className="flex gap-2 md:col-span-2">
                <select
                  aria-label={`Production material ${index + 1}`}
                  className={selectClass}
                  value={line.item}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) =>
                        i === index ? { ...l, item: e.target.value, quantity: "" } : l,
                      ),
                    )
                  }
                >
                  <option value="">Required fabric or material</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · available {quantityText(i.quantity, i.unit)}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Total required quantity ${index + 1}`}
                  placeholder="Total quantity"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                    )
                  }
                />
                <Button
                  variant="outline"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={lines.length >= 100}
              onClick={() => setLines([...lines, { item: "", quantity: "" }])}
            >
              Add required material
            </Button>
            <Input
              aria-label="Production creation reason"
              placeholder="Issue / creation reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </fieldset>
          <Button disabled={create.isPending} onClick={submit}>
            {pending ? "Retry same Production Job" : "Create Production Job and issue materials"}
          </Button>
          {pending && <p>Request awaiting confirmation. Retry with the same values.</p>}
        </div>
      )}
      {(isOwner || can("tailoring.manage_jobs")) && (
        <div className="my-4">
          <Input
            aria-label="Production status reason"
            disabled={progress.isPending || !!statusPending}
            placeholder="Reason / completion confirmation for status change"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
          />
          {statusPending && (
            <Button disabled={progress.isPending} onClick={() => progress.mutate(statusPending)}>
              Retry same status request
            </Button>
          )}
        </div>
      )}
      <div className="mt-4 space-y-3">
        {jobs.data?.map((j) => (
          <article key={j.id} className="rounded border p-3">
            <p className="font-medium">
              {j.code} · {j.product} · {j.design} · {j.quantity} identical pieces
            </p>
            <p>
              {j.factory} → {j.section ?? "No Section"} → {j.tailor} · {j.status}
            </p>
            {j.notes && <p>{j.notes}</p>}
            <p>
              Required quantities:{" "}
              {j.requirements
                .map(
                  (r) =>
                    `${r.name}${r.batch ? ` · ${r.batch}` : ""}${r.thaan_id ? ` · Than ${r.thaan_id.slice(0, 8)}` : ""}: ${quantityText(r.quantity, r.unit)}`,
                )
                .join("; ")}
            </p>
            {j.events.map((e, i) => (
              <p key={i}>
                {e.status} · {e.reason} · {new Date(e.recorded_at).toLocaleString()}
              </p>
            ))}
            {(isOwner || can("tailoring.manage_jobs")) &&
              ["open", "in_progress"].includes(j.status) && (
                <Button
                  disabled={progress.isPending || !!statusPending || !statusReason.trim()}
                  onClick={() =>
                    progress.mutate({
                      p_request: crypto.randomUUID(),
                      p_job: j.id,
                      p_expected_status: j.status,
                      p_status: j.status === "open" ? "in_progress" : "completed",
                      p_reason: statusReason.trim(),
                    })
                  }
                >
                  {j.status === "open" ? "Start production" : "Confirm job completed"}
                </Button>
              )}
          </article>
        ))}
        {jobs.data?.length === 0 && <p>No Owner Production Jobs available.</p>}
      </div>
    </Panel>
  );
}
