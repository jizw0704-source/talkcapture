import { readFile, writeFile, rename, chmod, unlink } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
export const configFile = new URL("../.env.local", import.meta.url);
export const bases = [
  "https://api.minimax.cn/v1",
  "https://api.minimaxi.com/v1",
  "https://api.minimax.io/v1",
];
export async function readLocal(file: URL = configFile) {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw Error("无法读取电脑端模型配置。");
  }
}
export function validateModel(model: string, base: string) {
  if (!/^MiniMax-[A-Za-z0-9.\-]{1,80}$/.test(model))
    throw Error("请输入有效的 MiniMax 模型名称。");
  if (!bases.includes(base)) throw Error("仅支持 MiniMax 官方 API 地址。");
}
let queue: Promise<unknown> = Promise.resolve();
export function saveModel(
  value: { model: string; base: string; key?: string },
  file: URL = configFile,
) {
  const job = queue.then(async () => {
    validateModel(value.model, value.base);
    if (
      value.key !== undefined &&
      (!value.key.trim() ||
        value.key.length > 4096 ||
        /[\r\n\0]/.test(value.key))
    )
      throw Error("密钥格式无效；留空可保留当前密钥。");
    const saved = await readLocal(file);
    saved.MINIMAX_MODEL = value.model;
    saved.MINIMAX_BASE_URL = value.base;
    if (value.key !== undefined) saved.MINIMAX_API_KEY = value.key.trim();
    const content =
      Object.entries(saved)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") + "\n";
    const target = fileURLToPath(file),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, content, { mode: 0o600, flag: "wx" });
      await chmod(temp, 0o600);
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
  });
  queue = job.catch(() => {});
  return job;
}
