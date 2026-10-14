import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  createTransfer,
  privateIPv4,
  photoType,
  safePhotoName,
  MAX_FILE,
} from "../server/transfer.ts";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function fixture(options: { ttl?: number; lease?: number } = {}) {
  const phonePort = await availablePort(),
    desktopPort = await availablePort();
  const transfer = createTransfer({
    ...options,
    phonePort,
    desktopPort,
    addresses: () => [{ name: "test", address: "127.0.0.1" }],
  });
  const server = createServer((req, res) => void transfer.desktop(req, res));
  await new Promise<void>((r) => server.listen(desktopPort, "127.0.0.1", r));
  const desktop = `http://127.0.0.1:${desktopPort}`,
    mobile = `http://127.0.0.1:${phonePort}`;
  let owner = "",
    qr = "",
    key = "";
  const pc = (
    path: string,
    method = "GET",
    data?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${desktop}/api/phone/${path}`, {
      method,
      headers: {
        "X-Desktop-Client": "1",
        ...(owner ? { Authorization: `Bearer ${owner}` } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const phone = (
    path: string,
    method = "GET",
    data?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${mobile}/api/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  async function start() {
    const r = await pc("start", "POST", { ip: "127.0.0.1" });
    assert.equal(r.status, 200);
    const value = await r.json();
    owner = value.owner;
    qr = value.url.split("#")[1];
  }
  async function pair() {
    const r = await phone(
      "pair",
      "POST",
      { name: "测试手机" },
      { Authorization: `Bearer ${qr}` },
    );
    assert.equal(r.status, 200);
    key = (await r.json()).key;
  }
  const jpeg = Buffer.from([255, 216, 255, 1, 2, 3, 4, 5]);
  const upload = (bytes = jpeg, extra: Record<string, string> = {}) =>
    fetch(`${mobile}/api/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/octet-stream",
        "X-Photo-Name": encodeURIComponent("报告照片.jpg"),
        "X-Photo-Modified": "1730000000000",
        ...extra,
      },
      body: bytes,
    });
  async function close() {
    await transfer.dispose();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  return {
    pc,
    phone,
    start,
    pair,
    upload,
    close,
    desktop,
    mobile,
    jpeg,
    phonePort,
    authorization: () => `Bearer ${key}`,
  };
}
test("只识别私有 IPv4，不把 VPN 或公网地址当局域网", () => {
  for (const ip of ["192.168.0.2", "10.1.2.3", "172.16.0.1", "172.31.255.254"])
    assert.equal(privateIPv4(ip), true);
  for (const ip of [
    "127.0.0.1",
    "198.18.0.1",
    "8.8.8.8",
    "172.32.0.1",
    "192.168.0.999",
    "1.2.3",
  ])
    assert.equal(privateIPv4(ip), false);
});
test("文件签名检查和安全名称拒绝主动内容及路径穿越", () => {
  assert.equal(photoType(Buffer.from([255, 216, 255])), "image/jpeg");
  assert.throws(() => photoType(Buffer.from("<script>")), /不是支持/);
  assert.throws(
    () => photoType(Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypavifmif1")])),
    /不是支持/,
  );
  for (const name of [
    "../photo.jpg",
    "a\\b.jpg",
    "\u0000.jpg",
    "..",
    "a".repeat(241),
  ])
    assert.throws(() => safePhotoName(name));
  assert.equal(safePhotoName("中文报告.jpg"), "中文报告.jpg");
});
test("电脑入口阻断跨站、DNS 重绑定、无自定义头和无效网卡", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.pc("networks", "GET", undefined, {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${f.desktop}/api/phone/networks`,
        { headers: { Host: "evil.invalid", "X-Desktop-Client": "1" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(rebound, 403);
    assert.equal((await fetch(`${f.desktop}/api/phone/networks`)).status, 403);
    assert.equal((await f.pc("start", "POST", { ip: "8.8.8.8" })).status, 400);
    assert.equal((await f.pc("networks")).status, 200);
  } finally {
    await f.close();
  }
});
test("配对须电脑批准，二维码不直接授予上传权限，每次只连一台手机", async () => {
  const f = await fixture();
  try {
    await f.start();
    assert.equal(
      (await f.pc("start", "POST", { ip: "127.0.0.1" })).status,
      409,
    );
    assert.equal((await f.upload()).status, 401);
    await f.pair();
    assert.equal((await f.upload()).status, 403);
    assert.equal((await f.phone("pair", "POST", {})).status, 401);
    assert.equal((await f.pc("approve", "POST")).status, 200);
    assert.equal((await f.phone("status")).status, 200);
    assert.equal(
      (
        await f.phone("status", "GET", undefined, {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.upload(f.jpeg, { Authorization: "Bearer invalid" })).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("照片字节与元数据完整保留，确认导入后临时文件无法再读取", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.pair();
    await f.pc("approve", "POST");
    const original = Buffer.alloc(1024 * 1024 + 13, 117);
    f.jpeg.copy(original);
    const response = await f.upload(original);
    assert.equal(response.status, 201);
    const uploaded = await response.json();
    const status = await (await f.pc("status")).json();
    assert.equal(status.files[0].name, "报告照片.jpg");
    assert.equal(status.files[0].modified, 1730000000000);
    assert.equal(status.files[0].path, undefined);
    const received = Buffer.from(
      await (await f.pc(`file/${uploaded.id}`)).arrayBuffer(),
    );
    assert.equal(
      createHash("sha256").update(received).digest("hex"),
      createHash("sha256").update(original).digest("hex"),
    );
    assert.equal(
      (await f.pc(`ack/${uploaded.id}`, "POST", { state: "bad" })).status,
      400,
    );
    await f.pc(`ack/${uploaded.id}`, "POST", { state: "imported" });
    assert.equal((await f.pc(`file/${uploaded.id}`)).status, 404);
    assert.equal(
      (await (await f.phone("status")).json()).files[0].state,
      "imported",
    );
    assert.equal(
      (
        await f.pc("stop", "POST", undefined, {
          Authorization: "Bearer invalid",
        })
      ).status,
      401,
    );
    assert.equal((await f.pc("status")).status, 200);
  } finally {
    await f.close();
  }
});
test("损坏格式、非法文件名、无效时间和声明的大文件被拒绝", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.pair();
    await f.pc("approve", "POST");
    assert.equal((await f.upload(Buffer.from("fake"))).status, 415);
    assert.equal(
      (await f.upload(f.jpeg, { "X-Photo-Name": "..%2Fbad.jpg" })).status,
      400,
    );
    assert.equal(
      (await f.upload(f.jpeg, { "X-Photo-Modified": "-1" })).status,
      400,
    );
    const code = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${f.mobile}/api/upload`,
        {
          method: "POST",
          headers: {
            Authorization: f.authorization(),
            "X-Photo-Name": "photo.jpg",
            "X-Photo-Modified": "1730000000000",
            "Content-Length": String(MAX_FILE + 1),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(code, 413);
    const keyResponse = await f.phone("status");
    assert.equal(keyResponse.status, 200);
    assert.equal((await (await f.pc("status")).json()).files.length, 0);
  } finally {
    await f.close();
  }
});
test("待导入队列限八张，确认后释放队列；整次连接限一百张", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.pair();
    await f.pc("approve", "POST");
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await (await f.upload()).json()).id);
    assert.equal((await f.upload()).status, 429);
    for (const id of ids)
      await f.pc(`ack/${id}`, "POST", { state: "imported" });
    for (let i = 8; i < 100; i++) {
      const response = await f.upload();
      assert.equal(response.status, 201);
      const value = await response.json();
      await f.pc(`ack/${value.id}`, "POST", { state: "rejected" });
    }
    assert.equal((await f.upload()).status, 413);
  } finally {
    await f.close();
  }
});
test("关闭连接清理自建暂存目录，不再接受照片；不返回电脑编辑器", async () => {
  const before = new Set(await readdir(tmpdir()));
  const f = await fixture();
  try {
    await f.start();
    await f.pair();
    await f.pc("approve", "POST");
    await f.upload();
    assert.equal((await fetch(`${f.mobile}/src/main.ts`)).status, 401);
    const temp = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("report-photo-transfer-") && !before.has(name),
    );
    assert.equal(temp.length, 1);
    await f.pc("stop", "POST");
    assert.ok(!(await readdir(tmpdir())).includes(temp[0]));
    await assert.rejects(fetch(f.mobile));
    assert.equal((await f.pc("status")).status, 410);
  } finally {
    await f.close();
  }
});
test("二维码到期或电脑失去心跳后，旧凭证无法恢复连接", async () => {
  for (const options of [{ ttl: 50 }, { lease: 50 }]) {
    const f = await fixture(options);
    try {
      await f.start();
      await new Promise((r) => setTimeout(r, 70));
      assert.equal((await f.pc("status")).status, 410);
      await assert.rejects(fetch(f.mobile));
    } finally {
      await f.close();
    }
  }
});
