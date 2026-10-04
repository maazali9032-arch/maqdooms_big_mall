import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HierarchyManagement } from "./HierarchyManagement";
export function CustomerTailoringSetup() {
  const qc = useQueryClient();
  const [chargeCode, setChargeCode] = useState("");
  const [chargeName, setChargeName] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const charge = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("set_customer_tailoring_charge", {
        p_code: chargeCode.trim(),
        p_name: chargeName.trim(),
        p_amount: fabricMoneyInput(chargeAmount),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Applicable Tailoring Charge saved");
      void qc.invalidateQueries({ queryKey: ["customer-tailoring"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <HierarchyManagement />
      <Panel
        title="Customer Tailoring charges"
        description="Owner: configure the applicable charge. Booked jobs retain their original price."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            aria-label="Tailoring charge code"
            placeholder="Charge code"
            value={chargeCode}
            onChange={(e) => setChargeCode(e.target.value)}
          />
          <Input
            aria-label="Tailoring charge name"
            placeholder="Applicable charge name"
            value={chargeName}
            onChange={(e) => setChargeName(e.target.value)}
          />
          <Input
            aria-label="Tailoring charge rupees"
            placeholder="Applicable amount in rupees"
            inputMode="decimal"
            value={chargeAmount}
            onChange={(e) => setChargeAmount(e.target.value)}
          />
        </div>
        <Button className="mt-3" disabled={charge.isPending} onClick={() => charge.mutate()}>
          Save charge revision
        </Button>
      </Panel>
    </>
  );
}
