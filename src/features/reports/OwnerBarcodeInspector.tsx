import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Barcode, Camera, ChevronRight } from "lucide-react";
import { useSession } from "@/app/providers/session";
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
import { InspectorRecordView } from "./InspectorRecordView";

type Fields = Record<string, unknown>;
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
  matches?: { kind: string; id: string }[];
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
/** Dashboard inspector is available at every screen size; Owner access is still required. */
export function OwnerBarcodeInspector() {
  const { isOwner } = useSession();
  return isOwner ? <Inspector /> : null;
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
          className="mx-auto flex h-[92dvh] max-h-[92dvh] max-w-3xl flex-col rounded-t-3xl bg-[#faf9f6] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
        >
          <div aria-hidden="true" className="mx-auto h-1 w-12 shrink-0 rounded-full bg-border" />
          <SheetHeader className="shrink-0 pr-6 text-left">
            <SheetTitle>Global Barcode Inspector</SheetTitle>
            <SheetDescription>Owner view · Read-only recorded lifecycle</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
            {camera ? (
              <BarcodeCamera onScan={inspect} onStop={() => setCamera(false)} />
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-14 w-full justify-start rounded-xl bg-white px-4 text-base shadow-sm"
                onClick={() => setCamera(true)}
              >
                <Camera className="mr-2 size-5" /> Scan another barcode
                <ChevronRight className="ml-auto size-4" />
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
              <InspectorRecordView
                key={record.barcode}
                record={record}
                events={events}
                refreshing={history.isFetching}
                onRefresh={() => void history.refetch()}
                hasNextPage={!!history.hasNextPage}
                loadingMore={history.isFetchingNextPage}
                onLoadMore={() => void history.fetchNextPage()}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
