import { createContext, useContext } from "react";
export const ROLE_LABELS = {
  owner: "Owner",
  stock_entry: "Stock Entry",
  counter: "Counter",
  ecommerce_manager: "E-commerce Manager",
  salesperson: "Salesperson",
  tailor: "Tailor",
  production: "Production",
};
export const SessionContext = createContext({
  isOwner: true,
  roles: ["owner"],
  permissions: [] as string[],
  userId: "owner",
  fullName: "Owner Name",
  email: "owner@fixture.test",
  loading: false,
  can: (_key: string) => true,
  refresh: async () => {},
  signOut: async () => {},
  status: "authenticated",
});
export const useSession = () => useContext(SessionContext);
