import exifr from "exifr";

export async function identify(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  let type = "";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    type = "image/jpeg";
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
    type = "image/png";
  else {
    const header = new TextDecoder("ascii").decode(bytes);
    if (
      header.slice(4, 8) === "ftyp" &&
      /heic|heix|hevc|hevx|mif1|msf1/.test(header.slice(8)) &&
      !/avif|avis/.test(header.slice(8))
    )
      type = "image/heic";
  }
  if (!type) throw Error("仅支持有效的 JPEG、PNG、HEIC / HEIF 照片。");
  return file.slice(0, file.size, type);
}
export async function capturedTime(file: File): Promise<number | null> {
  try {
    const data = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const date = data?.DateTimeOriginal ?? data?.CreateDate;
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date.getTime()
      : null;
  } catch {
    return null;
  }
}
export function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}
export async function toJpeg(blob: Blob, quality: number) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("浏览器无法生成 JPEG。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const result = await canvas.convertToBlob({ type: "image/jpeg", quality });
    canvas.width = 1;
    canvas.height = 1;
    return result;
  } finally {
    bitmap.close();
  }
}
