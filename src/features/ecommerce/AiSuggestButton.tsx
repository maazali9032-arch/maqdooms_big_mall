import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { suggestProductText, type AiSuggestionResult } from "./ai-suggest.functions";

export type AiSuggestion = Partial<AiSuggestionResult>;

/**
 * Asks the ERP server to suggest name, description, tags and search text from the
 * starred photo. Suggestions fill the form only; nothing is saved until staff press Save.
 */
export function AiSuggestButton({
  productId,
  thumbnail,
  onApply,
}: {
  productId: string;
  thumbnail: string | null;
  onApply: (s: AiSuggestion) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!thumbnail || busy}
        onClick={async () => {
          if (!thumbnail) return;
          setBusy(true);
          try {
            const s = await suggestProductText({ data: { productId, imagePath: thumbnail } });
            onApply(s);
            toast.success("Suggestions filled in. Review them, then press Save.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "AI suggestions failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Sparkles className="size-4" />
        {busy ? "Thinking…" : "Suggest with AI"}
      </Button>
      <span className="text-xs text-muted-foreground">
        {thumbnail
          ? "Uses the starred photo and the ERP details."
          : "Add a photo to use AI suggestions."}
      </span>
    </div>
  );
}
