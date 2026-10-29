/**
 * Browser-side photo pipeline used before every upload:
 * upright orientation, crop to a fixed shape, resize to a standard size,
 * strip hidden metadata (EXIF/GPS) and always encode as WebP. Staff can pick any
 * photo of any size or format the browser can open; nothing is refused up front.
 * Browsers without native WebP encoding (some Safari versions) use a WebAssembly encoder.
 */

export type CropRect = { sx: number; sy: number; sw: number; sh: number };
export type OutputSpec = { width: number; height: number; quality: number };

/** Standard sizes: square for ERP inventory, portrait 4:5 for the website. */
export const IMAGE_SPECS = {
  inventory: { aspect: 1, outputs: [{ width: 800, height: 800, quality: 0.8 }] },
  ecommerce: {
    aspect: 4 / 5,
    outputs: [
      { width: 1600, height: 2000, quality: 0.82 }, // product page and zoom
      { width: 600, height: 750, quality: 0.78 }, // grid cards
    ],
  },
} as const;

export async function loadPhoto(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall back to an <img> decode below (e.g. HEIC on browsers without bitmap support)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(
      "This photo format can't be read here. Use JPG, PNG, WebP or HEIC from the phone camera.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function photoSize(photo: ImageBitmap | HTMLImageElement) {
  return "naturalWidth" in photo
    ? { width: photo.naturalWidth, height: photo.naturalHeight }
    : { width: photo.width, height: photo.height };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Render one crop of the photo at the given output size, always as WebP. */
export async function renderCrop(
  photo: ImageBitmap | HTMLImageElement,
  crop: CropRect,
  spec: OutputSpec,
  baseName: string,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process photos");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.drawImage(photo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, spec.width, spec.height);
  let blob = await toBlob(canvas, "image/webp", spec.quality);
  if (!blob || blob.type !== "image/webp") {
    // No native WebP encoder here: encode the same pixels with WebAssembly (loaded only when needed).
    const { encode } = await import("@jsquash/webp");
    const pixels = ctx.getImageData(0, 0, spec.width, spec.height);
    const bytes = await encode(pixels, { quality: Math.round(spec.quality * 100) });
    blob = new Blob([bytes], { type: "image/webp" });
  }
  return new File([blob], `${baseName}.webp`, { type: "image/webp" });
}

/** The largest centred crop with the given aspect (width / height). */
export function centredCrop(width: number, height: number, aspect: number): CropRect {
  if (width / height > aspect) {
    const sw = height * aspect;
    return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
  }
  const sh = width / aspect;
  return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}
