import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRecentSales } from "@/features/pos";
import { PageHeader, Panel, DemoNotice, EmptyState } from "@/shared/components/page";
import { formatMetres, formatMoney } from "@/shared/utils/units";
import { useSession } from "@/app/providers/session";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Message templates and receipt previews. No provider is connected.",
      },
      { property: "og:title", content: "WhatsApp — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Message templates and receipt previews." },
    ],
  }),
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const { can } = useSession();
  const templates = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_templates").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const sales = useRecentSales(1, can("pos.sell"));
  const latest = (sales.data ?? [])[0];
  const items = (latest?.sale_items ?? []) as {
    length_mm: number;
    amount_paise: number;
    thaans: { barcode: string } | null;
  }[];

  return (
    <>
      <PageHeader title="WhatsApp" description="Templates, triggers and message log foundations." />

      <DemoNotice>
        No WhatsApp provider is configured, so nothing is sent. This screen shows exactly what a
        customer would receive once credentials are added.
      </DemoNotice>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Receipt preview"
          description={latest ? `Based on bill ${latest.bill_no}` : undefined}
        >
          {latest ? (
            <pre className="whitespace-pre-wrap rounded-md border border-border/70 bg-surface p-3 text-xs leading-relaxed">
              {`Assalamu alaikum ${(latest.customers as { name?: string } | null)?.name ?? "customer"}, thank you for shopping at Maqdoom's Big Mall.

Bill: ${latest.bill_no}
${items.map((i) => `${i.thaans?.barcode ?? "Item"} — ${formatMetres(i.length_mm)} — ${formatMoney(i.amount_paise)}`).join("\n")}

Total: ${formatMoney(latest.total_paise)}

We look forward to serving you again.`}
            </pre>
          ) : (
            <EmptyState
              title="No bills yet"
              description="Complete a sale at the counter to preview a receipt."
            />
          )}
        </Panel>

        <Panel title="Templates" bodyClassName="p-0">
          <div className="divide-y divide-border">
            {(templates.data ?? []).map((t) => (
              <div key={t.id} className="px-4 py-3">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="numeric text-[11px] text-muted-foreground">
                  trigger: {t.trigger_event}
                </p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {t.body}
                </pre>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
