import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  ShoppingCart,
  Shirt,
  Scissors,
  BarChart3,
  Wallet,
  Factory,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react";
import { reportMoney } from "./report-value";
import { title } from "./evidence-model";
export const reportIcons: Record<string, LucideIcon> = {
  "Sales & Payments": Wallet,
  "Stock & Inventory": Boxes,
  "Production & Costs": Factory,
  "Orders & Tailoring": Scissors,
  "Finished Products": Shirt,
  "Transfers & Locations": ArrowLeftRight,
  "Audit & Reconciliation": ShieldCheck,
};
export function OwnerKpi({
  label,
  value,
  hint,
  index = 0,
}: {
  label: string;
  value: string;
  hint: string;
  index?: number;
}) {
  const Icon = [ShoppingCart, Boxes, Shirt, Scissors][index % 4]!;
  return (
    <div className={`owner-kpi owner-kpi-${index % 4}`}>
      <span className="owner-kpi-icon">
        <Icon size={23} strokeWidth={1.7} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="numeric mt-1 break-words text-xl font-semibold tracking-tight">{value}</p>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
export function ColumnChart({
  values,
  money = false,
}: {
  values: { name: string; value: bigint }[];
  money?: boolean;
}) {
  const id = useId();
  const max = values.reduce((m, v) => (v.value > m ? v.value : m), 0n);
  const divisor = max > 0n ? max : 1n;
  if (!values.length)
    return (
      <div className="owner-chart-empty">
        <BarChart3 className="size-9 text-primary/35" />
        <p>No matching recorded activity.</p>
      </div>
    );
  const width = 600,
    plot = 540,
    step = plot / values.length;
  return (
    <figure
      className="space-y-3"
      aria-label={money ? "Recorded sales amount chart" : "Recorded bill count chart"}
    >
      <p className="text-xs text-muted-foreground">
        Highest {money ? "amount" : "count"}:{" "}
        <strong className="text-foreground">
          {money ? reportMoney(max.toString()) : max.toString()}
        </strong>
      </p>
      <svg viewBox={`0 0 ${width} 220`} className="w-full" role="img" aria-labelledby={id}>
        <title id={id}>Recorded activity; exact values available in each column tooltip</title>
        {[0, 1, 2, 3].map((n) => (
          <line
            key={n}
            x1={30}
            x2={580}
            y1={20 + n * 50}
            y2={20 + n * 50}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="3 5"
          />
        ))}
        {values.map((v, i) => {
          const h = Math.max(0, Number((v.value * 15000n) / divisor) / 100),
            x = 35 + i * step;
          return (
            <g key={v.name}>
              <title>
                {title(v.name)}: {money ? reportMoney(v.value.toString()) : v.value.toString()}
              </title>
              <rect
                x={x + step * 0.18}
                y={170 - h}
                width={Math.max(2, step * 0.64)}
                height={h}
                rx={4}
                fill={i % 2 ? "#987238" : "#173447"}
              />
              <text
                x={x + step / 2}
                y={194}
                textAnchor="middle"
                fontSize={values.length > 10 ? 9 : 11}
                fill="currentColor"
                className="text-muted-foreground"
              >
                {v.name.replaceAll("_", " ").length > 18
                  ? v.name.replaceAll("_", " ").slice(0, 17) + "…"
                  : v.name.replaceAll("_", " ")}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sr-only">
        {values.map((v) => (
          <li key={v.name}>
            {title(v.name)}: {money ? reportMoney(v.value.toString()) : v.value.toString()}
          </li>
        ))}
      </ul>
    </figure>
  );
}
export function DonutChart({ values }: { values: { name: string; value: bigint }[] }) {
  const total = values.reduce((s, v) => s + v.value, 0n),
    colors = ["#173447", "#987238", "#589d8d", "#cc8582", "#7c78a9"];
  if (total <= 0n)
    return (
      <div className="owner-chart-empty">
        <ShoppingCart className="size-9 text-primary/35" />
        <p>No positive collected amount in this period.</p>
      </div>
    );
  let offset = 0;
  return (
    <figure
      aria-label="Recorded sales proportions"
      className="flex flex-wrap items-center justify-center gap-5 py-3"
    >
      <svg viewBox="0 0 180 180" className="size-40 shrink-0" aria-hidden="true">
        <circle
          cx="90"
          cy="90"
          r="67"
          fill="none"
          stroke="currentColor"
          className="text-muted"
          strokeWidth="26"
        />
        {values.map((v, i) => {
          const share = Number((v.value * 100000n) / total) / 1000,
            start = offset;
          offset += share;
          return (
            <circle
              key={v.name}
              cx="90"
              cy="90"
              r="67"
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="26"
              pathLength="100"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
              transform="rotate(-90 90 90)"
            />
          );
        })}
        <text x="90" y="88" textAnchor="middle" fontSize="13" fill="currentColor">
          Paid sales
        </text>
        <text x="90" y="108" textAnchor="middle" fontSize="11" fill="currentColor">
          {values.length} sale types
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-4">
        {values.map((v, i) => (
          <li key={v.name} className="flex items-start gap-2 text-xs">
            <span
              className="mt-1 size-2.5 shrink-0 rounded"
              style={{ background: colors[i % colors.length] }}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{title(v.name)}</p>
              <p className="mt-1 text-muted-foreground">{reportMoney(v.value.toString())}</p>
            </div>
            <strong>{(Number((v.value * 1000n + total / 2n) / total) / 10).toFixed(1)}%</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}
