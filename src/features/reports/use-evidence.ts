import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";

export type EvidenceRow = { key: string; event_at: string | null; data: Record<string, unknown> };
type Page = { rows: EvidenceRow[]; next_cursor: string | null; total_rows: string };
export function useEvidence(
  dataset: string,
  range: { p_from?: string; p_to?: string } = {},
  enabled = true,
) {
  const { isOwner } = useSession();
  return useQuery({
    queryKey: ["owner-evidence", dataset, range],
    enabled: isOwner && enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const rows: EvidenceRow[] = [],
        cursors = new Set<string>();
      let after: string | undefined;
      do {
        if (signal.aborted) throw new Error("Report request cancelled");
        const request = supabase.rpc("owner_erp_report", {
          p_dataset: dataset,
          p_limit: 200,
          ...range,
          ...(after ? { p_after: after } : {}),
        });
        const { data, error } = await request.abortSignal(signal);
        if (error) throw error;
        const page = data as unknown as Page;
        rows.push(...page.rows);
        after = page.next_cursor ?? undefined;
        if (after && cursors.has(after))
          throw new Error("Report pagination did not advance; retry.");
        if (after) cursors.add(after);
      } while (after);
      return rows;
    },
  });
}
