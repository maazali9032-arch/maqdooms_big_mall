import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { SourcePicker, type SourceLocation } from "@/shared/components/source-picker";
import { FactoryTailorPicker } from "@/shared/components/factory-tailor-picker";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { reportQuantity } from "@/features/reports/report-value";
import { ProductionDocument } from "./ProductionDocument";
import type { ReserveCut } from "@/features/pos/counter-workspace-model";
type Definition = { id: string; name: string; code: string };
type Spec = { product: string; design: string; custom: string; size: string };
type Fabric = { barcode: string; fabric_name: string; batch_code: string; cuts: ReserveCut[] };
type Row = { fabric: Fabric; cut: ReserveCut; metres: string };
type Request = {
  p_request: string;
  p_source: string;
  p_items: { inventory_item_id: string; quantity: number }[];
  p_specs: {
    product_id: string;
    design_id: string | null;
    custom_design: string | null;
    size: string;
  }[];
  p_assignments: string[];
  p_notes: string;
};
const empty = { product: "", design: "", custom: "", size: "" };
function SpecInputs({
  value,
  onChange,
  definitions,
  prefix,
}: {
  value: Spec;
  onChange: (s: Spec) => void;
  definitions: { products: Definition[]; designs: Definition[] } | undefined;
  prefix: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-xs">
        Product
        <select
          aria-label={`${prefix} product`}
          value={value.product}
          onChange={(e) => onChange({ ...value, product: e.target.value })}
          className="min-h-11 w-full rounded border bg-background p-2"
        >
          <option value="">Select product</option>
          {definitions?.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Design
        <select
          aria-label={`${prefix} design`}
          value={value.design}
          onChange={(e) => onChange({ ...value, design: e.target.value })}
          className="min-h-11 w-full rounded border bg-background p-2"
        >
          <option value="">Select design</option>
          {definitions?.designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <label className="text-xs">
        Size
        <Input
          aria-label={`${prefix} size`}
          value={value.size}
          onChange={(e) => onChange({ ...value, size: e.target.value })}
          placeholder="e.g. 38"
        />
      </label>
      {value.design === "custom" && (
        <label className="text-xs sm:col-span-3">
          Custom design
          <Input
            aria-label={`${prefix} custom design`}
            value={value.custom}
            onChange={(e) => onChange({ ...value, custom: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
export function MixedProduction() {
  const { isOwner, roles, can } = useSession();
  if (!isOwner && !(roles.includes("production") && can("production.create")))
    return <p>Production creation permission required.</p>;
  return <ProductionForm />;
}
function ProductionForm() {
  const qc = useQueryClient();
  const [source, setSource] = useState<SourceLocation | null>(null),
    [barcode, setBarcode] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [defaults, setDefaults] = useState<Spec>(empty),
    [overrides, setOverrides] = useState<Partial<Spec>[]>([{}]),
    [count, setCount] = useState("1"),
    [factory, setFactory] = useState(""),
    [tailors, setTailors] = useState<string[]>([]),
    [notes, setNotes] = useState(""),
    [pending, setPending] = useState<Request | null>(null),
    [document, setDocument] = useState(""),
    [page, setPage] = useState(0);
  const definitions = useQuery({
    queryKey: ["production-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tailoring_work_catalog");
      if (error) throw error;
      return data as unknown as { products: Definition[]; designs: Definition[] };
    },
  });
  const scan = useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("production_fabric_catalog", { p_barcode: code });
      if (error) throw error;
      const fabric = (data as unknown as Fabric[]).find((f) => f.barcode === code);
      if (!fabric) throw new Error("No active measured Thaan matches");
      const cuts = fabric.cuts.filter(
        (c) => Number(c.locations.find((l) => l.id === source!.id)?.quantity_mm ?? 0) > 0,
      );
      if (cuts.length !== 1)
        throw new Error("Scan the unique physical Thaan available at this source");
      return { fabric, cut: cuts[0]!, metres: "" };
    },
    onSuccess: (row) => {
      if (rows.some((r) => r.cut.inventory_item_id === row.cut.inventory_item_id)) {
        toast.info("This Thaan is already listed");
        return;
      }
      setRows([...rows, row]);
      setBarcode("");
    },
    onError: (e) => toast.error(e.message),
  });
  const issue = useMutation({
    mutationFn: async (args: Request) => {
      setPending(args);
      const { data, error } = await supabase.rpc("create_mixed_production", args);
      if (error) throw error;
      return data;
    },
    onSuccess: (id) => {
      setDocument(id);
      setPending(null);
      setRows([]);
      setOverrides([{}]);
      setCount("1");
      setNotes("");
      void qc.invalidateQueries();
      toast.success("Production issued; fabric deducted immediately");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const frozen = issue.isPending || !!pending;
  function resize(value: string) {
    setCount(value);
    if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000) {
      setOverrides(Array.from({ length: Number(value) }, (_, i) => overrides[i] ?? {}));
      setPage(0);
    }
  }
  function submit() {
    if (pending) {
      issue.mutate(pending);
      return;
    }
    try {
      if (!rows.length || !tailors.length)
        throw new Error("Scan fabric and choose a factory with one or more tailors");
      if (Number(count) !== overrides.length) throw new Error("Enter a valid piece count");
      const items = rows.map((r) => {
        const quantity = quantityInput(r.metres, "mm");
        if (quantity > Number(r.cut.locations.find((l) => l.id === source!.id)?.quantity_mm ?? 0))
          throw new Error("Issued metres exceed available fabric");
        return { inventory_item_id: r.cut.inventory_item_id, quantity };
      });
      const specs = overrides.map((o) => {
        const s = { ...defaults, ...o };
        if (
          !s.product ||
          !s.design ||
          !s.size.trim() ||
          (s.design === "custom" && !s.custom.trim())
        )
          throw new Error("Choose product, size and defined/custom design for every piece");
        return {
          product_id: s.product,
          design_id: s.design === "custom" ? null : s.design,
          custom_design: s.design === "custom" ? s.custom.trim() : null,
          size: s.size.trim(),
        };
      });
      issue.mutate({
        p_request: crypto.randomUUID(),
        p_source: source!.id,
        p_items: items,
        p_specs: specs,
        p_assignments: tailors,
        p_notes: notes,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the production");
    }
  }
  if (!source) return <SourcePicker showWorkshop onChoose={setSource} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
        <strong>{source.name}</strong>
        <Button
          variant="outline"
          disabled={frozen || !!rows.length}
          onClick={() => setSource(null)}
        >
          Change source
        </Button>
      </div>
      <Panel
        title="Issue new production"
        description="One Production ID covers these pieces. Shared defaults fill every piece; individual rows can have different products, designs or sizes."
      >
        <QueryState
          loading={definitions.isPending}
          error={definitions.error}
          retry={() => void definitions.refetch()}
        />
        <fieldset disabled={frozen} className="space-y-4">
          <div className="rounded-lg border p-3 text-sm">
            Production ID: generated uniquely after a successful issue
          </div>
          <BarcodeEntry
            label="Production fabric barcode"
            value={barcode}
            onChange={setBarcode}
            onScan={(v) => scan.mutate(v)}
            disabled={scan.isPending || frozen}
          />
          <div className="ml-2 space-y-2 border-l pl-3">
            {rows.map((r, i) => (
              <div
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                key={r.cut.inventory_item_id}
              >
                <div className="text-sm">
                  <strong>{r.fabric.fabric_name}</strong>
                  <p className="break-all font-mono text-xs">{r.fabric.barcode}</p>
                  <p className="text-xs">
                    Available{" "}
                    {reportQuantity(
                      String(r.cut.locations.find((l) => l.id === source.id)?.quantity_mm ?? 0),
                      "mm",
                    )}
                  </p>
                </div>
                <label className="text-xs">
                  Metres to issue
                  <Input
                    aria-label={`Production metres ${r.fabric.barcode}`}
                    inputMode="decimal"
                    value={r.metres}
                    onChange={(e) =>
                      setRows(rows.map((v, n) => (n === i ? { ...v, metres: e.target.value } : v)))
                    }
                  />
                </label>
                <Button variant="ghost" onClick={() => setRows(rows.filter((_, n) => n !== i))}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <h3 className="font-semibold">Finished pieces</h3>
            <label className="block max-w-48 text-sm">
              Number of pieces
              <Input
                aria-label="Production piece count"
                inputMode="numeric"
                value={count}
                onChange={(e) => resize(e.target.value)}
              />
            </label>
            <h4 className="text-sm font-medium">Defaults for all pieces</h4>
            <SpecInputs
              value={defaults}
              onChange={setDefaults}
              definitions={definitions.data}
              prefix="Default"
            />
            <div className="ml-2 space-y-2 border-l pl-3">
              {overrides.slice(page * 25, (page + 1) * 25).map((o, i) => {
                const n = page * 25 + i;
                return (
                  <details key={n} className="rounded-lg border bg-card p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Piece {n + 1}
                      {" · " +
                        (definitions.data?.products.find(
                          (p) => p.id === { ...defaults, ...o }.product,
                        )?.name || "Choose product") +
                        " · Size " +
                        ({ ...defaults, ...o }.size || "not set")}
                      {Object.keys(o).length ? " · individual choices" : ""}
                    </summary>
                    <div className="mt-3">
                      <SpecInputs
                        value={{ ...defaults, ...o }}
                        onChange={(s) =>
                          setOverrides(
                            overrides.map((old, k) =>
                              k === n
                                ? Object.fromEntries(
                                    Object.entries(s).filter(
                                      ([key, value]) => value !== defaults[key as keyof Spec],
                                    ),
                                  )
                                : old,
                            ),
                          )
                        }
                        definitions={definitions.data}
                        prefix={`Piece ${n + 1}`}
                      />
                      {Object.keys(o).length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setOverrides(overrides.map((old, k) => (k === n ? {} : old)))
                          }
                        >
                          Use defaults
                        </Button>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            {overrides.length > 25 && (
              <div className="flex gap-2">
                <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous pieces
                </Button>
                <span className="self-center text-sm">
                  Page {page + 1} of {Math.ceil(overrides.length / 25)}
                </span>
                <Button
                  variant="outline"
                  disabled={(page + 1) * 25 >= overrides.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next pieces
                </Button>
              </div>
            )}
          </div>
          <FactoryTailorPicker
            factory={factory}
            onFactory={setFactory}
            selected={tailors}
            onSelected={setTailors}
            multiple
          />
          <Input
            aria-label="Production note optional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
          />
          <Button disabled={issue.isPending || !!definitions.error} onClick={submit}>
            Issue production & generate ID
          </Button>
        </fieldset>
        {pending && !issue.isPending && (
          <Button className="mt-3" onClick={submit}>
            Retry unchanged production
          </Button>
        )}
      </Panel>
      {document && <ProductionDocument code={document} />}
    </div>
  );
}
