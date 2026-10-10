import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { useSuppliers } from "@/features/inventory";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { Panel, EmptyState } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fabricMoneyInput } from "./fabric-entry-input";
import { quantityInput } from "./ledger-quantity";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";

type Variant = {
  id: string;
  code: string;
  ordinal: number;
  stock_id: string;
  thaan_id: string;
  original_mm: number;
  available_mm: string;
  cp_missing: boolean;
  can_fill_cp: boolean;
  cp_paise_per_m: string | null;
};
type FabricType = { id: string; code: string; name: string; variants: Variant[] };
type Batch = { id: string; code: string; provider_name: string; fabric_types: FabricType[] };
type Work =
  | { kind: "batch"; provider: string }
  | {
      kind: "fabric";
      batch: string;
      name: string;
      rows: { length_mm: number; cp_paise_per_m: number | null }[];
    }
  | { kind: "append"; group: string; rows: { length_mm: number; cp_paise_per_m: number | null }[] }
  | { kind: "cp"; barcode: string; cp: number };
type Pending = { request: string; work: Work };
function BarcodeLabel({
  variant,
  provider,
  fabric,
}: {
  variant: Variant;
  provider: string;
  fabric: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bars = fabricBarcodeBars(variant.code);
  return (
    <div>
      <div ref={ref} className="rounded border bg-white p-3 text-black">
        <p>
          {provider} · {fabric}
        </p>
        <svg
          viewBox={`0 0 ${bars.length + 40} 65`}
          role="img"
          aria-label={`Barcode ${variant.code}`}
          className="h-16 max-w-full"
        >
          <rect width={bars.length + 40} height="65" fill="white" />
          {[...bars].map((bit, index) =>
            bit === "1" ? (
              <rect key={index} x={20 + index} y="4" width="1" height="55" fill="black" />
            ) : null,
          )}
        </svg>
        <p>{variant.code}</p>
        <p>Original length: {reportQuantity(String(variant.original_mm), "mm")}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        onClick={() => {
          try {
            if (ref.current) printFabricLabel(ref.current, variant.code);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Printing failed");
          }
        }}
      >
        Print {variant.code}
      </Button>
    </div>
  );
}
export function StockRegistration() {
  const { isOwner, roles, userId, can } = useSession();
  const allowed = isOwner || (roles.includes("stock_entry") && can("inventory.receive"));
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const catalog = useQuery({
    queryKey: ["stock-registration", userId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_registration_catalog", {});
      if (error) throw error;
      return data as unknown as Batch[];
    },
  });
  const [provider, setProvider] = useState("");
  const [batchId, setBatchId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [fabric, setFabric] = useState("");
  const [rows, setRows] = useState([{ id: crypto.randomUUID(), length: "", cp: "" }]);
  const [barcode, setBarcode] = useState("");
  const [scanned, setScanned] = useState("");
  const [cp, setCp] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const selectedBatch = catalog.data?.find((batch) => batch.id === batchId);
  const names = [
    ...new Set([
      ...(suppliers.data ?? []).map((supplier) => supplier.name),
      ...(catalog.data ?? []).map((batch) => batch.provider_name),
    ]),
  ];
  const action = useMutation({
    mutationFn: async (args: Pending) => {
      setPending(args);
      const w = args.work;
      const result =
        w.kind === "batch"
          ? await supabase.rpc("register_delivery_batch", {
              p_request: args.request,
              p_provider: w.provider,
            })
          : w.kind === "fabric"
            ? await supabase.rpc("register_fabric_type", {
                p_request: args.request,
                p_batch: w.batch,
                p_name: w.name,
                p_rows: w.rows,
              })
            : w.kind === "append"
              ? await supabase.rpc("append_registered_thans", {
                  p_request: args.request,
                  p_fabric_type: w.group,
                  p_rows: w.rows,
                })
              : await supabase.rpc("fill_registered_thaan_cp", {
                  p_request: args.request,
                  p_barcode: w.barcode,
                  p_cp: w.cp,
                });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: (id, args) => {
      setPending(null);
      if (args.work.kind === "batch") {
        setBatchId(id);
        setGroupId("");
      } else if (args.work.kind !== "cp") {
        setRows([{ id: crypto.randomUUID(), length: "", cp: "" }]);
        setFabric("");
      } else setCp("");
      void qc.invalidateQueries();
      toast.success(
        args.work.kind === "batch"
          ? "New delivery batch created"
          : args.work.kind === "cp"
            ? "Missing CP recorded"
            : "Thans registered with unique barcodes and received into Workshop",
      );
    },
    onError: (error) => {
      if (definiteDatabaseRejection(error)) setPending(null);
      toast.error(error.message || "Request could not be confirmed; retry the same request");
    },
  });
  const frozen = action.isPending || pending !== null;
  const run = (work: Work) => action.mutate({ request: crypto.randomUUID(), work });
  if (!allowed) return <p>Authorized Stock Entry access is required.</p>;
  return (
    <div className="space-y-4">
      <QueryState
        loading={catalog.isPending}
        error={catalog.error}
        retry={() => void catalog.refetch()}
      />
      {pending && !action.isPending ? (
        <Panel title="Confirm previous request">
          <p>
            The result is uncertain. Retry the same request before editing or submitting another.
          </p>
          <Button onClick={() => action.mutate(pending)}>Retry same request</Button>
        </Panel>
      ) : null}
      <Panel
        title="1. Create delivery batch"
        description="Every delivery has a new batch ID. Selecting a provider from history reuses the name, not an earlier batch."
      >
        <fieldset disabled={frozen} className="space-y-3">
          <Label>Provider name</Label>
          <PickOrTypeInput
            value={provider}
            onChange={setProvider}
            options={names}
            placeholder="Select from history or type a provider"
          />
          <p className="text-xs text-muted-foreground">
            Prefix: first letter + last two letters of the first word. The first word must contain
            at least three English letters.
          </p>
          <Button
            type="button"
            disabled={!provider.trim()}
            onClick={() => run({ kind: "batch", provider: provider.trim() })}
          >
            Create new delivery batch
          </Button>
        </fieldset>
      </Panel>
      <Panel
        title="2. Select batch and register Fabric Type / Thans"
        description="New Fabric Types get a random, collision-checked code. Each physical Than gets the next suffix: a…z, aa, ab… CP can be left blank and filled by scanning later."
      >
        <fieldset
          disabled={frozen || catalog.isPending || Boolean(catalog.error)}
          className="space-y-3"
        >
          <Label htmlFor="registration-batch">Delivery batch</Label>
          <select
            id="registration-batch"
            className="h-11 w-full rounded border bg-background p-2"
            value={batchId}
            onChange={(event) => {
              setBatchId(event.target.value);
              setGroupId("");
            }}
          >
            <option value="">Choose a batch</option>
            {catalog.data?.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.code} — {batch.provider_name}
              </option>
            ))}
          </select>
          <Label htmlFor="registration-type">Fabric Type</Label>
          <select
            id="registration-type"
            className="h-11 w-full rounded border bg-background p-2"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">Create another Fabric Type</option>
            {selectedBatch?.fabric_types.map((group) => (
              <option key={group.id} value={group.id}>
                {group.code} — {group.name} (add more Thans)
              </option>
            ))}
          </select>
          {!groupId ? (
            <>
              <Label htmlFor="registration-name">New Fabric Type name</Label>
              <Input
                id="registration-name"
                value={fabric}
                onChange={(event) => setFabric(event.target.value)}
                placeholder="e.g. Cotton"
              />
            </>
          ) : null}
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label htmlFor={`length-${row.id}`}>Than {index + 1}: length (metres)</Label>
                <Input
                  id={`length-${row.id}`}
                  inputMode="decimal"
                  value={row.length}
                  onChange={(event) =>
                    setRows((old) =>
                      old.map((item) =>
                        item.id === row.id ? { ...item, length: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
              <div>
                <Label htmlFor={`cp-${row.id}`}>CP / Lagat per metre (optional)</Label>
                <Input
                  id={`cp-${row.id}`}
                  inputMode="decimal"
                  value={row.cp}
                  onChange={(event) =>
                    setRows((old) =>
                      old.map((item) =>
                        item.id === row.id ? { ...item, cp: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={rows.length === 1}
                onClick={() => setRows((old) => old.filter((item) => item.id !== row.id))}
              >
                Remove Than {index + 1}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rows.length >= 500}
              onClick={() =>
                setRows((old) => [...old, { id: crypto.randomUUID(), length: "", cp: "" }])
              }
            >
              Add another Than
            </Button>
            <Button
              type="button"
              disabled={!batchId || (!groupId && !fabric.trim())}
              onClick={() => {
                try {
                  const converted = rows.map((row) => ({
                    length_mm: quantityInput(row.length, "mm"),
                    cp_paise_per_m: row.cp.trim() ? fabricMoneyInput(row.cp) : null,
                  }));
                  run(
                    groupId
                      ? { kind: "append", group: groupId, rows: converted }
                      : { kind: "fabric", batch: batchId, name: fabric.trim(), rows: converted },
                  );
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Invalid Than details");
                }
              }}
            >
              Register and receive Thans
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Up to 500 Thans per submission; add further Thans afterward. New batches and Fabric
            Types always receive fresh identities.
          </p>
        </fieldset>
      </Panel>
      <Panel title="3. Scan a registered Than to fill missing CP">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const code = barcode.trim();
            const exists = catalog.data?.some((batch) =>
              batch.fabric_types.some((group) =>
                group.variants.some((variant) => variant.code === code),
              ),
            );
            if (!exists) {
              toast.error("Owned registered Than barcode not found; refresh if needed");
              return;
            }
            setScanned(code);
            setCp("");
          }}
        >
          <Input
            aria-label="Registered Than barcode"
            placeholder="Scan barcode and press Enter"
            value={barcode}
            disabled={frozen}
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setBarcode(event.target.value)}
          />
          <Button disabled={frozen || !barcode.trim()}>Scan Than</Button>
        </form>
      </Panel>
      <Panel
        title="Delivery history and barcode labels"
        actions={
          <Button type="button" variant="outline" onClick={() => void catalog.refetch()}>
            Refresh entries
          </Button>
        }
      >
        {!catalog.isPending && !catalog.error && !catalog.data?.length ? (
          <EmptyState
            title="No registered deliveries yet"
            description="Create your first delivery batch above."
          />
        ) : null}
        {catalog.data?.map((batch) => (
          <details
            key={batch.id}
            open={
              batch.id === batchId ||
              batch.fabric_types.some((group) =>
                group.variants.some((variant) => variant.code === scanned),
              )
            }
            className="mb-3 rounded border p-3"
          >
            <summary className="cursor-pointer font-semibold">
              {batch.code} — {batch.provider_name}
            </summary>
            {batch.fabric_types.map((group) => (
              <section key={group.id} className="mt-3 space-y-3">
                <h3 className="font-medium">
                  {group.code} — {group.name} · {group.variants.length} Thans ·{" "}
                  {reportQuantity(
                    String(group.variants.reduce((sum, variant) => sum + variant.original_mm, 0)),
                    "mm",
                  )}{" "}
                  originally received
                </h3>
                {group.variants.map((variant) => (
                  <details
                    key={variant.id}
                    open={variant.code === scanned}
                    className="rounded border p-3"
                  >
                    <summary className="cursor-pointer">
                      {variant.code} · original {reportQuantity(String(variant.original_mm), "mm")}{" "}
                      · available {reportQuantity(variant.available_mm, "mm")} ·{" "}
                      {variant.cp_missing ? "CP not entered" : "CP recorded"}
                    </summary>
                    <BarcodeLabel
                      variant={variant}
                      provider={batch.provider_name}
                      fabric={group.name}
                    />
                    {isOwner && variant.cp_paise_per_m !== null ? (
                      <p>CP / Lagat: {reportMoney(variant.cp_paise_per_m)} / m</p>
                    ) : null}
                    {variant.cp_missing &&
                    (isOwner || variant.can_fill_cp) &&
                    variant.code === scanned ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Input
                          aria-label={`Missing CP for ${variant.code}`}
                          placeholder="CP per metre"
                          inputMode="decimal"
                          value={cp}
                          disabled={frozen}
                          onChange={(event) => setCp(event.target.value)}
                        />
                        <Button
                          disabled={frozen || !cp.trim()}
                          onClick={() => {
                            try {
                              run({ kind: "cp", barcode: variant.code, cp: fabricMoneyInput(cp) });
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Invalid CP");
                            }
                          }}
                        >
                          Save missing CP
                        </Button>
                      </div>
                    ) : null}
                  </details>
                ))}
              </section>
            ))}
          </details>
        ))}
      </Panel>
    </div>
  );
}
