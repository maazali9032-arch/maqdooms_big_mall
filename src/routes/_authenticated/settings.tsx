import { createFileRoute } from "@tanstack/react-router";
import { useSession, ROLE_LABELS } from "@/app/providers/session";
import { PageHeader, Panel, DemoNotice } from "@/shared/components/page";
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
        <Panel title="Unit &amp; money system">
          <p className="text-sm text-muted-foreground">
            Lengths are stored as integer millimetres and displayed in metres; money is stored as
            integer paise. Yards are not an active business unit.
          </p>
        </Panel>
      )}

      {isOwner && (
        <Panel title="Integrations">
          <DemoNotice>
            WhatsApp automation, payment gateways and the public storefront are deliberately not
            connected. The storefront will be a separate application reading a controlled set of
            Showroom-only storefront API from this same database. POS sales update its stock
            availability.
          </DemoNotice>
        </Panel>
      )}
    </>
  );
}
