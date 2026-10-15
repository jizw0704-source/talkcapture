import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { mkdtemp, open, readFile, rm, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const MAX_FILE = 30 * 1024 * 1024;
export const MAX_TOTAL = 1024 * 1024 * 1024;
export const SESSION_MS = 10 * 60 * 1000;
const token = () => randomBytes(32).toString("hex");
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function privateIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168))
  );
}
export function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    /utun|tun\d|tailscale|docker|vbox|vmnet|loopback/i.test(name)
      ? []
      : (addresses || [])
          .filter(
            (a) => a.family === "IPv4" && !a.internal && privateIPv4(a.address),
          )
          .map((a) => ({ name, address: a.address })),
  );
}
export function photoType(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
    return "image/png";
  const header = new TextDecoder("ascii").decode(bytes);
  if (
    header.slice(4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(header.slice(8)) &&
    !/avif|avis/.test(header.slice(8))
  )
    return "image/heic";
  throw new HttpError(
    415,
    "不是支持的照片格式，请选择 JPEG、PNG 或 HEIC / HEIF。",
  );
}
export function safePhotoName(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 240 ||
    /[\/\\\u0000-\u001f\u007f]/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new HttpError(400, "照片名称无效，请重命名后重试。");
  return value;
}
function matches(value: unknown, expected: string) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
function authorize(req: IncomingMessage, expected: string) {
  if (!matches(req.headers.authorization, `Bearer ${expected}`))
    throw new HttpError(401, "连接无效或已关闭，请重新扫描电脑上的二维码。");
}
export function headers(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}
function json(res: ServerResponse, value: unknown, status = 200) {
  headers(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new HttpError(413, "请求内容过大。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    throw new HttpError(400, "请求格式不正确。");
  }
}
type Uploaded = {
  id: string;
  name: string;
  size: number;
  modified: number;
  type: string;
  state: "queued" | "imported" | "rejected";
  reason?: string;
  reviewReason?: string;
  path?: string;
};
type Session = {
  owner: string;
  qr: string;
  ip: string;
  origin: string;
  expires: number;
  heartbeat: number;
  peer?: { key: string; name: string; approved: boolean };
  dir: string;
  files: Uploaded[];
  bytes: number;
  receiving: boolean;
  closed: boolean;
  server: Server;
};

export function createTransfer(
  options: {
    desktopPort?: number;
    phonePort?: number;
    ttl?: number;
    lease?: number;
    addresses?: typeof lanAddresses;
  } = {},
) {
  const desktopPort = options.desktopPort ?? 9015,
    phonePort = options.phonePort ?? 9016;
  const desktopOrigin = `http://127.0.0.1:${desktopPort}`;
  let active: Session | undefined,
    starting = false;
  const expires = (s: Session) =>
    s.closed ||
    Date.now() >= s.expires ||
    Date.now() - s.heartbeat > (options.lease ?? 90_000);
  async function close() {
    const s = active;
    active = undefined;
    if (!s) return;
    s.closed = true;
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    await rm(s.dir, { recursive: true, force: true });
  }
  const sweep = setInterval(() => {
    if (active && expires(active)) void close();
  }, 1000);
  sweep.unref();
  function view(s: Session) {
    return {
      expires: s.expires,
      peer: s.peer ? { name: s.peer.name, approved: s.peer.approved } : null,
      receiving: s.receiving,
      files: s.files.map(({ path: _path, ...file }) => file),
    };
  }
  async function start(ip: unknown) {
    if (starting || active)
      throw new HttpError(409, "已经开启传图，请先关闭现有连接。");
    const addresses = (options.addresses ?? lanAddresses)();
    if (typeof ip !== "string" || !addresses.some((a) => a.address === ip))
      throw new HttpError(400, "电脑没有该局域网地址，请连接 Wi-Fi 后重试。");
    starting = true;
    let dir = "";
    try {
      dir = await mkdtemp(join(tmpdir(), "report-photo-transfer-"));
      const s: Session = {
        owner: token(),
        qr: token(),
        ip,
        origin: `http://${ip}:${phonePort}`,
        expires: Date.now() + (options.ttl ?? SESSION_MS),
        heartbeat: Date.now(),
        dir,
        files: [],
        bytes: 0,
        receiving: false,
        closed: false,
        server: createServer(),
      };
      s.server.on("request", (req, res) => {
        void phone(s, req, res).catch((error) => fail(res, error));
      });
      s.server.requestTimeout = 120_000;
      s.server.headersTimeout = 15_000;
      s.server.maxConnections = 12;
      await new Promise<void>((resolve, reject) => {
        s.server.once("error", reject);
        s.server.listen(phonePort, ip, () => {
          s.server.removeListener("error", reject);
          resolve();
        });
      });
      active = s;
      return {
        owner: s.owner,
        url: `${s.origin}/#${s.qr}`,
        expires: s.expires,
      };
    } catch {
      if (dir) await rm(dir, { recursive: true, force: true });
      throw new HttpError(
        503,
        "无法开启手机接收端口，请检查网络、端口占用或防火墙设置。",
      );
    } finally {
      starting = false;
    }
  }
  async function phone(s: Session, req: IncomingMessage, res: ServerResponse) {
    headers(res);
    if (
      req.headers.host !== `${s.ip}:${phonePort}` ||
      (req.headers.origin && req.headers.origin !== s.origin)
    )
      throw new HttpError(403, "请直接使用扫码打开的页面，不允许跨站访问。");
    if (expires(s)) throw new HttpError(410, "二维码已过期或电脑停止了传图。");
    const path = req.url?.split("?")[0];
    if (
      req.method === "GET" &&
      (path === "/" || path === "/phone.js" || path === "/phone.css")
    ) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
      );
      const file = path === "/" ? "phone.html" : path!.slice(1);
      const data = await readFile(new URL(`./${file}`, import.meta.url));
      res.setHeader(
        "Content-Type",
        path === "/phone.js"
          ? "text/javascript; charset=utf-8"
          : path === "/phone.css"
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
      );
      res.end(data);
      return;
    }
    if (path === "/api/pair" && req.method === "POST") {
      authorize(req, s.qr);
      const data = await body(req);
      if (s.peer)
        throw new HttpError(
          409,
          "此二维码已有一台手机申请连接，请在电脑上关闭并重新生成。",
        );
      const name =
        typeof data.name === "string"
          ? data.name.slice(0, 60).replace(/[\u0000-\u001f]/g, "")
          : "手机浏览器";
      s.peer = { key: token(), name, approved: false };
      json(res, { key: s.peer.key, expires: s.expires });
      return;
    }
    if (!s.peer) throw new HttpError(401, "请先申请连接电脑。");
    authorize(req, s.peer.key);
    if (path === "/api/status" && req.method === "GET") {
      json(res, { ...view(s), approved: s.peer.approved });
      return;
    }
    if (path !== "/api/upload" || req.method !== "POST")
      throw new HttpError(404, "该入口不可用。");
    if (!s.peer.approved)
      throw new HttpError(403, "请先在电脑上允许这台手机连接。");
    if (s.receiving)
      throw new HttpError(429, "另一张照片正在上传，请稍后重试。");
    if (s.files.length >= 100 || s.bytes >= MAX_TOTAL)
      throw new HttpError(
        413,
        "本次连接已达到 100 张或 1 GB 上限，请先关闭连接。",
      );
    if (s.files.filter((f) => f.state === "queued").length >= 8)
      throw new HttpError(429, "电脑有较多待导入照片，请稍后重试。");
    let name: string;
    try {
      name = safePhotoName(
        decodeURIComponent(String(req.headers["x-photo-name"] || "")),
      );
    } catch {
      throw new HttpError(400, "照片名称无效。");
    }
    const modified = Number(req.headers["x-photo-modified"]);
    if (!Number.isSafeInteger(modified) || modified < 0 || modified > 8.64e15)
      throw new HttpError(400, "照片时间参数无效。");
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_FILE || declared + s.bytes > MAX_TOTAL)
      throw new HttpError(413, "照片超过 30 MB 或本次连接超过 1 GB。");
    const id = randomUUID(),
      pathOnDisk = join(s.dir, id);
    s.receiving = true;
    let handle: Awaited<ReturnType<typeof open>> | undefined,
      kept = false;
    try {
      handle = await open(pathOnDisk, "wx", 0o600);
      let size = 0,
        prefix = Buffer.alloc(0);
      for await (const part of req) {
        if (expires(s)) throw new HttpError(410, "连接已过期，请重新扫码。");
        const chunk = Buffer.from(part);
        size += chunk.length;
        if (size > MAX_FILE || size + s.bytes > MAX_TOTAL)
          throw new HttpError(413, "照片超过 30 MB 或本次连接超过 1 GB。");
        if (prefix.length < 64)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 64 - prefix.length),
          ]);
        await handle.writeFile(chunk);
      }
      const type = photoType(prefix);
      if (!size) throw new HttpError(400, "照片是空文件。");
      await handle.close();
      handle = undefined;
      if (expires(s)) throw new HttpError(410, "连接已关闭，未保留此照片。");
      s.files.push({
        id,
        name,
        size,
        modified,
        type,
        state: "queued",
        path: pathOnDisk,
      });
      s.bytes += size;
      kept = true;
      json(res, { id, state: "queued" }, 201);
    } finally {
      await handle?.close();
      if (!kept) await unlink(pathOnDisk).catch(() => undefined);
      s.receiving = false;
    }
  }
  function fail(res: ServerResponse, error: unknown) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.setHeader("Connection", "close");
    json(
      res,
      {
        error:
          error instanceof HttpError
            ? error.message
            : "传图服务暂时不可用，请关闭后重新开启。",
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
  async function desktop(req: IncomingMessage, res: ServerResponse) {
    try {
      if (
        req.headers.host !== `127.0.0.1:${desktopPort}` ||
        req.headers["x-desktop-client"] !== "1" ||
        (req.headers.origin && req.headers.origin !== desktopOrigin)
      )
        throw new HttpError(403, "只允许电脑工具页面管理传图。");
      const path = req.url?.split("?")[0];
      if (path === "/api/phone/networks" && req.method === "GET") {
        json(res, { addresses: (options.addresses ?? lanAddresses)() });
        return;
      }
      if (path === "/api/phone/start" && req.method === "POST") {
        const data = await body(req);
        json(res, await start(data.ip));
        return;
      }
      const s = active;
      if (!s || expires(s)) {
        if (s) await close();
        throw new HttpError(410, "手机传图已关闭或过期，请重新开启。");
      }
      authorize(req, s.owner);
      s.heartbeat = Date.now();
      if (path === "/api/phone/stop" && req.method === "POST") {
        await close();
        json(res, { closed: true });
        return;
      }
      if (path === "/api/phone/status" && req.method === "GET") {
        json(res, view(s));
        return;
      }
      if (path === "/api/phone/approve" && req.method === "POST") {
        if (!s.peer) throw new HttpError(409, "还没有手机申请连接。");
        s.peer.approved = true;
        json(res, { approved: true });
        return;
      }
      const fileMatch = path?.match(/^\/api\/phone\/file\/([a-f0-9-]{36})$/);
      if (fileMatch && req.method === "GET") {
        const file = s.files.find(
          (f) => f.id === fileMatch[1] && f.state === "queued",
        );
        if (!file?.path) throw new HttpError(404, "待导入照片不存在。");
        headers(res);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", file.size);
        const stream = createReadStream(file.path);
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
        return;
      }
      const ackMatch = path?.match(/^\/api\/phone\/ack\/([a-f0-9-]{36})$/);
      if (ackMatch && req.method === "POST") {
        const data = await body(req),
          file = s.files.find((f) => f.id === ackMatch[1]);
        if (!file) throw new HttpError(404, "照片不存在。");
        if (data.state !== "imported" && data.state !== "rejected")
          throw new HttpError(400, "导入状态无效。");
        if (file.state === "queued") {
          if (file.path) await rm(file.path, { force: true });
          file.path = undefined;
          file.state = data.state;
          if (
            data.state === "imported" &&
            typeof data.reviewReason === "string"
          )
            file.reviewReason = data.reviewReason.slice(0, 300);
          if (data.state === "rejected")
            file.reason =
              typeof data.reason === "string"
                ? data.reason.slice(0, 300)
                : "电脑未能导入，请查看电脑的文件格式或容量提示。";
        }
        json(res, { state: file.state });
        return;
      }
      throw new HttpError(404, "该入口不可用。");
    } catch (error) {
      fail(res, error);
    }
  }
  return {
    desktop,
    close,
    dispose: async () => {
      clearInterval(sweep);
      await close();
    },
  };
}
