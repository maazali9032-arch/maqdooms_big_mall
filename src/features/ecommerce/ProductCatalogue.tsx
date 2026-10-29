import { useMemo, useState } from "react";
import { Home, Image, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Panel, StatusBadge } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { formatMoney } from "@/shared/utils/units";
import {
  SECTION_LABEL,
  priceLabel,
  publicImageUrl,
  stockLabel,
  useCatalogue,
  useCategories,
  type Section,
} from "./admin-api";
import { ProductEditor } from "./ProductEditor";

const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-sm";

/** All online products (drafts and published) as cards, with filters and the editor. */
export function ProductCatalogue({ onPublishNew }: { onPublishNew: () => void }) {
  const catalogue = useCatalogue();
  const categories = useCategories();
  const [editing, setEditing] = useState<string | null>(null);
  const [section, setSection] = useState<"" | Section>("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | "published" | "draft" | "sold_out">("");
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () =>
      (catalogue.data ?? []).filter(
        (p) =>
          (!section || p.section === section) &&
          (!category || p.category_id === category) &&
          (!status ||
            (status === "published" && p.published) ||
            (status === "draft" && !p.published) ||
            (status === "sold_out" && p.offer.sold_out)) &&
          (!search.trim() || p.title.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [catalogue.data, section, category, status, search],
  );

  return (
    <Panel
      title="Product Catalogue"
      description="Every online product. Prices come from the showroom SP; pieces left update automatically when something sells in the showroom."
      actions={<Button onClick={onPublishNew}>Publish by scan</Button>}
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={selectClass}
          value={section}
          onChange={(e) => {
            setSection(e.target.value as "" | Section);
            setCategory("");
          }}
          aria-label="Section"
        >
          <option value="">All sections</option>
          <option value="main">{SECTION_LABEL.main}</option>
          <option value="mahib">{SECTION_LABEL.mahib}</option>
        </select>
        <select
          className={selectClass}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {(categories.data ?? [])
            .filter((c) => !section || c.section === section)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Status"
        >
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="sold_out">Sold out</option>
        </select>
      </div>
      <QueryState
        loading={catalogue.isPending}
        error={catalogue.error}
        retry={() => void catalogue.refetch()}
      />
      {catalogue.data && !rows.length ? (
        <EmptyState
          title={
            catalogue.data.length ? "No products match these filters" : "No online products yet"
          }
          description={
            catalogue.data.length
              ? undefined
              : "Scan a showroom piece to create the first product page."
          }
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => {
          const thumb = publicImageUrl(p.thumbnail);
          return (
            <article key={p.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="aspect-[4/3] bg-muted">
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Image className="mr-2 size-5" /> No photo yet
                  </div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{p.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {p.category
                        ? `${SECTION_LABEL[p.section ?? "main"]} · ${p.category}`
                        : "No category yet"}
                    </p>
                  </div>
                  <StatusBadge status={p.published ? "published" : "draft"} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{priceLabel(p.offer, formatMoney)}</strong>
                  <span className={p.offer.sold_out ? "text-destructive" : "text-muted-foreground"}>
                    · {stockLabel(p.offer)}
                  </span>
                  {p.featured_in_category ? (
                    <Star className="size-4 text-amber-500" aria-label="Featured in category" />
                  ) : null}
                  {p.home_featured ? (
                    <Home className="size-4 text-primary" aria-label="On the home page" />
                  ) : null}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing(p.id)}>
                  Edit
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {editing ? <ProductEditor productId={editing} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}
