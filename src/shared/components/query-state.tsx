import { Button } from "@/components/ui/button";

export function QueryState({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
}) {
  if (error)
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
        <p>Could not load this data. Check your connection and try again.</p>
        {retry ? (
          <Button type="button" variant="outline" className="mt-2" onClick={retry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  if (loading)
    return (
      <p
        role="status"
        aria-live="polite"
        className="animate-pulse p-4 text-sm text-muted-foreground"
      >
        Loading recorded data…
      </p>
    );
  return null;
}
