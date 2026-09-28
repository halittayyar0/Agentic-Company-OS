export const AVATAR_ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const AVATAR_INPUT_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_OUTPUT_MAX_BYTES = 64 * 1024;
const AVATAR_INPUT_MAX_PIXELS = 40_000_000;

type FileDescriptor = Pick<File, "size" | "type">;

export function avatarFileError(file: FileDescriptor): string | null {
  if (
    !AVATAR_ACCEPTED_MIME_TYPES.includes(
      file.type as (typeof AVATAR_ACCEPTED_MIME_TYPES)[number],
    )
  ) {
    return "PNG, JPEG veya WebP dosyası seçin.";
  }
  if (file.size === 0) return "Seçilen dosya boş.";
  if (file.size > AVATAR_INPUT_MAX_BYTES) {
    return "Dosya 5 MB sınırını aşıyor.";
  }
  return null;
}

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Görsel tarayıcı tarafından okunamadı.");
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Avatar çıktısı oluşturulamadı."));
      },
      "image/webp",
      quality,
    );
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Avatar çıktısı okunamadı."));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Avatar çıktısı okunamadı."));
    };
    reader.readAsDataURL(blob);
  });
}

function renderSquare(loaded: LoadedImage, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Görsel işleme başlatılamadı.");

  const crop = Math.min(loaded.width, loaded.height);
  const sourceX = (loaded.width - crop) / 2;
  const sourceY = (loaded.height - crop) / 2;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    loaded.source,
    sourceX,
    sourceY,
    crop,
    crop,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

/**
 * Decode, center-crop, and compress locally. The original file never leaves
 * the browser and the persisted output stays inside the API's binary budget.
 */
export async function prepareAvatarImage(file: File): Promise<string> {
  const metadataError = avatarFileError(file);
  if (metadataError) throw new Error(metadataError);

  let loaded: LoadedImage;
  try {
    loaded = await loadImage(file);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Görsel tarayıcı tarafından okunamadı.");
  }

  try {
    if (
      loaded.width <= 0 ||
      loaded.height <= 0 ||
      loaded.width * loaded.height > AVATAR_INPUT_MAX_PIXELS
    ) {
      throw new Error("Görsel çözünürlüğü 40 megapiksel sınırını aşıyor.");
    }

    const attempts = [
      { size: 256, quality: 0.86 },
      { size: 256, quality: 0.72 },
      { size: 224, quality: 0.64 },
      { size: 192, quality: 0.56 },
    ];
    for (const attempt of attempts) {
      const blob = await canvasBlob(
        renderSquare(loaded, attempt.size),
        attempt.quality,
      );
      if (blob.size <= AVATAR_OUTPUT_MAX_BYTES) return blobDataUrl(blob);
    }
    throw new Error("Görsel güvenli avatar boyutuna sıkıştırılamadı.");
  } finally {
    loaded.dispose();
  }
}
