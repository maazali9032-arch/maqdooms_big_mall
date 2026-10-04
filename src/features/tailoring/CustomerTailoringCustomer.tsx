import { useState } from "react";
import { toast } from "sonner";
import { useCustomers, useCreateCustomer } from "@/features/customers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function CustomerTailoringCustomer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const customers = useCustomers();
  const create = useCreateCustomer();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const selected = customers.data?.find((c) => c.id === value);
  async function save() {
    try {
      if (!name.trim() && !phone.trim() && !whatsapp.trim())
        throw new Error("Enter customer identity or contact");
      const customer = await create.mutateAsync({ name, phone, whatsapp_phone: whatsapp });
      if (customer) {
        onChange(customer.id);
        toast.success("Customer selected");
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="ct-customer">Customer</Label>
      <select
        id="ct-customer"
        className="w-full rounded border bg-background p-2"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select customer</option>
        {customers.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name || c.phone || c.id}
          </option>
        ))}
      </select>
      {selected && (
        <p>
          Phone: {selected.phone || "—"} · WhatsApp: {selected.whatsapp_phone || "Not provided"}
        </p>
      )}
      {customers.error && (
        <p role="alert" className="text-destructive">
          {customers.error.message}
        </p>
      )}
      <div className="grid gap-2 md:grid-cols-3">
        <Input
          aria-label="Customer name"
          placeholder="Customer name"
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="Customer phone"
          placeholder="Phone"
          value={phone}
          disabled={disabled}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input
          aria-label="Customer WhatsApp"
          placeholder="WhatsApp number"
          value={whatsapp}
          disabled={disabled}
          onChange={(e) => setWhatsapp(e.target.value)}
        />
      </div>
      <Button variant="outline" disabled={disabled || create.isPending} onClick={() => void save()}>
        Create / find customer
      </Button>
    </div>
  );
}
