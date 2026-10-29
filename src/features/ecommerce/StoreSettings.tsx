import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/shared/components/page";
import { useEcomAction, useStoreSettings } from "./admin-api";

/** The WhatsApp number behind the website's "Order on WhatsApp" button. */
export function StoreSettings() {
  const settings = useStoreSettings();
  const { saveSettings } = useEcomAction();
  const [number, setNumber] = useState("");
  useEffect(() => {
    if (settings.data) setNumber(settings.data.whatsapp_number);
  }, [settings.data]);
  const digits = number.replace(/\D/g, "");
  const preview = digits.length === 10 ? `91${digits}` : digits;
  return (
    <Panel
      title="Store settings"
      description="Shoppers tap 'Order on WhatsApp' on a product page and a chat opens with the product name and link."
    >
      <div className="max-w-md space-y-3">
        <div className="space-y-1">
          <Label htmlFor="wa">
            WhatsApp number (with country code, or a 10-digit Indian mobile)
          </Label>
          <Input
            id="wa"
            inputMode="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Chat link: wa.me/{preview || "…"}</p>
        </div>
        <Button
          disabled={!digits || saveSettings.isPending || preview === settings.data?.whatsapp_number}
          onClick={() =>
            saveSettings.mutate(number, {
              onSuccess: () => toast.success("WhatsApp number saved"),
              onError: (e) => toast.error(e.message),
            })
          }
        >
          Save
        </Button>
      </div>
    </Panel>
  );
}
