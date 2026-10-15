import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
type Request = {
  p_request: string;
  p_kind: string;
  p_id: string;
  p_expected_name: string;
  p_expected_active: boolean;
};
export function DeleteDefinition({
  kind,
  item,
  disabled = false,
  onDeleted,
}: {
  kind: "floor" | "product" | "design";
  item: { id: string; name: string; active: boolean };
  disabled?: boolean;
  onDeleted?: () => void;
}) {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState<Request | null>(null),
    [error, setError] = useState("");
  const remove = useMutation({
    mutationFn: async (args: Request) => {
      setPending(args);
      setError("");
      const { error } = await supabase.rpc("owner_delete_definition", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setOpen(false);
      onDeleted?.();
      void qc.invalidateQueries();
      toast.success(
        `${kind === "floor" ? "Floor" : kind === "product" ? "Product type" : "Design"} deleted from future choices`,
      );
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      setError(e.message);
    },
  });
  if (!isOwner) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!remove.isPending && !pending) {
          setOpen(v);
          setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          disabled={disabled}
          aria-label={`Delete ${item.name}`}
        >
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the {kind === "product" ? "product type" : kind} from administration and
            future work choices. Existing stock, jobs, transactions and audit history remain intact.
            {kind === "floor" ? " A floor must be empty before it can be deleted." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {pending && !remove.isPending && (
          <p className="text-sm">
            The result is uncertain. Retry the unchanged deletion to confirm it.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending || !!pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                pending ?? {
                  p_request: crypto.randomUUID(),
                  p_kind: kind,
                  p_id: item.id,
                  p_expected_name: item.name,
                  p_expected_active: item.active,
                },
              )
            }
          >
            {remove.isPending ? "Deleting…" : pending ? "Retry deletion" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
