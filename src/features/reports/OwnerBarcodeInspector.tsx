import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Barcode, Camera, RefreshCw } from "lucide-react";
import { useSession } from "@/app/providers/session";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { BarcodeCamera } from "@/shared/components/barcode-camera";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { fieldText } from "./EvidenceViews";
import { title } from "./evidence-model";

type Fields = Record<string, unknown>;
const labels: Record<string, string> = {
  latest_cp_paise_per_m: "Current CP / lagat per metre",
  latest_cp_paise: "Current recorded piece CP / lagat",
  latest_sp_paise: "Current selling price",
  cp_paise_per_m: "Recorded CP / lagat per metre",
  cp_snapshot_paise: "Recorded sale CP snapshot",
  unlocated_legacy_quantity_mm: "Legacy balance (location not reconciled)",
};
type Cursor = { before: string; key: string } | null;
type Evidence = {
  key: string;
  source: string;
  title: string;
  event_at?: string;
  actor_id?: string | null;
  actor?: string | null;
  data: Fields;
};
export type BarcodeInspection = {
  barcode: string;
  status: "found" | "unknown" | "ambiguous";
  items: Fields[];
  current_stock: Fields[];
  linked_records: Evidence[];
  undated_records: Evidence[];
  events: Evidence[];
  next_cursor: Cursor;
  total_events: number;
  inspected_at: string;
  history_note: string;
};
function FieldsView({ data }: { data: Fields }) {
  return (
    <dl className="space-y-2 text-sm">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="min-w-0 border-b border-border/50 pb-2 last:border-0">
          <dt className="text-xs text-muted-foreground">{labels[key] ?? title(key)}</dt>
          <dd className="mt-1 break-words [overflow-wrap:anywhere]">
            {value !== null && typeof value === "object" ? (
              <details className="rounded border p-2">
                <summary className="cursor-pointer">
                  View recorded {title(key).toLowerCase()}
                </summary>
                <div className="mt-2 border-l pl-2">
                  {Array.isArray(value) ? (
                    value.length ? (
                      value.map((entry, index) => (
                        <div key={index} className="mb-3">
                          {entry && typeof entry === "object" ? (
                            <FieldsView data={entry as Fields} />
                          ) : (
                            String(entry ?? "Not recorded")
                          )}
                        </div>
                      ))
                    ) : (
                      "No recorded entries"
                    )
                  ) : (
                    <FieldsView data={value as Fields} />
                  )}
                </div>
              </details>
            ) : (
              fieldText(key, value, data)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function EvidenceCard({ event }: { event: Evidence }) {
  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="cursor-pointer text-sm">
        <strong>{event.title}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          {event.event_at
            ? new Date(event.event_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) +
              " (India)"
            : "Timestamp not recorded"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {event.actor ?? event.actor_id ?? "Responsible user not recorded"}
        </span>
      </summary>
      <div className="mt-3">
        <p className="mb-2 text-xs text-muted-foreground">Evidence: {event.source}</p>
        <FieldsView data={event.data} />
      </div>
    </details>
  );
}

/** Mounted only by the Dashboard; width and Owner checks also remove the camera on resize/logout. */
export function OwnerBarcodeInspector() {
  const { isOwner } = useSession();
  const mobile = useIsMobile();
  const [phone, setPhone] = useState(false);
  const [shortViewport, setShortViewport] = useState(false);
  useEffect(() => {
    const pointer = window.matchMedia("(pointer: coarse)");
    const short = window.matchMedia("(max-height: 767px)");
    const update = () => {
      const agent = navigator.userAgent;
      const tablet =
        /iPad|Tablet|Kindle|Silk/i.test(agent) ||
        (/Android/i.test(agent) && !/Mobile/i.test(agent)) ||
        (/Macintosh/i.test(agent) && navigator.maxTouchPoints > 1);
      setPhone(pointer.matches && /Mobi|iPhone|iPod/i.test(agent) && !tablet);
      setShortViewport(short.matches);
    };
    update();
    pointer.addEventListener("change", update);
    short.addEventListener("change", update);
    return () => {
      pointer.removeEventListener("change", update);
      short.removeEventListener("change", update);
    };
  }, []);
  return isOwner && (mobile || shortViewport) && phone ? <Inspector /> : null;
}
function Inspector() {
  const { userId } = useSession();
  const [open, setOpen] = useState(false),
    [camera, setCamera] = useState(false);
  const [entry, setEntry] = useState(""),
    [barcode, setBarcode] = useState("");
  const history = useInfiniteQuery({
    queryKey: ["owner-barcode-inspector", userId, barcode],
    enabled: open && !!barcode,
    initialPageParam: null as Cursor,
    retry: false,
    gcTime: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("owner_barcode_inspect", {
        p_barcode: barcode,
        p_limit: 50,
        ...(pageParam ? { p_before: pageParam.before, p_before_key: pageParam.key } : {}),
      });
      if (error) throw error;
      return data as unknown as BarcodeInspection;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const record = history.data?.pages[0];
  const events = history.data?.pages.flatMap((page) => page.events ?? []) ?? [];
  const inspect = (code: string) => {
    setCamera(false);
    setEntry(code);
    setBarcode(code);
    if (code === barcode) void history.refetch();
  };
  const changeOpen = (value: boolean) => {
    setOpen(value);
    setCamera(value);
    if (!value) {
      setBarcode("");
      setEntry("");
    }
  };
  return (
    <>
      <Button
        type="button"
        aria-label="Open Global Barcode Inspector"
        size="icon"
        className="fixed right-4 z-40 size-14 rounded-full shadow-lg"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={() => changeOpen(true)}
      >
        <Barcode className="size-6" />
      </Button>
      <Sheet open={open} onOpenChange={changeOpen}>
        <SheetContent
          side="bottom"
          className="flex h-[92dvh] max-h-[92dvh] flex-col rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="shrink-0 pr-6 text-left">
            <SheetTitle>Global Barcode Inspector</SheetTitle>
            <SheetDescription>Owner view · Read-only recorded lifecycle</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
            {camera ? (
              <BarcodeCamera onScan={inspect} onStop={() => setCamera(false)} />
            ) : (
              <Button type="button" variant="outline" onClick={() => setCamera(true)}>
                <Camera className="size-4" /> Scan another barcode
              </Button>
            )}
            <BarcodeEntry
              value={entry}
              onChange={setEntry}
              onScan={inspect}
              label="Inspect barcode"
              action="Inspect"
            />
            {barcode && history.isPending && <p role="status">Loading recorded history…</p>}
            {history.error && (
              <div role="alert" className="space-y-2 text-sm">
                <p>Inspection could not load. {history.error.message}</p>
                <Button variant="outline" onClick={() => void history.refetch()}>
                  Retry inspection
                </Button>
              </div>
            )}
            {record?.status === "unknown" && (
              <p role="status" className="rounded-xl border p-4 text-sm">
                No recorded barcode matches “{record.barcode}”. Check the code or scan again.
              </p>
            )}
            {record?.status === "ambiguous" && (
              <p role="status" className="rounded-xl border p-4 text-sm">
                This code matches multiple records. Scan the item’s unique barcode.
              </p>
            )}
            {record?.status === "found" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="break-all">{record.barcode}</strong>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={history.isFetching}
                    onClick={() => void history.refetch()}
                  >
                    <RefreshCw className="size-4" /> Refresh
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Checked{" "}
                  {new Date(record.inspected_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  (India). {record.history_note}
                </p>
                <section aria-label="Item details" className="space-y-3">
                  <h3 className="font-semibold">Item details &amp; CP / lagat</h3>
                  {record.items.map((item, index) => (
                    <div key={index} className="rounded-xl border p-3">
                      <FieldsView data={item} />
                    </div>
                  ))}
                  {!record.items.length && (
                    <p className="text-sm">No physical item details recorded.</p>
                  )}
                </section>
                <section aria-label="Current stock and location" className="space-y-3">
                  <h3 className="font-semibold">Current stock &amp; location</h3>
                  {record.current_stock.map((stock, index) => (
                    <div key={index} className="rounded-xl border p-3">
                      <FieldsView data={stock} />
                    </div>
                  ))}
                  {!record.current_stock.length && (
                    <p className="text-sm">No reconciled location balance recorded.</p>
                  )}
                </section>
                {!!record.linked_records.length && (
                  <section aria-label="Linked orders and jobs" className="space-y-2">
                    <h3 className="font-semibold">Linked orders &amp; jobs</h3>
                    {record.linked_records.map((event, index) => (
                      <EvidenceCard key={index} event={event} />
                    ))}
                  </section>
                )}
                <section aria-label="Recorded lifecycle" className="space-y-2">
                  <h3 className="font-semibold">Recorded lifecycle ({record.total_events})</h3>
                  {events.map((event) => (
                    <EvidenceCard key={event.key} event={event} />
                  ))}
                  {!events.length && <p className="text-sm">No timestamped events recorded.</p>}
                  {history.hasNextPage && (
                    <Button
                      variant="outline"
                      disabled={history.isFetchingNextPage}
                      onClick={() => void history.fetchNextPage()}
                    >
                      {history.isFetchingNextPage ? "Loading…" : "Load older events"}
                    </Button>
                  )}
                </section>
                {!!record.undated_records.length && (
                  <section className="space-y-2">
                    <h3 className="font-semibold">Records without captured timestamps</h3>
                    {record.undated_records.map((event) => (
                      <EvidenceCard key={event.key} event={event} />
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
