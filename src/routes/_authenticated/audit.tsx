import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAuditLog } from "@/features/audit";
import { PageHeader, Panel, EmptyState } from "@/shared/components/page";
import { formatDateTime } from "@/shared/utils/format";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Searchable record of every attributable action in the platform.",
      },
      { property: "og:title", content: "Audit Trail — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Searchable record of every attributable action." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const audit = useAuditLog();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = audit.data ?? [];
    if (!term) return all;
    return all.filter((a) =>
      [a.actor_name, a.action, a.entity, a.entity_ref, JSON.stringify(a.detail)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [audit.data, q]);

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Who did what, to which record, and when."
        actions={
          <Input
            placeholder="Search user, action, thaan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10 sm:w-72"
          />
        }
      />

      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState
            title="No audit entries visible"
            description="Audit access requires the audit.view permission."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-border bg-surface">
                <tr className="label-eyebrow">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Record</th>
                  <th className="hidden px-3 py-2 font-semibold md:table-cell">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </td>
                    <td className="px-3 py-2 text-sm">{a.actor_name ?? "System"}</td>
                    <td className="px-3 py-2 text-sm capitalize">{a.action.replace(/_/g, " ")}</td>
                    <td className="numeric px-3 py-2 text-xs">
                      {a.entity}: {a.entity_ref ?? "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">
                      {JSON.stringify(a.detail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
