import { loadCorrections } from "./learning";
import type { ProcessRequest, ProcessResult } from "./types";

let worker: Worker | undefined;
let serial = 0;
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<
  number,
  {
    resolve: (
      value: ProcessResult & { blob: Blob; width: number; height: number },
    ) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export function stopProcessing(reason = "处理已取消。") {
  generation++;
  worker?.terminate();
  worker = undefined;
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(Error(reason));
  }
  pending.clear();
}
export function processImage(request: Omit<ProcessRequest, "id">) {
  const scheduledGeneration = generation;
  const result = queue.then(() => {
    if (scheduledGeneration !== generation) throw Error("处理已取消。");
    return runImage(request);
  });
  queue = result.catch(() => undefined);
  return result;
}
function runImage(request: Omit<ProcessRequest, "id">) {
  if (!worker) {
    worker = new Worker(new URL("./image.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<ProcessResult>) => {
      const result = event.data,
        job = pending.get(result.id);
      if (!job) return;
      clearTimeout(job.timer);
      pending.delete(result.id);
      if (result.error || !result.blob || !result.width || !result.height)
        job.reject(Error(result.error || "图像处理没有返回结果。"));
      else
        job.resolve(
          result as ProcessResult & {
            blob: Blob;
            width: number;
            height: number;
          },
        );
    };
    worker.onerror = () =>
      stopProcessing("后台图像处理异常，请重新选择照片后重试。");
  }
  const id = ++serial;
  return new Promise<
    ProcessResult & { blob: Blob; width: number; height: number }
  >((resolve, reject) => {
    const timer = setTimeout(() => {
      stopProcessing("照片处理超时，请缩小照片后重试。");
    }, 120_000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({
      ...request,
      ...(request.kind === "detect"
        ? { examples: request.examples ?? loadCorrections() }
        : {}),
      id,
    });
  });
}
