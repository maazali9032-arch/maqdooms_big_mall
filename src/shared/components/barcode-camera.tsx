import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function BarcodeCamera({
  onScan,
  onStop,
}: {
  onScan: (code: string) => void;
  onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onScan, onStop });
  callbacks.current = { onScan, onStop };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false,
      detected = false;
    let stream: MediaStream | undefined;
    let controls: { stop: () => void } | undefined;
    const preview = video.current;
    const stop = () => {
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (preview) preview.srcObject = null;
    };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera unavailable. Use the barcode field below.");
        // Keep the stream under this component's control, including a late permission response.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stop();
          return;
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !preview) {
          stop();
          return;
        }
        controls = await new BrowserMultiFormatReader().decodeFromStream(
          stream,
          preview,
          (result, _error, scanner) => {
            if (cancelled || detected || !result?.getText().trim()) return;
            detected = true;
            scanner.stop();
            stop();
            callbacks.current.onScan(result.getText().trim());
          },
        );
        if (cancelled || detected) {
          stop();
          return;
        }
        setReady(true);
      } catch (failure) {
        stop();
        if (!cancelled)
          setError(
            failure instanceof DOMException && failure.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access or use the barcode field below."
              : failure instanceof DOMException && failure.name === "NotFoundError"
                ? "No camera found. Use the barcode field below."
                : "Camera could not start. Use the barcode field below.",
          );
      }
    };
    void start();
    const suspend = () => {
      if (document.hidden) {
        cancelled = true;
        stop();
        callbacks.current.onStop();
      }
    };
    document.addEventListener("visibilitychange", suspend);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", suspend);
    };
  }, []);
  return (
    <section aria-label="Barcode camera" className="space-y-2 rounded-xl border bg-muted/30 p-3">
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        aria-label="Live barcode camera"
        className="aspect-video max-h-[40dvh] w-full rounded-lg bg-black object-contain"
      />
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : (
        <p role="status" className="text-sm">
          {ready
            ? "Point the camera at the barcode. It will open automatically."
            : "Starting camera…"}
        </p>
      )}
      <Button type="button" variant="outline" onClick={onStop}>
        Stop camera
      </Button>
    </section>
  );
}

/** Mobile-only camera entry for any barcode field. */
export function BarcodeCameraButton({
  onScan,
  disabled = false,
  label = "Scan with camera",
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full sm:hidden"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Camera className="size-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan barcode</DialogTitle>
            <DialogDescription>Point the camera at the barcode. It will be entered automatically.</DialogDescription>
          </DialogHeader>
          {open && (
            <BarcodeCamera
              onScan={(code) => {
                setOpen(false);
                onScan(code);
              }}
              onStop={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
