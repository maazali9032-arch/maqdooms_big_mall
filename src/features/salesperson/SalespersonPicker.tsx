import { useSalespeople } from "./use-salespeople";
import { useSession } from "@/app/providers/session";

import { Label } from "@/components/ui/label";

export function SalespersonPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  id: string;
}) {
  const options = useSalespeople();
  const { can } = useSession();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Salesperson</Label>
      <select
        id={id}
        className="w-full rounded border bg-background p-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={
          disabled || options.isPending || Boolean(options.error) || !can("pos.assign_salesperson")
        }
      >
        <option value="">Select credited Salesperson</option>
        {options.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name?.trim() || "Name not recorded"}
          </option>
        ))}
      </select>
      {options.error && <p role="alert">Salespeople could not load. Refresh before billing.</p>}
      {!options.isPending && !options.error && options.data?.length === 0 && (
        <p>Owner must assign the Salesperson role to an active staff account before billing.</p>
      )}
    </div>
  );
}
