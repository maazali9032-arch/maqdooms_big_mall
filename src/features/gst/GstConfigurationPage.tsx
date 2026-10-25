import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Panel, StatusBadge } from "@/shared/components/page";
import { gstLocalDateTime } from "./configuration-time";
import { gstReadWithDeadline, readOwnerGstConfiguration } from "./configuration-reader";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useGstConfiguration, type GstConfiguration } from "./tax";
import { GarmentGstSlabs } from "./GarmentGstSlabs";

type Draft = Omit<GstConfiguration, "id">;

const blankConfig = (): Draft => ({
  enabled: false,
  effective_from: gstLocalDateTime(new Date()),
  legal_name: "",
  trading_name: "MAQDOOM’S Big Mall",
  address: "",
  contact: "",
  gstin: "",
  state_code: "",
  price_mode: "inclusive",
  invoice_display: "final_first",
  tailoring_display: "separate",
  purchase_mode: "track_itc",
});

const fixedRules = [
  { category: "purchase", classification_code: "5208" },
  { category: "fabric_sale", classification_code: "5208" },
  { category: "finished_sale", classification_code: "6203" },
  { category: "tailoring", classification_code: "9988" },
] as const;

export function GstConfigurationPage() {
  const { isOwner } = useSession();
  const query = useGstConfiguration(true);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(blankConfig);
  const [effectiveDateEdited, setEffectiveDateEdited] = useState(false);

  useEffect(() => {
    if (!query.data?.configuration) return;
    const { id: _id, ...configuration } = query.data.configuration;
    void _id;
    setDraft({
      ...configuration,
      price_mode: "inclusive",
      effective_from: gstLocalDateTime(
        new Date(Math.max(Date.now(), Date.parse(configuration.effective_from))),
      ),
    });
    setEffectiveDateEdited(false);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft.legal_name.trim() || !draft.address.trim() || !draft.contact.trim())
        throw new Error("Enter the legal business name, address and contact details");
      if (!/^\d{2}$/.test(draft.state_code)) throw new Error("Enter the two-digit GST state code");
      if (draft.enabled && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(draft.gstin))
        throw new Error("Enter a valid GSTIN before activating GST");
      const normalized = fixedRules.map((rule) => ({
        ...rule,
        item_ref: null,
        label: null,
        rate_bps: 500,
      }));
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: Error | null }>;
      const { data, error } = await rpc("owner_save_gst_configuration", {
        p_request: crypto.randomUUID(),
        p_configuration: {
          ...draft,
          price_mode: "inclusive",
          invoice_display: "final_first",
          tailoring_display: "combined",
          purchase_mode: "track_itc",
          effective_from:
            !effectiveDateEdited && new Date(draft.effective_from).getTime() <= Date.now()
              ? new Date().toISOString()
              : new Date(draft.effective_from).toISOString(),
          legal_name: draft.legal_name.trim(),
          trading_name: draft.trading_name.trim(),
          address: draft.address.trim(),
          contact: draft.contact.trim(),
          gstin: draft.gstin.trim().toUpperCase(),
        },
        p_rules: normalized,
      });
      if (error) throw error;
      const persisted = await gstReadWithDeadline((signal) =>
        readOwnerGstConfiguration(supabase as unknown as SupabaseClient, signal),
      );
      if (persisted.configuration?.id !== data)
        throw new Error(
          "GST version was saved, but a newer version is now present. Reload before editing again.",
        );
      return persisted;
    },
    onSuccess: (persisted) => {
      queryClient.setQueryData(["gst-owner-configuration"], persisted);
      void queryClient.invalidateQueries({ queryKey: ["gst-transaction-configuration"] });
      toast.success("GST configuration version saved");
    },
    onError: (error) => toast.error(error.message),
  });

  if (!isOwner) return <p>Owner access is required.</p>;
  if (query.isPending) return <p>Loading GST configuration…</p>;
  if (query.error)
    return (
      <p role="alert">
        Could not load GST configuration. {query.error.message}{" "}
        <button className="underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );

  return (
    <div className="space-y-4">
      <GarmentGstSlabs />
      <Panel
        title="Activation and effective date"
        description="Saving creates a new immutable version. Changes apply from save time unless you choose a different effective date. Scheduled future versions retain their date."
        actions={
          <StatusBadge
            status={draft.enabled ? "active" : "draft"}
            label={draft.enabled ? "Active" : "Draft / disabled"}
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Effective from
            <Input
              type="datetime-local"
              value={draft.effective_from}
              onChange={(event) => {
                setEffectiveDateEdited(true);
                setDraft({ ...draft, effective_from: event.target.value });
              }}
            />
          </label>
          <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            Activate this version for new transactions
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Activation affects only transactions at or after the effective date. Historical invoice
          snapshots never change.
        </p>
      </Panel>

      <Panel title="Business invoice identity" description="Printed on the GST thermal invoice.">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["legal_name", "Legal business name"],
              ["trading_name", "Trading name"],
              ["contact", "Business contact"],
              ["gstin", "GSTIN"],
              ["state_code", "Business state code"],
            ] as const
          ).map(([field, label]) => (
            <label className="text-sm" key={field}>
              {label}
              <Input
                value={draft[field]}
                maxLength={field === "state_code" ? 2 : undefined}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
            </label>
          ))}
          <label className="text-sm sm:col-span-2">
            Business address
            <Input
              value={draft.address}
              onChange={(event) => setDraft({ ...draft, address: event.target.value })}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Fixed GST workflow">
        <p className="text-sm text-muted-foreground">
          Selling prices are GST-inclusive, fabric is fixed at 5%, customer tailoring is one
          combined garment line, and purchase GST is tracked separately for ITC. The garment slab
          above is the only rate setting: up to and including ₹2,500 uses its lower rate; above it
          uses its higher rate.
        </p>
      </Panel>

      <div className="sticky bottom-3 flex justify-end rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving GST version…" : "Save new GST configuration version"}
        </Button>
      </div>
    </div>
  );
}
