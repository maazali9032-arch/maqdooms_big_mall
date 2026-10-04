import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/shared/utils/format";
import { quantityInput, quantityText } from "@/features/inventory/ledger-quantity";
import {
  consumableQuantity,
  issueItems,
  definiteDatabaseRejection,
} from "@/features/inventory/consumable-input";
import type { Consumable } from "@/features/inventory/Consumables";
import type { Database } from "@/integrations/supabase/types";

type Job = {
  id: string;
  code: string;
  kind: string;
  status: string;
  factory_name: string;
  section_name: string | null;
  tailor_name: string;
  tailor_code: string;
};
type Issue = {
  id: string;
  code: string;
  job_code: string;
  issue_type: string;
  reason: string;
  issued_by: string;
  issuer_name: string | null;
  issued_at: string;
  source_name: string;
  factory_name: string;
  section_name: string | null;
  tailor_name: string;
  tailor_code: string;
  lines: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    thaan_id: string | null;
    barcode: string | null;
    batch_code: string | null;
    movement_id: string;
  }[];
};
type Stock = {
  fabric_name: string;
  batch_code: string;
  barcode: string;
  cuts: {
    inventory_item_id: string;
    thaan_id: string;
    locations: { id: string; name: string; quantity_mm: number }[];
  }[];
};
type Args = Database["public"]["Functions"]["post_material_issue"]["Args"];
type Item = { id: string; name: string; unit: string; quantity: number; fabric: boolean };

export function MaterialIssues() {
  const { isOwner, roles, can } = useSession();
  const mayRead = isOwner || roles.includes("counter") || roles.includes("tailor");
  const mayIssue = isOwner || (roles.includes("counter") && can("pos.issue_to_tailoring"));
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ["material-issues", "jobs"],
    enabled: mayRead,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("material_issue_jobs");
      if (error) throw error;
      return data as unknown as Job[];
    },
  });
  const catalog = useQuery({
    queryKey: ["consumables", "catalog"],
    enabled: mayIssue,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumable_catalog");
      if (error) throw error;
      return data as unknown as Consumable[];
    },
  });
  const fabrics = useQuery({
    queryKey: ["material-issues", "fabrics"],
    enabled: mayIssue,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_catalog");
      if (error) throw error;
      return (data as unknown as { stocks: Stock[] }).stocks;
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: mayIssue,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [jobId, setJobId] = useState("");
  const [source, setSource] = useState("");
  const [type, setType] = useState("required");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ item: "", quantity: "" }]);
  const [pending, setPending] = useState<Args | null>(null);
  const history = useQuery({
    queryKey: ["material-issues", "history", jobId],
    enabled: mayRead,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("material_issue_history", {
        ...(jobId ? { p_job: jobId } : {}),
        p_limit: 100,
      });
      if (error) throw error;
      return data as unknown as Issue[];
    },
  });
  const job = jobs.data?.find((j) => j.id === jobId);
  const items: Item[] = (catalog.data ?? [])
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
  if (type === "additional" || job?.kind === "production")
    for (const s of fabrics.data ?? [])
      for (const c of s.cuts)
        for (const l of c.locations)
          if (l.id === source && l.quantity_mm > 0)
            items.push({
              id: c.inventory_item_id,
              name: `${s.fabric_name} · ${s.batch_code} · Than ${c.thaan_id.slice(0, 8)}`,
              unit: "mm",
              quantity: Number(l.quantity_mm),
              fabric: true,
            });
  const post = useMutation({
    mutationFn: async (args: Args) => {
      setPending(args);
      const { data, error } = await supabase.rpc("post_material_issue", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setPending(null);
      setLines([{ item: "", quantity: "" }]);
      setReason("");
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
      toast.success("Material Issue posted");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  if (!mayRead) return null;
  const submit = () => {
    if (pending) {
      post.mutate(pending);
      return;
    }
    try {
      if (!job || !source || !reason.trim())
        throw new Error("Choose a job, source location and reason");
      const payload = issueItems(
        lines.map((line) => {
          const item = items.find((i) => i.id === line.item);
          if (!item) throw new Error("Choose an available material for every line");
          const quantity = item.fabric
            ? quantityInput(line.quantity, "mm")
            : consumableQuantity(line.quantity, item.unit);
          if (quantity > item.quantity) throw new Error(`Insufficient ${item.name} at this source`);
          return { inventory_item_id: item.id, quantity };
        }),
      );
      post.mutate({
        p_request_id: crypto.randomUUID(),
        p_job_kind: job.kind,
        p_job: job.id,
        p_source: source,
        p_type: type,
        p_items: payload,
        p_reason: reason.trim(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel
      title="Material Issues"
      description="Explicit required quantities and Additional Material Issues, linked to the job and its Factory → Section → Tailor assignment."
    >
      {jobs.error && <p role="alert">{jobs.error.message}</p>}
      {mayIssue && (
        <div className="space-y-3">
          <fieldset disabled={post.isPending || !!pending} className="space-y-3">
            <label>
              Job
              <select
                className="block w-full border p-2"
                value={jobId}
                onChange={(e) => {
                  setJobId(e.target.value);
                  setLines([{ item: "", quantity: "" }]);
                }}
              >
                <option value="">Choose an open job</option>
                {jobs.data
                  ?.filter((j) => ["open", "in_progress"].includes(j.status))
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.code} ·{" "}
                      {j.kind === "production" ? "Owner Production" : "Customer Tailoring"}
                    </option>
                  ))}
              </select>
            </label>
            {job && (
              <p>
                {job.factory_name} → {job.section_name ?? "No Section"} → {job.tailor_code} ·{" "}
                {job.tailor_name}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                Source
                <select
                  className="block w-full border p-2"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setLines([{ item: "", quantity: "" }]);
                  }}
                >
                  <option value="">Choose source</option>
                  {locations.data
                    ?.filter((l) => l.active)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Issue type
                <select
                  className="block w-full border p-2"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setLines([{ item: "", quantity: "" }]);
                  }}
                >
                  <option value="required">Required Material Issue</option>
                  <option value="additional">Additional Material Issue</option>
                </select>
              </label>
            </div>
            {lines.map((line, index) => {
              const item = items.find((i) => i.id === line.item);
              return (
                <div className="grid gap-2 md:grid-cols-3" key={index}>
                  <label>
                    Material
                    <select
                      className="block w-full border p-2"
                      value={line.item}
                      onChange={(e) =>
                        setLines(
                          lines.map((l, n) => (n === index ? { ...l, item: e.target.value } : l)),
                        )
                      }
                    >
                      <option value="">Choose material</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} · Available {quantityText(i.quantity, i.unit, i.fabric)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity ({item?.fabric ? "metres" : (item?.unit ?? "unit")})
                    <Input
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines(
                          lines.map((l, n) =>
                            n === index ? { ...l, quantity: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() => setLines(lines.filter((_, n) => n !== index))}
                    disabled={lines.length === 1}
                  >
                    Remove line
                  </Button>
                </div>
              );
            })}
            <Button
              variant="outline"
              disabled={lines.length >= 100}
              onClick={() => setLines([...lines, { item: "", quantity: "" }])}
            >
              Add material
            </Button>
            <label className="block">
              Reason / reference
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            Enter the actual required quantity. Required fabric is already issued at Customer
            Tailoring booking; extra fabric uses Additional Material Issue. No automatic wastage or
            order repricing.
          </p>
          {[catalog.error, fabrics.error, locations.error].filter(Boolean).map((e, i) => (
            <p key={i} role="alert">
              {e?.message}
            </p>
          ))}
          {!jobs.isPending &&
            !jobs.data?.some((j) => ["open", "in_progress"].includes(j.status)) && (
              <p>
                Create a Customer Tailoring Job first. Owner Production Job creation is in its later
                phase.
              </p>
            )}
          {pending && !post.isPending && (
            <p role="alert">
              Issue result is uncertain. Retry the same issue to confirm its result.
            </p>
          )}
          <Button disabled={post.isPending} onClick={submit}>
            {post.isPending ? "Posting…" : pending ? "Retry same issue" : "Post Material Issue"}
          </Button>
        </div>
      )}
      <div className="mt-5 space-y-3">
        <h3 className="font-semibold">Issue history</h3>
        {!mayIssue && (
          <label>
            Job
            <select
              className="block w-full border p-2"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">All assigned jobs</option>
              {jobs.data?.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code}
                </option>
              ))}
            </select>
          </label>
        )}
        {history.isPending && <p>Loading history…</p>}
        {history.error && <p role="alert">{history.error.message}</p>}
        {!history.isPending && !history.error && !history.data?.length && (
          <p>No Material Issues recorded for this selection.</p>
        )}
        {history.data?.map((i) => (
          <div key={i.id} className="rounded border p-3 text-sm">
            <p className="font-semibold">
              {i.code} · {i.job_code} ·{" "}
              {i.issue_type === "additional"
                ? "Additional Material Issue"
                : "Required Material Issue"}
            </p>
            <p>
              {i.factory_name} → {i.section_name ?? "No Section"} → {i.tailor_code} ·{" "}
              {i.tailor_name}
            </p>
            <p>
              {formatDateTime(i.issued_at)} · From {i.source_name} · Issued by{" "}
              {i.issuer_name ?? i.issued_by} · {i.reason}
            </p>
            {i.lines?.map((l) => (
              <p key={l.id}>
                {l.name} · {quantityText(Number(l.quantity), l.unit, !!l.thaan_id)}
                {l.barcode && ` · ${l.barcode} · Batch ${l.batch_code} · Than ${l.thaan_id}`} ·
                Movement {l.movement_id}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
