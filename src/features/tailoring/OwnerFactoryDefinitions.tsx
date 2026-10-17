import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateStaff } from "@/features/access/CreateStaff";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import type { Database } from "@/integrations/supabase/types";
type Entity = Database["public"]["Functions"]["manage_tailoring_entity"]["Args"];
type Assign = Database["public"]["Functions"]["owner_assign_factory_user"]["Args"];
type Factory = { id: string; code: string; name: string; active: boolean };
type Tailor = {
  id: string;
  code: string;
  real_name: string;
  profile_id: string | null;
  active: boolean;
};
type Hierarchy = {
  factories: Factory[];
  tailors: Tailor[];
  assignments: { id: string; tailor_id: string; factory_id: string; valid_until: string | null }[];
};
type Action = { kind: "entity"; args: Entity } | { kind: "assignment"; args: Assign };
const empty = { id: "", code: "", name: "", active: true };
export function OwnerFactoryDefinitions() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState(empty),
    [factory, setFactory] = useState(""),
    [user, setUser] = useState(""),
    [create, setCreate] = useState(false),
    [pending, setPending] = useState<Action | null>(null);
  const hierarchy = useQuery({
    queryKey: ["tailoring-hierarchy"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_tailoring_hierarchy");
      if (error) throw error;
      return data as unknown as Hierarchy;
    },
  });
  const users = useQuery({
    queryKey: ["factory-users"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_factory_users");
      if (error) throw error;
      return data as unknown as { id: string; name: string; roles: string[] | null }[];
    },
  });
  const save = useMutation({
    mutationFn: async (action: Action) => {
      setPending(action);
      const { error } =
        action.kind === "entity"
          ? await supabase.rpc("manage_tailoring_entity", action.args)
          : await supabase.rpc("owner_assign_factory_user", action.args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setForm(empty);
      setUser("");
      void qc.invalidateQueries();
      toast.success("Factory definitions saved");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  if (!isOwner) return <p>Owner access required.</p>;
  const data = hierarchy.data;
  const assign = () => {
    const t = data?.tailors.find((t) => t.profile_id === user);
    const current = data?.assignments.find((a) => a.tailor_id === t?.id && !a.valid_until);
    save.mutate({
      kind: "assignment",
      args: {
        p_request: crypto.randomUUID(),
        p_user: user,
        p_factory: factory,
        ...(current ? { p_expected: current.id } : {}),
      },
    });
  };
  return (
    <Panel
      title="Factories & Tailors"
      description="Define factories and their staff here. Work forms use these same definitions."
    >
      <QueryState
        loading={hierarchy.isPending || users.isPending}
        error={hierarchy.error || users.error}
        retry={() => {
          void hierarchy.refetch();
          void users.refetch();
        }}
      />
      <fieldset disabled={!!pending || save.isPending} className="space-y-4">
        <div className="rounded-xl border p-3">
          <h3 className="mb-3 font-semibold">{form.id ? "Edit factory" : "Add factory"}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              aria-label="Factory code"
              placeholder="Factory code"
              disabled={!!form.id}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <Input
              aria-label="Factory name"
              placeholder="Factory name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <label className="my-3 flex gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active
          </label>
          <div className="flex gap-2">
            <Button
              disabled={!form.code.trim() || !form.name.trim()}
              onClick={() =>
                save.mutate({
                  kind: "entity",
                  args: {
                    p_request: crypto.randomUUID(),
                    p_kind: "factory",
                    p_id: form.id || null,
                    p_code: form.code.trim(),
                    p_name: form.name.trim(),
                    p_active: form.active,
                    p_reason: "Owner saved factory definition",
                  },
                })
              }
            >
              Save factory
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(empty)}>
                Cancel edit
              </Button>
            )}
          </div>
        </div>
        <div className="rounded-xl border p-3">
          <h3 className="font-semibold">Add / move a Tailor</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Choose an existing user or create a login. Saving grants the Tailor role and preserves
            other roles. Existing jobs retain their original assignment.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              aria-label="Factory for Tailor"
              className="min-h-11 min-w-0 rounded border bg-background p-2"
              value={factory}
              onChange={(e) => setFactory(e.target.value)}
            >
              <option value="">Choose factory</option>
              {data?.factories
                .filter((f) => f.active)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="Existing user for Tailor"
              className="min-h-11 min-w-0 rounded border bg-background p-2"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            >
              <option value="">Choose existing user</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!factory || !user} onClick={assign}>
              Save Tailor in factory
            </Button>
            <Button variant="outline" onClick={() => setCreate(true)}>
              Create staff login
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          {data?.factories.map((f) => (
            <details key={f.id} open className="rounded-xl border p-3">
              <summary className="cursor-pointer font-semibold">
                {f.name}{" "}
                <span className="text-xs font-normal">
                  {f.code} · {f.active ? "Active" : "Inactive"}
                </span>
              </summary>
              <div className="mt-3 ml-2 space-y-2 border-l pl-3">
                <Button size="sm" variant="outline" onClick={() => setForm(f)}>
                  Edit factory
                </Button>
                {data.tailors
                  .filter((t) =>
                    data.assignments.some(
                      (a) => a.factory_id === f.id && a.tailor_id === t.id && !a.valid_until,
                    ),
                  )
                  .map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                    >
                      <div>
                        <strong>{t.real_name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {t.profile_id ? "Linked staff account" : "No staff login linked"} ·{" "}
                          {t.active ? "Active" : "Inactive"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          save.mutate({
                            kind: "entity",
                            args: {
                              p_request: crypto.randomUUID(),
                              p_kind: "tailor",
                              p_id: t.id,
                              p_code: t.code,
                              p_name: t.real_name,
                              p_active: !t.active,
                              p_profile: t.profile_id || undefined,
                              p_reason: t.active
                                ? "Owner deactivated Tailor for future assignments"
                                : "Owner reactivated Tailor",
                            },
                          })
                        }
                      >
                        {t.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  ))}
                {!data.assignments.some((a) => a.factory_id === f.id && !a.valid_until) && (
                  <p className="text-sm">No Tailors assigned.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      </fieldset>
      {pending && !save.isPending && (
        <Button className="mt-3" onClick={() => save.mutate(pending)}>
          Retry unchanged definition
        </Button>
      )}
      {create && (
        <CreateStaff
          initialRole="tailor"
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            setUser(id);
            setCreate(false);
            void users.refetch();
          }}
        />
      )}
    </Panel>
  );
}
