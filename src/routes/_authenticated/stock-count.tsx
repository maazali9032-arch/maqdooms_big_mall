import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/shared/components/page";
import { StockCountWorkspace } from "@/features/inventory/StockCountWorkspace";
export const Route = createFileRoute("/_authenticated/stock-count")({
  component: () => (
    <>
      <PageHeader
        title="Stock counts"
        description="Assigned barcode counts with owner-only missing-stock review."
      />
      <StockCountWorkspace />
    </>
  ),
});
