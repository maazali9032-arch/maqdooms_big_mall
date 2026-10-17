import { Panel, StatCard } from "@/shared/components/page";
import { reportQuantity } from "./report-value";

export type DailyBusiness = {
  revenue_paise: string;
  fabric_revenue_paise: string;
  product_revenue_paise: string;
  counter_paise: string;
  ecommerce_paise: string;
  tailoring_booked_paise: string;
  bills: number;
  batches_registered: number;
  thaans_registered: number;
  received_fabric_mm: string;
  transfers: number;
  production_issued: number;
  production_issued_mm: string;
  production_finished: number;
  finished_pieces_received: number;
  tailoring_jobs: number;
};
export function DailyOperations({ data, day }: { data: DailyBusiness; day: string }) {
  const link = (dataset: string) => `/reports?from=${day}&through=${day}#${dataset}`;
  const cards = [
    {
      label: "Stock entry",
      value: `${data.thaans_registered} Thaans`,
      hint: `${data.batches_registered} batches · ${reportQuantity(data.received_fabric_mm, "mm")} received`,
      href: link("movements"),
    },
    {
      label: "Stock transfers",
      value: data.transfers,
      hint: "Posted transfer documents",
      href: link("transfers"),
    },
    {
      label: "Production issued",
      value: data.production_issued,
      hint: `${reportQuantity(data.production_issued_mm, "mm")} issued, including additional fabric`,
      href: link("material_issues"),
    },
    {
      label: "Production finished",
      value: data.production_finished,
      hint: `${data.finished_pieces_received} pieces received at Workshop on this day`,
      href: link("production_history"),
    },
    {
      label: "Customer tailoring",
      value: data.tailoring_jobs,
      hint: "New customer jobs booked on this day",
      href: link("customer_tailoring"),
    },
  ];
  return (
    <Panel
      title="Selected-day operations"
      description={`${day} · India business day. Current inventory and ongoing work are shown separately below.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <a key={card.label} href={card.href}>
            <StatCard label={card.label} value={card.value} hint={card.hint} />
          </a>
        ))}
      </div>
    </Panel>
  );
}
