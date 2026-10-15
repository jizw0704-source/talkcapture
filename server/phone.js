const $ = (id) => document.getElementById(id);
const qr = location.hash.slice(1);
const storage = "report-phone-session";
let key = "",
  expires = 0,
  approved = false,
  running = false,
  xhr,
  items = [],
  batchStarted = false,
  lastReminder = "";
try {
  const saved = JSON.parse(sessionStorage.getItem(storage) || "{}");
  if (qr && saved.qr !== qr) sessionStorage.removeItem(storage);
  else {
    key = saved.key || "";
    expires = saved.expires || 0;
  }
} catch {}
if (qr) history.replaceState(null, "", location.pathname);
window.addEventListener("hashchange", () => {
  if (location.hash) location.reload();
});
const say = (text, error = false) => {
  if ($("status").textContent !== text) $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
function render() {
  const failed = items.filter((i) => i.state === "failed"),
    done = items.filter((i) => i.state === "done"),
    pending = items.filter((i) =>
      ["ready", "sending", "sent"].includes(i.state),
    ),
    reviews = items.filter((i) => i.reviewReason);
  $("batchCounts").textContent = items.length
    ? `${items.length} 张 · 已导入 ${done.length} · 待完成 ${pending.length} · 失败 ${failed.length}${reviews.length ? ` · 边界待核对 ${reviews.length}` : ""}`
    : "选择照片后，在这里查看传输结果。";
  const reminder =
    batchStarted && !running && !pending.length && failed.length
      ? failed.map((i) => `${i.file.name}:${i.message}`).join("|")
      : "";
  $("failureNotice").hidden = !reminder;
  if (reminder)
    say(
      `本轮已结束：${done.length} 张已导入，${failed.length} 张待处理，请查看失败清单。`,
    );
  if (reminder && reminder !== lastReminder) {
    $("failureHeading").textContent =
      `${done.length ? "其他照片已处理完" : "本轮传输已结束"}，还有 ${failed.length} 张需要重传`;
    $("failureDetail").textContent =
      "失败照片和原因已集中列出。原文件仍在此页面，可以直接重试，无需重新查找相册。若文件损坏或过大，请按原因重新选择或转换。";
    $("filter").value = "failed";
    $("failureHeading").focus({ preventScroll: true });
    $("failureNotice").scrollIntoView({ block: "nearest" });
    lastReminder = reminder;
  }
  if (!failed.length) lastReminder = "";
  if (
    batchStarted &&
    !running &&
    !pending.length &&
    !failed.length &&
    items.length
  )
    say(
      `全部 ${done.length} 张已导入电脑${reviews.length ? `，${reviews.length} 张边界待核对。` : "，可以回电脑整理了。"}`,
    );
  const filter = $("filter").value;
  $("filter").disabled = !items.length;
  for (const item of items) {
    if (!item.element) {
      const li = document.createElement("li"),
        thumb = document.createElement("img"),
        content = document.createElement("div"),
        name = document.createElement("strong"),
        state = document.createElement("span"),
        reason = document.createElement("span"),
        retry = document.createElement("button"),
        replace = document.createElement("button"),
        actions = document.createElement("div");
      thumb.alt = `${item.file.name}的缩略图`;
      thumb.loading = "lazy";
      thumb.src = item.url;
      thumb.onerror = () => {
        thumb.hidden = true;
      };
      name.textContent = item.file.name;
      actions.className = "item-actions";
      retry.textContent = "只重试这张";
      replace.textContent = "重新选择这张";
      retry.onclick = () => void upload(true, item);
      replace.onclick = () => {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = $("photos").accept;
        picker.onchange = () => {
          const file = picker.files?.[0];
          if (!file) return;
          URL.revokeObjectURL(item.url);
          item.file = file;
          item.url = URL.createObjectURL(file);
          item.id = undefined;
          item.reviewReason = undefined;
          item.state = file.size > 30 * 1024 * 1024 ? "failed" : "ready";
          item.message =
            item.state === "failed"
              ? "超过 30 MB，请缩小后重试"
              : "已重新选择，待上传";
          name.textContent = file.name;
          thumb.hidden = false;
          thumb.alt = `${file.name}的缩略图`;
          thumb.src = item.url;
          lastReminder = "";
          render();
        };
        picker.click();
      };
      actions.append(retry, replace);
      content.append(name, state, reason, actions);
      li.append(thumb, content);
      $("list").append(li);
      Object.assign(item, {
        element: li,
        stateElement: state,
        reasonElement: reason,
        retryButton: retry,
        replaceButton: replace,
      });
    }
    item.element.hidden =
      filter === "failed"
        ? item.state !== "failed"
        : filter === "review"
          ? !item.reviewReason
          : false;
    item.stateElement.textContent = item.message;
    item.stateElement.className = item.state === "failed" ? "error" : "";
    item.reasonElement.textContent = item.reviewReason || "";
    item.reasonElement.hidden = !item.reviewReason;
    item.retryButton.hidden = item.replaceButton.hidden =
      item.state !== "failed";
    item.retryButton.disabled = running || !approved;
    item.replaceButton.disabled = running;
  }
  $("pickerLabel").textContent = items.length ? "继续添加照片" : "选择相册照片";
  $("photos").disabled = !approved || running;
  $("upload").disabled =
    !approved || running || !items.some((i) => i.state === "ready");
  $("upload").textContent = running ? "正在传输…" : "传到电脑";
  $("retry").hidden = running || !approved || !failed.length;
  $("retry").textContent = `重试全部失败照片（${failed.length}）`;
  $("cancel").hidden = !running;
}
$("filter").onchange = render;
async function api(path, method = "GET", data, auth = key) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.error || "连接失败");
    error.status = response.status;
    throw error;
  }
  return result;
}
async function poll() {
  if (!key) return;
  try {
    const data = await api("/api/status");
    approved = data.approved;
    expires = data.expires;
    $("connection").textContent = approved
      ? "电脑已允许连接，可以选择照片。"
      : "请在电脑上点击“允许这台手机”。";
    $("expiry").textContent =
      `连接剩余 ${Math.max(0, Math.ceil((expires - Date.now()) / 60000))} 分钟`;
    $("connect").hidden = true;
    for (const item of items) {
      const remote = data.files.find((f) => f.id === item.id);
      if (remote?.state === "imported") {
        item.state = "done";
        item.message = "电脑已导入";
        item.reviewReason = remote.reviewReason;
      } else if (remote?.state === "rejected") {
        item.state = "failed";
        item.message = remote.reason || "电脑未能导入";
      }
    }
    render();
  } catch (error) {
    $("connection").textContent =
      error.status === 410 || error.status === 401
        ? "连接已失效，请在电脑上重新开启并扫码。"
        : "暂时无法连接电脑，请检查 Wi-Fi，稍后会重试。";
    approved = false;
    render();
    if (error.status === 410 || error.status === 401) {
      running = false;
      xhr?.abort();
      for (const item of items) {
        if (["ready", "sending", "sent"].includes(item.state)) {
          const sent = item.state !== "ready";
          item.sessionLost = true;
          item.state = "failed";
          item.id = undefined;
          item.message = sent
            ? "连接已失效，导入结果未确认。请先检查电脑是否已导入，再重新扫码，避免重复。"
            : "连接已失效，此照片尚未上传，请重新扫码后重传。";
        }
      }
      render();
      key = "";
      sessionStorage.removeItem(storage);
    }
  }
}
$("connect").onclick = async () => {
  if (!qr && !key) {
    $("connection").textContent = "没有有效二维码，请重新扫描电脑上的二维码。";
    return;
  }
  $("connect").disabled = true;
  try {
    if (!key) {
      const result = await api(
        "/api/pair",
        "POST",
        {
          name: /iPhone|iPad/.test(navigator.userAgent)
            ? "iPhone / iPad 浏览器"
            : /Android/.test(navigator.userAgent)
              ? "Android 手机浏览器"
              : "手机浏览器",
        },
        qr,
      );
      key = result.key;
      expires = result.expires;
      sessionStorage.setItem(storage, JSON.stringify({ qr, key, expires }));
    }
    await poll();
  } catch (error) {
    $("connection").textContent = error.message;
  } finally {
    $("connect").disabled = false;
  }
};
$("photos").onchange = () => {
  const selected = Array.from($("photos").files || []);
  let added = 0;
  for (const file of selected) {
    const existing = items.find(
      (i) =>
        i.file.name === file.name &&
        i.file.size === file.size &&
        i.file.lastModified === file.lastModified,
    );
    if (existing) continue;
    if (items.length >= 100) {
      say("本次连接最多 100 张；已有列表已保留。", true);
      break;
    }
    items.push({
      file,
      url: URL.createObjectURL(file),
      state: file.size > 30 * 1024 * 1024 ? "failed" : "ready",
      message:
        file.size > 30 * 1024 * 1024 ? "超过 30 MB，请缩小后重试" : "待上传",
    });
    added++;
  }
  $("photos").value = "";
  $("filter").value = "all";
  lastReminder = "";
  if (items.length < 100 || added)
    say(`新增 ${added} 张，点击“传到电脑”；之前的失败照片仍保留。`);
  render();
};
function send(item, index, total) {
  return new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.timeout = 120000;
    xhr.setRequestHeader("Authorization", `Bearer ${key}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Photo-Name", encodeURIComponent(item.file.name));
    xhr.setRequestHeader("X-Photo-Modified", String(item.file.lastModified));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        $("progress").value = Math.round((event.loaded / event.total) * 100);
        say(
          `正在上传第 ${index + 1} / ${total} 张 · ${Math.round((event.loaded / event.total) * 100)}%`,
        );
      }
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        item.id = data.id;
        resolve();
      } else
        reject(
          Object.assign(Error(data.error || "上传失败，请重试。"), {
            status: xhr.status,
          }),
        );
    };
    xhr.onerror = () => reject(Error("网络中断，请检查 Wi-Fi 后重试。"));
    xhr.ontimeout = () => reject(Error("上传超时，请重试或缩小照片。"));
    xhr.onabort = () => reject(Error("已取消，可重试此照片。"));
    xhr.send(item.file);
  });
}
async function upload(retry = false, only) {
  if (running || !approved) return;
  const queue = items.filter(
    (i) => (!only || i === only) && i.state === (retry ? "failed" : "ready"),
  );
  batchStarted = true;
  lastReminder = "";
  running = true;
  render();
  $("progress").hidden = false;
  for (let i = 0; i < queue.length; i++) {
    if (!running) break;
    const item = queue[i];
    item.id = undefined;
    item.sessionLost = false;
    item.state = "sending";
    item.message = "上传中";
    render();
    try {
      for (let attempt = 0; ; attempt++) {
        if (!running) throw Error("已取消，可重试此照片。");
        try {
          await send(item, i, queue.length);
          break;
        } catch (error) {
          if (error.status !== 429 || attempt >= 60 || !running) throw error;
          item.message = "电脑正在处理，等待后自动继续…";
          render();
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (item.state === "sending") {
        item.state = "sent";
        item.message = "已传到电脑，等待导入";
      }
    } catch (error) {
      if (!item.sessionLost) {
        item.state = "failed";
        item.message = error.message;
      }
    }
    render();
  }
  running = false;
  xhr = undefined;
  $("progress").hidden = true;
  say("传输已结束，正在确认电脑导入结果；失败项会集中提醒。");
  render();
  void poll();
}
$("upload").onclick = () => void upload();
$("retry").onclick = () => void upload(true);
$("cancel").onclick = () => {
  running = false;
  xhr?.abort();
};
setInterval(() => void poll(), 1500);
if (key) void poll();
render();
