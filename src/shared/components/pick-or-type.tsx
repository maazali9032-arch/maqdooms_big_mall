import { useId } from "react";
import { Input } from "@/components/ui/input";

/** Free-text input with suggestions: pick an existing name or type a new one. */
export function PickOrTypeInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
}) {
  const listId = useId();
  const isNew =
    value.trim() !== "" && !options.some((o) => o.toLowerCase() === value.trim().toLowerCase());
  return (
    <div className="space-y-1">
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {isNew ? (
        <p className="text-[11px] text-muted-foreground">New — will be saved for future use</p>
      ) : null}
    </div>
  );
}
