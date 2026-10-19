import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Panel, StatusBadge } from "@/shared/components/page";
import { gstLocalDateTime } from "./configuration-time";
import {
  formatGstRate,
  percentToBps,
  useGstConfiguration,
  type GstCategory,
  type GstConfiguration,
  type GstRule,
} from "./tax";

const labels: Record<GstCategory, string> = {
  purchase: "Stock purchases",
  fabric_sale: "Fabric sales",
  finished_sale: "Finished-product sales",
  tailoring: "Customer tailoring / services",
};

type DraftRule = GstRule & { key: string; rate: string };
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

const blankRules = (): DraftRule[] =>
  (Object.keys(labels) as GstCategory[]).map((category) => ({
    key: crypto.randomUUID(),
    category,
    classification_code: "",
    item_ref: null,
    label: null,
    rate_bps: 0,
    rate: "",
  }));

function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; title: string; detail: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={`cursor-pointer rounded-xl border p-3 text-sm ${value === option.value ? "border-primary bg-primary/5" : ""}`}
        >
          <span className="flex items-start gap-2">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong className="block">{option.title}</strong>
              <span className="text-xs text-muted-foreground">{option.detail}</span>
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function GstConfigurationPage() {
  const { isOwner } = useSession();
  const query = useGstConfiguration(true);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(blankConfig);
  const [rules, setRules] = useState<DraftRule[]>(blankRules);
  const [effectiveDateEdited, setEffectiveDateEdited] = useState(false);

  useEffect(() => {
    if (!query.data?.configuration) return;
    const { id: _id, ...configuration } = query.data.configuration;
    void _id;
    setDraft({
      ...configuration,
      effective_from: gstLocalDateTime(
        new Date(Math.max(Date.now(), Date.parse(configuration.effective_from))),
      ),
    });
    setEffectiveDateEdited(false);
    setRules(
      query.data.rules.map((rule) => ({
        ...rule,
        key: rule.id ?? crypto.randomUUID(),
        rate: String(rule.rate_bps / 100),
      })),
    );
  }, [query.data]);

  const defaults = useMemo(() => rules.filter((rule) => !rule.item_ref), [rules]);
  const overrides = useMemo(() => rules.filter((rule) => !!rule.item_ref), [rules]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft.legal_name.trim() || !draft.address.trim() || !draft.contact.trim())
        throw new Error("Enter the legal business name, address and contact details");
      if (!/^\d{2}$/.test(draft.state_code)) throw new Error("Enter the two-digit GST state code");
      if (draft.enabled && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(draft.gstin))
        throw new Error("Enter a valid GSTIN before activating GST");
      const normalized = rules.map((rule) => ({
        category: rule.category,
        item_ref: rule.item_ref || null,
        label: rule.label?.trim() || null,
        classification_code: rule.classification_code.trim().toUpperCase(),
        rate_bps: percentToBps(rule.rate),
      }));
      for (const category of Object.keys(labels) as GstCategory[])
        if (!normalized.some((rule) => rule.category === category && !rule.item_ref))
          throw new Error(`Add the default ${labels[category]} rule`);
      if (draft.enabled && normalized.some((rule) => !rule.classification_code))
        throw new Error("Every active tax rule requires an HSN/SAC classification");
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: Error | null }>;
      const { data, error } = await rpc("owner_save_gst_configuration", {
        p_request: crypto.randomUUID(),
        p_configuration: {
          ...draft,
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
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gst-transaction-configuration"] });
      await queryClient.invalidateQueries({ queryKey: ["gst-owner-configuration"] });
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

  const patchRule = (key: string, change: Partial<DraftRule>) =>
    setRules((current) =>
      current.map((rule) => (rule.key === key ? { ...rule, ...change } : rule)),
    );

  return (
    <div className="space-y-4">
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

      <Panel
        title="Default GST classifications"
        description="Base rules used unless a more specific active rule matches the product or service reference."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {defaults.map((rule) => (
            <div key={rule.key} className="rounded-xl border p-3">
              <strong className="text-sm">{labels[rule.category]}</strong>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs">
                  GST rate %
                  <Input
                    inputMode="decimal"
                    value={rule.rate}
                    onChange={(event) => patchRule(rule.key, { rate: event.target.value })}
                  />
                </label>
                <label className="text-xs">
                  HSN / SAC
                  <Input
                    value={rule.classification_code}
                    onChange={(event) =>
                      patchRule(rule.key, { classification_code: event.target.value })
                    }
                  />
                </label>
              </div>
              {rule.rate && /^\d+(?:\.\d{1,2})?$/.test(rule.rate) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Saved rate: {formatGstRate(percentToBps(rule.rate))}
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Classification-specific overrides"
        description="Use a stable product, fabric or service reference when its legal classification differs from the category default."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              setRules((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  category: "fabric_sale",
                  item_ref: "",
                  label: "",
                  classification_code: "",
                  rate_bps: 0,
                  rate: "",
                },
              ])
            }
          >
            <Plus className="size-4" /> Add override
          </Button>
        }
      >
        {!overrides.length ? (
          <p className="text-sm text-muted-foreground">No specific overrides configured.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((rule) => (
              <div
                key={rule.key}
                className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_1fr_8rem_auto]"
              >
                <select
                  aria-label="GST override category"
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                  value={rule.category}
                  onChange={(event) =>
                    patchRule(rule.key, { category: event.target.value as GstCategory })
                  }
                >
                  {(Object.keys(labels) as GstCategory[]).map((category) => (
                    <option key={category} value={category}>
                      {labels[category]}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Override label"
                  placeholder="Rule label"
                  value={rule.label ?? ""}
                  onChange={(event) => patchRule(rule.key, { label: event.target.value })}
                />
                <Input
                  aria-label="Product or service reference"
                  placeholder="Product/fabric/service ID"
                  value={rule.item_ref ?? ""}
                  onChange={(event) => patchRule(rule.key, { item_ref: event.target.value })}
                />
                <Input
                  aria-label="Override HSN or SAC"
                  placeholder="HSN/SAC"
                  value={rule.classification_code}
                  onChange={(event) =>
                    patchRule(rule.key, { classification_code: event.target.value })
                  }
                />
                <div className="flex gap-1">
                  <Input
                    aria-label="Override GST rate percent"
                    placeholder="%"
                    inputMode="decimal"
                    value={rule.rate}
                    onChange={(event) => patchRule(rule.key, { rate: event.target.value })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove GST override"
                    onClick={() =>
                      setRules((current) => current.filter((item) => item.key !== rule.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Calculation and display options">
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 font-semibold">POS selling-price mode</h3>
            <Choice
              name="price-mode"
              value={draft.price_mode}
              onChange={(price_mode) => setDraft({ ...draft, price_mode })}
              options={[
                {
                  value: "inclusive",
                  title: "A — GST-inclusive",
                  detail: "Entered SP is the final customer price; GST is extracted.",
                },
                {
                  value: "exclusive",
                  title: "B — GST-exclusive",
                  detail: "Entered SP is taxable value; GST is added.",
                },
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Customer invoice display</h3>
            <Choice
              name="invoice-display"
              value={draft.invoice_display}
              onChange={(invoice_display) => setDraft({ ...draft, invoice_display })}
              options={[
                {
                  value: "final_first",
                  title: "A — Final price first",
                  detail: "Prominent payable total followed by taxable value and GST.",
                },
                {
                  value: "taxable_first",
                  title: "B — Taxable value first",
                  detail: "Taxable value and GST lead to final payable total.",
                },
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Customer tailoring invoice</h3>
            <Choice
              name="tailoring-display"
              value={draft.tailoring_display}
              onChange={(tailoring_display) => setDraft({ ...draft, tailoring_display })}
              options={[
                {
                  value: "separate",
                  title: "A — Separate lines",
                  detail: "Fabric and stitching display separately with their own classifications.",
                },
                {
                  value: "combined",
                  title: "B — Combined presentation",
                  detail: "One customer-facing job line while tax components remain separate.",
                },
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Purchase GST and ITC</h3>
            <Choice
              name="purchase-mode"
              value={draft.purchase_mode}
              onChange={(purchase_mode) => setDraft({ ...draft, purchase_mode })}
              options={[
                {
                  value: "track_itc",
                  title: "A — Track GST and ITC separately",
                  detail: "Base value, purchase GST and ITC stay separate.",
                },
                {
                  value: "include_noncreditable",
                  title: "B — Track non-creditable cost",
                  detail:
                    "Non-creditable GST is reported as a cost adjustment without rewriting base CP.",
                },
              ]}
            />
          </div>
        </div>
      </Panel>

      <div className="sticky bottom-3 flex justify-end rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving GST version…" : "Save new GST configuration version"}
        </Button>
      </div>
    </div>
  );
}
