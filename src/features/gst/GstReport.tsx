import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { reportMoney } from "@/features/reports/report-value";

type GstReportData = {
  summary: Record<string, string>;
  by_rate: {
    category: string;
    classification_code: string;
    rate_bps: number;
    taxable_paise: string;
    gst_paise: string;
    documents: string;
  }[];
  invoices: {
    invoice_number: string;
    recorded_at: string;
    supply_type: string;
    taxable_paise: string;
    gst_paise: string;
    final_paise: string;
  }[];
  purchases: {
    batch_id: string;
    supplier: string;
    invoice_number: string | null;
    itc_status: string;
    purchase_mode?: string;
    inventory_cost_adjustment_paise?: string;
    calculated_taxable_paise: string;
    calculated_gst_paise: string;
    actual_taxable_paise: string | null;
    actual_gst_paise: string | null;
    difference_paise: string | null;
  }[];
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const first = () => `${today().slice(0, 8)}01`;
const summaryCards: [string, string][] = [
  ["Taxable sales", "sales_taxable_paise"],
  ["Output GST", "output_gst_paise"],
  ["Eligible ITC", "eligible_itc_paise"],
  ["Non-creditable cost adjustment", "inventory_cost_adjustment_paise"],
  ["Estimated liability", "estimated_net_liability_paise"],
];
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

export function GstReport() {
  const [from, setFrom] = useState(first);
  const [through, setThrough] = useState(today);
  const [kind, setKind] = useState("output_decrease"),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["gst-report", from, through],
    queryFn: async () => {
      const { data, error } = await rpc("owner_gst_report", {
        p_from: from,
        p_through: through,
        p_category: null,
        p_location: null,
      });
      if (error) throw error;
      return data as GstReportData;
    },
  });
  const adjustment = useMutation({
    mutationFn: async () => {
      const paise = Math.round(Number(amount) * 100);
      if (!Number.isSafeInteger(paise) || paise <= 0 || !reference.trim() || !reason.trim())
        throw new Error("Enter a positive amount, reference and reason");
      const { error } = await rpc("owner_record_gst_adjustment", {
        p_request: crypto.randomUUID(),
        p_kind: kind,
        p_amount_paise: paise,
        p_effective_date: today(),
        p_reference: reference.trim(),
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAmount("");
      setReference("");
      setReason("");
      void query.refetch();
      toast.success("GST adjustment recorded");
    },
    onError: (e) => toast.error(e.message),
  });
  const s = query.data?.summary;
  return (
    <div className="space-y-4">
      <Panel
        title="GST reports & reconciliation"
        description="Owner-only output tax, purchase GST, ITC and immutable invoice snapshots. Figures are operational estimates for CA review."
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            aria-label="GST report from"
            type="date"
            className="w-auto"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            aria-label="GST report through"
            type="date"
            className="w-auto"
            value={through}
            onChange={(e) => setThrough(e.target.value)}
          />
          <Button variant="outline" onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </div>
        <QueryState
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {s && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map(([label, key]) => (
              <div key={key} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <strong>{reportMoney(s[key] ?? "0")}</strong>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {!!query.data?.by_rate.length && (
        <Panel title="Classification and rate summary">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Category</th>
                  <th>HSN/SAC</th>
                  <th>Rate</th>
                  <th>Taxable</th>
                  <th>GST</th>
                  <th>Documents</th>
                </tr>
              </thead>
              <tbody>
                {query.data.by_rate.map((r, i) => (
                  <tr key={`${r.category}-${r.classification_code}-${i}`} className="border-b">
                    <td className="p-2">{r.category}</td>
                    <td>{r.classification_code}</td>
                    <td>{r.rate_bps / 100}%</td>
                    <td>{reportMoney(r.taxable_paise)}</td>
                    <td>{reportMoney(r.gst_paise)}</td>
                    <td>{r.documents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Panel
        title="Purchase reconciliation"
        description="Calculated amounts come from base CP and the active purchase rule; actual amounts come from the supplier invoice."
      >
        {query.data?.purchases.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Supplier</th>
                  <th>Invoice</th>
                  <th>ITC</th>
                  <th>Saved purchase mode</th>
                  <th>Cost adjustment</th>
                  <th>Calculated GST</th>
                  <th>Actual GST</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {query.data.purchases.map((p) => (
                  <tr key={p.batch_id} className="border-b">
                    <td className="p-2">{p.supplier}</td>
                    <td>{p.invoice_number ?? "—"}</td>
                    <td>{p.itc_status}</td>
                    <td>
                      {p.purchase_mode === "include_noncreditable"
                        ? "Non-creditable cost"
                        : p.purchase_mode === "track_itc"
                          ? "Separate GST / ITC"
                          : "—"}
                    </td>
                    <td>
                      {p.inventory_cost_adjustment_paise != null
                        ? reportMoney(p.inventory_cost_adjustment_paise)
                        : "—"}
                    </td>
                    <td>{reportMoney(p.calculated_gst_paise)}</td>
                    <td>{p.actual_gst_paise ? reportMoney(p.actual_gst_paise) : "—"}</td>
                    <td>{p.difference_paise ? reportMoney(p.difference_paise) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No GST purchase documents in this period.</p>
        )}
      </Panel>
      <Panel
        title="Manual GST adjustment"
        description="Use only for CA-approved credit/debit notes, ITC reversals or reclaims. Entries are append-only and audited."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            aria-label="GST adjustment type"
            className="h-11 rounded border bg-background p-2"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="output_increase">Output increase</option>
            <option value="output_decrease">Output decrease</option>
            <option value="itc_reversal">ITC reversal</option>
            <option value="itc_reclaim">ITC reclaim</option>
          </select>
          <Input
            inputMode="decimal"
            placeholder="Amount ₹"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            placeholder="Document reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button
          className="mt-3"
          disabled={adjustment.isPending}
          onClick={() => adjustment.mutate()}
        >
          Record adjustment
        </Button>
      </Panel>
    </div>
  );
}
