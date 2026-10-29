import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AiSuggestion = {
  title?: string;
  description?: string;
  tags?: string[];
  seo_title?: string;
  seo_description?: string;
};

/** Photo-to-text suggestions (Phase C). Staff review every suggestion before saving. */
export function AiSuggestButton({
  thumbnail,
}: {
  productId: string;
  thumbnail: string | null;
  onApply: (s: AiSuggestion) => void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
      <Sparkles className="size-4" />
      {thumbnail ? "Suggest with AI (coming soon)" : "Add a photo to use AI suggestions"}
    </Button>
  );
}
