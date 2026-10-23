import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel } from "@/shared/components/page";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { ProductionDocument } from "@/features/tailoring/ProductionDocument";
import { BarcodeCameraButton } from "@/shared/components/barcode-camera";
import type { Database } from "@/integrations/supabase/types";
type Request = Database["public"]["Functions"]["issue_additional_production_fabric"]["Args"];
export function ProductionFabricIssue() {
  const { isOwner, roles, can } = useSession();
  const allowed = isOwner || (roles.includes("counter") && can("pos.issue_to_tailoring"));
  const [code, setCode] = useState("");
  const [document, setDocument] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scan, setScan] = useState("");
  const [source, setSource] = useState("");
  const [metres, setMetres] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Request | null>(null);
  const qc = useQueryClient();
  const stock = useQuery({
    queryKey: ["pos-reserve-variants", scan],
    enabled: allowed && !!scan,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pos_reserve_variants", { p_barcode: scan });
      if (error) throw error;
      const rows = data as unknown as {
        barcode: string;
        cuts: { locations: { id: string; name: string; quantity_mm: number }[] }[];
      }[];
      const exact = rows.find((r) => r.barcode === scan);
      if (!exact) throw new Error("No available Thaan matches this barcode");
      return exact;
    },
  });
  const issue = useMutation({
    mutationFn: async () => {
      if (
        !pending &&
        (!document ||
          document !== code.trim() ||
          scan !== barcode.trim() ||
          !stock.data ||
          !source ||
          !reason.trim())
      )
        throw new Error("Scan Production ID and Thaan, then choose source, metres and reason");
      const args = pending ?? {
        p_request: crypto.randomUUID(),
        p_code: document,
        p_barcode: scan,
        p_source: source,
        p_quantity_mm: quantityInput(metres, "mm"),
        p_reason: reason.trim(),
      };
      setPending(args);
      const { error } = await supabase.rpc("issue_additional_production_fabric", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setBarcode("");
      setScan("");
      setMetres("");
      setSource("");
      setReason("");
      for (const key of [
        "production-document",
        "pos-reserve-variants",
        "owner-production",
        "direct-fabric-sale",
        "inventory",
        "location-ledger",
        "showroom-stock",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      toast.success("Additional fabric issued against the same Production ID");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  if (!allowed) return null;
  return (
    <Panel
      title="Additional production fabric"
      description="Scan the Production ID and Thaan barcode. Posting deducts metres from the selected source immediately."
    >
      <fieldset disabled={issue.isPending || !!pending} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Additional issue Production ID"
            placeholder="Scan or type Production ID"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setDocument("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setDocument(code.trim());
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => setDocument(code.trim())}
            disabled={!code.trim()}
          >
            Load Production ID
          </Button>
        </div>
        {document && <ProductionDocument code={document} />}
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Additional production Thaan barcode"
            placeholder="Scan or type Thaan barcode"
            value={barcode}
            onChange={(e) => {
              setBarcode(e.target.value);
              setScan("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSource("");
                setScan(barcode.trim());
              }
            }}
          />
          <Button
            variant="outline"
            disabled={!barcode.trim()}
            onClick={() => {
              setSource("");
              setScan(barcode.trim());
            }}
          >
            Scan Thaan
          </Button>
          <BarcodeCameraButton
            onScan={(code) => {
              setBarcode(code);
              setSource("");
              setScan(code);
            }}
          />
        </div>
        {stock.error && <p role="alert">{stock.error.message}</p>}
        <select
          aria-label="Additional production source"
          className="w-full rounded border bg-background p-2"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choose source</option>
          {stock.data?.cuts
            .flatMap((c) => c.locations)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {(l.quantity_mm / 1000).toFixed(3)} m available
              </option>
            ))}
        </select>
        <Input
          aria-label="Additional production metres"
          placeholder="Metres to issue"
          value={metres}
          onChange={(e) => setMetres(e.target.value)}
        />
        <Input
          aria-label="Additional production reason"
          placeholder="Additional fabric issue reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </fieldset>
      <Button
        className="mt-3"
        disabled={issue.isPending || stock.isFetching}
        onClick={() => issue.mutate()}
      >
        {pending ? "Retry same fabric issue" : "Issue additional fabric"}
      </Button>
    </Panel>
  );
}
