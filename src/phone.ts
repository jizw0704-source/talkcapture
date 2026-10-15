type RemotePhoto = {
  id: string;
  name: string;
  size: number;
  modified: number;
  type: string;
  state: string;
};
type Status = {
  expires: number;
  peer: { name: string; approved: boolean } | null;
  files: RemotePhoto[];
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function phoneTransfer(options: {
  canImport: () => boolean;
  importPhoto: (
    file: File,
  ) => Promise<boolean | null | { reviewReason?: string }>;
}) {
  let owner = "",
    expires = 0,
    timer: ReturnType<typeof setInterval> | undefined,
    polling = false,
    closed = false,
    generation = 0;
  const completed = new Map<string, boolean>();
  const failures = new Map<string, string>();
  const reviews = new Map<string, string>();
  const status = (text: string, error = false) => {
    $("phoneStatus").textContent = text;
    $("phoneStatus").classList.toggle("error", error);
  };
  async function api(
    path: string,
    method = "GET",
    data?: unknown,
    key = owner,
  ) {
    const response = await fetch(`/api/phone/${path}`, {
      method,
      cache: "no-store",
      headers: {
        "X-Desktop-Client": "1",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("当前服务还未启用手机传图，请使用新的本地启动方式。");
    }
    if (!response.ok) {
      const error = Object.assign(Error(result.error || "传图服务连接失败。"), {
        status: response.status,
      });
      throw error;
    }
    return result;
  }
  async function networks() {
    const data = await api("networks"),
      list = $<HTMLSelectElement>("phoneNetwork");
    list.replaceChildren();
    for (const network of data.addresses) {
      const option = document.createElement("option");
      option.value = network.address;
      option.textContent = `${network.address} · ${network.name}`;
      list.append(option);
    }
    $<HTMLButtonElement>("phoneStart").disabled = !list.options.length;
    if (!list.options.length)
      status("没有可用的局域网地址。请连接 Wi-Fi 后点击“重新检测网络”。", true);
    else status("选择电脑的 Wi-Fi 地址，开启后让手机扫码。");
  }
  function reset() {
    generation++;
    owner = "";
    expires = 0;
    if (timer) clearInterval(timer);
    timer = undefined;
    $("phoneCode").hidden = true;
    $("phoneApprove").hidden = true;
    $("phoneStop").hidden = true;
    $("phoneStart").hidden = false;
    $<HTMLSelectElement>("phoneNetwork").disabled = false;
    completed.clear();
    failures.clear();
    reviews.clear();
    $<HTMLInputElement>("phoneLink").value = "";
    $<HTMLImageElement>("phoneQr").removeAttribute("src");
  }
  async function stop() {
    generation++;
    closed = true;
    try {
      if (owner) await api("stop", "POST");
      status("手机传图已关闭，暂存文件已清理。");
    } catch {
      status(
        "未能确认服务关闭；请保持电脑页面打开或停止本地服务。离线保护会自动关闭接收。",
        true,
      );
    } finally {
      reset();
    }
  }
  async function poll() {
    if (!owner || polling) return;
    const key = owner;
    polling = true;
    try {
      const data: Status = await api("status", "GET", undefined, key);
      if (closed || owner !== key) return;
      expires = data.expires;
      $("phoneRemaining").textContent =
        `剩余 ${Math.max(0, Math.ceil((expires - Date.now()) / 60000))} 分钟`;
      $("phoneApprove").hidden = !data.peer || data.peer.approved;
      const imported = data.files.filter((f) => f.state === "imported").length,
        rejected = data.files.filter((f) => f.state === "rejected").length;
      status(
        !data.peer
          ? "二维码已就绪，等待手机申请连接。"
          : !data.peer.approved
            ? `${data.peer.name} 申请连接。确认是你的手机后再允许。`
            : `手机已连接 · 电脑已导入 ${imported} 张${rejected ? ` · ${rejected} 张未能导入` : ""}`,
      );
      for (const photo of data.files.filter((f) => f.state === "queued")) {
        if (closed || owner !== key || !options.canImport()) break;
        if (!completed.has(photo.id)) {
          const response = await fetch(`/api/phone/file/${photo.id}`, {
            headers: {
              "X-Desktop-Client": "1",
              Authorization: `Bearer ${key}`,
            },
            cache: "no-store",
          });
          if (!response.ok) throw Error("接收照片失败，请检查电脑连接。");
          const file = new File([await response.blob()], photo.name, {
            type: photo.type,
            lastModified: photo.modified,
          });
          if (closed || owner !== key || !options.canImport()) break;
          let imported: boolean | null | { reviewReason?: string };
          try {
            imported = await options.importPhoto(file);
          } catch (error) {
            imported = false;
            failures.set(photo.id, (error as Error).message);
          }
          if (closed || owner !== key) break;
          if (imported === null) break;
          if (typeof imported === "object" && imported.reviewReason)
            reviews.set(photo.id, imported.reviewReason);
          completed.set(photo.id, imported !== false);
        }
        if (closed || owner !== key) break;
        await api(
          `ack/${photo.id}`,
          "POST",
          {
            state: completed.get(photo.id) ? "imported" : "rejected",
            reason: failures.get(photo.id),
            reviewReason: reviews.get(photo.id),
          },
          key,
        );
      }
    } catch (error) {
      if (closed || owner !== key) return;
      const e = error as Error & { status?: number };
      status(e.message, true);
      if (e.status === 410 || e.status === 401) {
        reset();
      }
    } finally {
      polling = false;
    }
  }
  $("phoneOpen").onclick = async () => {
    $("phonePanel").hidden = false;
    $("phonePanel").scrollIntoView({ block: "nearest" });
    if (!owner) {
      try {
        await networks();
      } catch (error) {
        status((error as Error).message, true);
      }
    }
  };
  $("phoneRefresh").onclick = async () => {
    if (owner) return;
    try {
      await networks();
    } catch (error) {
      status((error as Error).message, true);
    }
  };
  $("phoneStart").onclick = async () => {
    if (owner) return;
    const startGeneration = ++generation;
    closed = false;
    $<HTMLButtonElement>("phoneStart").disabled = true;
    try {
      const data = await api("start", "POST", {
        ip: $<HTMLSelectElement>("phoneNetwork").value,
      });
      if (generation !== startGeneration) {
        await api("stop", "POST", undefined, data.owner);
        return;
      }
      owner = data.owner;
      expires = data.expires;
      const qr = await import("qrcode");
      const code = await qr.toDataURL(data.url, {
        width: 256,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      if (generation !== startGeneration) return;
      $<HTMLImageElement>("phoneQr").src = code;
      $<HTMLInputElement>("phoneLink").value = data.url;
      $("phoneCode").hidden = false;
      $("phoneStop").hidden = false;
      $("phoneStart").hidden = true;
      $<HTMLSelectElement>("phoneNetwork").disabled = true;
      timer = setInterval(() => void poll(), 1500);
      await poll();
    } catch (error) {
      if (generation !== startGeneration) return;
      if (owner) await stop();
      status((error as Error).message, true);
    } finally {
      $<HTMLButtonElement>("phoneStart").disabled = false;
    }
  };
  $("phoneApprove").onclick = async () => {
    try {
      await api("approve", "POST");
      await poll();
    } catch (error) {
      status((error as Error).message, true);
    }
  };
  $("phoneStop").onclick = () => void stop();
  $("phoneHide").onclick = async () => {
    await stop();
    $("phonePanel").hidden = true;
    $("phoneOpen").focus();
  };
  window.addEventListener("beforeunload", () => {
    if (owner)
      void fetch("/api/phone/stop", {
        method: "POST",
        keepalive: true,
        headers: { "X-Desktop-Client": "1", Authorization: `Bearer ${owner}` },
      });
  });
  return { stop };
}
