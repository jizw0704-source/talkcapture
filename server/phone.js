const $ = (id) => document.getElementById(id);
const qr = location.hash.slice(1);
const storage = "report-phone-session";
let key = "",
  expires = 0,
  approved = false,
  running = false,
  xhr,
  items = [];
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
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
function render() {
  $("list").replaceChildren();
  for (const item of items) {
    const li = document.createElement("li"),
      name = document.createElement("strong"),
      state = document.createElement("span");
    name.textContent = item.file.name;
    state.textContent = item.message;
    li.append(name, state);
    $("list").append(li);
  }
  $("photos").disabled = !approved || running;
  $("upload").disabled =
    !approved || running || !items.some((i) => i.state === "ready");
  $("retry").hidden =
    running || !approved || !items.some((i) => i.state === "failed");
  $("cancel").hidden = !running;
}
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
  items = Array.from($("photos").files || []).map((file) => ({
    file,
    state: file.size > 30 * 1024 * 1024 ? "failed" : "ready",
    message:
      file.size > 30 * 1024 * 1024 ? "超过 30 MB，请缩小后重试" : "待上传",
  }));
  if (items.length > 100) {
    items = [];
    say("一次最多选择 100 张照片。", true);
  } else say(`已选择 ${items.length} 张照片，点击“传到电脑”。`);
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
      } else reject(Error(data.error || "上传失败，请重试。"));
    };
    xhr.onerror = () => reject(Error("网络中断，请检查 Wi-Fi 后重试。"));
    xhr.ontimeout = () => reject(Error("上传超时，请重试或缩小照片。"));
    xhr.onabort = () => reject(Error("已取消，可重试此照片。"));
    xhr.send(item.file);
  });
}
async function upload(retry = false) {
  if (running || !approved) return;
  const queue = items.filter((i) => i.state === (retry ? "failed" : "ready"));
  running = true;
  render();
  $("progress").hidden = false;
  for (let i = 0; i < queue.length; i++) {
    if (!running) break;
    const item = queue[i];
    item.state = "sending";
    item.message = "上传中";
    render();
    try {
      await send(item, i, queue.length);
      item.state = "sent";
      item.message = "已传到电脑，等待导入";
    } catch (error) {
      item.state = "failed";
      item.message = error.message;
    }
    render();
  }
  running = false;
  xhr = undefined;
  $("progress").hidden = true;
  render();
  say("本轮上传结束。请确认列表中显示“电脑已导入”；失败照片可以重试。");
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
