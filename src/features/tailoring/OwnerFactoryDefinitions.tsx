import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel, StatCard, StatusBadge } from "@/shared/components/page";
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
type MasterAssignment = {
  id: string;
  tailor_id: string;
  factory_id: string;
  valid_until: string | null;
};
type StaffAssignment = {
  id: string;
  staff_profile_id: string;
  tailor_id: string;
  factory_id: string;
  valid_from: string;
  valid_until: string | null;
};
type Hierarchy = { factories: Factory[]; tailors: Tailor[]; assignments: MasterAssignment[] };
type User = { id: string; name: string; roles: string[] | null };
type Action = { kind: "entity"; args: Entity } | { kind: "assignment"; args: Assign };
const empty = { id: "", code: "", name: "", active: true };
const selectClass =
  "min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary";

export function OwnerFactoryDefinitions() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [showFactoryForm, setShowFactoryForm] = useState(false);
  const [factory, setFactory] = useState("");
  const [user, setUser] = useState("");
  const [staffUser, setStaffUser] = useState("");
  const [staffMaster, setStaffMaster] = useState("");
  const [create, setCreate] = useState(false);
  const [createRole, setCreateRole] = useState("tailor");
  const [pending, setPending] = useState<Action | null>(null);

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
      return data as unknown as User[];
    },
  });
  const staffAssignments = useQuery({
    queryKey: ["tailor-staff-assignments"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tailor_staff_assignments")
        .select("id,staff_profile_id,tailor_id,factory_id,valid_from,valid_until")
        .is("valid_until", null)
        .order("valid_from");
      if (error) throw error;
      return data as StaffAssignment[];
    },
  });
  const refresh = () => {
    for (const key of [
      "tailoring-hierarchy",
      "factory-users",
      "tailor-staff-assignments",
      "active-tailors",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
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
      setShowFactoryForm(false);
      setUser("");
      setFactory("");
      refresh();
      toast.success("Factory hierarchy saved");
    },
    onError: (error) => {
      if (definiteDatabaseRejection(error)) setPending(null);
      toast.error(error.message);
    },
  });
  const assignStaff = useMutation({
    mutationFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: Error | null }>;
      const { error } = await rpc("owner_assign_tailor_staff", {
        p_staff: staffUser,
        p_tailor: staffMaster,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setStaffUser("");
      setStaffMaster("");
      refresh();
      toast.success("Tailor Staff assigned to the selected Master Tailor");
    },
    onError: (error) => toast.error(error.message),
  });

  if (!isOwner) return <p>Owner access required.</p>;
  const data = hierarchy.data;
  const people = users.data ?? [];
  const activeFactories = data?.factories.filter((item) => item.active) ?? [];
  const activeTailors = data?.tailors.filter((item) => item.active) ?? [];
  const currentMasters = data?.assignments.filter((item) => !item.valid_until) ?? [];
  const currentStaff = staffAssignments.data ?? [];
  const loading = hierarchy.isPending || users.isPending || staffAssignments.isPending;
  const error = hierarchy.error || users.error || staffAssignments.error;
  const profileName = (id: string | null) => people.find((item) => item.id === id)?.name ?? "—";
  const factoryFor = (id: string) => data?.factories.find((item) => item.id === id);
  const tailorFor = (id: string) => data?.tailors.find((item) => item.id === id);
  const assignMaster = () => {
    const tailor = data?.tailors.find((item) => item.profile_id === user);
    const current = currentMasters.find((item) => item.tailor_id === tailor?.id);
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
  const saveFactory = () =>
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
    });

  return (
    <div className="space-y-4">
      <QueryState
        loading={loading}
        error={error}
        retry={() => {
          void hierarchy.refetch();
          void users.refetch();
          void staffAssignments.refetch();
        }}
      />
      {!loading && !error && data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active Factories" value={activeFactories.length} icon={Building2} />
            <StatCard label="Master Tailors" value={activeTailors.length} />
            <StatCard
              label="Tailor Staff"
              value={people.filter((item) => item.roles?.includes("tailor_staff")).length}
              icon={Users}
            />
            <StatCard
              label="Active Assignments"
              value={currentMasters.length + currentStaff.length}
            />
          </div>

          <Panel
            title="Factories"
            description="Factory locations where tailoring work is handled."
            actions={
              <Button
                onClick={() => {
                  setForm(empty);
                  setShowFactoryForm((current) => !current);
                }}
              >
                <Plus className="size-4" /> Add Factory
              </Button>
            }
          >
            {showFactoryForm ? (
              <fieldset
                disabled={save.isPending || !!pending}
                className="mb-4 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <Input
                  aria-label="Factory code"
                  placeholder="Factory code"
                  disabled={!!form.id}
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
                <Input
                  aria-label="Factory name"
                  placeholder="Factory name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(event) => setForm({ ...form, active: event.target.checked })}
                    />
                    Active
                  </label>
                  <Button disabled={!form.code.trim() || !form.name.trim()} onClick={saveFactory}>
                    Save
                  </Button>
                  <Button variant="outline" onClick={() => setShowFactoryForm(false)}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {data.factories.map((item) => {
                const masters = currentMasters.filter((row) => row.factory_id === item.id);
                const staff = currentStaff.filter((row) => row.factory_id === item.id);
                return (
                  <article
                    key={item.id}
                    className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                      <Building2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{item.code}</strong>
                        <StatusBadge
                          status={item.active ? "active" : "archived"}
                          label={item.active ? "Active" : "Inactive"}
                        />
                      </div>
                      <p className="font-medium">{item.name}</p>
                    </div>
                    <div className="grid min-w-36 gap-1 border-l pl-4 text-xs text-muted-foreground">
                      <span>
                        {masters.length} Master Tailor{masters.length === 1 ? "" : "s"}
                      </span>
                      <span>{staff.length} Staff</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setForm(item);
                        setShowFactoryForm(true);
                      }}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                  </article>
                );
              })}
              {!data.factories.length ? (
                <p className="text-sm text-muted-foreground">No factories have been added.</p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Master Tailor assignments"
            description="Assign each Master Tailor to one factory. Reassignment affects future work only."
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setCreateRole("tailor");
                  setCreate(true);
                }}
              >
                <UserPlus className="size-4" /> Create Master Tailor login
              </Button>
            }
          >
            <fieldset
              disabled={save.isPending || !!pending}
              className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]"
            >
              <select
                className={selectClass}
                value={user}
                onChange={(e) => setUser(e.target.value)}
              >
                <option value="">Select user for Master Tailor</option>
                {people.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={factory}
                onChange={(e) => setFactory(e.target.value)}
              >
                <option value="">Assign to factory</option>
                {activeFactories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
              <Button disabled={!user || !factory} onClick={assignMaster}>
                Assign Master Tailor
              </Button>
            </fieldset>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">#</th>
                    <th>Master Tailor</th>
                    <th>User Login</th>
                    <th>Factory</th>
                    <th>Staff Count</th>
                    <th>Status</th>
                    <th className="pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {currentMasters.map((row, index) => {
                    const tailor = tailorFor(row.tailor_id);
                    const itemFactory = factoryFor(row.factory_id);
                    return (
                      <tr key={row.id}>
                        <td className="p-3 text-muted-foreground">{index + 1}</td>
                        <td className="font-medium">{tailor?.real_name ?? "—"}</td>
                        <td>{profileName(tailor?.profile_id ?? null)}</td>
                        <td>{itemFactory ? `${itemFactory.code} · ${itemFactory.name}` : "—"}</td>
                        <td>
                          {currentStaff.filter((staff) => staff.tailor_id === row.tailor_id).length}
                        </td>
                        <td>
                          <StatusBadge
                            status={tailor?.active ? "active" : "archived"}
                            label={tailor?.active ? "Active" : "Inactive"}
                          />
                        </td>
                        <td className="pr-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setUser(tailor?.profile_id ?? "");
                              setFactory(row.factory_id);
                            }}
                          >
                            <Pencil className="size-3.5" /> Reassign
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Tailor Staff assignments"
            description="Each staff member belongs to one Master Tailor and automatically inherits that tailor’s factory."
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setCreateRole("tailor_staff");
                  setCreate(true);
                }}
              >
                <UserPlus className="size-4" /> Create Tailor Staff login
              </Button>
            }
          >
            <fieldset
              disabled={assignStaff.isPending}
              className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]"
            >
              <select
                className={selectClass}
                value={staffUser}
                onChange={(e) => setStaffUser(e.target.value)}
              >
                <option value="">Select Tailor Staff login</option>
                {people
                  .filter((item) => item.roles?.includes("tailor_staff"))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <select
                className={selectClass}
                value={staffMaster}
                onChange={(e) => setStaffMaster(e.target.value)}
              >
                <option value="">Select Master Tailor</option>
                {activeTailors
                  .filter((item) => currentMasters.some((row) => row.tailor_id === item.id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.real_name}
                    </option>
                  ))}
              </select>
              <Button disabled={!staffUser || !staffMaster} onClick={() => assignStaff.mutate()}>
                Assign Staff
              </Button>
            </fieldset>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">#</th>
                    <th>Staff member</th>
                    <th>User Login</th>
                    <th>Master Tailor</th>
                    <th>Factory</th>
                    <th>Status</th>
                    <th className="pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {currentStaff.map((row, index) => {
                    const tailor = tailorFor(row.tailor_id);
                    const itemFactory = factoryFor(row.factory_id);
                    return (
                      <tr key={row.id}>
                        <td className="p-3 text-muted-foreground">{index + 1}</td>
                        <td className="font-medium">{profileName(row.staff_profile_id)}</td>
                        <td>{profileName(row.staff_profile_id)}</td>
                        <td>{tailor?.real_name ?? "—"}</td>
                        <td>{itemFactory ? `${itemFactory.code} · ${itemFactory.name}` : "—"}</td>
                        <td>
                          <StatusBadge status="active" label="Active" />
                        </td>
                        <td className="pr-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setStaffUser(row.staff_profile_id);
                              setStaffMaster(row.tailor_id);
                            }}
                          >
                            <Pencil className="size-3.5" /> Reassign
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
      {pending && !save.isPending ? (
        <Button onClick={() => save.mutate(pending)}>Retry unchanged definition</Button>
      ) : null}
      {create ? (
        <CreateStaff
          initialRole={createRole}
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            if (createRole === "tailor_staff") setStaffUser(id);
            else setUser(id);
            setCreate(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
