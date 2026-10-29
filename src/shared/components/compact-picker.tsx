import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string };

/**
 * A compact single-choice picker for long lists: the list opens under the button,
 * has a search box and a fixed height (about eight rows), and scrolls inside.
 */
export function CompactPicker({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  emptyText = "Nothing matches",
}: {
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2"
        onOpenAutoFocus={(e) => {
          // Focus the search box instead of the first option.
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector("input")?.focus();
        }}
      >
        <Input
          aria-label={`Search ${ariaLabel.toLowerCase()}`}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown.length === 1) {
              e.preventDefault();
              choose(shown[0]!.value);
            }
          }}
          className="mb-2 h-9"
        />
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-64 overflow-y-auto overscroll-contain"
        >
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => choose(o.value)}
              className={cn(
                "block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                o.value === value && "bg-muted font-medium",
              )}
              title={o.label}
            >
              {o.label}
            </button>
          ))}
          {!shown.length && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</p>
          )}
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          {shown.length} of {options.length}
        </p>
      </PopoverContent>
    </Popover>
  );
}
