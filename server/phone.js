import { t, uiText, uiAttr, setupLocale } from "/i18n.js";
setupLocale();
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
  if ($("status").textContent !== text) uiText($("status"), () => text);
  $("status").classList.toggle("error", error);
};
function render() {
  const failed = items.filter((i) => i.state === "failed"),
    done = items.filter((i) => i.state === "done"),
    pending = items.filter((i) =>
      ["ready", "sending", "sent"].includes(i.state),
    ),
    reviews = items.filter((i) => i.reviewReason);
  uiText($("batchCounts"), () =>
    items.length
      ? t(
          "{0} \u5F20 \u00B7 \u5DF2\u5BFC\u5165 {1} \u00B7 \u5F85\u5B8C\u6210 {2} \u00B7 \u5931\u8D25 {3}{4}",
          items.length,
          done.length,
          pending.length,
          failed.length,
          reviews.length
            ? t(" \u00B7 \u8FB9\u754C\u5F85\u6838\u5BF9 {0}", reviews.length)
            : "",
        )
      : t(
          "\u9009\u62E9\u7167\u7247\u540E\uFF0C\u5728\u8FD9\u91CC\u67E5\u770B\u4F20\u8F93\u7ED3\u679C\u3002",
        ),
  );
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
    uiText($("failureHeading"), () =>
      t(
        "{0}\uFF0C\u8FD8\u6709 {1} \u5F20\u9700\u8981\u91CD\u4F20",
        done.length
          ? t("\u5176\u4ED6\u7167\u7247\u5DF2\u5904\u7406\u5B8C")
          : t("\u672C\u8F6E\u4F20\u8F93\u5DF2\u7ED3\u675F"),
        failed.length,
      ),
    );
    uiText($("failureDetail"), () =>
      t(
        "\u5931\u8D25\u7167\u7247\u548C\u539F\u56E0\u5DF2\u96C6\u4E2D\u5217\u51FA\u3002\u539F\u6587\u4EF6\u4ECD\u5728\u6B64\u9875\u9762\uFF0C\u53EF\u4EE5\u76F4\u63A5\u91CD\u8BD5\uFF0C\u65E0\u9700\u91CD\u65B0\u67E5\u627E\u76F8\u518C\u3002\u82E5\u6587\u4EF6\u635F\u574F\u6216\u8FC7\u5927\uFF0C\u8BF7\u6309\u539F\u56E0\u91CD\u65B0\u9009\u62E9\u6216\u8F6C\u6362\u3002",
      ),
    );
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
      uiAttr(thumb, "alt", () => t("{0}的缩略图", item.file.name));
      thumb.loading = "lazy";
      thumb.src = item.url;
      thumb.onerror = () => {
        thumb.hidden = true;
      };
      uiText(name, () => item.file.name);
      actions.className = "item-actions";
      uiText(retry, () => t("\u53EA\u91CD\u8BD5\u8FD9\u5F20"));
      uiText(replace, () => t("\u91CD\u65B0\u9009\u62E9\u8FD9\u5F20"));
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
          uiText(name, () => file.name);
          thumb.hidden = false;
          uiAttr(thumb, "alt", () => t("{0}的缩略图", file.name));
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
    uiText(item.stateElement, () => item.message);
    item.stateElement.className = item.state === "failed" ? "error" : "";
    uiText(item.reasonElement, () => item.reviewReason || "");
    item.reasonElement.hidden = !item.reviewReason;
    item.retryButton.hidden = item.replaceButton.hidden =
      item.state !== "failed";
    item.retryButton.disabled = running || !approved;
    item.replaceButton.disabled = running;
  }
  uiText($("pickerLabel"), () =>
    items.length
      ? t("\u7EE7\u7EED\u6DFB\u52A0\u7167\u7247")
      : t("\u9009\u62E9\u76F8\u518C\u7167\u7247"),
  );
  $("photos").disabled = !approved || running;
  $("upload").disabled =
    !approved || running || !items.some((i) => i.state === "ready");
  uiText($("upload"), () =>
    running
      ? t("\u6B63\u5728\u4F20\u8F93\u2026")
      : t("\u4F20\u5230\u7535\u8111"),
  );
  $("retry").hidden = running || !approved || !failed.length;
  uiText($("retry"), () =>
    t(
      "\u91CD\u8BD5\u5168\u90E8\u5931\u8D25\u7167\u7247\uFF08{0}\uFF09",
      failed.length,
    ),
  );
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
    uiText($("connection"), () =>
      approved
        ? t(
            "\u7535\u8111\u5DF2\u5141\u8BB8\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u9009\u62E9\u7167\u7247\u3002",
          )
        : t(
            "\u8BF7\u5728\u7535\u8111\u4E0A\u70B9\u51FB\u201C\u5141\u8BB8\u8FD9\u53F0\u624B\u673A\u201D\u3002",
          ),
    );
    uiText($("expiry"), () =>
      t(
        "\u8FDE\u63A5\u5269\u4F59 {0} \u5206\u949F",
        Math.max(0, Math.ceil((expires - Date.now()) / 60000)),
      ),
    );
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
    uiText($("connection"), () =>
      error.status === 410 || error.status === 401
        ? t(
            "\u8FDE\u63A5\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u7535\u8111\u4E0A\u91CD\u65B0\u5F00\u542F\u5E76\u626B\u7801\u3002",
          )
        : t(
            "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u7535\u8111\uFF0C\u8BF7\u68C0\u67E5 Wi-Fi\uFF0C\u7A0D\u540E\u4F1A\u91CD\u8BD5\u3002",
          ),
    );
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
    uiText($("connection"), () =>
      t(
        "\u6CA1\u6709\u6709\u6548\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u91CD\u65B0\u626B\u63CF\u7535\u8111\u4E0A\u7684\u4E8C\u7EF4\u7801\u3002",
      ),
    );
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
    uiText($("connection"), () => error.message);
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

document.addEventListener("languagechange", () => render());
