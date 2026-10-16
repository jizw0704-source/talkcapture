import { heicTo } from "heic-to/next";
import { homography, targetSize, validateCorners } from "./geometry";
import { suggestCorners } from "./suggestions";
import type { ProcessRequest, ProcessResult } from "./types";

async function decode(blob: Blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    if (!blob.type.includes("hei"))
      throw Error("照片无法解码，请检查文件是否损坏。");
    const converted = await heicTo({ blob, type: "image/png" });
    if (!(converted instanceof Blob))
      throw Error("HEIC 转换失败，请转换成 JPEG 后重试。");
    return createImageBitmap(converted, { imageOrientation: "from-image" });
  }
}
self.onmessage = async (e: MessageEvent<ProcessRequest>) => {
  const q = e.data;
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    bitmap = await decode(q.blob);
    if (bitmap.width * bitmap.height > 80_000_000)
      throw Error("照片超过 8000 万像素，请先缩小后重试。");
    const odd = q.rotation % 180 !== 0;
    const sourceWidth = odd ? bitmap.height : bitmap.width;
    const sourceHeight = odd ? bitmap.width : bitmap.height;
    const scale = Math.min(
      1,
      (q.kind !== "warp" ? q.maxEdge : 5000) /
        Math.max(bitmap.width, bitmap.height),
    );
    const w = Math.max(
      2,
      Math.round((odd ? bitmap.height : bitmap.width) * scale),
    );
    const h = Math.max(
      2,
      Math.round((odd ? bitmap.width : bitmap.height) * scale),
    );
    canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw Error("浏览器不支持画布处理。");
    ctx.translate(w / 2, h / 2);
    ctx.rotate((q.rotation * Math.PI) / 180);
    ctx.drawImage(
      bitmap,
      (-bitmap.width * scale) / 2,
      (-bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    bitmap.close();
    bitmap = undefined;
    if (q.kind === "detect") {
      const pixels = ctx.getImageData(0, 0, w, h).data;
      const detection = suggestCorners(pixels, w, h, q.examples);
      const scale = Math.min(1, 240 / Math.max(w, h));
      const width = Math.max(1, Math.round(w * scale));
      const height = Math.max(1, Math.round(h * scale));
      const thumb = new OffscreenCanvas(width, height);
      try {
        const thumbCtx = thumb.getContext("2d");
        if (!thumbCtx) throw Error("无法生成自动定位的缩略图。");
        thumbCtx.drawImage(canvas, 0, 0, width, height);
        const blob = await thumb.convertToBlob({ type: "image/png" });
        self.postMessage({
          id: q.id,
          blob,
          width,
          height,
          sourceWidth,
          sourceHeight,
          detection,
        } satisfies ProcessResult);
      } finally {
        thumb.width = 1;
        thumb.height = 1;
      }
      return;
    }
    if (q.kind === "plain") {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      self.postMessage({
        id: q.id,
        blob,
        width: w,
        height: h,
        sourceWidth,
        sourceHeight,
      } satisfies ProcessResult);
      return;
    }
    const error = validateCorners(q.corners);
    if (error) throw Error(error);
    const size = targetSize(q.corners, w, h, q.maxEdge);
    const input = ctx.getImageData(0, 0, w, h).data;
    const output = new OffscreenCanvas(size.width, size.height);
    const outCtx = output.getContext("2d");
    if (!outCtx) throw Error("无法生成输出图像。");
    const image = outCtx.createImageData(size.width, size.height),
      data = image.data;
    const m = homography(q.corners);
    const contrast = 1 + q.contrast / 100;
    for (let y = 0; y < size.height; y++) {
      const v = y / (size.height - 1);
      for (let x = 0; x < size.width; x++) {
        const u = x / (size.width - 1),
          z = m[6] * u + m[7] * v + 1;
        const sx = Math.max(
          0,
          Math.min(w - 1, ((m[0] * u + m[1] * v + m[2]) / z) * (w - 1)),
        );
        const sy = Math.max(
          0,
          Math.min(h - 1, ((m[3] * u + m[4] * v + m[5]) / z) * (h - 1)),
        );
        const ix = Math.floor(sx),
          iy = Math.floor(sy),
          fx = sx - ix,
          fy = sy - iy;
        const a = (iy * w + ix) * 4,
          b = (iy * w + Math.min(ix + 1, w - 1)) * 4;
        const c = (Math.min(iy + 1, h - 1) * w + ix) * 4,
          d = (Math.min(iy + 1, h - 1) * w + Math.min(ix + 1, w - 1)) * 4;
        const i = (y * size.width + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const value =
            input[a + ch] * (1 - fx) * (1 - fy) +
            input[b + ch] * fx * (1 - fy) +
            input[c + ch] * (1 - fx) * fy +
            input[d + ch] * fx * fy;
          data[i + ch] =
            ch === 3
              ? value
              : (value - 128) * contrast + 128 + q.brightness * 2.55;
        }
      }
    }
    outCtx.putImageData(image, 0, 0);
    const blob = await output.convertToBlob({ type: "image/png" });
    self.postMessage({ id: q.id, blob, ...size } satisfies ProcessResult);
    output.width = 1;
    output.height = 1;
  } catch (error) {
    self.postMessage({
      id: q.id,
      error: error instanceof Error ? error.message : "图像处理失败，请重试。",
    } satisfies ProcessResult);
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
