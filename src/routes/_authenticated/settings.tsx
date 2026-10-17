import { createFileRoute } from "@tanstack/react-router";
import { useSession, ROLE_LABELS } from "@/app/providers/session";
import { PageHeader, Panel } from "@/shared/components/page";
import { AccountSettings } from "@/features/access/AccountSettings";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Maqdoom's Big Mall ERP" },
      { name: "description", content: "Account, unit system and integration settings." },
      { property: "og:title", content: "Settings — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Account, unit system and integration settings." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { fullName, email, roles, isOwner } = useSession();

  return (
    <>
      <PageHeader
        title={isOwner ? "Settings" : "Account"}
        description="Your name, email and password settings."
      />

      <Panel title="Your account">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="label-eyebrow">Name</dt>
            <dd>{fullName}</dd>
          </div>
          <div>
            <dt className="label-eyebrow">Email</dt>
            <dd>{email ?? "—"}</dd>
          </div>
          <div>
            <dt className="label-eyebrow">Roles</dt>
            <dd>{roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "None assigned"}</dd>
          </div>
        </dl>
      </Panel>
      <AccountSettings />
      {isOwner && (
        <details className="panel px-4 py-3 text-sm sm:px-5">
          <summary className="cursor-pointer font-medium">System information</summary>
          <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <strong className="block text-foreground">Units and money</strong>
              Lengths display in metres and money displays in rupees. Exact millimetres and paise
              are retained internally for calculations.
            </p>
            <p>
              <strong className="block text-foreground">Connections</strong>
              WhatsApp automation, payment gateways and the public storefront are not connected yet.
            </p>
          </div>
        </details>
      )}
    </>
  );
}
