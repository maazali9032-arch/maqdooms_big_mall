import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GstCategory = "purchase" | "fabric_sale" | "finished_sale" | "tailoring";
export type GstPriceMode = "inclusive" | "exclusive";
export type GstSupplyType = "intra_state" | "inter_state";

export type GstRule = {
  id?: string;
  category: GstCategory;
  item_ref?: string | null;
  label?: string | null;
  classification_code: string;
  rate_bps: number;
};

export type GstConfiguration = {
  id: string;
  enabled: boolean;
  effective_from: string;
  legal_name: string;
  trading_name: string;
  address: string;
  contact: string;
  gstin: string;
  state_code: string;
  price_mode: GstPriceMode;
  invoice_display: "final_first" | "taxable_first";
  tailoring_display: "separate" | "combined";
  purchase_mode: "track_itc" | "include_noncreditable";
};

export type GstTransactionConfiguration = {
  configuration: GstConfiguration | null;
  rules: GstRule[];
};

export type TaxBreakdown = {
  enteredPaise: bigint;
  taxablePaise: bigint;
  gstPaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  finalPaise: bigint;
  rateBps: number;
  mode: GstPriceMode;
  supplyType: GstSupplyType;
};

const roundDivide = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator / 2n) / denominator;

/**
 * Exact integer-paise preview of the authoritative PostgreSQL calculation.
 * Every screen imports this function; transaction RPCs recalculate and persist
 * the result server-side before accepting a completed invoice.
 */
export function calculateTaxPaise(
  enteredPaise: bigint,
  rateBps: number,
  mode: GstPriceMode,
  supplyType: GstSupplyType,
): TaxBreakdown {
  if (enteredPaise < 0n || !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000)
    throw new Error("Enter a valid nonnegative amount and GST rate");
  const rate = BigInt(rateBps);
  const taxablePaise =
    mode === "inclusive" ? roundDivide(enteredPaise * 10000n, 10000n + rate) : enteredPaise;
  const gstPaise =
    mode === "inclusive" ? enteredPaise - taxablePaise : roundDivide(taxablePaise * rate, 10000n);
  const finalPaise = mode === "inclusive" ? enteredPaise : taxablePaise + gstPaise;
  const cgstPaise = supplyType === "intra_state" ? roundDivide(gstPaise, 2n) : 0n;
  const sgstPaise = supplyType === "intra_state" ? gstPaise - cgstPaise : 0n;
  return {
    enteredPaise,
    taxablePaise,
    gstPaise,
    cgstPaise,
    sgstPaise,
    igstPaise: supplyType === "inter_state" ? gstPaise : 0n,
    finalPaise,
    rateBps,
    mode,
    supplyType,
  };
}

export function defaultGstRule(
  data: GstTransactionConfiguration | undefined,
  category: GstCategory,
) {
  return data?.rules.find((rule) => rule.category === category && !rule.item_ref) ?? null;
}

export function formatGstRate(rateBps: number) {
  return `${(rateBps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

export function percentToBps(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Use a GST rate from 0 to 100");
  const bps = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000)
    throw new Error("Use a GST rate from 0 to 100");
  return bps;
}

export function useGstConfiguration(ownerEditor = false) {
  return useQuery({
    queryKey: [ownerEditor ? "gst-owner-configuration" : "gst-transaction-configuration"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      ).call(
        supabase,
        ownerEditor ? "owner_gst_configuration" : "gst_transaction_configuration",
        {},
      );
      if (error) throw error;
      return data as GstTransactionConfiguration;
    },
  });
}
