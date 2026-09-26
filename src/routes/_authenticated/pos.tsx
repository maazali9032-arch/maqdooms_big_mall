import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  lookupThaan,
  useCompleteFabricSale,
  useIssueTailoringFabrics,
  useRecentSales,
} from "@/features/pos";
import { useCreateCustomer, useCustomers } from "@/features/customers";
import { useActiveTailors, useCreateJob, useEligibleTailoringJobs } from "@/features/tailoring";
import type { ThaanOverview } from "@/features/inventory";
import { PageHeader, Panel, StatusBadge, EmptyState } from "@/shared/components/page";
import { formatMetres, formatMoney, lineAmountPaise, parseMetreInput } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSession } from "@/app/providers/session";

type StagedFabricCut = {
  thaanId: string;
  barcode: string;
  fabric: string | null;
  lengthMm: number;
  pricePaise: number;
};

type SaleReceipt = {
  billNo: string;
  totalPaise: number;
  cuts: Array<StagedFabricCut & { remainingMm: number; amountPaise: number }>;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({
    meta: [
      { title: "Counter / POS — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Scan a thaan, check available length and cut fabric for sale or tailoring.",
      },
      { property: "og:title", content: "Counter / POS — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Scan a thaan, check available length and cut fabric.",
      },
    ],
  }),
  component: PosPage,
});

function PosPage() {
  const { can, isOwner, roles } = useSession();
  const canSell = can("pos.sell");
  const canIssue = can("pos.issue_to_tailoring");
  const canCreateJob = isOwner || roles.includes("counter");
  const completeSale = useCompleteFabricSale();
  const issueTailoring = useIssueTailoringFabrics();
  const createCustomer = useCreateCustomer();
  const createJob = useCreateJob();
  const customers = useCustomers(canSell);
  const jobs = useEligibleTailoringJobs(canIssue);
  const activeTailors = useActiveTailors(canCreateJob);
  const sales = useRecentSales(10, canSell);

  const [barcode, setBarcode] = useState("");
  const [thaan, setThaan] = useState<ThaanOverview | null>(null);
  const [length, setLength] = useState("");
  const [purpose, setPurpose] = useState<"sale" | "tailoring">(canSell ? "sale" : "tailoring");
  const [customerId, setCustomerId] = useState("");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", whatsapp: "" });
  const [jobId, setJobId] = useState("");
  const [stagedCuts, setStagedCuts] = useState<StagedFabricCut[]>([]);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [newJob, setNewJob] = useState({ garment: "", tailorId: "", notes: "" });
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canSell && canIssue) setPurpose("tailoring");
  }, [canIssue, canSell]);

  useEffect(() => {
    if (jobId && !jobs.isFetching && !(jobs.data ?? []).some((job) => job.id === jobId)) {
      setJobId("");
    }
  }, [jobId, jobs.data, jobs.isFetching]);

  const lengthMm = parseMetreInput(length);
  const amount =
    thaan?.price_paise && lengthMm ? lineAmountPaise(lengthMm, thaan.price_paise) : null;
  const selectedJob = (jobs.data ?? []).find((job) => job.id === jobId) ?? null;
  const stagedLengthMm = stagedCuts.reduce((sum, item) => sum + item.lengthMm, 0);
  const stagedValuePaise = stagedCuts.reduce(
    (sum, item) => sum + lineAmountPaise(item.lengthMm, item.pricePaise),
    0,
  );

  async function findThaan(e: React.FormEvent) {
    e.preventDefault();
    try {
      const found = await lookupThaan(barcode);
      if (!found) {
        toast.error(`Unknown barcode ${barcode}`);
        return;
      }
      setThaan(found);
      setReceipt(null);
    } catch {
      toast.error("Lookup failed");
    }
  }

  function addStagedCut() {
    if (!thaan || !lengthMm) {
      toast.error("Scan a thaan and enter a length in metres");
      return;
    }
    if (purpose === "tailoring" && !jobId) {
      toast.error("Select an assigned, available tailoring job");
      return;
    }
    if (thaan.status !== "active" || thaan.is_incomplete || thaan.price_paise === null) {
      toast.error("This thaan is not active and complete");
      return;
    }
    if (lengthMm > thaan.available_mm - thaan.held_mm) {
      toast.error("Cut length exceeds stock available after online holds");
      return;
    }
    if (stagedCuts.some((item) => item.thaanId === thaan.id)) {
      toast.error(`${thaan.barcode} is already staged. Remove it before adding it again.`);
      return;
    }

    setStagedCuts((items) => [
      ...items,
      {
        thaanId: thaan.id,
        barcode: thaan.barcode,
        fabric: thaan.fabric_name,
        lengthMm,
        pricePaise: thaan.price_paise!,
      },
    ]);
    toast.success(
      `${thaan.barcode} added — stock will change only after ${
        purpose === "sale" ? "completing the bill" : "final issue"
      }`,
    );
    setThaan(null);
    setBarcode("");
    setLength("");
    setReceipt(null);
    window.setTimeout(() => scanRef.current?.focus(), 0);
  }

  async function submitSale() {
    if (stagedCuts.length === 0) {
      toast.error("Add at least one fabric cut to the sale");
      return;
    }
    try {
      let saleCustomerId = customerId || null;
      const hasNewCustomerDetails = Object.values(newCustomer).some((value) => value.trim());
      if (customerMode === "new" && hasNewCustomerDetails) {
        const customer = await createCustomer.mutateAsync({
          name: newCustomer.name,
          phone: newCustomer.phone,
          whatsapp_phone: newCustomer.whatsapp,
        });
        saleCustomerId = customer?.id ?? null;
      } else if (customerMode === "new") {
        saleCustomerId = null;
      }

      const result = await completeSale.mutateAsync({
        customerId: saleCustomerId,
        items: stagedCuts.map((item) => ({
          barcode: item.barcode,
          lengthMm: item.lengthMm,
        })),
      });
      setReceipt({
        billNo: result.bill_no,
        totalPaise: result.total_paise,
        cuts: result.cuts.map((cutResult) => {
          const staged = stagedCuts.find((item) => item.barcode === cutResult.barcode)!;
          return {
            ...staged,
            remainingMm: cutResult.remaining_mm,
            amountPaise: cutResult.amount_paise,
          };
        }),
      });
      toast.success(
        `${result.item_count} fabric item${result.item_count === 1 ? "" : "s"} billed — ${formatMoney(result.total_paise)}`,
      );
      setStagedCuts([]);
      setThaan(null);
      setBarcode("");
      setLength("");
      setCustomerId("");
      if (customerMode === "new") {
        setNewCustomer({ name: "", phone: "", whatsapp: "" });
      }
      scanRef.current?.focus();
    } catch (err) {
      toast.error(errorMessage(err, "Sale rejected"));
    }
  }

  async function createTailoringJob(e: React.FormEvent) {
    e.preventDefault();
    if (!newJob.garment.trim() || !newJob.tailorId) {
      toast.error("Enter a garment and select an active Tailor");
      return;
    }
    try {
      const createdJobId = await createJob.mutateAsync({
        garment: newJob.garment,
        tailor_id: newJob.tailorId,
        notes: newJob.notes,
      });
      await jobs.refetch();
      setJobId(createdJobId);
      setNewJob({ garment: "", tailorId: "", notes: "" });
      setJobDialogOpen(false);
      toast.success("Tailoring job created and selected");
    } catch (err) {
      toast.error(errorMessage(err, "Could not create tailoring job"));
    }
  }

  async function issueStagedCuts() {
    if (!jobId || stagedCuts.length === 0) {
      toast.error("Select a job and add at least one fabric cut");
      return;
    }
    try {
      const result = await issueTailoring.mutateAsync({
        jobId,
        items: stagedCuts.map((item) => ({
          barcode: item.barcode,
          lengthMm: item.lengthMm,
        })),
      });
      toast.success(
        `${result.cut_count} fabric cut${result.cut_count === 1 ? "" : "s"} issued to ${selectedJob?.code ?? "tailoring job"}`,
      );
      setStagedCuts([]);
      setJobId("");
      setThaan(null);
      setBarcode("");
      setLength("");
      setReceipt(null);
      scanRef.current?.focus();
    } catch (err) {
      toast.error(errorMessage(err, "Tailoring issue rejected"));
    }
  }

  return (
    <>
      <PageHeader
        title="Counter"
        description="Scan a thaan barcode to begin. Every cut goes through the same ledger operation."
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Panel title="Scan thaan barcode">
            <form onSubmit={findThaan} className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={scanRef}
                autoFocus
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="TH-0001"
                className="numeric h-12 text-base"
              />
              <Button type="submit" className="h-12 sm:w-32">
                Look up
              </Button>
            </form>
          </Panel>

          {thaan ? (
            <Panel title={thaan.barcode} description={thaan.fabric_name ?? "Unassigned fabric"}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="label-eyebrow">Original</p>
                  <p className="numeric text-lg">{formatMetres(thaan.original_mm)}</p>
                </div>
                <div>
                  <p className="label-eyebrow">Available</p>
                  <p className="numeric text-lg font-semibold">
                    {formatMetres(thaan.available_mm)}
                  </p>
                </div>
                <div>
                  <p className="label-eyebrow">Held online</p>
                  <p className="numeric text-lg">{formatMetres(thaan.held_mm)}</p>
                </div>
                <div>
                  <p className="label-eyebrow">Selling / m</p>
                  <p className="numeric text-lg">{formatMoney(thaan.price_paise)}</p>
                </div>
              </div>
              <div className="mt-3">
                <StatusBadge status={thaan.is_incomplete ? "incomplete" : thaan.status} />
              </div>

              <div className="mt-5 space-y-3 border-t border-border pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cutlen">Length to cut (metres)</Label>
                    <Input
                      id="cutlen"
                      inputMode="decimal"
                      value={length}
                      onChange={(e) => setLength(e.target.value)}
                      placeholder="5.00"
                      className="numeric h-12 text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Purpose</Label>
                    <Select
                      value={purpose}
                      onValueChange={(v) => setPurpose(v as typeof purpose)}
                      disabled={stagedCuts.length > 0}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {canSell ? <SelectItem value="sale">Customer sale</SelectItem> : null}
                        {canIssue ? <SelectItem value="tailoring">Tailoring</SelectItem> : null}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {purpose === "sale" ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label>Customer (optional)</Label>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={customerMode === "existing" ? "secondary" : "ghost"}
                          onClick={() => setCustomerMode("existing")}
                        >
                          Existing
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={customerMode === "new" ? "secondary" : "ghost"}
                          onClick={() => setCustomerMode("new")}
                        >
                          New customer
                        </Button>
                      </div>
                    </div>

                    {customerMode === "existing" ? (
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger className="h-12">
                          <SelectValue placeholder="Walk-in" />
                        </SelectTrigger>
                        <SelectContent>
                          {(customers.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name ?? c.phone ?? c.whatsapp_phone ?? "Unnamed customer"}
                              {c.name && (c.phone || c.whatsapp_phone)
                                ? ` · ${c.phone ?? c.whatsapp_phone}`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input
                          aria-label="New customer name"
                          value={newCustomer.name}
                          onChange={(e) =>
                            setNewCustomer((current) => ({ ...current, name: e.target.value }))
                          }
                          placeholder="Name (optional)"
                        />
                        <Input
                          aria-label="New customer contact number"
                          inputMode="tel"
                          value={newCustomer.phone}
                          onChange={(e) =>
                            setNewCustomer((current) => ({ ...current, phone: e.target.value }))
                          }
                          placeholder="Contact (optional)"
                        />
                        <Input
                          aria-label="New customer WhatsApp number"
                          inputMode="tel"
                          value={newCustomer.whatsapp}
                          onChange={(e) =>
                            setNewCustomer((current) => ({ ...current, whatsapp: e.target.value }))
                          }
                          placeholder="WhatsApp (optional)"
                        />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Leave blank for a walk-in sale. Matching contact numbers reuse the existing
                      customer.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Tailoring job</Label>
                      {canCreateJob ? (
                        <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={stagedCuts.length > 0}
                            >
                              New job
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <form className="space-y-4" onSubmit={createTailoringJob}>
                              <DialogHeader>
                                <DialogTitle>Create tailoring job</DialogTitle>
                                <DialogDescription>
                                  Create one work order and assign it to an active Tailor account.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-1.5">
                                <Label htmlFor="pos-job-garment">Garment</Label>
                                <Input
                                  id="pos-job-garment"
                                  value={newJob.garment}
                                  onChange={(e) =>
                                    setNewJob((current) => ({
                                      ...current,
                                      garment: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g. Two-piece suit"
                                  autoFocus
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Assigned Tailor</Label>
                                <Select
                                  value={newJob.tailorId}
                                  onValueChange={(tailorId) =>
                                    setNewJob((current) => ({ ...current, tailorId }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select active Tailor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(activeTailors.data ?? []).map((tailor) => (
                                      <SelectItem key={tailor.id} value={tailor.id}>
                                        {tailor.full_name}
                                        {tailor.email ? ` · ${tailor.email}` : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {!activeTailors.isLoading &&
                                (activeTailors.data ?? []).length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No active Tailor accounts are available. Ask the Owner to assign
                                    the Tailor role first.
                                  </p>
                                ) : null}
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="pos-job-notes">Notes (optional)</Label>
                                <Input
                                  id="pos-job-notes"
                                  value={newJob.notes}
                                  onChange={(e) =>
                                    setNewJob((current) => ({
                                      ...current,
                                      notes: e.target.value,
                                    }))
                                  }
                                  placeholder="Measurements or instructions"
                                />
                              </div>
                              <DialogFooter>
                                <Button
                                  type="submit"
                                  disabled={
                                    createJob.isPending ||
                                    !newJob.garment.trim() ||
                                    !newJob.tailorId
                                  }
                                >
                                  Create and select job
                                </Button>
                              </DialogFooter>
                            </form>
                          </DialogContent>
                        </Dialog>
                      ) : null}
                    </div>
                    <Select
                      value={jobId}
                      onValueChange={setJobId}
                      disabled={
                        jobs.isLoading || (jobs.data ?? []).length === 0 || stagedCuts.length > 0
                      }
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue
                          placeholder={
                            jobs.isLoading ? "Loading assigned jobs…" : "Select assigned job"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(jobs.data ?? []).map((j) => (
                          <SelectItem key={j.id} value={j.id}>
                            {j.code} · {j.garment} · {j.tailor_name}
                            {j.tailor_email ? ` (${j.tailor_email})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!jobs.isLoading && (jobs.data ?? []).length === 0 ? (
                      <p className="rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No assigned open or in-progress tailoring jobs are available.
                      </p>
                    ) : null}
                    {stagedCuts.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        This job is locked while cuts are staged. Remove every staged cut to select
                        another job.
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="flex items-center justify-between rounded-sm bg-surface px-3 py-3">
                  <span className="text-sm text-muted-foreground">
                    {purpose === "sale" ? "Line amount" : "This cut selling value"}
                  </span>
                  <span className="numeric text-xl font-semibold">{formatMoney(amount)}</span>
                </div>

                <Button
                  className="h-12 w-full"
                  onClick={addStagedCut}
                  disabled={
                    completeSale.isPending ||
                    issueTailoring.isPending ||
                    (purpose === "tailoring" && !jobId)
                  }
                >
                  {purpose === "sale" ? "Add to sale" : "Add cut"}
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel>
              <EmptyState
                title="No thaan scanned"
                description="Scan a barcode to see available length, price and cutting options."
              />
            </Panel>
          )}

          {stagedCuts.length > 0 ? (
            <Panel
              title={purpose === "sale" ? "Items ready to bill" : "Cuts ready to issue"}
              description={
                purpose === "sale"
                  ? customerMode === "existing" && customerId
                    ? ((customers.data ?? []).find((customer) => customer.id === customerId)
                        ?.name ?? "Selected customer")
                    : customerMode === "new" &&
                        Object.values(newCustomer).some((value) => value.trim())
                      ? newCustomer.name.trim() ||
                        newCustomer.phone.trim() ||
                        newCustomer.whatsapp.trim()
                      : "Walk-in customer"
                  : selectedJob
                    ? `${selectedJob.code} · ${selectedJob.garment} · ${selectedJob.tailor_name}`
                    : "Selected tailoring job"
              }
              bodyClassName="p-0"
            >
              <div className="divide-y divide-border">
                {stagedCuts.map((item) => (
                  <div key={item.thaanId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="numeric text-sm font-medium">{item.barcode}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.fabric ?? "Unassigned fabric"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="numeric text-sm font-medium">{formatMetres(item.lengthMm)}</p>
                      <p className="numeric text-xs text-muted-foreground">
                        {formatMoney(lineAmountPaise(item.lengthMm, item.pricePaise))}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setStagedCuts((items) =>
                          items.filter((cutItem) => cutItem.thaanId !== item.thaanId),
                        )
                      }
                      disabled={issueTailoring.isPending || completeSale.isPending}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <div className="space-y-3 border-t border-border p-4">
                <div className="flex items-center justify-between gap-3 rounded-sm bg-surface px-3 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {stagedCuts.length} fabric {purpose === "sale" ? "item" : "cut"}
                      {stagedCuts.length === 1 ? "" : "s"}
                    </p>
                    <p className="numeric text-xs text-muted-foreground">
                      {formatMetres(stagedLengthMm)} total
                    </p>
                  </div>
                  <span className="numeric text-xl font-semibold">
                    {formatMoney(stagedValuePaise)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Stock has not been deducted yet. The final action revalidates every thaan and
                  commits all cuts together.
                </p>
                <Button
                  className="h-12 w-full"
                  onClick={purpose === "sale" ? submitSale : issueStagedCuts}
                  disabled={
                    purpose === "sale"
                      ? completeSale.isPending || createCustomer.isPending
                      : issueTailoring.isPending || !jobId
                  }
                >
                  {purpose === "sale"
                    ? completeSale.isPending || createCustomer.isPending
                      ? "Completing sale…"
                      : "Complete sale & cut"
                    : issueTailoring.isPending
                      ? "Issuing…"
                      : "Issue to tailoring"}
                </Button>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          {receipt ? (
            <Panel
              title="WhatsApp receipt preview"
              description="Nothing is sent — no provider is configured"
            >
              <pre className="whitespace-pre-wrap rounded-sm bg-surface p-3 text-xs leading-relaxed">
                {`Assalamu alaikum, thank you for shopping at Maqdoom's Big Mall.

Bill: ${receipt.billNo}
${receipt.cuts
  .map(
    (item) =>
      `${item.fabric ?? "Fabric"} (${item.barcode})\n${formatMetres(item.lengthMm)} — ${formatMoney(item.amountPaise)}`,
  )
  .join("\n")}

Total: ${formatMoney(receipt.totalPaise)}

We look forward to serving you again.`}
              </pre>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {receipt.cuts.map((item) => (
                  <p key={item.thaanId}>
                    Remaining on {item.barcode}: {formatMetres(item.remainingMm)}
                  </p>
                ))}
              </div>
            </Panel>
          ) : null}

          {canSell ? (
            <Panel title="Recent bills" bodyClassName="p-0">
              <div className="divide-y divide-border">
                {(sales.data ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="numeric text-xs font-medium">{s.bill_no}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {(s.customers as { name?: string | null } | null)?.name ?? "Walk-in"} ·{" "}
                        {formatDateTime(s.created_at)}
                      </p>
                    </div>
                    <span className="numeric text-sm">{formatMoney(s.total_paise)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
