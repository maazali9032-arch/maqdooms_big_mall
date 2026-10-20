import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/shared/components/page";
import { CounterWorkspace } from "@/features/pos/CounterWorkspace";
export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "Counter / POS — Maqdoom's Big Mall ERP" }] }),
  component: PosPage,
});
function PosPage() {
  return (
    <>
      <PageHeader
        title="Counter / POS"
        description="Scan an item from any showroom floor to sell, or scan a customer bill, tailor work order or Production ID to issue extra fabric."
      />
      <CounterWorkspace />
    </>
  );
}
