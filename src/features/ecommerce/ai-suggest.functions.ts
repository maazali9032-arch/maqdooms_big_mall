import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AiSuggestionResult = {
  title: string;
  description: string;
  highlights: string[];
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

/** Google shows about 155 characters; always end with the WhatsApp call to action. */
function searchDescription(value: unknown) {
  const cta = "Order on WhatsApp.";
  const text = fit(value, 400).replace(/\s*Order on WhatsApp\.?\s*$/i, "");
  const lead = fit(text, 155 - cta.length - 2).replace(/[.\s]*$/, ".");
  return lead === "." ? cta : `${lead} ${cta}`;
}

/** Shortens at a word boundary so a long AI line never ends mid-word. */
function fit(value: unknown, max: number) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

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

    const colours = [...new Set(facts.stock.map((s) => s.colour).filter(Boolean))];
    const isFabric = facts.offer.kind === "fabric";
    // Website limits: card and page titles use a capitals display font, Google adds the store name.
    const prompt = [
      "You write product text for the website of MAQDOOM'S BIG MALL, an Indian menswear and fabric showroom (sherwanis, kurtas, kurta pajamas, waistcoats, suits, fabrics).",
      "Look at the photo. Describe only what is visible or given in the facts. Never invent fabric composition, feel (soft, breathable, luxurious), brand, embroidery technique, discounts, delivery or stock claims.",
      "Never mention a size anywhere (the website shows sizes separately and they change). Never mention the price.",
      "Write plain, confident English for shoppers. Avoid filler and hype: no 'exquisite', 'perfect for', 'ideal for', 'versatile', 'explore', 'discover', 'step out in style', 'elevate', 'must-have', 'premium quality', exclamation marks or emojis.",
      `Facts: staff name "${facts.title}"; ${isFabric ? "fabric sold by the metre" : "ready garment"}${colours.length ? `; colour ${colours.join(", ")}` : ""}.`,
      "Fields:",
      `- title: 3 to 6 words, at most 40 characters, Title Case. Pattern: colour + one key detail + ${isFabric ? "fabric type (e.g. Off-White Slub Cotton Fabric)" : "garment (e.g. Dark Teal Striped Kurta Pajama)"}. No size, no 'Men's', no store name, no words like premium or for menswear.`,
      `- description: exactly 2 sentences, 25 to 45 words in total. Sentence 1: what it is and the most visible details. Sentence 2: ${isFabric ? "what it can be tailored into" : "when to wear it (e.g. festivals, Eid, weddings, family functions, everyday)"}.`,
      `- highlights: 3 to 5 items, each 2 to 6 words, no full stop. Visible facts only: ${isFabric ? "colour, weave or texture, pattern, what it suits" : "colour, pattern, collar or neckline, sleeves, what the set includes"}.`,
      "- tags: 5 to 8 lowercase search words or short phrases that shoppers type. No size, no store name, no repeats of the same word.",
      "- seo_title: at most 38 characters (the store name is added after it). Usually the title, shortened if needed.",
      "- seo_description: 140 to 155 characters. One sentence with the product and its key detail, ending with: Order on WhatsApp.",
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
                highlights: { type: "ARRAY", items: { type: "STRING" } },
                tags: { type: "ARRAY", items: { type: "STRING" } },
                seo_title: { type: "STRING" },
                seo_description: { type: "STRING" },
              },
              required: [
                "title",
                "description",
                "highlights",
                "tags",
                "seo_title",
                "seo_description",
              ],
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
    const list = (v: unknown) => (Array.isArray(v) ? v : []);
    return {
      title: fit(parsed["title"], 60),
      description: fit(parsed["description"], 400),
      highlights: list(parsed["highlights"])
        .map((h) => fit(h, 60).replace(/[.。]+$/, ""))
        .filter(Boolean)
        .slice(0, 6),
      tags: [
        ...new Set(
          list(parsed["tags"])
            .map((t) => clip(t, 40).toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 8),
      seo_title: fit(parsed["seo_title"], 45),
      seo_description: searchDescription(parsed["seo_description"]),
    };
  });
