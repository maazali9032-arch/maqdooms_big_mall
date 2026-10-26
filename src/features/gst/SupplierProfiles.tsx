import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SupplierProfile = {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

type SupplierDraft = Omit<SupplierProfile, "id"> & { id: string | null };

const blankSupplier = (): SupplierDraft => ({
  id: null,
  name: "",
  gstin: "",
  phone: "",
  email: "",
  address: "",
});

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "Supplier profile could not be saved";
}

export function SupplierProfiles() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SupplierDraft | null>(null);
  const [deleting, setDeleting] = useState<SupplierProfile | null>(null);
  const profiles = useQuery({
    queryKey: ["owner-supplier-profiles"],
    queryFn: async () => {
      const { data, error } = await rpc("owner_supplier_profiles");
      if (error) throw error;
      return (data ?? []) as SupplierProfile[];
    },
  });
  const save = useMutation({
    mutationFn: async (draft: SupplierDraft) => {
      const name = draft.name.trim();
      const gstin = (draft.gstin ?? "").trim().toUpperCase();
      if (!name) throw new Error("Enter the supplier name");
      if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin))
        throw new Error("Enter a valid 15-character supplier GSTIN");
      const { error } = await rpc("owner_save_supplier_profile", {
        p_id: draft.id,
        p_name: name,
        p_gstin: gstin,
        p_phone: draft.phone ?? "",
        p_email: draft.email ?? "",
        p_address: draft.address ?? "",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEditing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-supplier-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
      ]);
      toast.success("Supplier profile saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: async (supplier: SupplierProfile) => {
      const { error } = await rpc("owner_delete_supplier_profile", { p_id: supplier.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      setDeleting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-supplier-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
      ]);
      toast.success("Supplier profile deleted");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Panel
      title="Supplier profiles"
      description="Save business supplier details once. Selecting the supplier during Fabric, Readymade or Materials stock entry automatically fills these fields."
      actions={
        <Button size="sm" onClick={() => setEditing(blankSupplier())}>
          <Plus className="size-4" /> Add supplier
        </Button>
      }
    >
      {editing ? (
        <div className="mb-4 rounded-xl border bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-sm font-medium">
              Supplier / business name
              <Input
                autoFocus
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="For example: Arvind"
              />
            </label>
            <label className="text-sm font-medium">
              GSTIN
              <Input
                value={editing.gstin ?? ""}
                maxLength={15}
                onChange={(event) =>
                  setEditing({ ...editing, gstin: event.target.value.toUpperCase() })
                }
                placeholder="15-character GSTIN"
              />
            </label>
            <label className="text-sm font-medium">
              Phone
              <Input
                value={editing.phone ?? ""}
                onChange={(event) => setEditing({ ...editing, phone: event.target.value })}
                placeholder="Supplier contact number"
              />
            </label>
            <label className="text-sm font-medium">
              Email
              <Input
                type="email"
                value={editing.email ?? ""}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
                placeholder="accounts@supplier.com"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Address
              <Input
                value={editing.address ?? ""}
                onChange={(event) => setEditing({ ...editing, address: event.target.value })}
                placeholder="Registered business address"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(editing)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save supplier"}
            </Button>
          </div>
        </div>
      ) : null}

      {profiles.isPending ? (
        <p className="text-sm text-muted-foreground">Loading suppliers…</p>
      ) : null}
      {profiles.error ? (
        <p role="alert" className="text-sm text-destructive">
          Supplier profiles could not be loaded. {errorMessage(profiles.error)}
        </p>
      ) : null}
      {!profiles.isPending && !profiles.error && profiles.data?.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No supplier profiles yet. Add the first supplier to enable Stock Entry autofill.
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {profiles.data?.map((supplier) => (
          <article key={supplier.id} className="flex min-w-0 gap-3 rounded-xl border p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{supplier.name}</h3>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {supplier.gstin || "GSTIN not added"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing({ ...supplier })}
                    aria-label={`Edit ${supplier.name}`}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(supplier)}
                    aria-label={`Delete ${supplier.name}`}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <span>{supplier.phone || "No phone"}</span>
                <span className="truncate">{supplier.email || "No email"}</span>
                <span className="sm:col-span-2">{supplier.address || "No address"}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the supplier from future stock-entry choices. It cannot be deleted if it
              is already linked to an existing fabric batch, so historic stock remains traceable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending || !deleting}
              onClick={(event) => {
                event.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete supplier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
