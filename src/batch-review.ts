import { t, uiText, uiAttr, getLanguage } from "../shared/i18n.js";
import type { Photo } from "./types";
import { looksSimilar, type Fingerprint } from "./duplicates";
import { validateCorners } from "./geometry";
import { processImage } from "./processor";
export function setupBatchReview(
  getPhotos: () => Photo[],
  isBusy: () => boolean,
  open: (id: string) => void,
  changed: () => void,
) {
  const panel = document.getElementById("batchOverview") as HTMLDetailsElement,
    grid = document.getElementById("batchGrid")!,
    status = document.getElementById("duplicateStatus")!,
    comparison = document.getElementById("duplicateComparison")!;
  const filter = document.getElementById("batchFilter") as HTMLSelectElement;
  const cache = new Map<string, Promise<Fingerprint>>(),
    ignored = new Set<string>();
  const previews = new Map<string, { key: string; url: string }>();
  const contentKey = (p: Photo) =>
    JSON.stringify([
      p.digest,
      p.size,
      p.rotation,
      p.corners,
      p.brightness,
      p.contrast,
    ]);
  let pairs: [string, string][] = [],
    lastDraw = "",
    scanKey = "",
    generation = 0,
    failedCount = 0,
    scanning = false,
    selected: [string, string] | undefined;
  const image = (p: Photo) => {
    const cached = previews.get(p.id);
    if (cached?.key === contentKey(p))
      return { url: cached.url, kind: "corrected" };
    return {
      url: p.result || p.thumb,
      kind:
        p.result && p.previewKind === "corrected" ? "corrected" : "original",
    };
  };
  const updateStatus = () =>
    uiText(status, () =>
      scanning
        ? t("正在本机检查相似页面…")
        : t(
            "发现 {0} 对疑似重复；仅提示，不自动排除。{1}",
            pairs.length,
            failedCount
              ? t(" {0} 页缺少可用预览，暂未参与相似检查。", failedCount)
              : "",
          ),
    );
  const pairKey = (a: string, b: string) => [a, b].sort().join(":");
  const eligible = (p: Photo) => !p.excluded && Boolean(p.file);
  const needsReview = (p: Photo) =>
    !p.processed || p.automated || p.previewError || !p.file;
  const text = (tag: string, value: () => string) => {
    const el = document.createElement(tag);
    uiText(el, value);
    return el;
  };
  const action = (value: () => string, run: () => void) => {
    const b = text("button", value) as HTMLButtonElement;
    b.disabled = isBusy();
    b.onclick = () => {
      if (!isBusy()) run();
    };
    return b;
  };
  const fingerprint = (url: string) => {
    let pending = cache.get(url);
    if (pending) return pending;
    pending = (async () => {
      const blob = await (await fetch(url)).blob(),
        bitmap = await createImageBitmap(blob);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 64;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0, 96, 64);
        const data = ctx.getImageData(0, 0, 96, 64).data,
          pixels = [];
        for (let i = 0; i < data.length; i += 4)
          pixels.push(
            0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
          );
        return { width: bitmap.width, height: bitmap.height, pixels };
      } finally {
        bitmap.close();
      }
    })();
    cache.set(url, pending);
    return pending;
  };
  function draw() {
    if (!panel.open) return;
    updateStatus();
    const photos = getPhotos();
    const drawKey = JSON.stringify([
      getLanguage(),
      isBusy(),
      filter.value,
      pairs,
      selected,
      photos.map((p) => [
        p.id,
        p.name,
        p.processed,
        p.automated,
        p.excluded,
        Boolean(p.file),
        p.result,
        p.thumb,
        image(p).url,
        image(p).kind,
        p.previewKind,
        p.previewError,
      ]),
    ]);
    if (drawKey === lastDraw) return;
    lastDraw = drawKey;
    grid.replaceChildren();
    const related = (p: Photo) =>
      pairs
        .flatMap(([a, b]) => (a === p.id ? [b] : b === p.id ? [a] : []))
        .filter((id) => photos.some((q) => q.id === id && !q.excluded));
    let shown = 0;
    for (const [index, p] of photos.entries()) {
      const matches = related(p);
      if (
        (filter.value === "issues" && (p.excluded || !needsReview(p))) ||
        (filter.value === "duplicates" && (p.excluded || !matches.length)) ||
        (filter.value === "excluded" && !p.excluded) ||
        (filter.value === "all" && p.excluded)
      )
        continue;
      shown++;
      const card = document.createElement("article");
      card.className = "batch-card";
      const preview = action(
        () => t("核对第 {0} 页", index + 1),
        () => open(p.id),
      );
      preview.className = "batch-preview";
      const src = image(p);
      if (src.url) {
        const img = document.createElement("img");
        img.src = src.url;
        img.alt = "";
        img.loading = "lazy";
        preview.append(img);
      } else preview.append(text("span", () => t("预览尚未就绪")));
      uiAttr(preview, "aria-label", () => t("核对第 {0} 页", index + 1));
      card.append(
        preview,
        text("h3", () => t("第 {0} 页 · {1}", index + 1, p.name)),
      );
      card.append(
        text("p", () =>
          p.excluded
            ? t("已排除")
            : !p.file
              ? t("原图缺失")
              : p.processed && !p.automated
                ? t("已确认")
                : t("需要核对"),
        ),
      );
      card.append(
        text("p", () =>
          src.kind === "corrected"
            ? t("校正预览")
            : t("原图预览 · 尚无校正预览"),
        ),
      );
      if (p.previewError) card.append(text("p", () => t("预览失败，点击重试")));
      for (const id of matches.slice(0, 3)) {
        const other = photos.find((q) => q.id === id);
        if (!other) continue;
        card.append(
          action(
            () => t("与第 {0} 页并排比较", photos.indexOf(other) + 1),
            () => {
              selected = [p.id, id];
              drawComparison();
              comparison.scrollIntoView({ block: "nearest" });
            },
          ),
        );
      }
      if (matches.length > 3)
        card.append(
          text("p", () =>
            t("还有 {0} 页相似，可在疑似重复筛选中查看。", matches.length - 3),
          ),
        );
      if (p.excluded)
        card.append(
          action(
            () => t("恢复"),
            () => {
              p.excluded = false;
              changed();
            },
          ),
        );
      grid.append(card);
    }
    if (!shown) grid.append(text("p", () => t("当前筛选下没有页面。")));
    drawComparison();
  }
  function drawComparison() {
    comparison.replaceChildren();
    if (!selected) {
      comparison.hidden = true;
      return;
    }
    const photos = getPhotos(),
      a = photos.find((p) => p.id === selected![0]),
      b = photos.find((p) => p.id === selected![1]);
    if (!a || !b) {
      selected = undefined;
      comparison.hidden = true;
      return;
    }
    comparison.hidden = false;
    comparison.append(
      text("h3", () => t("疑似重复页对比")),
      text("p", () =>
        t(
          "相似不代表重复，逐步出现的文字或图表可能不同。保留操作只排除另一页，不删除原图或确认选区。",
        ),
      ),
    );
    const views = document.createElement("div");
    views.className = "duplicate-views";
    for (const p of [a, b]) {
      const figure = document.createElement("figure");
      const src = image(p);
      if (src.url) {
        const img = document.createElement("img");
        img.src = src.url;
        img.alt = t("第 {0} 页", photos.indexOf(p) + 1);
        figure.append(img);
      }
      figure.append(
        text("figcaption", () =>
          t("第 {0} 页 · {1}", photos.indexOf(p) + 1, p.name),
        ),
        action(
          () => t("打开此页核对"),
          () => open(p.id),
        ),
      );
      views.append(figure);
    }
    comparison.append(views);
    const choices = document.createElement("div");
    choices.className = "toolbar";
    for (const [keep, exclude] of [
      [a, b],
      [b, a],
    ])
      choices.append(
        action(
          () =>
            t(
              "保留第 {0} 页，排除第 {1} 页",
              photos.indexOf(keep) + 1,
              photos.indexOf(exclude) + 1,
            ),
          () => {
            keep.excluded = false;
            exclude.excluded = true;
            selected = undefined;
            changed();
          },
        ),
      );
    choices.append(
      action(
        () => t("保留两页，本次不再提示"),
        () => {
          const restore = a.excluded || b.excluded;
          a.excluded = b.excluded = false;
          ignored.add(pairKey(a.id, b.id));
          pairs = pairs.filter(
            ([x, y]) => pairKey(x, y) !== pairKey(a.id, b.id),
          );
          selected = undefined;
          if (restore) changed();
          else draw();
        },
      ),
      action(
        () => t("关闭对比"),
        () => {
          selected = undefined;
          drawComparison();
        },
      ),
    );
    comparison.append(choices);
  }
  async function scan() {
    const photos = getPhotos().filter(eligible),
      key = JSON.stringify(photos.map((p) => [p.id, contentKey(p), p.thumb]));
    if (key === scanKey) return;
    scanKey = key;
    const token = ++generation;
    pairs = [];
    scanning = true;
    updateStatus();
    const signatures: { p: Photo; kind: string; value: Fingerprint }[] = [];
    let failed = 0;
    for (const p of photos) {
      if (token !== generation) return;
      if (isBusy()) {
        scanKey = "";
        scanning = false;
        updateStatus();
        return;
      }
      if (p.file && !validateCorners(p.corners)) {
        const expectedKey = contentKey(p),
          cached = previews.get(p.id);
        if (cached?.key !== expectedKey)
          try {
            const preview = await processImage({
              kind: "thumbnail",
              blob: p.file,
              rotation: p.rotation,
              corners: p.corners.map((v) => ({ ...v })),
              maxEdge: 480,
              brightness: p.brightness,
              contrast: p.contrast,
            });
            if (token !== generation) return;
            if (contentKey(p) !== expectedKey) {
              scanKey = "";
              scanning = false;
              updateStatus();
              return;
            }
            if (cached) URL.revokeObjectURL(cached.url);
            previews.set(p.id, {
              key: expectedKey,
              url: URL.createObjectURL(preview.blob),
            });
          } catch {
            /* Fall back to the explicitly labeled original preview. */
          }
      }
      const src = image(p);
      if (!src.url) {
        failed++;
        continue;
      }
      try {
        const value = await fingerprint(src.url);
        if (token !== generation) return;
        signatures.push({ p, kind: src.kind, value });
      } catch {
        failed++;
      }
    }
    const next: [string, string][] = [];
    for (let i = 0; i < signatures.length; i++)
      for (let j = i + 1; j < signatures.length; j++) {
        const a = signatures[i],
          b = signatures[j];
        if (ignored.has(pairKey(a.p.id, b.p.id))) continue;
        const same =
          a.p.digest &&
          a.p.digest === b.p.digest &&
          a.p.rotation === b.p.rotation &&
          JSON.stringify(a.p.corners) === JSON.stringify(b.p.corners);
        if (same || (a.kind === b.kind && looksSimilar(a.value, b.value)))
          next.push([a.p.id, b.p.id]);
      }
    if (token !== generation) return;
    pairs = next;
    failedCount = failed;
    scanning = false;
    updateStatus();
    const ids = new Set(getPhotos().map((p) => p.id));
    for (const [id, preview] of previews)
      if (!ids.has(id)) {
        URL.revokeObjectURL(preview.url);
        previews.delete(id);
      }
    if (cache.size > 300) {
      const urls = new Set(photos.map((p) => image(p).url));
      for (const url of cache.keys()) if (!urls.has(url)) cache.delete(url);
    }
    draw();
  }
  const render = () => {
    if (!getPhotos().length) {
      generation++;
      scanKey = "";
      pairs = [];
      selected = undefined;
      cache.clear();
      for (const preview of previews.values()) URL.revokeObjectURL(preview.url);
      previews.clear();
      ignored.clear();
      lastDraw = "";
    }
    if (panel.open) {
      draw();
      void scan();
    }
  };
  filter.onchange = draw;
  panel.ontoggle = () => {
    if (panel.open) render();
    else {
      generation++;
      scanKey = "";
      scanning = false;
    }
  };
  return render;
}
