/** Customer stitching stages as staff see them. "open" and "in_progress" both mean Started. */
const LABELS: Record<string, string> = {
  draft: "Draft",
  open: "Started",
  in_progress: "Started",
  completed: "Completed",
  ready: "Delivery Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function stitchingStatusLabel(status: string) {
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export type StitchingGarment = {
  line_no: number;
  size: string;
  notes?: string | null;
  barcode?: string | null;
  sp_paise?: string | null;
};
