import { MutationCache, QueryClient } from "@tanstack/react-query";

/** Canonical dashboard/reports refresh after a successful controlled write. */
export function createWorkspaceQueryClient() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["owner-report-overview"] });
        void queryClient.invalidateQueries({ queryKey: ["owner-report"] });
      },
    }),
  });
  return queryClient;
}
