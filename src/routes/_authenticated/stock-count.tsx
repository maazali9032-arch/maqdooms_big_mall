import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/shared/components/page";
import { StockCountWorkspace } from "@/features/inventory/StockCountWorkspace";
export const Route = createFileRoute("/_authenticated/stock-count")({
  component: () => (
    <>
      <PageHeader
        title="Stock Audit"
        description="Create, assign and monitor physical stock audits with owner-only missing-stock review."
      />
      <StockCountWorkspace />
    </>
  ),
});
