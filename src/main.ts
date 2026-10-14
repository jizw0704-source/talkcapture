import "./style.css";
import {
  fullCorners,
  rotatedCorners,
  safeName,
  validateCorners,
} from "./geometry";
import type { Point } from "./geometry";
import { identify, capturedTime } from "./files";
import { processImage, stopProcessing } from "./processor";
import { exportReport } from "./export";
import { readProject, writeProject } from "./storage";
import type { Photo } from "./types";
import { phoneTransfer } from "./phone";
import { organizeAutomatically, type AutomaticIssue } from "./automation";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const names = ["左上", "右上", "右下", "左下"];
type Stage = "import" | "review" | "export";
let stage: Stage = "import";
let photos: Photo[] = [],
  currentId = "",
  busy = false,
  detecting = false,
  selectedPoint = -1;
let bitmap: ImageBitmap | undefined,
  displayToken = 0,
  previewToken = 0;
let showOriginal = false,
  downloadUrl = "",
  originalUrl = "",
  saveTimer: ReturnType<typeof setTimeout>;
let previewTimer: ReturnType<typeof setTimeout>,
  exportController: AbortController | undefined;
let automaticController: AbortController | undefined;
let automaticIssues: AutomaticIssue[] = [];
const checked = new Set<string>(),
  histories = new Map<string, Point[][]>();
const canvas = $<HTMLCanvasElement>("editorCanvas"),
  ctx = canvas.getContext("2d")!;
const viewport = $("canvasViewport");
let imageRect = { x: 0, y: 0, w: 1, h: 1 };
let drag:
  | {
      point: number;
      x: number;
      y: number;
      scrollX: number;
      scrollY: number;
      changed: boolean;
    }
  | undefined;
let pointer: Point | undefined;
const current = () => photos.find((p) => p.id === currentId);
const copy = (points: Point[]) => points.map((p) => ({ ...p }));
const message = (text: string, error = false) => {
  $("status").hidden = !text;
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
const progress = (done: number, total: number, label: string) => {
  const el = $<HTMLProgressElement>("progress");
  el.hidden = false;
  el.value = Math.round((done / total) * 100);
  message(label);
};
const button = (text: string, action: () => void) => {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  el.onclick = action;
  return el;
};
const bytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function renderStage() {
  for (const name of ["import", "review", "export"] as const) {
    $(`${name}Screen`).hidden = stage !== name;
    const id = `step${name[0].toUpperCase()}${name.slice(1)}`;
    const control = $<HTMLButtonElement>(id);
    control.disabled = busy || (name !== "import" && !photos.length);
    if (stage === name) control.setAttribute("aria-current", "step");
    else control.removeAttribute("aria-current");
  }
  $("addMore").hidden = stage === "import";
  $("continueReview").hidden = !photos.some((photo) => photo.file);
  renderAutomatic();
}
function showStage(next: Stage, focus = true) {
  if (busy || (next !== "import" && !photos.length)) return;
  stage = next;
  renderStage();
  draw();
  if (focus) $(`${next}Title`).focus();
}
for (const name of ["import", "review", "export"] as const)
  $(`step${name[0].toUpperCase()}${name.slice(1)}`).onclick = () =>
    showStage(name);
$("addMore").onclick = () => showStage("import");
$("continueReview").onclick = () => showStage("review");
$("goExport").onclick = () => showStage("export");
$("backReview").onclick = () => showStage("review");

function revokeDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = "";
  $("download").hidden = true;
  $("downloadResult").hidden = true;
}
function save() {
  clearTimeout(saveTimer);
  revokeDownload();
  saveTimer = setTimeout(() => {
    void writeProject({
      version: 1,
      name: input("projectName").value,
      aspect: select("aspect").value,
      quality: select("quality").value,
      photos: photos.map(
        ({ file: _file, thumb: _thumb, result: _result, ...photo }) => photo,
      ),
    }).catch(() =>
      message("本地编辑参数暂时无法保存；当前照片仍可处理和导出。", true),
    );
  }, 250);
}
function history(photo: Photo) {
  photo.detection = undefined;
  const list = histories.get(photo.id) || [];
  list.push(copy(photo.corners));
  if (list.length > 30) list.shift();
  histories.set(photo.id, list);
}
function invalidate(photo: Photo) {
  photo.processed = false;
  photo.automated = undefined;
  if (photo.result) URL.revokeObjectURL(photo.result);
  photo.result = undefined;
  previewToken++;
  clearTimeout(previewTimer);
  save();
  renderPages();
  renderSummary();
  draw();
  syncPoint();
  updatePreview();
  if (photo.corners.length === 4 && !validateCorners(photo.corners))
    previewTimer = setTimeout(() => void refreshPreview(photo), 350);
}
function setBusy(value: boolean) {
  busy = value;
  document
    .querySelectorAll<HTMLButtonElement>(
      "button:not(#cancel):not(#cancelDetect):not(#cancelAutomatic):not([data-phone-control])",
    )
    .forEach((el) => {
      el.disabled = value;
    });
  document
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input:not(#phoneLink),select:not(#phoneNetwork)")
    .forEach((el) => {
      el.disabled = value;
    });
  canvas.style.pointerEvents = value ? "none" : "auto";
  if (!value) {
    $("progress").hidden = true;
    render();
  }
}
function renderAutomatic() {
  $("automaticPanel").hidden =
    !photos.length || (stage === "export" && !automaticController);
  $("automaticPanel").setAttribute("aria-busy", String(!!automaticController));
  const start = $<HTMLButtonElement>("autoOrganize");
  start.disabled = busy || !photos.some((p) => p.file && !p.excluded);
  start.textContent = automaticController
    ? "正在自动整理…"
    : automaticIssues.length
      ? "继续整理并生成 PPT"
      : "自动整理并生成 PPT";
  $("cancelAutomatic").hidden = !automaticController;
  const pending = automaticIssues.filter((issue) => {
    const photo = photos.find((p) => p.id === issue.photoId);
    return (
      photo &&
      !photo.excluded &&
      (!photo.file || !photo.processed || !!validateCorners(photo.corners))
    );
  });
  const included = photos.filter((photo) => !photo.excluded);
  const ready = included.filter(
    (photo) => photo.file && photo.processed && !validateCorners(photo.corners),
  ).length;
  $("automaticSummary").textContent = pending.length
    ? `${included.length} 页保留 · ${pending.length} 页待检查`
    : `${included.length} 页保留 · ${ready} 页已就绪`;
  $("automaticReview").hidden = !pending.length;
  $("automaticReviewTitle").textContent = `需要检查 ${pending.length} 页`;
  const list = $("automaticIssues");
  list.replaceChildren();
  for (const issue of pending) {
    const index = photos.findIndex((p) => p.id === issue.photoId);
    const item = document.createElement("li");
    const open = button(`${index + 1}. ${photos[index].name}`, () => {
      showStage("review");
      void openPhoto(issue.photoId);
    });
    open.disabled = busy;
    const reason = document.createElement("span");
    reason.textContent = issue.reason;
    open.append(reason);
    item.append(open);
    list.append(item);
  }
}

async function runAutomatic() {
  if (busy) return;
  const included = photos.filter((photo) => !photo.excluded);
  if (!included.length) return;
  const controller = new AbortController();
  automaticController = controller;
  automaticIssues = [];
  clearTimeout(previewTimer);
  previewToken++;
  displayToken++;
  revokeDownload();
  setBusy(true);
  renderAutomatic();
  $("cancelAutomatic").focus();
  const check = () => {
    if (controller.signal.aborted) throw Error("自动整理已取消。");
  };
  try {
    automaticIssues = await organizeAutomatically(included, {
      signal: controller.signal,
      detect: async (photo) => {
        const blob = await identify(photo.file!);
        check();
        const result = await processImage({
          blob,
          rotation: photo.rotation,
          corners: [],
          maxEdge: 640,
          brightness: 0,
          contrast: 0,
          kind: "detect",
        });
        if (!result.detection) throw Error("自动定位未返回结果，请重试。");
        return result.detection;
      },
      prepare: async (photo, corners) => {
        const blob = await identify(photo.file!);
        check();
        return processImage({
          blob,
          rotation: photo.rotation,
          corners,
          brightness: photo.brightness,
          contrast: photo.contrast,
          maxEdge: 1400,
          kind: "warp",
        });
      },
      commit: (photo, result) => {
        if (photo.result) URL.revokeObjectURL(photo.result);
        photo.result = URL.createObjectURL(result.blob);
        photo.resultWidth = result.width;
        photo.resultHeight = result.height;
      },
      progress,
      changed: () => {
        save();
        renderPages();
        renderSummary();
      },
    });
    check();
    if (automaticIssues.length) {
      automaticController = undefined;
      setBusy(false);
      showStage("review", false);
      await openPhoto(automaticIssues[0].photoId);
      message(
        `自动整理已暂停：${automaticIssues.length} 页需要检查。其余页面已保留，未生成缺页文件。`,
      );
      $("automaticReviewTitle").focus();
      return;
    }
    select("format").value = "pptx";
    setBusy(false);
    showStage("export", false);
    if (await generateReport()) $("download").focus();
  } catch (error) {
    message(
      controller.signal.aborted
        ? "自动整理已取消。已完成页面和原有编辑保留，可点击按钮继续。"
        : (error as Error).message,
      !controller.signal.aborted,
    );
  } finally {
    if (automaticController === controller) automaticController = undefined;
    setBusy(false);
  }
}
$("autoOrganize").onclick = () => void runAutomatic();
$("cancelAutomatic").onclick = () => {
  automaticController?.abort();
  stopProcessing("自动整理已取消。");
};

function renderSummary() {
  const included = photos.filter((p) => !p.excluded),
    processed = included.filter((p) => p.processed);
  const automated = processed.filter((p) => p.automated).length;
  $("counts").textContent = photos.length
    ? `${photos.length} 张照片 · ${processed.length - automated} 页已确认${automated ? ` · ${automated} 页自动校正` : ""} · ${photos.filter((p) => p.excluded).length} 页已排除`
    : "尚未导入照片";
  $("pageCount").textContent = `${included.length} 页保留`;
  $("exportSummary").textContent =
    `${included.length} 页待导出 · ${included.length - processed.length} 页${automated ? "待处理" : "未确认"}`;
  const missing = included.filter((p) => !p.file).length;
  $("recovery").hidden = !missing;
  const pending = included.length - processed.length;
  $("exportCheck").textContent = missing
    ? `缺少 ${missing} 张原图，请返回导入重新选择。`
    : pending && !input("allowOriginal").checked
      ? `还有 ${pending} 页未确认，请返回核对，或在更多选项中选择按原图导出。`
      : pending
        ? `${pending} 页未确认，将按原图导出。`
        : automated
          ? `${processed.length} 页已就绪（${automated} 页自动校正），可以生成文件。请检查自动裁切结果。`
          : `已确认 ${processed.length} 页，可以生成文件。`;
  $("add").textContent = photos.some((p) => !p.file)
    ? "重新选择原图"
    : photos.length
      ? "继续添加照片"
      : "选择照片";
  renderStage();
  $<HTMLButtonElement>("export").disabled = busy || !included.length;
  const compact = select("quality").value === "compact";
  $("estimate").textContent =
    `等比例完整放入页面，不拉伸。${compact ? "体积优先：最长边不超过 1920 px，JPEG 质量 82%。" : "清晰优先：最长边不超过 3200 px，JPEG 质量 95%。"} 不会放大低分辨率原图；导出时可能下采样，原始文件不变。`;
  $("outputPage").style.aspectRatio =
    select("aspect").value === "wide" ? "16 / 9" : "4 / 3";
}
function renderPages() {
  const list = $("pageList");
  list.replaceChildren();
  if (!photos.length) {
    const p = document.createElement("p");
    p.textContent = "导入后在这里查看和调整页序。";
    p.className = "empty-small";
    list.append(p);
  }
  photos.forEach((photo, index) => {
    const row = document.createElement("div");
    row.className = `page-row${photo.id === currentId ? " active" : ""}${photo.excluded ? " excluded" : ""}`;
    row.dataset.id = photo.id;
    row.draggable = !busy;
    row.ondragstart = (event) => {
      event.dataTransfer?.setData("application/x-report-page", photo.id);
    };
    row.ondragover = (event) => {
      if (event.dataTransfer?.types.includes("application/x-report-page"))
        event.preventDefault();
    };
    row.ondrop = (event) => {
      const id = event.dataTransfer?.getData("application/x-report-page");
      if (!id || busy) return;
      event.preventDefault();
      event.stopPropagation();
      const from = photos.findIndex((p) => p.id === id);
      if (from < 0 || from === index) return;
      const [item] = photos.splice(from, 1);
      photos.splice(index, 0, item);
      save();
      renderPages();
    };
    const top = document.createElement("div");
    top.className = "page-top";
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked.has(photo.id);
    box.disabled = busy;
    box.setAttribute("aria-label", `勾选第 ${index + 1} 页 ${photo.name}`);
    box.onchange = () =>
      box.checked ? checked.add(photo.id) : checked.delete(photo.id);
    label.append(box);
    const open = button("", () => void openPhoto(photo.id));
    open.className = "page-open";
    open.disabled = busy;
    open.setAttribute("aria-label", `打开第 ${index + 1} 页 ${photo.name}`);
    if (photo.thumb) {
      const img = document.createElement("img");
      img.src = photo.thumb;
      img.alt = "";
      img.width = 56;
      img.height = 44;
      img.loading = "lazy";
      img.decoding = "async";
      open.append(img);
    }
    const text = document.createElement("span"),
      title = document.createElement("span"),
      status = document.createElement("span");
    title.className = "photo-name";
    title.textContent = `${index + 1}. ${photo.name}`;
    status.className = `page-caption${!photo.file ? " missing" : ""}`;
    status.textContent = !photo.file
      ? "请重新选择原图"
      : photo.excluded
        ? "已排除 · 原图保留"
        : photo.processed
          ? "已确认"
          : photo.detection === "suggested"
            ? "自动定位 · 待确认"
            : photo.detection
              ? "需手动选四角"
              : "待校正 / 待确认";
    if (photo.file && !photo.excluded && photo.processed && photo.automated)
      status.textContent = "自动校正 · 建议检查";
    text.append(title, status);
    open.append(text);
    top.append(label, open);
    const controls = document.createElement("div");
    controls.className = "page-controls";
    const up = button("上移", () => moveOne(index, -1)),
      down = button("下移", () => moveOne(index, 1));
    up.disabled = busy || index === 0;
    down.disabled = busy || index === photos.length - 1;
    const exclusion = button(photo.excluded ? "恢复" : "排除", () => {
      photo.excluded = !photo.excluded;
      save();
      render();
    });
    exclusion.disabled = busy;
    controls.append(up, down, exclusion);
    row.append(top, controls);
    list.append(row);
  });
}
function moveOne(index: number, delta: number) {
  if (busy || index + delta < 0 || index + delta >= photos.length) return;
  [photos[index], photos[index + delta]] = [
    photos[index + delta],
    photos[index],
  ];
  save();
  renderPages();
}
function syncPoint() {
  const p = current()?.corners[selectedPoint];
  if (selectedPoint >= 0) select("pointSelect").value = String(selectedPoint);
  input("pointX").value = p ? (p.x * 100).toFixed(2) : "";
  input("pointY").value = p ? (p.y * 100).toFixed(2) : "";
}
function render() {
  renderPages();
  renderSummary();
  const photo = current(),
    index = photos.findIndex((p) => p.id === currentId);
  $("currentName").textContent = photo?.name || "四点校正";
  $("pageMeta").textContent = photo
    ? `第 ${index + 1} / ${photos.length} 页 · ${photo.format} · ${photo.width} × ${photo.height} px${photo.warnings.length ? " · " + photo.warnings.join("；") : ""}`
    : "选择一张照片开始";
  for (const id of [
    "undo",
    "autoFind",
    "reset",
    "whole",
    "inherit",
    "rotate",
    "applyPoint",
    "confirm",
    "exclude",
  ])
    $<HTMLButtonElement>(id).disabled = busy || !photo?.file;
  $<HTMLButtonElement>("prev").disabled = busy || index <= 0;
  $<HTMLButtonElement>("next").disabled =
    busy || index < 0 || index >= photos.length - 1;
  $("exclude").textContent = photo?.excluded ? "恢复此页" : "排除此页";
  input("brightness").value = String(photo?.brightness || 0);
  input("contrast").value = String(photo?.contrast || 0);
  const error = photo ? validateCorners(photo.corners) : null;
  $("cornerPrompt").textContent = !photo
    ? "导入后自动尝试定位画面；也可按顺序点选四角。"
    : photo.corners.length < 4
      ? `${photo.detection === "ambiguous" ? "发现多个候选画面，请手动选择。" : photo.detection === "not_found" ? "未找到可靠的完整 PPT 边界，请手动选择。" : ""}请点选第 ${photo.corners.length + 1} 个角：${names[photo.corners.length]}。`
      : error ||
        (photo.processed
          ? photo.automated
            ? "当前页已自动校正，建议检查完整内容。可微调后人工确认。"
            : "当前页已确认。拖动控制点后需重新确认。"
          : photo.detection === "suggested"
            ? "自动建议的四角已就绪，请核对完整内容，可拖动微调，然后校正并确认。"
            : "四角已就绪，可拖动微调，然后校正并确认。");
  syncPoint();
  draw();
  updatePreview();
}
function updatePreview() {
  const photo = current(),
    img = $<HTMLImageElement>("previewImage");
  $("showOriginal").setAttribute("aria-pressed", String(showOriginal));
  $("showResult").setAttribute("aria-pressed", String(!showOriginal));
  const source = showOriginal ? originalUrl : photo?.result;
  img.hidden = !source;
  if (source) {
    img.src = source;
    img.width = (showOriginal ? photo?.width : photo?.resultWidth) || 1400;
    img.height = (showOriginal ? photo?.height : photo?.resultHeight) || 900;
  } else img.removeAttribute("src");
  $("previewEmpty").hidden = !!source;
  $("previewEmpty").textContent =
    photo && !photo.file
      ? "重新选择原始照片后恢复预览。"
      : "点选四个角后生成校正预览。";
  $("previewMeta").textContent = showOriginal
    ? "原图对比（最长边 1800 px 预览）"
    : photo?.result
      ? `${photo.resultWidth} × ${photo.resultHeight} px 预览${photo.processed ? (photo.automated ? " · 自动校正，建议检查" : " · 已确认") : " · 尚未确认"}`
      : "";
}
async function refreshPreview(photo: Photo) {
  if (!photo.file || validateCorners(photo.corners)) return;
  const token = ++previewToken;
  try {
    const result = await processImage({
      blob: await identify(photo.file),
      rotation: photo.rotation,
      corners: copy(photo.corners),
      brightness: photo.brightness,
      contrast: photo.contrast,
      maxEdge: 1400,
      kind: "warp",
    });
    if (token !== previewToken || !photos.includes(photo)) return false;
    if (photo.result) URL.revokeObjectURL(photo.result);
    photo.result = URL.createObjectURL(result.blob);
    photo.resultWidth = result.width;
    photo.resultHeight = result.height;
    if (photo.id === currentId) updatePreview();
    return true;
  } catch (error) {
    if (token === previewToken) message((error as Error).message, true);
    return false;
  }
}
async function openPhoto(id: string) {
  if (busy) return;
  const photo = photos.find((p) => p.id === id);
  if (!photo) return;
  currentId = id;
  selectedPoint = -1;
  pointer = undefined;
  bitmap?.close();
  bitmap = undefined;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = "";
  const token = ++displayToken;
  previewToken++;
  clearTimeout(previewTimer);
  select("zoom").value = "1";
  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;
  render();
  if (!photo.file) return;
  try {
    const result = await processImage({
      blob: await identify(photo.file),
      rotation: photo.rotation,
      corners: [],
      brightness: 0,
      contrast: 0,
      maxEdge: 1800,
      kind: "plain",
    });
    const next = await createImageBitmap(result.blob);
    if (token !== displayToken) {
      next.close();
      return;
    }
    bitmap = next;
    originalUrl = URL.createObjectURL(result.blob);
    draw();
    updatePreview();
    if (!photo.result && photo.corners.length === 4) void refreshPreview(photo);
  } catch (error) {
    if (token === displayToken) message((error as Error).message, true);
  }
}
function draw() {
  const photo = current(),
    zoom = Number(select("zoom").value);
  const baseW = Math.max(240, viewport.clientWidth),
    baseH = viewport.clientHeight;
  const cssW = Math.round(baseW * zoom),
    cssH = Math.round(baseH * zoom),
    scale = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * scale);
  canvas.height = Math.round(cssH * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(0, 0, cssW, cssH);
  $("canvasEmpty").hidden = !!bitmap;
  if (!bitmap || !photo) return;
  const ratio = Math.min(
    (cssW - 48) / bitmap.width,
    (cssH - 48) / bitmap.height,
  );
  const w = bitmap.width * ratio,
    h = bitmap.height * ratio,
    x = (cssW - w) / 2,
    y = (cssH - h) / 2;
  imageRect = { x, y, w, h };
  ctx.drawImage(bitmap, x, y, w, h);
  const coords = photo.corners.map((p) => ({ x: x + p.x * w, y: y + p.y * h }));
  if (coords.length) {
    ctx.beginPath();
    coords.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (coords.length === 4) ctx.closePath();
    ctx.fillStyle = "#10101008";
    if (coords.length === 4) ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#101010";
    ctx.stroke();
    coords.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === selectedPoint ? 13 : 11, 0, Math.PI * 2);
      ctx.fillStyle = i === selectedPoint ? "#567700" : "#101010";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y);
    });
  }
  if (pointer && drag?.point !== -1) {
    const size = 120,
      lx = Math.min(cssW - size - 8, viewport.scrollLeft + baseW - size - 16),
      ly = viewport.scrollTop + 16;
    const sx = ((pointer.x - x) / w) * bitmap.width,
      sy = ((pointer.y - y) / h) * bitmap.height,
      sample = 52;
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(lx - 2, ly - 2, size + 4, size + 4);
    ctx.beginPath();
    ctx.rect(lx, ly, size, size);
    ctx.clip();
    ctx.drawImage(
      bitmap,
      sx - sample / 2,
      sy - sample / 2,
      sample,
      sample,
      lx,
      ly,
      size,
      size,
    );
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx + size / 2, ly);
    ctx.lineTo(lx + size / 2, ly + size);
    ctx.moveTo(lx, ly + size / 2);
    ctx.lineTo(lx + size, ly + size / 2);
    ctx.stroke();
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
const mousePoint = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
const normalized = (p: Point) => ({
  x: Math.max(0, Math.min(1, (p.x - imageRect.x) / imageRect.w)),
  y: Math.max(0, Math.min(1, (p.y - imageRect.y) / imageRect.h)),
});
canvas.onpointerdown = (event) => {
  const photo = current();
  if (!photo?.file || !bitmap || busy) return;
  canvas.focus();
  const p = mousePoint(event);
  pointer = p;
  const hit = photo.corners.findIndex(
    (c) =>
      Math.hypot(
        imageRect.x + c.x * imageRect.w - p.x,
        imageRect.y + c.y * imageRect.h - p.y,
      ) < 22,
  );
  if (hit >= 0) {
    history(photo);
    selectedPoint = hit;
    drag = {
      point: hit,
      x: event.clientX,
      y: event.clientY,
      scrollX: viewport.scrollLeft,
      scrollY: viewport.scrollTop,
      changed: false,
    };
  } else if (
    photo.corners.length < 4 &&
    p.x >= imageRect.x &&
    p.x <= imageRect.x + imageRect.w &&
    p.y >= imageRect.y &&
    p.y <= imageRect.y + imageRect.h
  ) {
    history(photo);
    photo.corners.push(normalized(p));
    selectedPoint = photo.corners.length - 1;
    invalidate(photo);
    render();
  } else {
    selectedPoint = -1;
    drag = {
      point: -1,
      x: event.clientX,
      y: event.clientY,
      scrollX: viewport.scrollLeft,
      scrollY: viewport.scrollTop,
      changed: false,
    };
  }
  canvas.setPointerCapture(event.pointerId);
  syncPoint();
  draw();
};
canvas.onpointermove = (event) => {
  if (!bitmap || busy) return;
  pointer = mousePoint(event);
  if (drag?.point === -1) {
    viewport.scrollLeft = drag.scrollX + drag.x - event.clientX;
    viewport.scrollTop = drag.scrollY + drag.y - event.clientY;
  } else if (drag && current()) {
    current()!.corners[drag.point] = normalized(pointer);
    drag.changed = true;
    syncPoint();
  }
  draw();
};
function endDrag() {
  if (drag?.changed && current()) {
    invalidate(current()!);
    render();
  }
  drag = undefined;
  pointer = undefined;
  draw();
}
canvas.onpointerup = endDrag;
canvas.onpointercancel = endDrag;
canvas.onpointerleave = () => {
  if (!drag) {
    pointer = undefined;
    draw();
  }
};
canvas.onkeydown = (event) => {
  if (busy) return;
  const photo = current();
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
    photo?.corners[selectedPoint]
  ) {
    event.preventDefault();
    history(photo);
    const p = photo.corners[selectedPoint],
      step = event.shiftKey ? 0.01 : 0.001;
    if (event.key === "ArrowLeft") p.x -= step;
    if (event.key === "ArrowRight") p.x += step;
    if (event.key === "ArrowUp") p.y -= step;
    if (event.key === "ArrowDown") p.y += step;
    p.x = Math.max(0, Math.min(1, p.x));
    p.y = Math.max(0, Math.min(1, p.y));
    invalidate(photo);
    render();
  }
};
document.addEventListener("keydown", (event) => {
  if (
    stage !== "review" ||
    busy ||
    event.defaultPrevented ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    $<HTMLDialogElement>("clearDialog").open ||
    (!!event.target && $("phonePanel").contains(event.target as Node))
  )
    return;
  if (event.key === "Enter" && event.target === canvas) {
    event.preventDefault();
    void confirm();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    navigate(event.key === "ArrowLeft" ? -1 : 1);
  }
});
function navigate(delta: number) {
  const index = photos.findIndex((p) => p.id === currentId);
  const next = photos[index + delta];
  if (next) void openPhoto(next.id);
}
async function confirm() {
  const photo = current();
  if (!photo?.file || busy) return;
  const error = validateCorners(photo.corners);
  if (error) {
    message(error, true);
    return;
  }
  clearTimeout(previewTimer);
  setBusy(true);
  message("正在校正当前页…");
  try {
    const success = await refreshPreview(photo);
    if (!success || !photo.result)
      throw Error("校正未完成，请检查四角后重试。");
    photo.processed = true;
    photo.automated = false;
    save();
    message("当前页已确认。原始照片保留。");
    const index = photos.indexOf(photo),
      next = photos.slice(index + 1).find((p) => !p.excluded);
    setBusy(false);
    if (input("autoNext").checked && next) {
      if (
        !next.corners.length &&
        !next.detection &&
        next.rotation === photo.rotation
      ) {
        next.corners = copy(photo.corners);
        next.warnings = [
          ...new Set([...next.warnings, "已沿用上一张四角，请核对"]),
        ];
        save();
      }
      await openPhoto(next.id);
    } else render();
  } catch (error) {
    message((error as Error).message, true);
  } finally {
    if (busy) setBusy(false);
  }
}
function sortPhotos() {
  const mode = select("sort").value;
  photos.sort((a, b) =>
    mode === "selection"
      ? a.selection - b.selection
      : mode === "name"
        ? a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
          a.selection - b.selection
        : (a.captured ?? a.modified) - (b.captured ?? b.modified) ||
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
          a.selection - b.selection,
  );
}
async function importFiles(files: File[]) {
  if (busy || !files.length) return;
  setBusy(true);
  displayToken++;
  previewToken++;
  clearTimeout(previewTimer);
  const initialProject = photos.length === 0;
  const failures: string[] = [];
  let added = 0,
    restored = 0;
  const alreadyMatched = new Set<string>();
  let usedBytes = photos.reduce((sum, p) => sum + p.size, 0),
    nextSelection = Math.max(-1, ...photos.map((p) => p.selection)) + 1;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progress(
      i,
      files.length,
      `${input("autoDetect").checked ? "读取并尝试自动定位" : "读取"}第 ${i + 1} / ${files.length} 张照片`,
    );
    try {
      if (file.size > 30 * 1024 * 1024) throw Error("超过单张 30 MB 限制");
      const recover = photos.find(
        (p) =>
          !p.file &&
          !alreadyMatched.has(p.id) &&
          p.name === file.name &&
          p.size === file.size &&
          p.modified === file.lastModified,
      );
      if (!recover && photos.length >= 100) throw Error("项目最多 100 张照片");
      if (!recover && usedBytes + file.size > 1024 * 1024 * 1024)
        throw Error("项目总大小超过 1 GB");
      const automatic = !recover && input("autoDetect").checked;
      const blob = await identify(file),
        plain = await processImage({
          blob,
          rotation: recover?.rotation || 0,
          corners: [],
          brightness: 0,
          contrast: 0,
          maxEdge: automatic ? 640 : 240,
          kind: automatic ? "detect" : "plain",
        });
      const photo: Photo = recover || {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        captured: await capturedTime(file),
        selection: nextSelection++,
        format: blob.type.replace("image/", "").toUpperCase(),
        width: plain.sourceWidth || plain.width,
        height: plain.sourceHeight || plain.height,
        rotation: 0,
        corners: [],
        brightness: 0,
        contrast: 0,
        processed: false,
        excluded: false,
        warnings: [],
      };
      photo.file = file;
      if (automatic && plain.detection) {
        photo.detection = plain.detection.status;
        photo.corners = copy(plain.detection.corners);
      }
      if (photo.thumb) URL.revokeObjectURL(photo.thumb);
      photo.thumb = URL.createObjectURL(plain.blob);
      if (recover) {
        alreadyMatched.add(photo.id);
        restored++;
      } else {
        photos.push(photo);
        usedBytes += file.size;
        added++;
      }
    } catch (error) {
      failures.push(`${file.name}：${(error as Error).message}`);
    }
  }
  if (initialProject) sortPhotos();
  save();
  setBusy(false);
  const missing = photos.filter((p) => !p.file).length;
  $("recovery").hidden = !missing;
  $("recovery").textContent =
    `还有 ${missing} 张原图需要重新选择，已有编辑参数保留。`;
  message(
    `新增 ${added} 张，恢复 ${restored} 张。${failures.length ? "\n未导入：\n" + failures.join("\n") : ""}`,
    !!failures.length,
  );
  if (added || restored) showStage("review", false);
  await openPhoto(
    currentId && photos.some((p) => p.id === currentId)
      ? currentId
      : photos[0]?.id || "",
  );
}

$("add").onclick = () => input("files").click();
input("files").onchange = () => {
  const files = Array.from(input("files").files || []);
  input("files").value = "";
  void importFiles(files);
};
$("dropzone").onclick = () => {
  if (!busy) input("files").click();
};
$("dropzone").onkeydown = (event) => {
  if ((event.key === "Enter" || event.key === " ") && !busy) {
    event.preventDefault();
    input("files").click();
  }
};
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    $("dropzone").classList.add("drag-over");
  }
});
document.addEventListener("drop", (event) => {
  $("dropzone").classList.remove("drag-over");
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  void importFiles(Array.from(event.dataTransfer.files));
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) $("dropzone").classList.remove("drag-over");
});
$("prev").onclick = () => navigate(-1);
$("next").onclick = () => navigate(1);
$("confirm").onclick = () => void confirm();
$("autoFind").onclick = async () => {
  const photo = current();
  if (!photo?.file || busy) return;
  detecting = true;
  previewToken++;
  clearTimeout(previewTimer);
  setBusy(true);
  $("cancelDetect").hidden = false;
  $("cancelDetect").focus();
  message("正在本地寻找完整 PPT 四角…");
  try {
    const blob = await identify(photo.file);
    if (!detecting) return;
    const result = await processImage({
      blob,
      rotation: photo.rotation,
      corners: [],
      maxEdge: 640,
      brightness: 0,
      contrast: 0,
      kind: "detect",
    });
    if (!detecting) return;
    if (!result.detection)
      throw Error("自动定位未返回结果，请重试或手动选四角。");
    if (
      result.detection.status === "suggested" &&
      !validateCorners(result.detection.corners)
    ) {
      history(photo);
      photo.corners = copy(result.detection.corners);
      photo.detection = "suggested";
      selectedPoint = -1;
      invalidate(photo);
      message("已找到候选四角，正在生成预览。请核对完整内容后校正并确认。");
    } else {
      if (!photo.corners.length) photo.detection = result.detection.status;
      save();
      message(
        `${result.detection.status === "ambiguous" ? "发现多个候选画面，无法确定要保留哪一个。" : "未找到可靠的完整 PPT 四角。"}现有选区保留，可手动点选或微调。`,
      );
    }
  } catch (error) {
    message((error as Error).message, detecting);
  } finally {
    detecting = false;
    $("cancelDetect").hidden = true;
    setBusy(false);
    $("autoFind").focus();
  }
};
$("cancelDetect").onclick = () => {
  if (!detecting) return;
  detecting = false;
  stopProcessing("自动定位已取消，原有选区保留。");
};
$("undo").onclick = () => {
  const photo = current(),
    list = photo && histories.get(photo.id);
  if (photo && list?.length) {
    photo.detection = undefined;
    photo.corners = list.pop()!;
    selectedPoint = -1;
    invalidate(photo);
    render();
  }
};
$("reset").onclick = () => {
  const photo = current();
  if (photo) {
    history(photo);
    photo.corners = [];
    selectedPoint = -1;
    invalidate(photo);
    render();
  }
};
$("whole").onclick = () => {
  const photo = current();
  if (photo) {
    history(photo);
    photo.corners = fullCorners();
    selectedPoint = 0;
    invalidate(photo);
    render();
  }
};
$("inherit").onclick = () => {
  const photo = current(),
    index = photos.findIndex((p) => p.id === currentId),
    previous = photos[index - 1];
  if (!photo || !previous || validateCorners(previous.corners)) {
    message("上一张没有可沿用的完整四角。", true);
    return;
  }
  if (previous.rotation !== photo.rotation) {
    message("两张照片旋转方向不同，请先调整旋转或自行点选四角。", true);
    return;
  }
  history(photo);
  photo.corners = copy(previous.corners);
  invalidate(photo);
  render();
  message("已沿用上一张四角，请检查它们是否贴合当前画面。");
};
$("rotate").onclick = () => {
  const photo = current();
  if (!photo) return;
  histories.delete(photo.id);
  photo.rotation = (photo.rotation + 90) % 360;
  photo.corners = rotatedCorners(photo.corners);
  invalidate(photo);
  void openPhoto(photo.id);
};
select("zoom").onchange = draw;
select("pointSelect").onchange = () => {
  selectedPoint = Number(select("pointSelect").value);
  syncPoint();
  draw();
};
$("applyPoint").onclick = () => {
  const photo = current(),
    index = Number(select("pointSelect").value),
    x = input("pointX").valueAsNumber / 100,
    y = input("pointY").valueAsNumber / 100;
  if (!photo?.corners[index]) {
    message("先在照片上点选该控制点。", true);
    return;
  }
  if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
    message("坐标应在 0–100% 之间。", true);
    return;
  }
  history(photo);
  photo.corners[index] = { x, y };
  selectedPoint = index;
  invalidate(photo);
  render();
};
for (const id of ["brightness", "contrast"])
  input(id).onchange = () => {
    const photo = current();
    if (!photo) return;
    photo[id as "brightness" | "contrast"] = Number(input(id).value);
    invalidate(photo);
    render();
  };
$("exclude").onclick = () => {
  const photo = current();
  if (photo) {
    photo.excluded = !photo.excluded;
    save();
    render();
  }
};
for (const [id, excluded] of [
  ["excludeSelected", true],
  ["restoreSelected", false],
] as const)
  $(id).onclick = () => {
    for (const photo of photos)
      if (checked.has(photo.id)) photo.excluded = excluded;
    save();
    render();
  };
$("moveSelected").onclick = () => {
  const position = input("movePosition").valueAsNumber;
  if (!Number.isInteger(position) || position < 1 || position > photos.length) {
    message(`目标页序应在 1–${photos.length} 之间。`, true);
    return;
  }
  const moving = photos.filter((p) => checked.has(p.id));
  if (!moving.length) {
    message("请先勾选要移动的页面。");
    return;
  }
  photos = photos.filter((p) => !checked.has(p.id));
  photos.splice(Math.min(position - 1, photos.length), 0, ...moving);
  save();
  render();
};
select("sort").onchange = () => {
  sortPhotos();
  save();
  renderPages();
};
$("showResult").onclick = () => {
  showOriginal = false;
  updatePreview();
};
$("showOriginal").onclick = () => {
  showOriginal = true;
  updatePreview();
};
input("projectName").oninput = save;
for (const id of ["aspect", "quality", "format"])
  select(id).onchange = () => {
    save();
    renderSummary();
  };
input("allowOriginal").onchange = () => {
  revokeDownload();
  renderSummary();
};
async function generateReport() {
  if (busy) return false;
  const included = photos.filter((p) => !p.excluded);
  if (!included.length) {
    message("没有可导出的页面。", true);
    return false;
  }
  if (included.some((p) => !p.file)) {
    message("缺少原图，请重新选择照片恢复后再导出。", true);
    return false;
  }
  if (!input("allowOriginal").checked && included.some((p) => !p.processed)) {
    message(
      "存在未确认页。请逐页校正并确认，或明确勾选“未确认页按原图导出”。",
      true,
    );
    return false;
  }
  if (included.some((p) => p.processed && validateCorners(p.corners))) {
    message("已确认页的四角无效，请重新校正。", true);
    return false;
  }
  clearTimeout(previewTimer);
  previewToken++;
  revokeDownload();
  setBusy(true);
  $("cancel").hidden = !!automaticController;
  exportController = automaticController || new AbortController();
  const format = select("format").value,
    name = safeName(input("projectName").value);
  try {
    const blob = await exportReport(included, {
      format,
      wide: select("aspect").value === "wide",
      compact: select("quality").value === "compact",
      name,
      signal: exportController.signal,
      progress,
    });
    downloadUrl = URL.createObjectURL(blob);
    const link = $<HTMLAnchorElement>("download");
    link.href = downloadUrl;
    link.download = `${name}.${format}`;
    link.textContent = `下载 ${format.toUpperCase()} · ${bytes(blob.size)}`;
    link.hidden = false;
    $("downloadInfo").textContent =
      `${name}.${format} · ${included.length} 页 · ${bytes(blob.size)}`;
    $("downloadResult").hidden = false;
    message(
      `已生成 ${included.length} 页 ${format.toUpperCase()}，请点击下载并检查文件。${included.some((p) => p.automated) ? "部分页面由工具自动校正，请检查裁切是否完整。" : ""}${included.some((p) => !p.processed) ? "未确认页使用原图。" : ""}`,
    );
    return true;
  } catch (error) {
    message((error as Error).message, !exportController?.signal.aborted);
    return false;
  } finally {
    exportController = undefined;
    $("cancel").hidden = true;
    setBusy(false);
  }
}
$("export").onclick = () => void generateReport();
$("cancel").onclick = () => {
  exportController?.abort();
  stopProcessing();
  message("已请求取消；正在封装的文件会被丢弃。");
};
$("clear").onclick = () => $<HTMLDialogElement>("clearDialog").showModal();
$<HTMLDialogElement>("clearDialog").onclose = () => {
  if ($<HTMLDialogElement>("clearDialog").returnValue === "clear")
    void clearProject();
};
async function clearProject() {
  await phone.stop();
  clearTimeout(saveTimer);
  clearTimeout(previewTimer);
  stopProcessing();
  displayToken++;
  previewToken++;
  bitmap?.close();
  bitmap = undefined;
  for (const photo of photos) {
    if (photo.thumb) URL.revokeObjectURL(photo.thumb);
    if (photo.result) URL.revokeObjectURL(photo.result);
  }
  photos = [];
  automaticIssues = [];
  stage = "import";
  currentId = "";
  selectedPoint = -1;
  checked.clear();
  histories.clear();
  revokeDownload();
  $("recovery").hidden = true;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = "";
  try {
    await writeProject(null);
    message("当前项目已清空，电脑中的原始照片未删除。");
  } catch {
    message(
      "当前预览已清空，但浏览器保存的编辑参数未能清空，请检查站点存储设置。",
      true,
    );
  }
  render();
}
$("demo").onclick = async () => {
  if (busy) return;
  const files: File[] = [];
  for (let i = 0; i < 3; i++) {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1100;
    const g = c.getContext("2d")!;
    g.fillStyle = "#404448";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#fff";
    g.fillRect(180, 130, 1240, 820);
    g.fillStyle = "#101010";
    g.font = "bold 54px sans-serif";
    g.fillText(
      ["Materials research", "Process & observation", "Results & next steps"][
        i
      ],
      250,
      230,
    );
    g.font = "28px sans-serif";
    g.fillText("LOCAL DEMO · Synthetic report slide", 250, 290);
    g.strokeStyle = "#777";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(280, 750);
    g.lineTo(280, 400);
    g.moveTo(280, 750);
    g.lineTo(1040, 750);
    g.stroke();
    g.strokeStyle = "#567700";
    g.lineWidth = 6;
    g.beginPath();
    for (let n = 0; n <= 80; n++) {
      const x = 280 + n * 9,
        y = 710 - (1 - Math.exp(-n / (16 + i * 10))) * 270;
      n ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = "#646464";
    g.font = "24px sans-serif";
    g.fillText("Illustrative data, not research evidence", 280, 840);
    g.fillText(`${i + 1} / 3`, 1280, 900);
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(Error("示例生成失败"))),
        "image/jpeg",
        0.94,
      ),
    );
    files.push(
      new File([blob], `示例报告_${i + 1}.jpg`, {
        type: "image/jpeg",
        lastModified: 1730000000000 + i * 1000,
      }),
    );
    c.width = 1;
    c.height = 1;
  }
  await importFiles(files);
  message(
    "已加入三张合成示例照片。请核对自动建议或手动选四角，体验校正、页序调整与导出；示例不是科研证据。",
  );
};
new ResizeObserver(() => draw()).observe(viewport);
window.addEventListener("beforeunload", () => {
  bitmap?.close();
  stopProcessing();
});
async function init() {
  if (
    !window.Worker ||
    !window.createImageBitmap ||
    !window.OffscreenCanvas ||
    !window.indexedDB
  ) {
    setBusy(true);
    message(
      "当前浏览器缺少本地图像处理或存储能力，请在新版电脑端 Chrome / Edge / Safari 中打开。",
      true,
    );
    return;
  }
  try {
    const saved = await readProject();
    if (
      saved?.version === 1 &&
      Array.isArray(saved.photos) &&
      saved.photos.length
    ) {
      photos = saved.photos;
      input("projectName").value = saved.name;
      select("aspect").value = saved.aspect;
      select("quality").value = saved.quality;
      currentId = photos[0].id;
      $("recovery").hidden = false;
      $("recovery").textContent =
        `已恢复 ${photos.length} 页编辑参数。请重新选择原始照片；匹配文件名、大小和修改时间后恢复。`;
    }
  } catch {
    message(
      "浏览器无法读取本地保存；仍可创建当前项目，刷新后的恢复可能不可用。",
      true,
    );
  }
  render();
}
void init();
const phone = phoneTransfer({
  canImport: () => !busy,
  importPhoto: async (file) => {
    if (busy) return null;
    await importFiles([file]);
    return photos.some((photo) => photo.file === file);
  },
});
