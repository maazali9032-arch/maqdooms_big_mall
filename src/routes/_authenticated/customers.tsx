import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateCustomer, useCustomers } from "@/features/customers";
import { PageHeader, Panel, EmptyState } from "@/shared/components/page";
import { formatMoney } from "@/shared/utils/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Maqdoom's Big Mall ERP" },
      { name: "description", content: "Customer profiles with purchase and tailoring history." },
      { property: "og:title", content: "Customers — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Customer profiles with purchase and tailoring history.",
      },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const customers = useCustomers();
  const create = useCreateCustomer();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <>
      <PageHeader
        title="Customers"
        description="Profiles, purchase history and tailoring references."
      />

      <Panel title="Add customer">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11"
          />
          <Input
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11"
          />
          <Button
            className="h-11 sm:w-32"
            onClick={async () => {
              if (!name.trim()) return;
              try {
                await create.mutateAsync({ name, phone, notes: "" });
                setName("");
                setPhone("");
                toast.success("Customer added");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not add customer");
              }
            }}
          >
            Add
          </Button>
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        {(customers.data ?? []).length === 0 ? (
          <EmptyState title="No customers yet" />
        ) : (
          <div className="divide-y divide-border">
            {(customers.data ?? []).map((c) => {
              const sales = (c.sales ?? []) as { id: string; total_paise: number }[];
              const jobs = (c.tailoring_jobs ?? []) as { id: string; code: string }[];
              const spend = sales.reduce((sum, s) => sum + s.total_paise, 0);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="numeric text-xs text-muted-foreground">{c.phone ?? "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="numeric text-sm">{formatMoney(spend)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {sales.length} bills · {jobs.length} tailoring jobs
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
