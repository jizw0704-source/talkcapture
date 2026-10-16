import { t, uiText, uiAttr } from "../shared/i18n.js";
import { processImage } from "./processor";
import { validateCorners } from "./geometry";
import { readTemplate, type ReadingLine } from "./grouping-evidence";
import type { Photo } from "./types";
import {
  suggestGroups,
  titleOf,
  reportMarkdown,
  reportSourceMarkdown,
  groupName,
} from "./reports";
export function setupReports(
  getPhotos: () => Photo[],
  changed: () => void,
  isBusy: () => boolean,
  setBusy: (value: boolean) => void,
  onExport: (reportId: string) => void = () => {},
) {
  const root = document.getElementById("reportWorkspace")!;
  const status = document.getElementById("reportStatus")!;
  const list = document.getElementById("reportList")!;
  const run = document.getElementById("analyzeReports") as HTMLButtonElement;
  const cancel = document.getElementById("cancelAnalysis") as HTMLButtonElement;
  let controller: AbortController | undefined;
  let running = false;
  let lastView = "";
  const sourceKey = (p: Photo) =>
    JSON.stringify([p.digest || "", p.rotation, p.corners]);
  const eligible = () => getPhotos().filter((p) => !p.excluded);
  const setStatus = (s: string | (() => string)) => {
    uiText(status, () => (typeof s === "function" ? s() : s));
  };
  const button = (text: string, action: () => void) => {
    const b = document.createElement("button");
    uiText(b, () => text);
    b.onclick = action;
    return b;
  };
  function download(name: string, text: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/[\\/:*?"<>|]/g, "_") + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function groups() {
    const map = new Map<string, Photo[]>();
    for (const p of eligible()) {
      const id = p.reportId || "unassigned";
      map.set(id, [...(map.get(id) || []), p]);
    }
    return map;
  }
  function render() {
    root.hidden = !eligible().length;
    run.disabled = running || isBusy();
    uiText(run, () =>
      eligible().some((p) => p.reportId)
        ? eligible().some((p) => !p.reportId)
          ? t("识别并分组新增照片")
          : t("补充识别文字")
        : t("识别文字并建议分组"),
    );
    const view = JSON.stringify([
      running,
      isBusy(),
      eligible().map((p) => [
        p.id,
        p.reportId,
        p.reportTitle,
        p.processed,
        p.reading,
        p.readingError,
        p.groupingReason,
      ]),
    ]);
    if (view === lastView) return;
    lastView = view;
    const expanded = new Set(
      [...list.querySelectorAll<HTMLElement>(".report-group")]
        .filter((el) => el.querySelector("details")?.open)
        .map((el) => el.dataset.report),
    );
    list.replaceChildren();
    if (!eligible().some((p) => p.reportId)) return;
    const grouped = groups();
    let n = 0;
    for (const [id, pages] of grouped) {
      n++;
      const groupNumber = n;
      const section = document.createElement("section");
      section.className = "report-group";
      section.dataset.report = id;
      const heading = document.createElement("h3");
      uiText(heading, () =>
        t(
          "报告 {0} \u00B7 {1} 页{2}",
          groupNumber,
          pages.length,
          id === "unassigned" ? t(" \u00B7 待分组") : "",
        ),
      );
      section.append(heading);
      const label = document.createElement("label");
      uiText(label, () => t("报告名称"));
      const name = document.createElement("input");
      name.value = pages[0].reportTitle || titleOf(pages[0]);
      name.maxLength = 100;
      name.disabled = running || isBusy();
      name.onchange = () => {
        for (const p of pages)
          p.reportTitle = name.value.trim() || titleOf(pages[0]);
        changed();
      };
      label.append(name);
      section.append(label);
      const sourcePages = document.createElement("p");
      sourcePages.className = "hint";
      uiText(sourcePages, () =>
        t(
          "来源页：{0}",
          pages.map((p) => getPhotos().indexOf(p) + 1).join(", "),
        ),
      );
      section.append(sourcePages);
      if (pages[0].groupingReason) {
        const hint = document.createElement("p");
        hint.className = "hint";
        uiText(hint, () => t("分界线索：{0}", t(pages[0].groupingReason!)));
        section.append(hint);
      }
      const actions = document.createElement("div");
      actions.className = "report-actions";
      actions.append(
        button("下载原文 Markdown", () =>
          download(
            name.value,
            reportSourceMarkdown(name.value, pages, getPhotos()),
          ),
        ),
      );
      actions.prepend(button("导出这份报告", () => onExport(id)));
      actions.append(
        button("重新建议名称", () => {
          const suggested = groupName(pages);
          for (const p of pages) p.reportTitle = suggested;
          changed();
          render();
        }),
      );
      const optional = document.createElement("details");
      optional.className = "optional-analysis";
      const optionalTitle = document.createElement("summary");
      uiText(optionalTitle, () => t("可选：内容分析"));
      const privacy = document.createElement("p");
      privacy.className = "hint";
      uiText(privacy, () =>
        t("仅发送这份报告的识别文字与来源页码，可能计费。"),
      );
      optional.append(
        optionalTitle,
        privacy,
        button("MiniMax 解读", () => void modelSummary(name.value, pages)),
      );
      if (n > 1)
        actions.append(
          button("合并到上一报告", () => {
            const previous = [...grouped.entries()][
              [...grouped.keys()].indexOf(id) - 1
            ];
            for (const p of pages) {
              p.reportId = previous[0];
              p.groupingReason = undefined;
              p.reportTitle =
                previous[1][0].reportTitle || titleOf(previous[1][0]);
            }
            changed();
            render();
          }),
        );
      section.append(actions);
      const details = document.createElement("details"),
        summary = document.createElement("summary");
      details.open = expanded.has(id);
      uiText(summary, () => t("核对分组与逐页文字"));
      details.append(summary);
      for (const p of pages) {
        const row = document.createElement("div");
        row.className = "report-page";
        const title = document.createElement("p");
        uiText(title, () =>
          t("第 {0} 页 \u00B7 {1}", getPhotos().indexOf(p) + 1, p.name),
        );
        row.append(title);
        const targetLabel = document.createElement("label");
        uiText(targetLabel, () => t("所属报告"));
        const select = document.createElement("select");
        select.disabled = running || isBusy();
        for (const [key, ps] of grouped) {
          const option = document.createElement("option");
          option.value = key;
          option.textContent = ps[0].reportTitle || titleOf(ps[0]);
          select.append(option);
        }
        select.value = id;
        select.onchange = () => {
          p.reportId = select.value;
          p.groupingReason = undefined;
          p.reportTitle = grouped.get(select.value)?.[0].reportTitle;
          changed();
          render();
        };
        targetLabel.append(select);
        row.append(targetLabel);
        row.append(
          button("从此页拆分", () => {
            for (const next of pages.slice(pages.indexOf(p))) {
              next.reportId = p.id;
              next.reportTitle = titleOf(p);
              next.groupingReason =
                next === p ? "人工确认的报告分界" : undefined;
            }
            changed();
            render();
          }),
        );
        const textLabel = document.createElement("label");
        uiText(textLabel, () => t("识别文字（可修正）"));
        const text = document.createElement("textarea");
        text.rows = 5;
        text.value = p.reading?.text || "";
        text.disabled = running || isBusy();
        text.onchange = () => {
          p.reading = {
            text: text.value,
            confidence: 1,
            digest: sourceKey(p),
          };
          changed();
        };
        textLabel.append(text);
        row.append(textLabel);
        if (!text.value) {
          const warning = document.createElement("p");
          uiText(
            warning,
            () =>
              p.readingError || t("此页尚未识别到文字，保留在报告中，请核对。"),
          );
          row.append(warning);
        }
        details.append(row);
      }
      section.append(details, optional);
      list.append(section);
    }
    list
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = running || isBusy()));
  }
  async function modelSummary(title: string, pages: Photo[]) {
    if (running) return;
    running = true;
    setBusy(true);
    render();
    setStatus("正在由 MiniMax 解读当前报告的识别文字…");
    try {
      const response = await fetch("/api/analysis/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: pages.map((p) => ({
            page: getPhotos().indexOf(p) + 1,
            text: p.reading?.text || "",
          })),
        }),
        signal: AbortSignal.timeout(180000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "解读失败");
      download(
        title + "-解读总结",
        `# ${title}\n\n> MiniMax 生成，请核对来源页码与原图。\n\n${result.text}\n\n---\n\n${reportMarkdown(title, pages, getPhotos())}`,
      );
      setStatus("解读总结已生成并下载，包含逐页原文，便于核对与 Agent 使用。");
    } catch (e) {
      setStatus((e as Error).message + "。仍可下载原文 Markdown。");
    } finally {
      running = false;
      setBusy(false);
      render();
    }
  }
  cancel.onclick = () => controller?.abort();
  async function prepareGroups() {
    if (running || isBusy()) return;
    const photos = eligible();
    running = true;
    setBusy(true);
    controller = new AbortController();
    cancel.hidden = false;
    render();
    let failed = 0;
    try {
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (controller.signal.aborted) throw Error("已取消；已识别内容保留。");
        setStatus(`本机识别 ${i + 1} / ${photos.length}：${p.name}`);
        const cached = p.reading?.digest === sourceKey(p) && !!p.reading?.text;
        if (cached && p.reading?.template) continue;
        if (!p.file) {
          failed++;
          continue;
        }
        try {
          const corrected =
            p.corners.length === 4 && !validateCorners(p.corners);
          const source = corrected
            ? (
                await processImage({
                  blob: p.file,
                  rotation: p.rotation,
                  corners: p.corners,
                  maxEdge: 2600,
                  brightness: 0,
                  contrast: 0,
                  kind: "warp",
                })
              ).blob
            : p.file;
          const template = corrected
            ? await readTemplate(source).catch(() => undefined)
            : undefined;
          if (cached && p.reading) {
            p.reading.template = template;
            changed();
            continue;
          }
          const response = await fetch("/api/analysis/ocr", {
            method: "POST",
            body: source,
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error);
          const lines = result.lines as ReadingLine[];
          p.reading = {
            text: lines.map((l) => l.text).join("\n"),
            confidence: lines.length
              ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
              : 0,
            digest: sourceKey(p),
            lines,
            template,
          };
          p.readingError = p.reading.text
            ? undefined
            : "未识别到文字，请核对原图清晰度与选区。";
          if (!p.reading.text) failed++;
          changed();
        } catch (e) {
          if (controller.signal.aborted)
            throw Error("已取消；已识别内容保留。");
          p.readingError = (e as Error).message;
          failed++;
          changed();
          setStatus(`${p.name}：${(e as Error).message}`);
        }
      }
      // Keep human group IDs and names. Only assign previously ungrouped pages.
      let active = "";
      for (const suggestion of suggestGroups(photos)) {
        const p = suggestion.photo;
        if (p.reportId) {
          active = p.reportId;
          continue;
        }
        if (suggestion.start || !active) active = p.id;
        p.reportId = active;
        p.groupingReason = suggestion.start ? suggestion.reason : undefined;
      }
      for (const [id, pages] of groups()) {
        const name =
          pages.find((p) => p.reportTitle)?.reportTitle || groupName(pages);
        for (const p of pages) p.reportTitle = name;
      }
      changed();
      const groupCount = groups().size;
      setStatus(() =>
        t(
          "已整理为 {0} 组，请核对分界。{1}",
          groupCount,
          failed
            ? t(
                " {0} 页缺少可识别文字，仍保留在分组中；可补图后重试或手动填写。",
                failed,
              )
            : t(" 可修改分组和名称，再按组导出 PPT、PDF 或原文 Markdown。"),
        ),
      );
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      running = false;
      setBusy(false);
      cancel.hidden = true;
      controller = undefined;
      render();
    }
  }
  run.onclick = () => void prepareGroups();
  window.addEventListener("pagehide", () => controller?.abort(), {
    once: true,
  });
  render();
  return Object.assign(render, { prepare: prepareGroups });
}
