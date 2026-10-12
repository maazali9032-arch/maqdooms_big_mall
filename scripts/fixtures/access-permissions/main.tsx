import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Route } from "@/routes/_authenticated/access";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import "@/styles.css";

const Page = Route.options.component!;
const root = createRootRoute({
  component: () => (
    <main className="mx-auto max-w-6xl space-y-5 p-5">
      <Page />
    </main>
  ),
});
const router = createRouter({
  routeTree: root,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
    <Toaster />
  </QueryClientProvider>,
);
