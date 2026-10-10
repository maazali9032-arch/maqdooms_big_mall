import { createContext, useContext } from "react";
export const ROLE_LABELS = { owner: "Owner", stock_entry: "Stock Entry", counter: "Counter" };
export const SessionContext = createContext({
  isOwner: false,
  roles: ["stock_entry"],
  permissions: [
    "inventory.receive",
    "stock.print_barcode",
    "inventory.fill_missing_cp",
    "stock.transfer",
  ],
  userId: "fixture",
  fullName: "Fixture Staff",
  email: "fixture@example.test",
  loading: false,
  can: (key: string) =>
    [
      "inventory.receive",
      "stock.print_barcode",
      "inventory.fill_missing_cp",
      "stock.transfer",
    ].includes(key),
});
export const useSession = () => useContext(SessionContext);
