import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QueryState } from "./query-state";
export type TailorAssignment = {
  id: string;
  factory_id: string;
  factory_name: string;
  tailor_name: string;
  tailor_code: string;
  section_name: string | null;
};
function useTailorAssignments() {
  return useQuery({
    queryKey: ["tailoring-hierarchy", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tailoring_assignment_options");
      if (error) throw error;
      return data as unknown as TailorAssignment[];
    },
  });
}
export function FactoryTailorPicker({
  factory,
  onFactory,
  selected,
  onSelected,
  multiple = false,
}: {
  factory: string;
  onFactory: (v: string) => void;
  selected: string[];
  onSelected: (v: string[]) => void;
  multiple?: boolean;
}) {
  const query = useTailorAssignments();
  const factories = [
    ...new Map((query.data ?? []).map((a) => [a.factory_id, a.factory_name])).entries(),
  ];
  return (
    <div className="space-y-3">
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <label className="block text-sm">
        Factory
        <select
          aria-label="Assignment factory"
          className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"
          value={factory}
          onChange={(e) => {
            onFactory(e.target.value);
            onSelected([]);
          }}
        >
          <option value="">Select factory</option>
          {factories.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {factory && (
        <fieldset className="rounded-lg border p-3">
          <legend className="px-1 text-sm">
            {multiple ? "Select one or more tailors" : "Select tailor"}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(query.data ?? [])
              .filter((a) => a.factory_id === factory)
              .map((a) => (
                <label
                  className="flex min-h-11 items-center gap-2 rounded border p-2 text-sm"
                  key={a.id}
                >
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name="job-tailor"
                    checked={selected.includes(a.id)}
                    onChange={() =>
                      onSelected(
                        multiple
                          ? selected.includes(a.id)
                            ? selected.filter((id) => id !== a.id)
                            : [...selected, a.id]
                          : [a.id],
                      )
                    }
                  />
                  <span>
                    {a.tailor_name}
                    <span className="block text-xs text-muted-foreground">{a.tailor_code}</span>
                  </span>
                </label>
              ))}
          </div>
          {!(query.data ?? []).some((a) => a.factory_id === factory) && (
            <p>No active tailors are assigned to this factory.</p>
          )}
        </fieldset>
      )}
    </div>
  );
}
