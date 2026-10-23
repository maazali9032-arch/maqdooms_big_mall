import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImagePlus, Images, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    const displayFile = file ?? inheritedFile;
    if (!displayFile) return setPreview("");
    const url = URL.createObjectURL(displayFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, inheritedFile]);
  useEffect(() => {
    if (!cameraOpen) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not provide camera capture. Use the upload option instead.");
      return;
    }
    let active = true;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((next) => {
        if (!active) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = next;
        if (video.current) video.current.srcObject = next;
      })
      .catch(() => setCameraError("Camera access was not available. Check the browser permission and try again."));
    return () => {
      active = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [cameraOpen]);
  const capturePhoto = () => {
    const element = video.current;
    if (!element?.videoWidth || !element.videoHeight) {
      setCameraError("The camera is still starting. Please try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return setCameraError("The photo could not be captured. Please try again.");
      try {
        const photo = new File([blob], `stock-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        validateStockImage(photo);
        onChange(photo);
        setCameraOpen(false);
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : "The photo could not be used.");
      }
    }, "image/jpeg", 0.9);
  };
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setCameraError("");
            setCameraOpen(true);
          }}
        >
          <Camera className="size-4" /> Capture photo
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
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Capture stock image</DialogTitle>
            <DialogDescription>Frame the fabric or garment, then take the photo.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg bg-black">
            <video ref={video} autoPlay playsInline muted className="aspect-[4/3] w-full object-contain" />
          </div>
          {cameraError && <p role="alert" className="text-sm text-destructive">{cameraError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCameraOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!!cameraError} onClick={capturePhoto}>
              <Camera className="size-4" /> Take photo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            On mobile, you can also use the device camera from the file picker.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

