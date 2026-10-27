import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BarcodeCameraButton } from "./barcode-camera";

/** One entry path for manual typing, keyboard scanners and camera results. */
export function BarcodeEntry({
  value,
  onChange,
  onScan,
  label,
  placeholder,
  disabled = false,
  action = "Search / Scan",
  showCameraOnDesktop = false,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onScan: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  action?: string;
  showCameraOnDesktop?: boolean;
  children?: ReactNode;
}) {
  return (
    <form
      className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap"
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
        className="col-span-2 min-w-0 w-full sm:flex-1"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
      <Button type="submit" className="w-full sm:w-auto" disabled={disabled || !value.trim()}>
        {action}
      </Button>
      <BarcodeCameraButton
        disabled={disabled}
        mobileOnly={!showCameraOnDesktop}
        onScan={(code) => {
          onChange(code);
          onScan(code);
        }}
      />
      {children}
    </form>
  );
}
