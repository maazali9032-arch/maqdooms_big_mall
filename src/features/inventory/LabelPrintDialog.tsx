import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  STARTING_LABEL_PROFILE,
  labelRows,
  symbolSize,
  labelPrintCSS,
  validProfile,
  type LabelProfile,
  type Sticker,
} from "./label-print-model";
const PROFILE_KEY = "maqdooms.thermal-label-profile.v1";
function profileFromStorage() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null") as LabelProfile;
    if (p && validProfile(p)) return p;
  } catch {
    /* Use adjustable starting profile. */
  }
  return STARTING_LABEL_PROFILE;
}
function ThermalLabels({ labels, profile }: { labels: Sticker[]; profile: LabelProfile }) {
  return (
    <>
      {labelRows(labels, profile.columns).map((row, index) => (
        <div className="label-row" key={index}>
          {row.map((l, i) => {
            const symbol = symbolSize(l.code, profile);
            return (
              <article className="sticker" key={i}>
                <p className="name">{l.name}</p>
                {l.description && <p>{l.description}</p>}
                <svg
                  preserveAspectRatio="none"
                  aria-label={`Barcode ${l.code}`}
                  viewBox={`0 0 ${symbol.modules} 54`}
                  style={{ width: `${symbol.width}mm` }}
                >
                  <rect width="100%" height="100%" fill="white" />
                  {[...symbol.bars].map((b, j) =>
                    b === "1" ? (
                      <rect key={j} x={j + 10} width="1" height="54" fill="black" />
                    ) : null,
                  )}
                </svg>
                <p className="code">{l.code}</p>
                {l.detail && <p>{l.detail}</p>}
                {l.price && <p className="price">{l.price}</p>}
              </article>
            );
          })}
        </div>
      ))}
    </>
  );
}
export function LabelPrintDialog({
  labels,
  title,
  close,
}: {
  labels: Sticker[];
  title: string;
  close: () => void;
}) {
  const [profile, setProfile] = useState(profileFromStorage);
  const [error, setError] = useState("");
  const preview = useRef<HTMLIFrameElement>(null);
  const valid = validProfile(profile);
  const symbols = valid ? labels.map((l) => symbolSize(l.code, profile)) : [];
  const tooLong = symbols.some((s) => s.dots < 1),
    dense = symbols.some((s) => s.dots === 1);
  const rows = valid ? labelRows(labels, profile.columns).length : 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Barcode Label Setup</DialogTitle>
          <DialogDescription>
            Starting size is inferred from your photos. Adjust to the loaded roll and test one row
            before printing a batch.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              ["width", "Sticker width (mm)"],
              ["height", "Sticker height (mm)"],
              ["gap", "Gap between columns (mm)"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="text-sm">
              {label}
              <Input
                type="number"
                min={field === "gap" ? 0 : 20}
                step="0.1"
                aria-label={label}
                value={Number.isFinite(profile[field]) ? profile[field] : ""}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    [field]: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
          <label className="text-sm">
            Columns
            <select
              aria-label="Labels across roll"
              className="min-h-11 w-full rounded border p-2"
              value={profile.columns}
              onChange={(e) => setProfile({ ...profile, columns: Number(e.target.value) })}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Printer resolution
            <select
              aria-label="Printer resolution"
              className="min-h-11 w-full rounded border p-2"
              value={profile.dpi}
              onChange={(e) => setProfile({ ...profile, dpi: Number(e.target.value) })}
            >
              <option value={203}>203 dpi</option>
              <option value={300}>300 dpi</option>
            </select>
          </label>
        </div>
        <p className="text-sm">
          {labels.length} unique item labels · {rows} print rows. One browser page is one row of
          stickers; the last row may have an empty position.
        </p>
        <p className="text-sm">
          Select TSC TE244 in Print. Match the driver’s paper width and label height to this setup,
          use 100% scale, no margins and no headers/footers. Set/calibrate the gap between rows in
          the printer driver.
        </p>
        {!valid && <p role="alert">Enter valid sizes; total row width must not exceed 108 mm.</p>}
        {tooLong && (
          <p role="alert">
            An existing barcode cannot fit at this resolution. Increase sticker width or use a
            higher-resolution printer. Its identity will not be changed.
          </p>
        )}
        {dense && !tooLong && (
          <p role="status" className="text-sm">
            Some existing codes use narrow bars. Test scanning the printed row; use wider labels if
            scanning is unreliable.
          </p>
        )}
        {valid && !tooLong && (
          <iframe
            ref={preview}
            title="Thermal label preview"
            className="h-64 w-full rounded border bg-white"
            srcDoc="<!doctype html><html><head></head><body></body></html>"
            onLoad={() => {
              const doc = preview.current?.contentDocument;
              if (!doc) return;
              doc.head.innerHTML = "";
              const style = doc.createElement("style");
              style.textContent = labelPrintCSS(profile);
              doc.head.append(style);
              const content = doc.createElement("div");
              doc.body.replaceChildren(content);
              createRoot(content).render(
                <ThermalLabels labels={labels.slice(0, profile.columns)} profile={profile} />,
              );
            }}
            key={JSON.stringify(profile)}
          />
        )}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={close}>
            Close setup
          </Button>
          {[true, false].map((test) => (
            <Button
              key={String(test)}
              disabled={!valid || tooLong}
              onClick={() => {
                try {
                  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
                  const frame = document.createElement("iframe");
                  frame.title = test ? "Thermal test row" : title;
                  frame.setAttribute("aria-hidden", "true");
                  Object.assign(frame.style, {
                    position: "fixed",
                    width: "0",
                    height: "0",
                    border: "0",
                  });
                  document.body.append(frame);
                  const doc = frame.contentDocument,
                    win = frame.contentWindow;
                  if (!doc || !win) {
                    frame.remove();
                    throw new Error("Print preview could not open");
                  }
                  doc.title = title;
                  const style = doc.createElement("style");
                  style.textContent = labelPrintCSS(profile);
                  doc.head.append(style);
                  const content = doc.createElement("div");
                  doc.body.append(content);
                  const root = createRoot(content);
                  root.render(
                    <ThermalLabels
                      labels={test ? labels.slice(0, profile.columns) : labels}
                      profile={profile}
                    />,
                  );
                  let cleaned = false;
                  const clean = () => {
                    if (cleaned) return;
                    cleaned = true;
                    root.unmount();
                    frame.remove();
                  };
                  win.addEventListener("afterprint", clean, { once: true });
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      try {
                        if (
                          [...doc.querySelectorAll<HTMLElement>(".sticker")].some(
                            (el) => el.scrollHeight > el.clientHeight + 1,
                          )
                        )
                          throw new Error(
                            "Label content exceeds this sticker height. Increase the height before printing.",
                          );
                        win.focus();
                        win.print();
                      } catch (e) {
                        clean();
                        setError((e as Error).message);
                      }
                    }),
                  );
                  window.setTimeout(clean, 60000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {test ? "Print test row" : "Print all labels"}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
