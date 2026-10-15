import type { IncomingMessage, ServerResponse } from "node:http";
import { configFile, readLocal, saveModel, bases } from "./model-config.ts";
import { testMiniMax } from "./minimax.ts";
export function createSettingsApi(file: URL = configFile) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (code: number, data: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    if (
      !/^127\.0\.0\.1:\d+$/.test(req.headers.host || "") ||
      req.headers["x-desktop-client"] !== "1" ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`)
    )
      return reply(403, { error: "设置仅允许本机工具页面访问。" });
    try {
      if (req.method === "GET" && req.url === "/api/settings") {
        const local = await readLocal(file);
        const model =
          process.env.MINIMAX_MODEL || local.MINIMAX_MODEL || "MiniMax-M2.5";
        const base =
          process.env.MINIMAX_BASE_URL || local.MINIMAX_BASE_URL || bases[0];
        const c = {
          model: /^MiniMax-[A-Za-z0-9.\-]{1,80}$/.test(model)
            ? model
            : "MiniMax-M2.5",
          base: bases.includes(base) ? base : bases[0],
          key: process.env.MINIMAX_API_KEY || local.MINIMAX_API_KEY || "",
        };
        return reply(200, {
          model: c.model,
          base: c.base,
          keyConfigured: !!c.key,
          environmentOverride: !!(
            process.env.MINIMAX_API_KEY ||
            process.env.MINIMAX_MODEL ||
            process.env.MINIMAX_BASE_URL
          ),
        });
      }
      if (req.method === "POST" && req.url === "/api/settings/test")
        return reply(200, await testMiniMax());
      if (req.method !== "PUT" || req.url !== "/api/settings")
        return reply(404, { error: "设置接口不存在。" });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply(415, { error: "设置格式无效。" });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12000) throw Error("设置内容过长。");
        chunks.push(Buffer.from(chunk));
      }
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        typeof v.model !== "string" ||
        typeof v.base !== "string" ||
        (v.key !== undefined && typeof v.key !== "string")
      )
        throw Error("设置内容无效。");
      if (
        process.env.MINIMAX_API_KEY ||
        process.env.MINIMAX_MODEL ||
        process.env.MINIMAX_BASE_URL
      )
        throw Error("当前使用启动环境变量，请先移除环境变量再通过页面保存。");
      // Never read back or echo a secret into the browser.
      await saveModel(
        { model: v.model.trim(), base: v.base, key: v.key || undefined },
        file,
      );
      const local = await readLocal(file);
      return reply(200, {
        saved: true,
        keyConfigured: !!local.MINIMAX_API_KEY,
      });
    } catch (error) {
      if (req.url === "/api/settings/test")
        return reply(400, { error: (error as Error).message });
      reply(400, {
        error:
          "无法保存或读取设置，请检查模型名称、官方服务地址与密钥格式后重试。",
      });
    }
  };
}
export const settingsApi = createSettingsApi();
