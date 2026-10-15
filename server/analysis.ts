import { summarizeWithMiniMax } from "./minimax.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
let active = false;
export async function analysisApi(req: IncomingMessage, res: ServerResponse) {
  const reply = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  // No cross-origin requests and no arbitrary URL/model execution.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`)
    return reply(403, { error: "仅允许本机工具调用。" });
  if (req.url === "/api/analysis/summary" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
        size += chunk.length;
        if (size > 180000) throw Error("报告文字过长，请先拆分报告。");
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !Array.isArray(data.pages) ||
        !data.pages.length ||
        data.pages.length > 100
      )
        throw Error("请先识别报告文字。");
      if (
        new Set(data.pages.map((p: { page: number }) => p.page)).size !==
        data.pages.length
      )
        throw Error("来源页码重复，请重新载入报告。");
      const source = data.pages
        .map((p: { page: number; text: string }) => {
          if (
            !Number.isInteger(p.page) ||
            p.page < 1 ||
            typeof p.text !== "string"
          )
            throw Error("页面内容无效。");
          return "第 " + p.page + " 页：\n" + p.text;
        })
        .join("\n\n");
      if (source.length > 8000)
        throw Error("报告文字超过本次解读容量，请拆分报告后重试。");
      if (source.length < 30) throw Error("可识别文字不足，请补充内容后重试。");
      reply(
        200,
        await summarizeWithMiniMax(
          data.pages.map((p: { page: number; text: string }) => ({
            page: p.page,
            text: p.text,
          })),
        ),
      );
    } catch (error) {
      reply(503, {
        error: (error as Error).message,
      });
    }
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/analysis/ocr")
    return reply(404, { error: "接口不存在。" });
  if (active) return reply(429, { error: "正在识别另一张照片，请稍后重试。" });
  if (process.platform !== "darwin")
    return reply(503, {
      error: "当前本地识别需要 macOS Vision；尚未支持此系统。",
    });
  active = true;
  let directory = "";
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024)
        throw Error("照片超过 30 MB，请缩小后重试。");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw Error("没有收到照片。");
    directory = await mkdtemp(join(tmpdir(), "talkcapture-ocr-"));
    const image = join(directory, "source");
    await writeFile(image, bytes, { mode: 0o600 });
    const { stdout } = await run(
      "/Library/Developer/CommandLineTools/usr/bin/swift",
      [
        fileURLToPath(new URL("./native/recognize.swift", import.meta.url)),
        image,
      ],
      {
        env: {
          ...process.env,
          DEVELOPER_DIR: "/Library/Developer/CommandLineTools",
        },
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    reply(200, { lines: JSON.parse(stdout) });
  } catch (error) {
    reply(422, {
      error: "本地识别未完成，请检查照片或 macOS Swift 工具后重试。",
      detail: (
        (error as Error & { stderr?: string }).stderr ||
        (error as Error).message
      ).slice(0, 500),
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    active = false;
  }
}
