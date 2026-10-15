import { fabricBarcodeBars } from "./barcode-encoding";
export function BarcodeSticker({
  barcode,
  name,
  description = "",
  detail = "",
  price = "",
}: {
  barcode: string;
  name: string;
  description?: string;
  detail?: string;
  price?: string;
}) {
  const bars = fabricBarcodeBars(barcode);
  return (
    <article
      data-barcode-label=""
      data-code={barcode}
      data-name={name}
      data-description={description}
      data-detail={detail}
      data-price={price}
      className="min-w-0 break-inside-avoid rounded border bg-white p-3 text-sm text-black"
    >
      <p className="font-semibold">{name}</p>
      <p>{description}</p>
      <svg
        role="img"
        aria-label={`Barcode ${barcode}`}
        viewBox={`0 0 ${bars.length + 20} 54`}
        className="h-14 w-full"
        shapeRendering="crispEdges"
      >
        <rect width="100%" height="100%" fill="white" />
        {[...bars].map((b, i) =>
          b === "1" ? <rect key={i} x={i + 10} width="1" height="54" fill="black" /> : null,
        )}
      </svg>
      <p className="break-all font-mono text-xs">{barcode}</p>
      <p>{detail}</p>
      {price && <p className="font-semibold">SP {price}</p>}
    </article>
  );
}
