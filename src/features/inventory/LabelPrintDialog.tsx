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
  labelPages,
  normalizeProfile,
  symbolSize,
  labelPrintCSS,
  validProfile,
  type LabelProfile,
  type Sticker,
} from "./label-print-model";
// Versioned so the measured 40 × 30 mm showroom roll replaces prior experimental profiles.
const PROFILE_KEY = "maqdooms.barcode-label-profile.v4";
function profileFromStorage() {
  try {
    const p = normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null"));
    if (validProfile(p)) return p;
  } catch {
    /* Use adjustable starting profile. */
  }
  return STARTING_LABEL_PROFILE;
}
function ThermalLabels({ labels, profile }: { labels: Sticker[]; profile: LabelProfile }) {
  return (
    <>
      {labelPages(labels, profile).map((page, index) => (
        <div className="label-page" key={index}>
          {page.map((l, i) => {
            const symbol = symbolSize(l.code, profile);
            return (
              <article className="sticker" key={i}>
                <div className={`label-content${l.price ? " with-price" : ""}`}>
                  {l.description && <p>{l.description}</p>}
                  <p className="name">{l.name}</p>
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
                  {l.price && <p className="price">{l.price}</p>}
                </div>
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
  const pages = valid ? labelPages(labels, profile).length : 0;
  const applyPreset = (preset: "showroom-roll" | "thermal-1" | "a4-2x7" | "a4-3x8") => {
    const presets: Record<typeof preset, LabelProfile> = {
      "showroom-roll": STARTING_LABEL_PROFILE,
      "thermal-1": {
        mode: "roll",
        width: 101.6,
        height: 25.4,
        columns: 1,
        rows: 1,
        gap: 0,
        rowGap: 0,
        pageWidth: 0,
        pageHeight: 0,
        margin: 0,
        dpi: 203,
      },
      "a4-2x7": {
        mode: "sheet",
        width: 90,
        height: 37,
        columns: 2,
        rows: 7,
        gap: 5,
        rowGap: 2,
        pageWidth: 210,
        pageHeight: 297,
        margin: 8,
        dpi: 300,
      },
      "a4-3x8": {
        mode: "sheet",
        width: 60,
        height: 30,
        columns: 3,
        rows: 8,
        gap: 3,
        rowGap: 2,
        pageWidth: 210,
        pageHeight: 297,
        margin: 9,
        dpi: 300,
      },
    };
    setProfile(presets[preset]);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Print barcode labels</DialogTitle>
          <DialogDescription>
            Check the preview, print a test, then print your labels.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="text-sm">
            <p className="font-semibold">
              {profile.mode === "sheet"
                ? `${profile.pageWidth} × ${profile.pageHeight} mm page`
                : "Thermal roll"}
            </p>
            <p className="text-muted-foreground">
              {profile.width} × {profile.height} mm stickers · {profile.columns} across
              {profile.mode === "sheet" ? ` · ${profile.rows} rows` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => applyPreset("showroom-roll")}>
            Use showroom 40 × 30 roll
          </Button>
        </div>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <p className="my-3 text-xs text-muted-foreground">
            Change these only to match the sticker roll or paper loaded in the printer.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => applyPreset("thermal-1")}>
              1-up thermal roll
            </Button>
            <Button type="button" variant="outline" onClick={() => applyPreset("a4-2x7")}>
              A4 2 × 7 sheet
            </Button>
            <Button type="button" variant="outline" onClick={() => applyPreset("a4-3x8")}>
              A4 3 × 8 sheet
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Media type
              <select
                aria-label="Label media type"
                className="min-h-11 w-full rounded border p-2"
                value={profile.mode}
                onChange={(e) =>
                  setProfile({ ...profile, mode: e.target.value as LabelProfile["mode"] })
                }
              >
                <option value="roll">Continuous / thermal roll</option>
                <option value="sheet">Fixed printer page (4 × 6, A4, Letter, etc.)</option>
              </select>
            </label>
            {(
              [
                ["width", "Sticker width (mm)"],
                ["height", "Sticker height (mm)"],
                ["gap", "Gap between columns (mm)"],
                ["rowGap", "Gap between rows (mm)"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="text-sm">
                {label}
                <Input
                  type="number"
                  min={field === "gap" || field === "rowGap" ? 0 : field === "width" ? 12 : 10}
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
            {(
              (profile.mode === "roll"
                ? [["columns", "Labels across"]]
                : [
                    ["columns", "Labels across"],
                    ["rows", "Labels down per page"],
                  ]) as (readonly ["columns" | "rows", string])[]
            ).map(([field, label]) => (
              <label className="text-sm" key={field}>
                {label}
                <Input
                  type="number"
                  min={1}
                  max={field === "columns" ? 12 : 30}
                  step={1}
                  aria-label={label}
                  value={profile[field]}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      [field]: e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            {profile.mode === "sheet" && (
              <>
                {(
                  [
                    ["pageWidth", "Paper width (mm)"],
                    ["pageHeight", "Paper height (mm)"],
                    ["margin", "Paper margin (mm)"],
                  ] as const
                ).map(([field, label]) => (
                  <label className="text-sm" key={field}>
                    {label}
                    <Input
                      type="number"
                      min={0}
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
              </>
            )}
            <label className="text-sm">
              Printer resolution
              <Input
                type="number"
                min={100}
                max={1200}
                step={1}
                aria-label="Printer resolution"
                value={profile.dpi}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    dpi: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Match the printer driver’s media size to these measurements. Use 100% scale, no browser
            headers/footers and no extra margins. Calibrate thermal label gaps in the printer driver
            if required.
          </p>
        </details>
        <p className="text-sm" role="status">
          {labels.length} label{labels.length === 1 ? "" : "s"} · {pages} print page
          {pages === 1 ? "" : "s"}. {profile.columns} label{profile.columns === 1 ? "" : "s"} across
          each row.
        </p>
        <p className="text-xs text-muted-foreground">
          In Chrome, choose the label printer and use 100% scale with headers and footers off.
        </p>
        {!valid && <p role="alert">Enter dimensions that fit the selected roll or sheet.</p>}
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
            title="Barcode label preview"
            className="h-52 w-full rounded border bg-white"
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
                <ThermalLabels
                  labels={labels.slice(
                    0,
                    profile.mode === "roll" ? profile.columns : profile.columns * profile.rows,
                  )}
                  profile={profile}
                />,
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
                  frame.title = test ? "Barcode label test page" : title;
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
                      labels={
                        test
                          ? labels.slice(
                              0,
                              profile.mode === "roll"
                                ? profile.columns
                                : profile.columns * profile.rows,
                            )
                          : labels
                      }
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
              {test ? "Print test page" : "Print all labels"}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
