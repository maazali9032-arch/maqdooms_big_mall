import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Monitor } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Terminal = {
  id: string;
  code: string;
  active: boolean;
  user_id: string;
  user_name: string;
  user_active: boolean;
};
type Staff = { id: string; full_name: string; active: boolean; roles: string[] };

export function PosTerminalManagement({ staff }: { staff: Staff[] }) {
  const qc = useQueryClient();
  const terminals = useQuery({
    queryKey: ["pos-terminals"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("owner_pos_terminals", {});
      if (error) throw error;
      return (data ?? []) as Terminal[];
    },
  });
  const save = useMutation({
    mutationFn: async (input: { user: string; code: string; active: boolean }) => {
      const { error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("owner_save_pos_terminal", {
        p_user: input.user,
        p_code: input.code,
        p_active: input.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pos-terminals"] });
      toast.success("POS terminal saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const counters = staff.filter((person) => person.active && person.roles.includes("counter"));
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
              Each Counter account has one fixed terminal code. Owners do not receive a POS code.
            </p>
          </div>
        </div>
      </header>
      <div className="divide-y">
        {counters.map((person, index) => {
          const terminal = terminals.data?.find((item) => item.user_id === person.id);
          return (
            <TerminalRow
              key={person.id}
              user={person}
              initialCode={terminal?.code ?? `POS-${index + 1}`}
              active={terminal?.active ?? true}
              busy={save.isPending}
              onSave={(code, active) => save.mutate({ user: person.id, code, active })}
            />
          );
        })}
        {!counters.length && (
          <p className="p-4 text-sm text-muted-foreground">
            Assign the Counter role to a staff account before creating a POS terminal.
          </p>
        )}
      </div>
    </section>
  );
}
function TerminalRow({
  user,
  initialCode,
  active,
  busy,
  onSave,
}: {
  user: Staff;
  initialCode: string;
  active: boolean;
  busy: boolean;
  onSave: (code: string, active: boolean) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [enabled, setEnabled] = useState(active);
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto] sm:items-center">
      <strong>{user.full_name}</strong>
      <Input
        aria-label={`POS code for ${user.full_name}`}
        value={code}
        maxLength={32}
        onChange={(event) => setCode(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{" "}
        Active
      </label>
      <Button disabled={busy || !code.trim()} onClick={() => onSave(code.trim(), enabled)}>
        Save
      </Button>
    </div>
  );
}
