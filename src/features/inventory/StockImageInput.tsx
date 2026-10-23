import { useEffect, useId, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { validateStockImage } from "./stock-images";

export function StockImageInput({
  label,
  file,
  onChange,
  disabled,
  compact = false,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-1.5"}>
      {preview && <img src={preview} alt="Selected stock" className="size-12 rounded-md border object-cover" />}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} asChild>
          <label htmlFor={id} className="cursor-pointer">
            <ImagePlus className="size-4" /> {file ? "Replace image" : label}
          </label>
        </Button>
        {file && (
          <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => onChange(null)} aria-label="Remove selected image">
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

