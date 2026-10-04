import { createContext, useContext } from "react";
export const TestSession = createContext({ isOwner: true });
export const useSession = () => useContext(TestSession);
