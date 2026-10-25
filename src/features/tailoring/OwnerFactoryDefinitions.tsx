import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  Scissors,
  UserPlus,
  Users,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatDateTime, initials } from "@/shared/utils/format";

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
  const [showInactive, setShowInactive] = useState(false);
  const [expandedFactories, setExpandedFactories] = useState<string[] | null>(null);
  const [expandedTailors, setExpandedTailors] = useState<string[] | null>(null);

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
  const inactiveFactories = data?.factories.filter((item) => !item.active) ?? [];
  const inactiveTailors = data?.tailors.filter((item) => !item.active) ?? [];
  const tailorStaffCount = people.filter((item) => item.roles?.includes("tailor_staff")).length;
  const activeTailorStaffCount = new Set(currentStaff.map((item) => item.staff_profile_id)).size;
  const visibleFactories = (data?.factories ?? []).filter((item) => showInactive || item.active);
  const openFactories = expandedFactories ?? (visibleFactories[0] ? [visibleFactories[0].id] : []);
  const openTailors = expandedTailors ?? (currentMasters[0] ? [currentMasters[0].tailor_id] : []);
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
            <StatCard
              label="Total Factories"
              value={data.factories.length}
              hint={`${activeFactories.length} Active · ${inactiveFactories.length} Inactive`}
              icon={Building2}
            />
            <StatCard
              label="Master Tailors"
              value={data.tailors.length}
              hint={`${activeTailors.length} Active · ${inactiveTailors.length} Inactive`}
              icon={Scissors}
            />
            <StatCard
              label="Tailor Staff"
              value={tailorStaffCount}
              hint={`${activeTailorStaffCount} currently assigned`}
              icon={Users}
            />
            <StatCard
              label="Active Assignments"
              value={currentMasters.length + currentStaff.length}
              hint="Tailors linked to factories"
              icon={Link2}
            />
          </div>

          <Panel
            title="Factory hierarchy"
            description="Expand a factory to manage its Master Tailors and Tailor Staff."
            bodyClassName="space-y-3"
            actions={
              <div className="flex flex-wrap gap-2">
                {inactiveFactories.length ? (
                  <Button variant="outline" onClick={() => setShowInactive((value) => !value)}>
                    {showInactive ? "Hide Inactive" : `View Inactive (${inactiveFactories.length})`}
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    setForm(empty);
                    setShowFactoryForm((current) => !current);
                  }}
                >
                  <Plus className="size-4" /> Add Factory
                </Button>
              </div>
            }
          >
            {showFactoryForm ? (
              <fieldset
                disabled={save.isPending || !!pending}
                className="grid gap-3 rounded-xl border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)_auto]"
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

            {visibleFactories.map((item) => {
              const masters = currentMasters.filter((row) => row.factory_id === item.id);
              const staff = currentStaff.filter((row) => row.factory_id === item.id);
              const isOpen = openFactories.includes(item.id);
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-xl border bg-card shadow-sm"
                >
                  <header className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
                    <button
                      type="button"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background hover:bg-accent"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.name}`}
                      onClick={() =>
                        setExpandedFactories(
                          isOpen
                            ? openFactories.filter((id) => id !== item.id)
                            : [...openFactories, item.id],
                        )
                      }
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                      <Building2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="numeric text-lg">{item.code}</strong>
                        <StatusBadge
                          status={item.active ? "active" : "archived"}
                          label={item.active ? "Active" : "Inactive"}
                        />
                      </div>
                      <p className="font-semibold">{item.name}</p>
                    </div>
                    <div className="grid grid-cols-2 divide-x rounded-lg border bg-surface sm:min-w-[250px]">
                      <div className="px-4 py-2">
                        <strong className="numeric block">{masters.length}</strong>
                        <span className="text-[11px] text-muted-foreground">Master Tailors</span>
                      </div>
                      <div className="px-4 py-2">
                        <strong className="numeric block">{staff.length}</strong>
                        <span className="text-[11px] text-muted-foreground">Tailor Staff</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFactory(item.id);
                          setUser("");
                          if (!isOpen) setExpandedFactories([...openFactories, item.id]);
                        }}
                      >
                        <Plus className="size-3.5" /> Assign Master Tailor
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => {
                          setForm(item);
                          setShowFactoryForm(true);
                        }}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </div>
                  </header>

                  {isOpen ? (
                    <div className="space-y-3 border-t bg-surface/55 p-3 sm:p-4">
                      {factory === item.id ? (
                        <fieldset
                          disabled={save.isPending || !!pending}
                          className="grid gap-2 rounded-xl border bg-card p-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]"
                        >
                          <select
                            className={selectClass}
                            value={user}
                            onChange={(event) => setUser(event.target.value)}
                          >
                            <option value="">Select Master Tailor login</option>
                            {people
                              .filter((person) => person.roles?.includes("tailor"))
                              .map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name}
                                </option>
                              ))}
                          </select>
                          <Button disabled={!user} onClick={assignMaster}>
                            Assign to {item.code}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setCreateRole("tailor");
                              setCreate(true);
                            }}
                          >
                            <UserPlus className="size-4" /> Create login
                          </Button>
                        </fieldset>
                      ) : null}

                      {masters.map((row) => {
                        const tailor = tailorFor(row.tailor_id);
                        const tailorStaff = currentStaff.filter(
                          (staffRow) => staffRow.tailor_id === row.tailor_id,
                        );
                        const tailorOpen = openTailors.includes(row.tailor_id);
                        return (
                          <section
                            key={row.id}
                            className="overflow-hidden rounded-xl border bg-card"
                          >
                            <header className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                              <button
                                type="button"
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background hover:bg-accent"
                                aria-label={`${tailorOpen ? "Collapse" : "Expand"} ${tailor?.real_name ?? "Master Tailor"}`}
                                onClick={() =>
                                  setExpandedTailors(
                                    tailorOpen
                                      ? openTailors.filter((id) => id !== row.tailor_id)
                                      : [...openTailors, row.tailor_id],
                                  )
                                }
                              >
                                {tailorOpen ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                                <Scissors className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <strong>{tailor?.code ?? "Master Tailor"}</strong>
                                  <StatusBadge
                                    status={tailor?.active ? "active" : "archived"}
                                    label={tailor?.active ? "Active" : "Inactive"}
                                  />
                                </div>
                                <p className="font-semibold">
                                  {tailor?.real_name ?? profileName(tailor?.profile_id ?? null)}
                                  <span className="ml-1 font-normal text-muted-foreground">
                                    (Master Tailor)
                                  </span>
                                </p>
                              </div>
                              <div className="min-w-28 border-l px-4">
                                <strong className="numeric block">{tailorStaff.length}</strong>
                                <span className="text-[11px] text-muted-foreground">
                                  Tailor Staff
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setStaffMaster(row.tailor_id);
                                  setStaffUser("");
                                  if (!tailorOpen)
                                    setExpandedTailors([...openTailors, row.tailor_id]);
                                }}
                              >
                                <Plus className="size-3.5" /> Add Tailor Staff
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                aria-label={`Reassign ${tailor?.real_name ?? "Master Tailor"}`}
                                onClick={() => {
                                  setUser(tailor?.profile_id ?? "");
                                  setFactory(row.factory_id);
                                }}
                              >
                                <Pencil className="size-4" />
                              </Button>
                            </header>

                            {tailorOpen ? (
                              <div className="space-y-2 border-t bg-background p-3 sm:pl-14">
                                {staffMaster === row.tailor_id ? (
                                  <fieldset
                                    disabled={assignStaff.isPending}
                                    className="grid gap-2 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]"
                                  >
                                    <select
                                      className={selectClass}
                                      value={staffUser}
                                      onChange={(event) => setStaffUser(event.target.value)}
                                    >
                                      <option value="">Select Tailor Staff login</option>
                                      {people
                                        .filter((person) => person.roles?.includes("tailor_staff"))
                                        .map((person) => (
                                          <option key={person.id} value={person.id}>
                                            {person.name}
                                          </option>
                                        ))}
                                    </select>
                                    <Button
                                      disabled={!staffUser}
                                      onClick={() => assignStaff.mutate()}
                                    >
                                      Assign Staff
                                    </Button>
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setCreateRole("tailor_staff");
                                        setCreate(true);
                                      }}
                                    >
                                      <UserPlus className="size-4" /> Create login
                                    </Button>
                                  </fieldset>
                                ) : null}

                                {tailorStaff.map((staffRow) => {
                                  const staffName = profileName(staffRow.staff_profile_id);
                                  return (
                                    <div
                                      key={staffRow.id}
                                      className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center"
                                    >
                                      <span
                                        className={cn(
                                          "flex size-9 shrink-0 items-center justify-center rounded-full bg-info/10 text-xs font-semibold text-info",
                                        )}
                                      >
                                        {initials(staffName)}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="font-semibold">{staffName}</p>
                                        <p className="text-[11px] text-muted-foreground">
                                          Tailor Staff
                                        </p>
                                      </div>
                                      <StatusBadge status="active" label="Active" />
                                      <div className="min-w-32 text-xs text-muted-foreground">
                                        <span className="block">Assigned</span>
                                        <span>{formatDateTime(staffRow.valid_from)}</span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setStaffUser(staffRow.staff_profile_id);
                                          setStaffMaster(staffRow.tailor_id);
                                        }}
                                      >
                                        <Pencil className="size-3.5" /> Reassign
                                      </Button>
                                    </div>
                                  );
                                })}
                                {!tailorStaff.length ? (
                                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                    No Tailor Staff assigned to this Master Tailor.
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                      {!masters.length ? (
                        <p className="rounded-xl border border-dashed bg-card p-5 text-center text-sm text-muted-foreground">
                          No Master Tailors assigned to this factory.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!visibleFactories.length ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {showInactive ? "No factories have been added." : "No active factories."}
              </p>
            ) : null}
          </Panel>

          <Panel
            className="hidden"
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
            className="hidden"
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
            className="hidden"
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
