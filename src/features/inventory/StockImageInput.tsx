import { useEffect, useId, useState } from "react";
import { ImagePlus, Images, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { validateStockImage } from "./stock-images";

export function StockImageInput({
  label,
  file,
  onChange,
  disabled,
  compact = false,
  inheritedFile = null,
  inheritedText,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  compact?: boolean;
  inheritedFile?: File | null;
  inheritedText?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState("");
  useEffect(() => {
    const displayFile = file ?? inheritedFile;
    if (!displayFile) return setPreview("");
    const url = URL.createObjectURL(displayFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, inheritedFile]);
  const isInherited = !file && !!inheritedFile;
  return (
    <div
      className={
        compact
          ? "flex min-w-0 items-center gap-2"
          : "rounded-lg border border-dashed border-primary/25 bg-primary/[0.03] p-2.5"
      }
    >
      <input
        id={id}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (!next) return;
          try {
            validateStockImage(next);
            onChange(next);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Invalid image");
          }
        }}
      />
      {preview ? (
        <img
          src={preview}
          alt={isInherited ? "Inherited stock image" : "Selected stock image"}
          className={compact ? "size-10 rounded-md border object-cover" : "size-16 rounded-md border object-cover"}
        />
      ) : !compact ? (
        <span className="grid size-16 place-items-center rounded-md border border-dashed bg-background text-muted-foreground">
          <Images className="size-5" />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} asChild>
          <label htmlFor={id} className="cursor-pointer">
            <ImagePlus className="size-4" /> {file ? "Change image" : isInherited ? "Add custom image" : label}
          </label>
        </Button>
        {file && (
          <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => onChange(null)} aria-label="Remove selected image">
            <X className="size-4" />
          </Button>
        )}
        {isInherited && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
            {inheritedText ?? "Inherited image"}
          </span>
        )}
        {!compact && (
          <span className="w-full text-xs text-muted-foreground">
            {file ? "Custom image selected" : isInherited ? "Using the parent image until replaced" : "JPG, PNG or WebP · up to 5 MB"}
          </span>
        )}
      </div>
    </div>
  );
}

