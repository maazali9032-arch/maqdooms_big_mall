export type ReceiptJob = {
  id: string;
  code: string;
  bill_code: string | null;
  garment: string;
  status: string;
  customer: string | null;
  design: string | null;
  factory?: string;
  tailor?: string;
};
export type FinishedReceiptMatch =
  | { kind: "customer"; id: string; code: string; jobs: ReceiptJob[] }
  | { kind: "production"; id: string; code: string; status: string; name: string };
