import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AiSuggestionResult = {
  title: string;
  description: string;
  tags: string[];
  seo_title: string;
  seo_description: string;
};

type ProductFacts = {
  title: string;
  offer: { kind: string; sizes?: { size: string | null }[] };
  stock: { kind: string; size?: string | null; colour?: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const clip = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Runs on the ERP server only. Reads the starred product photo and the ERP facts,
 * asks Gemini for shopper-facing text, and returns it for staff to review. Nothing
 * is saved here. The API key is a server secret (GEMINI_API_KEY), never sent to the browser.
 */
export const suggestProductText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; imagePath: string }) => {
    if (!UUID.test(input?.productId ?? "")) throw new Error("Invalid product");
    if (typeof input.imagePath !== "string" || !input.imagePath.startsWith(`${input.productId}/`))
      throw new Error("Choose one of this product's photos");
    return { productId: input.productId, imagePath: input.imagePath };
  })
  .handler(async ({ data, context }): Promise<AiSuggestionResult> => {
    const key = process.env["GEMINI_API_KEY"];
    if (!key) throw new Error("AI suggestions are not set up yet (GEMINI_API_KEY is missing)");
    const model = process.env["GEMINI_MODEL"] || "gemini-2.5-flash";

    // Also the permission check: only e-commerce staff can read the product.
    const { data: product, error } = await context.supabase.rpc("ecom_product_admin", {
      p_listing: data.productId,
    });
    if (error) throw new Error(error.message);
    const facts = product as unknown as ProductFacts;

    const base = process.env["SUPABASE_URL"];
    if (!base) throw new Error("Server is missing SUPABASE_URL");
    const photo = await fetch(
      `${base}/storage/v1/object/public/ecommerce-images/${data.imagePath.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!photo.ok) throw new Error("Could not read the product photo");
    const mime = photo.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
      throw new Error("Unsupported photo type");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Photo is too large");

    const sizes = [...new Set(facts.stock.map((s) => s.size).filter(Boolean))];
    const colours = [...new Set(facts.stock.map((s) => s.colour).filter(Boolean))];
    const prompt = [
      "You write product listings for MAQDOOM'S BIG MALL, an Indian menswear and fabric store (sherwanis, kurtas, waistcoats, suits, fabrics).",
      "Look at the photo and write shopper-facing text in clear English. Describe only what is visible or given below; never invent fabric composition, brand, discounts or delivery promises.",
      `Known facts: product "${facts.title}"; type ${facts.offer.kind}${sizes.length ? `; sizes ${sizes.join(", ")}` : ""}${colours.length ? `; colour ${colours.join(", ")}` : ""}.`,
      "Return JSON with: title (max 80 chars), description (2-4 short sentences, max 600 chars), tags (5-10 lowercase search words), seo_title (max 60 chars), seo_description (max 155 chars).",
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mime, data: toBase64(bytes) } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                description: { type: "STRING" },
                tags: { type: "ARRAY", items: { type: "STRING" } },
                seo_title: { type: "STRING" },
                seo_description: { type: "STRING" },
              },
              required: ["title", "description", "tags", "seo_title", "seo_description"],
            },
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI service error (${response.status}) ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("The AI reply could not be read; try again");
    }
    return {
      title: clip(parsed["title"], 120),
      description: clip(parsed["description"], 1000),
      tags: (Array.isArray(parsed["tags"]) ? parsed["tags"] : [])
        .map((t) => clip(t, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
      seo_title: clip(parsed["seo_title"], 70),
      seo_description: clip(parsed["seo_description"], 170),
    };
  });
