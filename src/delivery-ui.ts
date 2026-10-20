import { t, uiText } from "../shared/i18n.js";
import type { SavedProject, Photo } from "./types";
import { makeBackup, readBackup } from "./backup";
import { restoreProject } from "./storage";
import { createZip, archiveLimit } from "./archive";
import { reportGroups, reportSourceMarkdown } from "./reports";
import { orderedReport } from "./report-order";
import { safeName, validateCorners } from "./geometry";
import { exportReport } from "./export";
type Job = { name: string; title: string; format: string; pages: Photo[] };
export function setupDelivery(
  getProject: () => SavedProject,
  isBusy: () => boolean,
  setBusy: (busy: boolean) => void,
  beforeRestore: () => Promise<void>,
) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const backupStatus = $("backupStatus"),
    batchStatus = $("batchStatus");
  let prepared: SavedProject | undefined,
    controller: AbortController | undefined,
    last = "",
    urls: string[] = [],
    backupUrl = "",
    zipUrl = "";
  let jobs: Job[] = [],
    done = new Map<string, Blob>(),
    failures = new Map<string, string>(),
    snapshot: SavedProject | undefined;
  const say = (el: HTMLElement, text: string) => uiText(el, () => t(text));
  const link = (
    parent: HTMLElement,
    text: string,
    blob: Blob,
    name: string,
  ) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    urls.push(a.href);
    a.download = name;
    uiText(a, () => t(text));
    parent.append(a);
    return a;
  };
  function clear() {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = "";
    done.clear();
    failures.clear();
    jobs = [];
    snapshot = undefined;
    $("batchResults").replaceChildren();
    $("batchDownload").hidden = true;
    $("batchRetry").hidden = true;
  }
  function render() {
    const project = getProject(),
      key = JSON.stringify(
        project.photos.map(({ file: _f, thumb: _t, result: _r, ...p }) => p),
      );
    if (key === last) return;
    last = key;
    if (backupUrl) {
      URL.revokeObjectURL(backupUrl);
      backupUrl = "";
      $("backupDownload").hidden = true;
    }
    clear();
    const list = $("batchGroups");
    const selected = new Set(
      Array.from(list.querySelectorAll<HTMLInputElement>("input:checked")).map(
        (x) => x.value,
      ),
    );
    const known = new Set(
      Array.from(list.querySelectorAll<HTMLInputElement>("input")).map(
        (x) => x.value,
      ),
    );
    const first = !list.childElementCount;
    list.replaceChildren();
    for (const group of reportGroups(project.photos)) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.value = group.id;
      input.checked = first || !known.has(group.id) || selected.has(group.id);
      input.onchange = clear;
      label.append(
        input,
        document.createTextNode(` ${group.title} (${group.pages.length})`),
      );
      list.append(label);
    }
    say(
      batchStatus,
      project.photos.length
        ? "选择报告和格式后打包；不会修改照片。"
        : "导入并分组后可批量导出。",
    );
  }
  $("backupSave").onclick = async () => {
    if (isBusy()) return;
    setBusy(true);
    say(backupStatus, "正在校验原图并生成备份…");
    try {
      const blob = await makeBackup(getProject());
      if (backupUrl) URL.revokeObjectURL(backupUrl);
      backupUrl = URL.createObjectURL(blob);
      const a = $<HTMLAnchorElement>("backupDownload");
      a.href = backupUrl;
      a.download = `TalkCapture-${new Date().toISOString().slice(0, 10)}.talkcapture.zip`;
      a.hidden = false;
      say(
        backupStatus,
        "备份已生成，请下载保存；包含原图和编辑数据，不含模型密钥。",
      );
    } catch (e) {
      say(backupStatus, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  $("backupLoad").onclick = () => {
    if (!isBusy()) $<HTMLInputElement>("backupFile").click();
  };
  $<HTMLInputElement>("backupFile").onchange = async () => {
    const input = $<HTMLInputElement>("backupFile"),
      file = input.files?.[0];
    input.value = "";
    if (!file || isBusy()) return;
    prepared = undefined;
    setBusy(true);
    say(backupStatus, "正在校验备份，当前项目保持不变…");
    try {
      prepared = await readBackup(file);
      say(
        $("restoreInfo"),
        t(
          "备份包含 {0} 张照片、{1} 组报告。恢复会替换当前项目，请先下载当前项目备份。",
          prepared.photos.length,
          reportGroups(prepared.photos).length,
        ),
      );
      $<HTMLDialogElement>("settingsPanel").close();
      $<HTMLDialogElement>("restoreDialog").showModal();
    } catch (e) {
      say(backupStatus, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  $("restoreCancel").onclick = () => {
    prepared = undefined;
    $<HTMLDialogElement>("restoreDialog").close();
    $<HTMLDialogElement>("settingsPanel").showModal();
  };
  $("restoreDialog").addEventListener("cancel", () => {
    prepared = undefined;
  });
  $("restoreConfirm").onclick = async () => {
    if (!prepared || isBusy()) return;
    setBusy(true);
    try {
      await beforeRestore();
      await restoreProject(prepared);
      location.reload();
    } catch (e) {
      say(
        $("restoreInfo"),
        t("恢复失败，当前项目保留：{0}", (e as Error).message),
      );
      setBusy(false);
    }
  };
  function results() {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    const root = $("batchResults");
    root.replaceChildren();
    for (const job of jobs) {
      const row = document.createElement("p");
      row.textContent = job.name + " · ";
      const blob = done.get(job.name);
      if (blob) link(row, "下载文件", blob, job.name.split("/").at(-1)!);
      else {
        const span = document.createElement("span");
        span.textContent = failures.get(job.name) || t("尚未完成");
        row.append(span);
      }
      root.append(row);
    }
    $("batchRetry").hidden = !jobs.some((j) => !done.has(j.name));
  }
  async function pack() {
    if (!snapshot || !done.size) return;
    const manifest = jobs.map((j) => ({
      file: j.name,
      status: done.has(j.name) ? "complete" : "failed",
      reason: failures.get(j.name) || "",
      pages: j.pages.map((p, i) => ({
        reportPage: i + 1,
        sourcePage: snapshot!.photos.indexOf(p) + 1,
        name: p.name,
      })),
    }));
    const blob = await createZip(
      [...done]
        .map(([name, blob]) => ({ name, blob }))
        .concat([
          {
            name: "sources.json",
            blob: new Blob([JSON.stringify(manifest, null, 2)], {
              type: "application/json",
            }),
          },
        ]),
    );
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = URL.createObjectURL(blob);
    const a = $<HTMLAnchorElement>("batchDownload");
    a.href = zipUrl;
    a.download = "TalkCapture-reports.zip";
    a.hidden = false;
  }
  async function run(retry = false) {
    if (isBusy()) return;
    if (!retry) {
      clear();
      snapshot = getProject();
      const selected = new Set(
        Array.from(
          $("batchGroups").querySelectorAll<HTMLInputElement>("input:checked"),
        ).map((x) => x.value),
      );
      const formats = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          "[name=batchFormat]:checked",
        ),
      ).map((x) => x.value);
      jobs = reportGroups(snapshot.photos).flatMap((g, i) =>
        selected.has(g.id)
          ? formats.map((format) => ({
              name: `${String(i + 1).padStart(2, "0")}-${safeName(g.title)}/${safeName(g.title)}.${format}`,
              title: g.title,
              format,
              pages: orderedReport(g.pages),
            }))
          : [],
      );
      if (!jobs.length) {
        say(batchStatus, "请至少选择一组报告和一种格式。");
        return;
      }
    }
    if (!snapshot) return;
    controller = new AbortController();
    setBusy(true);
    $("batchCancel").hidden = false;
    $<HTMLButtonElement>("batchCancel").disabled = false;
    try {
      for (const job of jobs.filter((j) => !done.has(j.name))) {
        if (controller.signal.aborted) break;
        say(batchStatus, t("正在生成：{0}", job.name));
        try {
          if (
            job.format !== "md" &&
            job.pages.some(
              (p) => !p.file || !p.processed || validateCorners(p.corners),
            )
          )
            throw Error("存在缺图或未确认选区，请先返回核对。");
          const blob =
            job.format === "md"
              ? new Blob(
                  [reportSourceMarkdown(job.title, job.pages, snapshot.photos)],
                  { type: "text/markdown;charset=utf-8" },
                )
              : await exportReport(job.pages, {
                  format: job.format,
                  wide: snapshot.aspect === "wide",
                  compact: snapshot.quality === "compact",
                  name: job.title,
                  signal: controller.signal,
                  progress: (_d, _t, label) =>
                    say(
                      batchStatus,
                      t("正在生成：{0} · {1}", job.name, t(label)),
                    ),
                });
          if (controller.signal.aborted) break;
          if (
            [...done.values()].reduce((n, b) => n + b.size, blob.size) >
            archiveLimit - 4 * 1024 * 1024
          )
            throw Error("打包内容超过 512 MB，请减少所选报告。");
          done.set(job.name, blob);
          failures.delete(job.name);
        } catch (e) {
          failures.set(job.name, t((e as Error).message));
          if (controller.signal.aborted) break;
        }
      }
      results();
      await pack();
      say(
        batchStatus,
        t(
          "已完成 {0}/{1} 个文件；失败或取消项可重试，已完成文件保留。",
          done.size,
          jobs.length,
        ),
      );
    } catch (e) {
      results();
      say(
        batchStatus,
        t("打包失败，可分别下载已完成文件：{0}", (e as Error).message),
      );
    } finally {
      controller = undefined;
      $("batchCancel").hidden = true;
      setBusy(false);
    }
  }
  $("batchRun").onclick = () => void run();
  $("batchRetry").onclick = () => void run(true);
  $("batchCancel").onclick = () => {
    controller?.abort();
    say(batchStatus, "正在取消，已完成文件保留…");
  };
  document
    .querySelectorAll<HTMLInputElement>("[name=batchFormat]")
    .forEach((x) => (x.onchange = clear));
  $("batchExport").addEventListener("toggle", render);
  render();
  window.addEventListener("pagehide", () => {
    controller?.abort();
    urls.forEach(URL.revokeObjectURL);
    if (backupUrl) URL.revokeObjectURL(backupUrl);
    if (zipUrl) URL.revokeObjectURL(zipUrl);
  });
  return render;
}
