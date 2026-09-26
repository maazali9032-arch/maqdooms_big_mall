import { useState } from "react";
import { toast } from "sonner";
import {
  useCorrectIncompleteThaan,
  useEnsureFabric,
  type ThaanOverview,
} from "@/features/inventory";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { parseMetreInput, parseRupeeInput } from "@/shared/utils/units";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ThaanEditor({
  thaan,
  costPaise,
  showCost,
  fabricNames,
  onClose,
}: {
  thaan: ThaanOverview;
  costPaise: number | null;
  showCost: boolean;
  fabricNames: string[];
  onClose: () => void;
}) {
  const correct = useCorrectIncompleteThaan();
  const ensureFabric = useEnsureFabric();
  const [form, setForm] = useState({
    fabric: thaan.fabric_name ?? "",
    length: thaan.original_mm !== null ? String(thaan.original_mm / 1000) : "",
    width: thaan.width_mm !== null ? String(thaan.width_mm / 1000) : "",
    price: thaan.price_paise !== null ? String(thaan.price_paise / 100) : "",
    cost: costPaise !== null ? String(costPaise / 100) : "",
  });

  async function save() {
    try {
      const originalMm = form.length ? parseMetreInput(form.length) : null;
      const widthMm = form.width ? parseMetreInput(form.width) : null;
      const pricePaise = form.price ? parseRupeeInput(form.price) : null;
      const cost = form.cost ? parseRupeeInput(form.cost) : null;
      if (form.length && originalMm === null) throw new Error("Enter a valid length");
      if (form.width && widthMm === null) throw new Error("Enter a valid width");
      if (form.price && pricePaise === null) throw new Error("Enter a valid selling price");
      if (form.cost && cost === null) throw new Error("Enter a valid laagat");
      const fabricId = form.fabric ? await ensureFabric.mutateAsync(form.fabric) : null;
      const result = await correct.mutateAsync({
        thaan_id: thaan.id,
        fabric_id: fabricId,
        original_mm: originalMm,
        width_mm: widthMm,
        price_paise: pricePaise,
        cost_paise: showCost ? cost : null,
      });
      toast.success(
        result.activated
          ? `${thaan.barcode} completed and activated`
          : `${thaan.barcode} updated${result.complete ? "" : " — required details are still missing"}`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="numeric">Edit {thaan.barcode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Fabric</Label>
            <PickOrTypeInput
              value={form.fabric}
              onChange={(fabric) => setForm({ ...form, fabric })}
              options={fabricNames}
              placeholder="Select or type new"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Length (m)</Label>
              <Input
                inputMode="decimal"
                value={form.length}
                onChange={(event) => setForm({ ...form, length: event.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Width (m)</Label>
              <Input
                inputMode="decimal"
                value={form.width}
                onChange={(event) => setForm({ ...form, width: event.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sell ₹/m</Label>
              <Input
                inputMode="decimal"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                className="h-11"
              />
            </div>
            {showCost ? (
              <div className="space-y-1.5">
                <Label>Laagat ₹/m</Label>
                <Input
                  inputMode="decimal"
                  value={form.cost}
                  onChange={(event) => setForm({ ...form, cost: event.target.value })}
                  className="h-11"
                />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={correct.isPending || ensureFabric.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
