const items: Record<string, unknown> = {
  "FAB-1": {
    id: "fabric-1",
    kind: "fabric",
    name: "Cotton",
    barcode: "FAB-1",
    available_mm: 5000,
    locations: [{ name: "Showroom F1", quantity_mm: 5000 }],
  },
  "FAB-2": {
    id: "fabric-2",
    kind: "fabric",
    name: "Cotton",
    barcode: "FAB-2",
    available_mm: 10000,
    locations: [{ name: "Showroom F2", quantity_mm: 10000 }],
  },
  "PRODUCT-1": {
    id: "product-1",
    kind: "product",
    name: "Shirt",
    barcode: "PRODUCT-1",
    sp_paise: "125000",
    available_pieces: 1,
    locations: [{ name: "Showroom F3", quantity: 1 }],
  },
};
Object.assign(window, { listingSaves: [], listingInserts: [] });
export const supabase = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "ecommerce_scan_stock") {
      await new Promise((r) => setTimeout(r, 30));
      return items[String(args.p_barcode)]
        ? { data: items[String(args.p_barcode)], error: null }
        : { data: null, error: new Error("No available showroom item matches this barcode") };
    }
    if (name === "ecommerce_listing_links") return { data: [items["FAB-1"]], error: null };
    if (name === "save_ecommerce_listing_details") {
      await new Promise((r) => setTimeout(r, 120));
      (window as any).listingSaves.push(args);
      return { data: null, error: null };
    }
    throw new Error("Unexpected RPC " + name);
  },
  from: (name: string) => ({
    insert: (value: unknown) => {
      (window as any).listingInserts.push({ name, value });
      return {
        select: () => ({ single: async () => ({ data: { id: "new-listing" }, error: null }) }),
      };
    },
    delete: () => ({ eq: async () => ({ error: null }) }),
  }),
  storage: {
    from: () => ({
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({
          path,
          signedUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
        })),
      }),
      upload: async () => ({ error: null }),
      remove: async () => ({ error: null }),
    }),
  },
};
