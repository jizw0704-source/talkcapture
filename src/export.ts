import { contain } from "./geometry";
import { blobData, identify, toJpeg } from "./files";
import { processImage } from "./processor";
import type { Photo } from "./types";

export async function exportReport(
  photos: Photo[],
  options: {
    format: string;
    wide: boolean;
    compact: boolean;
    name: string;
    signal: AbortSignal;
    progress: (done: number, total: number, label: string) => void;
  },
) {
  const check = () => {
    if (options.signal.aborted) throw Error("导出已取消，未生成文件。");
  };
  const pageW = options.wide ? 13.333333 : 10,
    pageH = 7.5;
  const Pptx =
    options.format === "pptx" ? (await import("pptxgenjs")).default : null;
  const Pdf = options.format === "pdf" ? (await import("jspdf")).jsPDF : null;
  const pptx = Pptx ? new Pptx() : null;
  const pdf = Pdf
    ? new Pdf({
        unit: "mm",
        format: [pageW * 25.4, pageH * 25.4],
        orientation: "landscape",
        compress: true,
      })
    : null;
  if (pptx) {
    pptx.defineLayout({ name: "REPORT", width: pageW, height: pageH });
    pptx.layout = "REPORT";
    pptx.title = options.name;
    pptx.author = "学术报告照片整理助手";
  }
  if (pdf)
    pdf.setProperties({ title: options.name, creator: "学术报告照片整理助手" });
  for (let i = 0; i < photos.length; i++) {
    check();
    const photo = photos[i];
    if (!photo.file) throw Error(`缺少原图：${photo.name}。请重新选择文件。`);
    options.progress(
      i,
      photos.length + 1,
      `生成第 ${i + 1} / ${photos.length} 页`,
    );
    const result = await processImage({
      blob: await identify(photo.file),
      rotation: photo.rotation,
      corners: photo.corners,
      brightness: photo.brightness,
      contrast: photo.contrast,
      maxEdge: options.compact ? 1920 : 3200,
      kind: photo.processed ? "warp" : "plain",
    });
    check();
    const image = await blobData(
      await toJpeg(result.blob, options.compact ? 0.82 : 0.95),
    );
    check();
    const rect = contain(result.width, result.height, pageW, pageH);
    if (pptx) pptx.addSlide().addImage({ data: image, ...rect });
    if (pdf) {
      if (i > 0) pdf.addPage([pageW * 25.4, pageH * 25.4], "landscape");
      pdf.addImage(
        image,
        "JPEG",
        rect.x * 25.4,
        rect.y * 25.4,
        rect.w * 25.4,
        rect.h * 25.4,
        undefined,
        "FAST",
      );
    }
  }
  options.progress(
    photos.length,
    photos.length + 1,
    "封装文件；此阶段取消将丢弃结果",
  );
  check();
  const blob = pptx
    ? ((await pptx.write({ outputType: "blob", compression: true })) as Blob)
    : pdf!.output("blob");
  check();
  options.progress(photos.length + 1, photos.length + 1, "文件已生成");
  return blob;
}
