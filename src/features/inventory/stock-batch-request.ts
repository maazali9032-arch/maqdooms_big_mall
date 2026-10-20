import type { SupabaseClient } from "@supabase/supabase-js";

type BatchInput = {
  provider: string;
  date: string;
  remarks: string | null;
  fabrics: unknown[];
  purchase?: Record<string, unknown> | null;
};

/** No invoice means the established receiving API, not an omitted required GST argument. */
export function createStockBatch(
  client: Pick<SupabaseClient, "rpc">,
  request: string,
  work: BatchInput,
) {
  const args = {
    p_request: request,
    p_provider: work.provider,
    p_arrival_date: work.date,
    p_remarks: work.remarks,
    p_fabrics: work.fabrics,
  };
  return work.purchase
    ? client.rpc("create_barcode_batch_with_gst", { ...args, p_purchase: work.purchase })
    : client.rpc("create_barcode_batch_with_details", args);
}
