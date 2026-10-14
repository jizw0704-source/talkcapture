import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTransfer, headers } from "./transfer.ts";

const transfer = createTransfer(),
  root = fileURLToPath(new URL("../dist/", import.meta.url));
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  headers(res);
  if (req.headers.host !== "127.0.0.1:9015") {
    res.writeHead(403);
    res.end("Only the local desktop page is allowed.");
    return;
  }
  if (req.url?.startsWith("/api/phone/")) {
    await transfer.desktop(req, res);
    return;
  }
  try {
    if (req.method !== "GET" && req.method !== "HEAD") throw Error();
    const path = decodeURIComponent(
      new URL(req.url || "/", "http://127.0.0.1:9015").pathname,
    );
    const file = resolve(root, path === "/" ? "index.html" : `.${path}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error();
    if (!(await stat(file)).isFile()) throw Error();
    res.setHeader(
      "Content-Type",
      types[extname(file)] || "application/octet-stream",
    );
    if (req.method === "HEAD") res.end();
    else {
      const stream = createReadStream(file);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    }
  } catch {
    res.writeHead(404);
    res.end("Not found. Build the project before starting.");
  }
});
server.on("error", (error) => {
  console.error(
    "无法启动电脑工具，请检查 9015 端口是否占用。",
    (error as NodeJS.ErrnoException).code,
  );
  process.exitCode = 1;
});
server.listen(9015, "127.0.0.1", () =>
  console.log(
    "学术报告照片整理助手：http://127.0.0.1:9015/\n手机接收只在点击“生成二维码”后开启。",
  ),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void transfer.dispose().finally(() => {
      server.closeAllConnections();
      server.close(() => process.exit(0));
    });
  });
