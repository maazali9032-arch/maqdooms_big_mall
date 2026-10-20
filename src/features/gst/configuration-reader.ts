import type { SupabaseClient } from "@supabase/supabase-js";
import type { GstConfiguration, GstRule, GstTransactionConfiguration } from "./tax";

/** Owner SELECT policies already exist in the original GST migration. No new RPC is needed. */
export async function readOwnerGstConfiguration(
  client: Pick<SupabaseClient, "from">,
  signal: AbortSignal,
): Promise<GstTransactionConfiguration> {
  const configuration = await client
    .from("gst_configuration_versions")
    .select(
      "id,enabled,effective_from,legal_name,trading_name,address,contact,gstin,state_code,price_mode,invoice_display,tailoring_display,purchase_mode",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .abortSignal(signal)
    .maybeSingle();
  if (configuration.error) throw configuration.error;
  if (!configuration.data) return { configuration: null, rules: [] };
  const saved = configuration.data as unknown as GstConfiguration;
  const rules = await client
    .from("gst_tax_rules")
    .select("id,category,item_ref,label,classification_code,rate_bps")
    .eq("configuration_id", saved.id)
    .order("category")
    .abortSignal(signal);
  if (rules.error) throw rules.error;
  return { configuration: saved, rules: rules.data as unknown as GstRule[] };
}

/** Bound the whole read, including session acquisition before the HTTP request begins. */
export async function gstReadWithDeadline<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancelled = () => {
      controller.abort();
      reject(new Error("GST loading was cancelled. Please retry."));
    };
    if (signal?.aborted) return cancelled();
    signal?.addEventListener("abort", cancelled, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error("GST configuration took too long to load. Check your connection and retry."),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, Promise.resolve().then(() => read(controller.signal))]);
  } finally {
    clearTimeout(timer);
    if (cancelled) signal?.removeEventListener("abort", cancelled);
  }
}
