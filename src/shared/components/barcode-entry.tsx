import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** One entry path for manual typing, keyboard scanners and camera results. */
export function BarcodeEntry({
  value,
  onChange,
  onScan,
  label,
  placeholder,
  disabled = false,
  action = "Search / Scan",
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onScan: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  action?: string;
  children?: ReactNode;
}) {
  return (
    <form
      className="flex min-w-0 flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) onScan(value.trim());
      }}
    >
      <Input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? "Scan or type a barcode and press Enter"}
        className="min-w-0 flex-1"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        {action}
      </Button>
      {children}
    </form>
  );
}
