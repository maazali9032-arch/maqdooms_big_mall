import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ListingEditor } from "@/features/ecommerce/ListingEditor";
import { Toaster } from "sonner";
import "@/styles.css";
navigator.mediaDevices.getUserMedia = async () => {
  throw new DOMException("Denied", "NotAllowedError");
};
const edit = new URLSearchParams(location.search).has("edit");
function App() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <Toaster />
      {open ? (
        <ListingEditor
          listing={
            edit
              ? {
                  id: "existing",
                  title: "Existing cotton",
                  description: "Description",
                  category: "Fabric",
                  collection: "Summer",
                  tags: ["cotton", "summer"],
                  seo_title: "Existing SEO",
                  seo_description: "SEO description",
                  price_paise: 45000,
                  sale_price_paise: null,
                  stock_mode: "linked",
                  images: ["existing/image.jpg"],
                }
              : null
          }
          onClose={() => setOpen(false)}
        />
      ) : (
        <p>Editor closed</p>
      )}
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
