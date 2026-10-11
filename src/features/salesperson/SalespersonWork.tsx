import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/shared/utils/format";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { useSalespeople } from "./use-salespeople";

type Work = {
  id: string;
  code: string;
  kind: string;
  created_at: string;
  created_by: string;
  salesperson_user_id: string;
  salesperson_name: string;
  source_name: string;
  customer_snapshot: { name: string | null };
  final_customer_price_paise: string;
  fabric_mm: string | null;
  job_id: string | null;
  job_code: string | null;
  job_status: string | null;
  garment: string | null;
  factory_name: string | null;
  section_name: string | null;
  tailor_name: string | null;
  fabrics: { barcode: string; fabric: string; batch: string; quantity_mm: string }[];
};
type Cursor = { after: string; id: string } | undefined;
export function SalespersonWork() {
  const { isOwner, userId, can } = useSession();
  const [salesperson, setSalesperson] = useState("");
  const people = useSalespeople();
  const work = useInfiniteQuery({
    queryKey: ["salesperson-work", userId, salesperson],
    enabled: isOwner || can("salesperson.view_work"),
    initialPageParam: undefined as Cursor,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("salesperson_work", {
        ...(salesperson ? { p_salesperson: salesperson } : {}),
        ...(pageParam ? { p_after: pageParam.after, p_after_id: pageParam.id } : {}),
        p_limit: 50,
      });
      if (error) throw error;
      return data as unknown as Work[];
    },
    getNextPageParam: (last) => {
      const end = last.at(-1);
      return last.length === 50 && end ? { after: end.created_at, id: end.id } : undefined;
    },
  });
  const rows = work.data?.pages.flat() ?? [];
  return (
    <Panel
      title={isOwner ? "Salesperson work" : "My Work"}
      description="Attributed bills, fabric quantities and linked stitching progress. The POS operator and credited Salesperson are recorded separately."
    >
      {isOwner && (
        <select
          aria-label="Filter Salesperson"
          className="mb-3 w-full rounded border bg-background p-2"
          value={salesperson}
          onChange={(e) => setSalesperson(e.target.value)}
        >
          <option value="">All Salespeople</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.id}
            </option>
          ))}
        </select>
      )}
      <Button variant="outline" onClick={() => void work.refetch()}>
        Refresh work
      </Button>
      {work.error ? (
        <p role="alert">Work could not load. Check access or retry.</p>
      ) : work.isPending ? (
        <p>Loading work…</p>
      ) : !rows.length ? (
        <p>No attributed work yet.</p>
      ) : (
        rows.map((row) => (
          <article key={row.id} className="space-y-1 border-b py-4 text-sm">
            <p className="break-all font-semibold">
              {row.code} · {row.kind.replaceAll("_", " ")}
            </p>
            <p>
              {row.customer_snapshot?.name || "Walk-in customer"} · {row.source_name} ·{" "}
              {formatDateTime(row.created_at)}
            </p>
            <p>
              {reportMoney(row.final_customer_price_paise)}
              {row.fabric_mm !== null ? ` · ${reportQuantity(row.fabric_mm, "mm")}` : ""}
            </p>
            <p className="break-all">
              Salesperson: {row.salesperson_name} · {row.salesperson_user_id}
            </p>
            <p className="break-all text-xs">POS operator: {row.created_by}</p>
            {row.fabrics.map((f, index) => (
              <p key={`${f.barcode}-${index}`} className="break-all">
                {f.fabric} / {f.batch} · {f.barcode} · {reportQuantity(f.quantity_mm, "mm")}
              </p>
            ))}
            {row.job_id && (
              <p className="break-all">
                {row.job_code} · {row.garment} · {row.job_status} · {row.factory_name} →{" "}
                {row.section_name || "No Section"} → {row.tailor_name}
              </p>
            )}
          </article>
        ))
      )}
      {work.hasNextPage && (
        <Button disabled={work.isFetchingNextPage} onClick={() => void work.fetchNextPage()}>
          Load more work
        </Button>
      )}
    </Panel>
  );
}
