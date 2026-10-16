import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Terminal = {
  id: string;
  code: string;
  active: boolean;
  user_id: string | null;
  user_name: string | null;
  user_active: boolean | null;
};
type Staff = { id: string; full_name: string; active: boolean; roles: string[] };

const rpc = supabase.rpc as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

export function PosTerminalManagement({ staff }: { staff: Staff[] }) {
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState("");
  const terminals = useQuery({
    queryKey: ["pos-terminals"],
    queryFn: async () => {
      const { data, error } = await rpc("owner_pos_terminals", {});
      if (error) throw error;
      return (data ?? []) as Terminal[];
    },
  });
  const eligibleCounters = useMemo(
    () =>
      staff.filter(
        (person) =>
          person.active && person.roles.includes("counter") && !person.roles.includes("owner"),
      ),
    [staff],
  );
  const refresh = () => void qc.invalidateQueries({ queryKey: ["pos-terminals"] });
  const create = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await rpc("owner_create_pos_terminal", { p_code: code });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewCode("");
      refresh();
      toast.success("POS ID created");
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useMutation({
    mutationFn: async (input: {
      terminal: string;
      code: string;
      user: string | null;
      active: boolean;
    }) => {
      const renamed = await rpc("owner_rename_pos_terminal", {
        p_terminal: input.terminal,
        p_code: input.code,
      });
      if (renamed.error) throw renamed.error;
      const assigned = await rpc("owner_assign_pos_terminal", {
        p_terminal: input.terminal,
        p_user: input.user,
        p_active: input.active,
      });
      if (assigned.error) throw assigned.error;
    },
    onSuccess: () => {
      refresh();
      toast.success("POS assignment saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const assignedUsers = new Set(
    terminals.data?.flatMap((terminal) => (terminal.user_id ? [terminal.user_id] : [])) ?? [],
  );

  return (
    <section className="panel overflow-hidden">
      <header className="border-b px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-primary">
            <Monitor className="size-4" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">POS terminals</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Create your POS IDs here, then assign each ID to one active Counter user. Owners never
              receive a POS ID.
            </p>
          </div>
        </div>
        <div className="mt-4 flex max-w-md gap-2">
          <Input
            aria-label="New POS ID"
            value={newCode}
            maxLength={32}
            placeholder="For example: POS-3 or F2-Counter"
            onChange={(event) => setNewCode(event.target.value)}
          />
          <Button
            disabled={create.isPending || !newCode.trim()}
            onClick={() => create.mutate(newCode.trim())}
          >
            Create POS ID
          </Button>
        </div>
      </header>
      <div className="divide-y">
        {terminals.data?.map((terminal) => (
          <TerminalRow
            key={terminal.id}
            terminal={terminal}
            users={eligibleCounters}
            assignedUsers={assignedUsers}
            busy={update.isPending}
            onSave={(input) => update.mutate(input)}
          />
        ))}
        {!terminals.isLoading && !terminals.data?.length && (
          <p className="p-4 text-sm text-muted-foreground">
            No POS IDs yet. Create the IDs your counters will use above.
          </p>
        )}
      </div>
    </section>
  );
}

function TerminalRow({
  terminal,
  users,
  assignedUsers,
  busy,
  onSave,
}: {
  terminal: Terminal;
  users: Staff[];
  assignedUsers: Set<string>;
  busy: boolean;
  onSave: (input: { terminal: string; code: string; user: string | null; active: boolean }) => void;
}) {
  const [code, setCode] = useState(terminal.code);
  const [user, setUser] = useState(terminal.user_id ?? "");
  const [active, setActive] = useState(terminal.active);
  useEffect(() => {
    setCode(terminal.code);
    setUser(terminal.user_id ?? "");
    setActive(terminal.active);
  }, [terminal]);
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(130px,180px)_minmax(220px,1fr)_auto_auto] lg:items-center">
      <Input
        aria-label="POS ID"
        value={code}
        maxLength={32}
        onChange={(event) => setCode(event.target.value)}
      />
      <select
        aria-label={`Counter user for ${terminal.code}`}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={user}
        onChange={(event) => setUser(event.target.value)}
      >
        <option value="">Unassigned</option>
        {users.map((person) => (
          <option
            key={person.id}
            value={person.id}
            disabled={assignedUsers.has(person.id) && person.id !== terminal.user_id}
          >
            {person.full_name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 whitespace-nowrap text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />{" "}
        Active
      </label>
      <Button
        disabled={busy || !code.trim()}
        onClick={() =>
          onSave({ terminal: terminal.id, code: code.trim(), user: user || null, active })
        }
      >
        Save
      </Button>
    </div>
  );
}
