import { createContext, useContext } from "react";
export const ROLE_LABELS = { owner: "Owner", stock_entry: "Stock Entry", counter: "Counter" };
export const SessionContext = createContext({
  isOwner: false,
  roles: ["stock_entry"],
  permissions: ["inventory.receive"],
  userId: "fixture",
  fullName: "Fixture Staff",
  email: "fixture@example.test",
  loading: false,
  can: (key: string) => key === "inventory.receive",
});
export const useSession = () => useContext(SessionContext);
