export function StockImage({ src, alt }: { src?: string; alt: string }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className="size-12 rounded-md border bg-muted object-cover" />
  ) : (
    <span className="grid size-12 place-items-center rounded-md border bg-muted/30 text-[10px] text-muted-foreground">No image</span>
  );
}
