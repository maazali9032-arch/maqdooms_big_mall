import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarcodeSticker } from "./BarcodeSticker";
import { printFabricLabel } from "./fabric-label";
import { fabricMoneyInput } from "./fabric-entry-input";
import { reportMoney } from "@/features/reports/report-value";

type Job = {
  id: string;
  code: string;
  bill_code: string | null;
  garment: string;
  status: string;
  customer: string | null;
  design: string | null;
};
type FinishedItem = {
  id: string;
  job_id: string;
  job_code: string;
  bill_code: string | null;
  barcode: string;
  name: string;
  size: string;
  sp_paise: string;
  customer: string | null;
  design: string | null;
  status: string;
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

export function CustomerTailoringReceipt({ embedded = false }: { embedded?: boolean }) {
  const { isOwner, roles, can } = useSession();
  const allowed =
    isOwner ||
    (roles.includes("counter") && can("pos.issue_to_tailoring")) ||
    can("production.receive");
  const qc = useQueryClient();
  const label = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState("");
  const [jobId, setJobId] = useState("");
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [sp, setSp] = useState("");
  const [item, setItem] = useState<FinishedItem | null>(null);
  const jobs = useQuery({
    queryKey: ["customer-tailoring", "workshop-receipt", lookup],
    enabled: allowed && !!lookup,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_work", { p_code: lookup });
      if (error) throw error;
      return (data ?? []) as unknown as Job[];
    },
  });
  const receive = useMutation({
    mutationFn: async () => {
      if (!jobId || !name.trim() || !size.trim() || !sp.trim())
        throw new Error("Choose the tailoring job and enter name, size and SP");
      const { data, error } = await rpc("receive_customer_tailoring_finished_item", {
        p_request: crypto.randomUUID(),
        p_job: jobId,
        p_name: name.trim(),
        p_size: size.trim(),
        p_sp_paise: fabricMoneyInput(sp),
      });
      if (error) throw error;
      return data as FinishedItem;
    },
    onSuccess: (result) => {
      setItem(result);
      void qc.invalidateQueries();
      toast.success("Customer stitched item received and barcode generated");
    },
    onError: (error) => toast.error(error.message),
  });
  if (!allowed) return null;
  const selected = jobs.data?.find((job) => job.id === jobId);
  const content = (
    <div className="space-y-3">
      <BarcodeEntry
        value={code}
        onChange={setCode}
        label="Customer bill or tailoring ID"
        placeholder="Scan bill or tailoring ID"
        disabled={receive.isPending}
        onScan={(value) => {
          setLookup(value);
          setJobId("");
          setItem(null);
        }}
      />
      {jobs.error ? <p role="alert">{jobs.error.message}</p> : null}
      {jobs.data && !jobs.data.length ? <p>No matching customer tailoring job.</p> : null}
      {!!jobs.data?.length && (
        <select
          aria-label="Customer tailoring job to receive"
          className="w-full rounded-md border bg-background p-2"
          value={jobId}
          onChange={(event) => {
            const id = event.target.value;
            const job = jobs.data?.find((entry) => entry.id === id);
            setJobId(id);
            setName(job?.garment ?? "");
            setItem(null);
          }}
        >
          <option value="">Choose the stitched garment</option>
          {jobs.data.map((job) => (
            <option key={job.id} value={job.id}>
              {job.code} · {job.garment} · {job.customer || "Customer not recorded"}
            </option>
          ))}
        </select>
      )}
      {selected && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Finished-product name
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="text-sm">
            Size
            <Input value={size} onChange={(event) => setSize(event.target.value)} />
          </label>
          <label className="text-sm">
            SP ₹
            <Input inputMode="decimal" value={sp} onChange={(event) => setSp(event.target.value)} />
          </label>
        </div>
      )}
      {selected && (
        <Button disabled={receive.isPending} onClick={() => receive.mutate()}>
          Receive and generate finished barcode
        </Button>
      )}
      {item && (
        <div className="space-y-2 rounded-xl border p-3">
          <div ref={label}>
            <BarcodeSticker
              barcode={item.barcode}
              name={item.name}
              description={`${item.design || "Customer stitching"} · Size ${item.size}`}
              price={reportMoney(item.sp_paise)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              label.current && printFabricLabel(label.current, "Customer finished garment label")
            }
          >
            Print finished garment barcode
          </Button>
        </div>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <Panel
      title="Customer stitching receipt"
      description="Scan the customer bill or tailoring ID when the stitched garment returns to Workshop. The generated barcode belongs only to the finished garment."
    >
      {content}
    </Panel>
  );
}
