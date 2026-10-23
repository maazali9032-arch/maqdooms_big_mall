import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkshopInventory, type WorkshopRow } from "./WorkshopFabricStock";
import { quantityInput } from "./ledger-quantity";
import { fabricMoneyInput } from "./fabric-entry-input";
import { definiteDatabaseRejection } from "./consumable-input";
import { BarcodeCameraButton } from "@/shared/components/barcode-camera";

type Entry = {
  record: WorkshopRow;
  selected: boolean;
  colour: string;
  length: string;
  cp: string;
  status: string;
};
type Save = {
  id: string;
  thaan: string;
  version: string;
  changes: Record<string, string | number>;
  reason: string;
};
const fields = (record: WorkshopRow): Entry => ({
  record,
  selected: true,
  colour: record.colour ?? "",
  length:
    (record.original_mm === null ? record.saved_length_mm : record.workshop_mm) === null
      ? ""
      : String((record.original_mm === null ? record.saved_length_mm : record.workshop_mm)! / 1000),
  cp: record.cp_paise_per_m === null ? "" : String(record.cp_paise_per_m / 100),
  status: "",
});

export function ScannedThaanRows() {
  const inventory = useWorkshopInventory();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Save[]>([]);
  const frozen = busy || pending.length > 0;
  const selected = rows.filter((r) => r.selected);
  async function scan() {
    if (frozen || !barcode.trim()) return;
    setBusy(true);
    try {
      const fresh = await inventory.refetch();
      if (fresh.error) throw fresh.error;
      const found = fresh.data?.filter((r) => r.barcode === barcode.trim()) ?? [];
      if (!found.length)
        throw new Error(
          "No Workshop Thaan matches this barcode. Check its location/status in Inventory.",
        );
      setRows((old) => [
        ...old,
        ...found.filter((r) => !old.some((e) => e.record.thaan_id === r.thaan_id)).map(fields),
      ]);
      setBarcode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }
  function update(id: string, changes: Partial<Entry>) {
    setRows((old) => old.map((r) => (r.record.thaan_id === id ? { ...r, ...changes } : r)));
  }
  async function save() {
    if (busy) return;
    let work = pending;
    try {
      if (!work.length) {
        work = selected
          .map((entry) => {
            const r = entry.record;
            if (!r.can_edit) throw new Error(`${r.barcode}: editing permission required`);
            const changes: Save["changes"] = {};
            if (entry.colour !== (r.colour ?? "")) changes["colour"] = entry.colour.trim();
            const originalLength = r.original_mm === null ? r.saved_length_mm : r.workshop_mm;
            if (
              entry.length !== (originalLength === null ? "" : String(originalLength / 1000)) ||
              (r.original_mm === null && entry.length.trim())
            )
              changes["length_mm"] = quantityInput(entry.length, "mm");
            if (
              r.cp_visible &&
              entry.cp !== (r.cp_paise_per_m === null ? "" : String(r.cp_paise_per_m / 100))
            )
              changes["cp_paise_per_m"] = fabricMoneyInput(entry.cp);
            return {
              id: crypto.randomUUID(),
              thaan: r.thaan_id,
              version: r.version,
              changes,
              reason: reason.trim(),
            };
          })
          .filter((w) => Object.keys(w.changes).length);
        if (!work.length) throw new Error("No changed details in the selected rows.");
      }
      setBusy(true);
      setPending(work);
      for (let index = 0; index < work.length; index++) {
        const item = work[index]!;
        const { error } = await supabase.rpc("edit_workshop_thaan", {
          p_request: item.id,
          p_thaan: item.thaan,
          p_version: item.version,
          p_changes: item.changes,
          p_reason: item.reason,
        });
        if (error) {
          update(item.thaan, { status: error.message });
          setPending(definiteDatabaseRejection(error) ? [] : work.slice(index));
          throw error;
        }
        update(item.thaan, { status: "Saved", selected: false });
        setPending(work.slice(index + 1));
      }
      await qc.invalidateQueries();
      const fresh = await inventory.refetch();
      setRows((old) =>
        old.map((entry) => {
          const record = fresh.data?.find((r) => r.thaan_id === entry.record.thaan_id);
          return entry.status === "Saved" && record
            ? { ...fields(record), selected: false, status: "Saved" }
            : entry;
        }),
      );
      toast.success("Selected Thaan details saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Scan Existing Barcode"
      description="Scan multiple Thaans. Each scan adds a row; select the rows to edit their individual details."
    >
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void scan();
        }}
      >
        <Input
          ref={input}
          className="min-w-0 flex-1"
          aria-label="Thaan barcode"
          value={barcode}
          onChange={(event) => setBarcode(event.target.value)}
          placeholder="Scan barcode and press Enter"
          autoComplete="off"
          disabled={frozen}
        />
        <Button disabled={frozen || !barcode.trim()}>Scan Thaan</Button>
        <BarcodeCameraButton
          disabled={frozen}
          onScan={(code) => {
            setBarcode(code);
            window.setTimeout(() => void scan(), 0);
          }}
        />
      </form>
      {!!rows.length && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="Select all scanned Thaans"
                disabled={frozen}
                checked={rows.every((r) => r.selected)}
                onCheckedChange={(v) =>
                  setRows((old) => old.map((r) => ({ ...r, selected: Boolean(v) })))
                }
              />
              Select all
            </label>
            <span className="text-xs text-muted-foreground">
              {rows.length} scanned · {selected.length} selected
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2">Select</th>
                  <th>Thaan / batch / fabric</th>
                  <th>Colour</th>
                  <th>Length (m)</th>
                  <th>CP / metre</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const r = entry.record;
                  const disabled = frozen || !entry.selected || !r.can_edit;
                  return (
                    <tr key={r.thaan_id} className="border-b">
                      <td className="p-2">
                        <Checkbox
                          aria-label={`Select ${r.barcode}`}
                          checked={entry.selected}
                          disabled={frozen}
                          onCheckedChange={(v) => update(r.thaan_id, { selected: Boolean(v) })}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <p className="font-mono text-xs">{r.barcode}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.batch_code} · {r.type_name}
                        </p>
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={`Colour ${r.barcode}`}
                          value={entry.colour}
                          disabled={disabled}
                          onChange={(e) => update(r.thaan_id, { colour: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={`Length ${r.barcode}`}
                          inputMode="decimal"
                          value={entry.length}
                          disabled={
                            disabled ||
                            r.unlocated ||
                            (r.original_mm !== null && !r.can_correct_length)
                          }
                          onChange={(e) => update(r.thaan_id, { length: e.target.value })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          aria-label={`CP ${r.barcode}`}
                          inputMode="decimal"
                          value={r.cp_visible ? entry.cp : "Restricted"}
                          disabled={
                            disabled ||
                            !r.cp_visible ||
                            (!r.can_correct_cp && !(r.can_fill_cp && (r.cp_paise_per_m ?? 0) === 0))
                          }
                          onChange={(e) => update(r.thaan_id, { cp: e.target.value })}
                        />
                      </td>
                      <td className="p-2 text-xs">
                        {entry.status ||
                          (r.original_mm === null
                            ? "Awaiting measurement"
                            : r.can_edit
                              ? "Ready"
                              : "View only")}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          disabled={frozen}
                          aria-label={`Remove ${r.barcode}`}
                          onClick={() =>
                            setRows((old) => old.filter((e) => e.record.thaan_id !== r.thaan_id))
                          }
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            For unmeasured Thaans enter actual length. For measured stock this field corrects
            Workshop balance. Rows save separately; successful rows are marked Saved.
          </p>
          <Input
            aria-label="Scanned Thaan edit reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for recording/correcting these details (optional)"
            disabled={frozen}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || (!pending.length && !selected.length)}
              onClick={() => void save()}
            >
              {pending.length ? "Retry pending saves" : "Save selected Thaans"}
            </Button>
            <Button
              variant="outline"
              disabled={frozen}
              onClick={async () => {
                const fresh = await inventory.refetch();
                if (fresh.error) {
                  toast.error(fresh.error.message);
                  return;
                }
                setRows((old) =>
                  old.map((e) => {
                    const r = fresh.data?.find((r) => r.thaan_id === e.record.thaan_id);
                    return r ? fields(r) : e;
                  }),
                );
              }}
            >
              Reload saved details
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
