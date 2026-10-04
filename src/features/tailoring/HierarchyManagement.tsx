import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/shared/utils/format";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import type { Database } from "@/integrations/supabase/types";
type Factory = { id: string; code: string; name: string; active: boolean };
type Section = Factory & { factory_id: string };
type Tailor = {
  id: string;
  code: string;
  real_name: string;
  active: boolean;
  profile_id: string | null;
};
type Assignment = {
  id: string;
  tailor_id: string;
  factory_id: string;
  section_id: string | null;
  valid_from: string;
  valid_until: string | null;
};
type Hierarchy = {
  factories: Factory[];
  sections: Section[];
  tailors: Tailor[];
  assignments: Assignment[];
  profiles: { id: string; name: string }[];
};
type EntityArgs = Database["public"]["Functions"]["manage_tailoring_entity"]["Args"];
type AssignmentArgs = Database["public"]["Functions"]["assign_tailor"]["Args"];
type Action = { kind: "entity"; args: EntityArgs } | { kind: "assignment"; args: AssignmentArgs };
const empty = {
  kind: "factory",
  id: "",
  code: "",
  name: "",
  active: true,
  factory: "",
  profile: "",
  reason: "",
};
export function HierarchyManagement() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["tailoring-hierarchy"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_tailoring_hierarchy");
      if (error) throw error;
      return data as unknown as Hierarchy;
    },
  });
  const [form, setForm] = useState(empty);
  const [assignment, setAssignment] = useState({
    tailor: "",
    factory: "",
    section: "",
    reason: "",
  });
  const [pending, setPending] = useState<Action | null>(null);
  const refresh = () => {
    for (const key of [
      "tailoring-hierarchy",
      "customer-tailoring",
      "material-issues",
      "active-tailors",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: async (action: Action) => {
      setPending(action);
      const response =
        action.kind === "entity"
          ? await supabase.rpc("manage_tailoring_entity", action.args)
          : await supabase.rpc("assign_tailor", action.args);
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      setPending(null);
      setForm(empty);
      setAssignment({ tailor: "", factory: "", section: "", reason: "" });
      refresh();
      toast.success("Hierarchy saved; existing job assignments retained");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      refresh();
      toast.error(e.message);
    },
  });
  if (!isOwner) return null;
  const data = catalog.data;
  const list =
    form.kind === "factory"
      ? data?.factories
      : form.kind === "section"
        ? data?.sections
        : data?.tailors;
  const selectedTailor = data?.tailors.find((t) => t.id === assignment.tailor);
  const current = data?.assignments.find(
    (a) => a.tailor_id === assignment.tailor && !a.valid_until,
  );
  const selectEntity = (id: string) => {
    const row = list?.find((r) => r.id === id);
    if (!row) {
      setForm({ ...empty, kind: form.kind });
      return;
    }
    setForm({
      kind: form.kind,
      id: row.id,
      code: row.code,
      name: "real_name" in row ? row.real_name : row.name,
      active: row.active,
      factory: "factory_id" in row ? String(row.factory_id) : "",
      profile: "profile_id" in row ? (row.profile_id ?? "") : "",
      reason: "",
    });
  };
  const submitEntity = () => {
    if (pending) {
      save.mutate(pending);
      return;
    }
    if (
      !form.code.trim() ||
      !form.name.trim() ||
      !form.reason.trim() ||
      (form.kind === "section" && !form.factory)
    ) {
      toast.error("Enter the identity, required Factory and reason");
      return;
    }
    save.mutate({
      kind: "entity",
      args: {
        p_request: crypto.randomUUID(),
        p_kind: form.kind,
        p_id: form.id || null,
        p_code: form.code.trim(),
        p_name: form.name.trim(),
        p_active: form.active,
        p_factory: form.kind === "section" ? form.factory : null,
        p_profile: form.kind === "tailor" ? form.profile || null : null,
        p_reason: form.reason.trim(),
      },
    });
  };
  const submitAssignment = () => {
    if (pending) {
      save.mutate(pending);
      return;
    }
    if (!assignment.tailor || !assignment.factory || !assignment.reason.trim()) {
      toast.error("Choose Tailor, Factory and assignment reason");
      return;
    }
    save.mutate({
      kind: "assignment",
      args: {
        p_request: crypto.randomUUID(),
        p_tailor: assignment.tailor,
        p_factory: assignment.factory,
        p_section: assignment.section || null,
        p_expected_assignment: current?.id ?? null,
        p_reason: assignment.reason.trim(),
      },
    });
  };
  return (
    <Panel
      title="Factory / Section / Tailor management"
      description="Owner: manage business identities and future assignments. Existing jobs and material history retain their original assignment."
    >
      {catalog.isPending && <p>Loading hierarchy…</p>}
      {catalog.error && <p role="alert">{catalog.error.message}</p>}
      <fieldset
        disabled={save.isPending || !!pending || !data}
        className="grid gap-6 lg:grid-cols-2"
      >
        <div className="space-y-3">
          <h3 className="font-semibold">Create / edit</h3>
          <label>
            Entity
            <select
              className="block w-full border p-2"
              value={form.kind}
              onChange={(e) => setForm({ ...empty, kind: e.target.value })}
            >
              {["factory", "section", "tailor"].map((k) => (
                <option key={k} value={k}>
                  {k === "tailor" ? "Tailor" : k === "section" ? "Section" : "Factory"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Record
            <select
              className="block w-full border p-2"
              value={form.id}
              onChange={(e) => selectEntity(e.target.value)}
            >
              <option value="">Create new</option>
              {list?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {"real_name" in r ? r.real_name : r.name}
                  {!r.active ? " · Disabled" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Code / Tailor ID
            <Input
              disabled={!!form.id}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
          <label>
            {form.kind === "tailor" ? "Real name" : "Name"}
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          {form.kind === "section" && (
            <label>
              Factory
              <select
                disabled={!!form.id}
                className="block w-full border p-2"
                value={form.factory}
                onChange={(e) => setForm({ ...form, factory: e.target.value })}
              >
                <option value="">Choose Factory</option>
                {data?.factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                    {!f.active ? " · Disabled" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.kind === "tailor" && (
            <label>
              Optional Tailor login
              <select
                disabled={
                  !!form.profile &&
                  !!form.id &&
                  !!data?.assignments.some((a) => a.tailor_id === form.id)
                }
                className="block w-full border p-2"
                value={form.profile}
                onChange={(e) => setForm({ ...form, profile: e.target.value })}
              >
                <option value="">Business Tailor without login</option>
                {data?.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {form.profile && !data?.profiles.some((p) => p.id === form.profile) && (
                  <option value={form.profile}>Existing inactive login · {form.profile}</option>
                )}
              </select>
            </label>
          )}
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active
          </label>
          <label>
            Change reason
            <Input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <Button onClick={submitEntity}>Save {form.kind}</Button>
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">Assign / reassign Tailor</h3>
          <label>
            Tailor
            <select
              className="block w-full border p-2"
              value={assignment.tailor}
              onChange={(e) => setAssignment({ ...assignment, tailor: e.target.value })}
            >
              <option value="">Choose active Tailor</option>
              {data?.tailors
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.real_name}
                  </option>
                ))}
            </select>
          </label>
          {selectedTailor && (
            <p className="text-sm">
              Current:{" "}
              {current
                ? `${data?.factories.find((f) => f.id === current.factory_id)?.name} → ${data?.sections.find((s) => s.id === current.section_id)?.name ?? "No Section"}`
                : "Unassigned"}
            </p>
          )}
          <label>
            Factory
            <select
              className="block w-full border p-2"
              value={assignment.factory}
              onChange={(e) =>
                setAssignment({ ...assignment, factory: e.target.value, section: "" })
              }
            >
              <option value="">Choose active Factory</option>
              {data?.factories
                .filter((f) => f.active)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Section
            <select
              className="block w-full border p-2"
              value={assignment.section}
              onChange={(e) => setAssignment({ ...assignment, section: e.target.value })}
            >
              <option value="">No Section</option>
              {data?.sections
                .filter((s) => s.active && s.factory_id === assignment.factory)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Assignment reason
            <Input
              value={assignment.reason}
              onChange={(e) => setAssignment({ ...assignment, reason: e.target.value })}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Reassignment closes the previous assignment and creates a new one for future jobs.
            Existing jobs retain their original Factory/Section/Tailor.
          </p>
          <Button onClick={submitAssignment}>Save assignment</Button>
        </div>
      </fieldset>
      {pending && !save.isPending && (
        <div className="mt-3">
          <p role="alert">Result is uncertain. Retry the same request to confirm it.</p>
          <Button onClick={() => save.mutate(pending)}>Retry same change</Button>
        </div>
      )}
      <div className="mt-5 space-y-3">
        <h3 className="font-semibold">Assignment history</h3>
        {!catalog.isPending && !catalog.error && !data?.assignments.length && (
          <p>No assignments yet. Create a Factory and Tailor, then assign the Tailor.</p>
        )}
        {data?.assignments.map((a) => (
          <p key={a.id} className="text-sm">
            {data.tailors.find((t) => t.id === a.tailor_id)?.code} ·{" "}
            {data.tailors.find((t) => t.id === a.tailor_id)?.real_name} ·{" "}
            {data.factories.find((f) => f.id === a.factory_id)?.name} →{" "}
            {data.sections.find((s) => s.id === a.section_id)?.name ?? "No Section"} ·{" "}
            {formatDateTime(a.valid_from)} →{" "}
            {a.valid_until ? formatDateTime(a.valid_until) : "Current"} · {a.id}
          </p>
        ))}
      </div>
    </Panel>
  );
}
