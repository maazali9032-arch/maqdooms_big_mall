import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { quantityInput, quantityText } from "@/features/inventory/ledger-quantity";
import {
  consumableQuantity,
  definiteDatabaseRejection,
} from "@/features/inventory/consumable-input";

type Material = {
  issue_line_id: string;
  name: string;
  quantity: number;
  unit: string;
  fabric: boolean;
  category: string;
  actual_piece_usage: number;
  fabric_costs: { id: string; revision: number; cp_paise_per_m: number }[];
  receipts: { id: string; received_at: string; cp_paise_per_unit: number }[];
};
type Version = {
  id: string;
  revision: number;
  total_paise: number;
  mean_piece_paise: number;
  reason: string;
  lines: {
    id: string;
    category: string;
    amount_paise: number;
    description: string;
    quantity?: number;
    unit?: string;
  }[];
  allocations: {
    piece_id: string;
    piece_number: number;
    amount_paise: number;
    sp_paise: number | null;
    price_cost_version_id: string | null;
    status: string;
  }[];
};
type Context = {
  quantity: number;
  design_charge_paise: number | null;
  materials: Material[];
  versions: Version[];
};
type Functions = Database["public"]["Functions"];
type CostArgs = Functions["finalize_production_cost"]["Args"];
type PriceArgs = Functions["set_finished_product_sp"]["Args"];
type LineInput = { quantity: string; source: string; amount: string; category: string };
function money(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter explicit rupees with at most two decimal places");
  const [whole = "", fraction = ""] = value.trim().split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Money exceeds supported exact range");
  return Number(result);
}
const rupees = (value: number) => `₹${(Number(value) / 100).toFixed(2)}`;

export function ProductionCosting() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [job, setJob] = useState("");
  const [editing, setEditing] = useState(false);
  const [expected, setExpected] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, LineInput>>({});
  const [tailoring, setTailoring] = useState("");
  const [basis, setBasis] = useState("");
  const [reason, setReason] = useState("");
  const [other, setOther] = useState<{ description: string; amount: string }[]>([]);
  const [costPending, setCostPending] = useState<CostArgs | null>(null);
  const [pricePending, setPricePending] = useState<PriceArgs | null>(null);
  const [price, setPrice] = useState("");
  const [target, setTarget] = useState("all");
  const [priceReason, setPriceReason] = useState("");
  const jobs = useQuery({
    queryKey: ["owner-production", "history"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_history");
      if (error) throw error;
      return data as unknown as {
        id: string;
        code: string;
        product: string;
        design: string;
        status: string;
      }[];
    },
  });
  const context = useQuery({
    queryKey: ["production-costing", job],
    enabled: isOwner && !!job,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_costs", { p_job: job });
      if (error) throw error;
      return data as unknown as Context;
    },
  });
  const refresh = () => {
    for (const key of ["production-costing", "finished-products", "finished-product-sale"])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const cost = useMutation({
    mutationFn: async (args: CostArgs) => {
      setCostPending(args);
      const { data, error } = await supabase.rpc("finalize_production_cost", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setCostPending(null);
      setEditing(false);
      refresh();
      toast.success("Complete Production Cost revision recorded");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setCostPending(null);
      toast.error(e.message);
    },
  });
  const sp = useMutation({
    mutationFn: async (args: PriceArgs) => {
      setPricePending(args);
      const { data, error } = await supabase.rpc("set_finished_product_sp", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setPricePending(null);
      setPrice("");
      setPriceReason("");
      refresh();
      toast.success("Owner-reviewed Finished Product SP recorded");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPricePending(null);
      toast.error(e.message);
    },
  });
  const latest = context.data?.versions[0];
  if (!isOwner) return null;
  const submitCost = () => {
    if (costPending) {
      cost.mutate(costPending);
      return;
    }
    try {
      if (!context.data || !editing || !reason.trim() || !basis)
        throw new Error(
          "Begin a revision and explicitly confirm all cost inputs, Design basis and reason",
        );
      const materials = context.data.materials.map((m) => {
        const input = inputs[m.issue_line_id];
        if (!input) throw new Error("Complete every material line");
        const q = /^0+(\.0{1,3})?$/.test(input.quantity.trim())
          ? 0
          : m.fabric
            ? quantityInput(input.quantity, "mm")
            : consumableQuantity(input.quantity, m.unit);
        if (q < Number(m.actual_piece_usage) || q > Number(m.quantity))
          throw new Error(
            "Billed quantity must cover actual piece usage and stay within issued quantity",
          );
        return {
          issue_line_id: m.issue_line_id,
          quantity: q,
          ...(m.fabric
            ? { fabric_cost_id: input.source }
            : input.source === "manual"
              ? { category: input.category, amount_paise: money(input.amount) }
              : { category: input.category, receipt_id: input.source }),
        };
      });
      cost.mutate({
        p_request: crypto.randomUUID(),
        p_job: job,
        p_expected_version: expected,
        p_materials: materials,
        p_tailoring: money(tailoring),
        p_design_basis: basis,
        p_other: other.map((c) => ({ description: c.description, amount_paise: money(c.amount) })),
        p_reason: reason.trim(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel
      title="Production Costing / Finished Product SP"
      description="Owner-only complete cost revisions. Review the recorded cost before setting explicit SP."
    >
      {[jobs.error, context.error].filter(Boolean).map((e, i) => (
        <p role="alert" key={i}>
          {e!.message}
        </p>
      ))}
      <select
        aria-label="Production Job for costing"
        className="w-full rounded border bg-background p-2"
        disabled={cost.isPending || sp.isPending || !!costPending || !!pricePending}
        value={job}
        onChange={(e) => {
          setJob(e.target.value);
          setEditing(false);
          setInputs({});
          setTarget("all");
        }}
      >
        <option value="">Completed Production Job</option>
        {jobs.data
          ?.filter((j) => j.status === "completed")
          .map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} · {j.product} · {j.design}
            </option>
          ))}
      </select>
      {context.data && (
        <>
          <p className="my-3">
            Quantity: {context.data.quantity} identical pieces. Retained Design charge:{" "}
            {context.data.design_charge_paise == null
              ? "No charge snapshot"
              : rupees(context.data.design_charge_paise)}
            . Confirm billable quantities and actual cost sources; no FIFO or unused-material cost
            is inferred.
          </p>
          <Button
            variant="outline"
            disabled={cost.isPending || !!costPending}
            onClick={() => {
              setExpected(latest?.id ?? null);
              setEditing(true);
              setInputs(
                Object.fromEntries(
                  context.data!.materials.map((m) => [
                    m.issue_line_id,
                    {
                      quantity: "",
                      source: "",
                      amount: "",
                      category: m.category ?? "other_consumables",
                    },
                  ]),
                ),
              );
              setTailoring("");
              setBasis("");
              setReason("");
              setOther([]);
            }}
          >
            Begin {latest ? "new cost revision" : "initial costing"}
          </Button>
          {editing && (
            <>
              <fieldset className="my-3 space-y-3" disabled={cost.isPending || !!costPending}>
                {context.data.materials.map((m) => {
                  const input = inputs[m.issue_line_id] ?? {
                    quantity: "",
                    source: "",
                    amount: "",
                    category: m.category,
                  };
                  const change = (value: Partial<LineInput>) =>
                    setInputs({ ...inputs, [m.issue_line_id]: { ...input, ...value } });
                  return (
                    <div key={m.issue_line_id} className="space-y-2 rounded border p-3">
                      <p>
                        {m.name} · issued {quantityText(Number(m.quantity), m.unit)} · actual piece
                        usage {quantityText(Number(m.actual_piece_usage), m.unit)}
                      </p>
                      <Input
                        aria-label={`${m.name} billed quantity`}
                        placeholder={m.fabric ? "Billable metres" : "Billable " + m.unit}
                        value={input.quantity}
                        onChange={(e) => change({ quantity: e.target.value })}
                      />
                      <select
                        aria-label={`${m.name} cost source`}
                        className="w-full rounded border bg-background p-2"
                        value={input.source}
                        onChange={(e) => change({ source: e.target.value })}
                      >
                        <option value="">Choose real cost source</option>
                        {m.fabric ? (
                          m.fabric_costs.map((c) => (
                            <option key={c.id} value={c.id}>
                              Fabric CP revision {c.revision} · {rupees(c.cp_paise_per_m)} / m
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="manual">Owner-confirmed actual total cost</option>
                            {m.receipts.map((r) => (
                              <option key={r.id} value={r.id}>
                                Receipt {new Date(r.received_at).toLocaleString()} ·{" "}
                                {rupees(r.cp_paise_per_unit)} / {m.unit}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                      {!m.fabric && (
                        <>
                          <select
                            aria-label={`${m.name} cost category`}
                            className="w-full rounded border bg-background p-2"
                            value={input.category}
                            onChange={(e) => change({ category: e.target.value })}
                          >
                            {["buttons", "thread", "padding", "other_consumables"].map((c) => (
                              <option key={c} value={c}>
                                {c.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          {input.source === "manual" && (
                            <Input
                              aria-label={`${m.name} actual total cost rupees`}
                              placeholder="Actual total cost ₹ (explicit zero if free)"
                              value={input.amount}
                              onChange={(e) => change({ amount: e.target.value })}
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                <Input
                  aria-label="Total tailoring production cost rupees"
                  placeholder="Total job tailoring / production cost ₹ (explicit zero if none)"
                  value={tailoring}
                  onChange={(e) => setTailoring(e.target.value)}
                />
                <select
                  aria-label="Design Embroidery charge basis"
                  className="w-full rounded border bg-background p-2"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="">Confirm Design / Embroidery basis</option>
                  {context.data.design_charge_paise == null ? (
                    <option value="not_applicable">No Design charge applies to this job</option>
                  ) : (
                    <>
                      <option value="job_total">
                        Retained charge applies once to the whole job
                      </option>
                      <option value="per_piece">Retained charge applies to each piece</option>
                    </>
                  )}
                </select>
                {other.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label={`Other production cost ${i + 1} description`}
                      value={c.description}
                      placeholder="Applicable cost description"
                      onChange={(e) =>
                        setOther(
                          other.map((r, n) =>
                            n === i ? { ...r, description: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={`Other production cost ${i + 1} rupees`}
                      value={c.amount}
                      placeholder="Total ₹"
                      onChange={(e) =>
                        setOther(
                          other.map((r, n) => (n === i ? { ...r, amount: e.target.value } : r)),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      onClick={() => setOther(other.filter((_, n) => n !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={other.length >= 100}
                  onClick={() => setOther([...other, { description: "", amount: "" }])}
                >
                  Add applicable other cost
                </Button>
                <Input
                  aria-label="Cost revision reason"
                  placeholder="Reason / billable quantities and cost basis confirmation"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </fieldset>
              <Button disabled={cost.isPending} onClick={submitCost}>
                {costPending ? "Retry same cost revision" : "Record Complete Production Cost"}
              </Button>
            </>
          )}
          {latest && (
            <div className="my-4 space-y-2">
              <p className="font-medium">
                Review cost revision {latest.revision}: Total {rupees(latest.total_paise)} ÷{" "}
                {context.data.quantity} pieces = ₹
                {(Number(latest.mean_piece_paise) / 100).toFixed(4)} average per piece
              </p>
              <p>
                Whole-paise allocation preserves the total; any remainder is assigned in
                piece-number order.
              </p>
              {latest.lines.map((l) => (
                <p key={l.id}>
                  {l.category.replaceAll("_", " ")} · {l.description} · {rupees(l.amount_paise)}
                </p>
              ))}
              <p>{latest.reason}</p>
              <p>
                Each piece:{" "}
                {latest.allocations
                  .map((p) => `#${p.piece_number} ${rupees(p.amount_paise)}`)
                  .join("; ")}
              </p>
              <fieldset className="space-y-2" disabled={sp.isPending || !!pricePending}>
                <select
                  aria-label="Finished Product price target"
                  className="w-full rounded border bg-background p-2"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="all">All available pieces in this job</option>
                  {latest.allocations
                    .filter((p) => p.status === "available")
                    .map((p) => (
                      <option key={p.piece_id} value={p.piece_id}>
                        Piece {p.piece_number} · current SP{" "}
                        {p.sp_paise == null ? "not set" : rupees(p.sp_paise)}
                        {p.price_cost_version_id && p.price_cost_version_id !== latest.id
                          ? " · reviewed against older cost"
                          : ""}
                      </option>
                    ))}
                </select>
                <Input
                  aria-label="Finished Product SP rupees"
                  placeholder="Owner-selected SP ₹"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <Input
                  aria-label="Finished Product price reason"
                  placeholder="Cost reviewed / price decision reason"
                  value={priceReason}
                  onChange={(e) => setPriceReason(e.target.value)}
                />
              </fieldset>
              <Button
                disabled={sp.isPending}
                onClick={() => {
                  if (pricePending) {
                    sp.mutate(pricePending);
                    return;
                  }
                  try {
                    if (!priceReason.trim()) throw new Error("Cost review / price reason required");
                    const amount = money(price);
                    const pieces = latest.allocations.filter(
                      (p) =>
                        p.status === "available" && (target === "all" || target === p.piece_id),
                    );
                    if (!pieces.length) throw new Error("Choose available pieces");
                    sp.mutate({
                      p_request: crypto.randomUUID(),
                      p_job: job,
                      p_cost_version: latest.id,
                      p_updates: pieces.map((p) => ({ piece_id: p.piece_id, sp_paise: amount })),
                      p_reason: priceReason.trim(),
                    });
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                {pricePending ? "Retry same price request" : "Confirm cost reviewed and set SP"}
              </Button>
            </div>
          )}
          <details>
            <summary>Permanent cost revision history</summary>
            {context.data.versions.map((v) => (
              <p key={v.id}>
                Revision {v.revision} · total {rupees(v.total_paise)} · {v.reason}
              </p>
            ))}
          </details>
        </>
      )}
    </Panel>
  );
}
