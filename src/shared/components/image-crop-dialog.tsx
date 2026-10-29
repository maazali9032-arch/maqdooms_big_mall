import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  loadPhoto,
  photoSize,
  renderCrop,
  type CropRect,
  type OutputSpec,
} from "@/shared/utils/image-pipeline";

/**
 * Fixed-shape crop: the frame keeps the standard aspect; staff drag the photo and
 * zoom to choose what is kept. Produces one compressed file per output size.
 */
export function ImageCropDialog({
  file,
  aspect,
  outputs,
  title = "Crop photo",
  onDone,
  onCancel,
}: {
  file: File;
  aspect: number;
  outputs: readonly OutputSpec[];
  title?: string;
  onDone: (files: File[]) => void;
  onCancel: () => void;
}) {
  const [photo, setPhoto] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = photo just covers the frame
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // photo top-left inside the frame, px
  const frame = useRef<HTMLDivElement>(null);
  const [frameW, setFrameW] = useState(320);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    let alive = true;
    loadPhoto(file)
      .then((p) => alive && setPhoto(p))
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : "Photo could not be read"),
      );
    return () => {
      alive = false;
    };
  }, [file]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

  const frameH = frameW / aspect;
  const size = photo ? photoSize(photo) : { width: 1, height: 1 };
  const cover = Math.max(frameW / size.width, frameH / size.height);
  const scale = cover * zoom;
  const shownW = size.width * scale;
  const shownH = size.height * scale;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(frameW - shownW, x)),
    y: Math.min(0, Math.max(frameH - shownH, y)),
  });

  // centre the photo whenever it first loads or the frame resizes
  useEffect(() => {
    if (!photo) return;
    setOffset(clamp((frameW - shownW) / 2, (frameH - shownH) / 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, frameW]);

  const setZoomKeepingCentre = (next: number) => {
    const cx = (frameW / 2 - offset.x) / scale;
    const cy = (frameH / 2 - offset.y) / scale;
    const nextScale = cover * next;
    setZoom(next);
    setOffset(
      (() => {
        const nx = frameW / 2 - cx * nextScale;
        const ny = frameH / 2 - cy * nextScale;
        return {
          x: Math.min(0, Math.max(frameW - size.width * nextScale, nx)),
          y: Math.min(0, Math.max(frameH - size.height * nextScale, ny)),
        };
      })(),
    );
  };

  const finish = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      const crop: CropRect = {
        sx: -offset.x / scale,
        sy: -offset.y / scale,
        sw: frameW / scale,
        sh: frameH / scale,
      };
      const base = crypto.randomUUID();
      const files: File[] = [];
      for (const spec of outputs) files.push(await renderCrop(photo, crop, spec, base));
      onDone(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo could not be processed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Drag the photo and zoom so the item fills the frame. Every photo is saved in the same
            shape and size.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div
          ref={frame}
          className="relative mx-auto w-full touch-none select-none overflow-hidden rounded-lg bg-muted"
          // The frame shrinks on short screens so the whole dialog, buttons included, stays visible.
          style={{ aspectRatio: String(aspect), maxWidth: `calc((100dvh - 17rem) * ${aspect})` }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setOffset(
              clamp(
                drag.current.ox + e.clientX - drag.current.x,
                drag.current.oy + e.clientY - drag.current.y,
              ),
            );
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {photo ? (
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{
                width: shownW,
                height: shownH,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                imageOrientation: "from-image",
              }}
            />
          ) : !error ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Loading photo…
            </p>
          ) : null}
          <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset ring-white/80" />
        </div>
        <label className="flex items-center gap-3 text-sm">
          Zoom
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            disabled={!photo}
            onChange={(e) => setZoomKeepingCentre(Number(e.target.value))}
            className="flex-1"
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!photo || busy} onClick={() => void finish()}>
            {busy ? "Processing…" : "Use photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
