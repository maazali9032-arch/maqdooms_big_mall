export type ReceiptJob = {
  id: string;
  code: string;
  scan_code?: string | null;
  bill_scan_code?: string | null;
  bill_code: string | null;
  garment: string;
  status: string;
  customer: string | null;
  design: string | null;
  factory?: string;
  tailor?: string;
};
export type FinishedReceiptMatch =
  | { kind: "customer"; id: string; code: string; scan_code?: string | null; jobs: ReceiptJob[] }
  | {
      kind: "production";
      id: string;
      code: string;
      scan_code?: string | null;
      status: string;
      name: string;
    };
