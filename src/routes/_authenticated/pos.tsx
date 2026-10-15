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
        description="Choose your Showroom floor, then scan an item to sell or an existing bill / Production ID to issue extra fabric."
      />
      <CounterWorkspace />
    </>
  );
}
