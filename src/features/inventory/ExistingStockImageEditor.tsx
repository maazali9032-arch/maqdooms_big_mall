import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StockImageInput } from "./StockImageInput";
import { saveStockImages, type StockImageKind } from "./stock-images";

export function ExistingStockImageEditor({
  itemId,
  kind,
  name,
  barcode,
  imageUrl,
  canManage,
}: {
  itemId: string;
  kind: StockImageKind;
  name: string;
  barcode: string;
  imageUrl?: string;
  canManage: boolean;
}) {
  const { userId } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in again before saving an image");
      if (!file) throw new Error("Choose or capture an image first");
      await saveStockImages(userId, [{ kind, itemId, file }]);
    },
    onSuccess: async () => {
      setOpen(false);
      setFile(null);
      await qc.invalidateQueries({ queryKey: ["stock-item-images", kind] });
      toast.success("Stock image saved");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Stock image could not be saved"),
  });

  if (!canManage) return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ImagePlus className="size-4" /> {imageUrl ? "Replace image" : "Add image"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !save.isPending) setFile(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{imageUrl ? "Replace" : "Add"} stock image</DialogTitle>
            <DialogDescription>
              {name} · {barcode}. This image applies only to this existing barcode.
            </DialogDescription>
          </DialogHeader>
          <StockImageInput
            label="Upload image"
            file={file}
            inheritedFile={null}
            onChange={setFile}
            disabled={save.isPending}
          />
          {imageUrl && !file && (
            <img src={imageUrl} alt={`${name} ${barcode}`} className="max-h-56 w-full rounded-md border object-contain" />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!file || save.isPending} onClick={() => save.mutate()}>
              Save image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
