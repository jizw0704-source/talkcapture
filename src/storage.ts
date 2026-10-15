import type { SavedProject } from "./types";
const database = "report-photo-organizer";
type Original = { blob: Blob; digest: string };
let writes: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("project"))
        db.createObjectStore("project");
      if (!db.objectStoreNames.contains("originals"))
        db.createObjectStore("originals");
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        Error("本地缓存升级被旧页面占用，请关闭其他旧版工具标签页后重试。"),
      );
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
export async function readProject(): Promise<SavedProject | undefined> {
  await writes;
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["project", "originals"]);
      const project = tx.objectStore("project").get("current");
      const originals = tx.objectStore("originals").getAll();
      const keys = tx.objectStore("originals").getAllKeys();
      tx.oncomplete = () => {
        const value = project.result as SavedProject | undefined;
        if (value?.version === 1 && Array.isArray(value.photos)) {
          const stored = new Map(
            keys.result.map((key, i) => [
              String(key),
              originals.result[i] as Original,
            ]),
          );
          for (const photo of value.photos) {
            const source = stored.get(photo.id);
            // Never attach a stale source left behind by a failed replacement write.
            if (
              source?.blob instanceof Blob &&
              photo.digest &&
              source.digest === photo.digest &&
              source.blob.size === photo.size
            ) {
              photo.file = new File([source.blob], photo.name, {
                type: source.blob.type,
                lastModified: photo.modified,
              });
            } else delete photo.file;
          }
        }
        resolve(value);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("读取本地缓存失败。"));
    });
  } finally {
    db.close();
  }
}
export function cacheOriginal(id: string, blob: Blob, digest: string) {
  return enqueue(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("originals", "readwrite");
        tx.objectStore("originals").put(
          { blob, digest } satisfies Original,
          id,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error("原图缓存未能写入。"));
      });
    } finally {
      db.close();
    }
  });
}
export function writeProject(value: SavedProject | null) {
  return enqueue(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          value ? ["project"] : ["project", "originals"],
          "readwrite",
        );
        const store = tx.objectStore("project");
        if (value) {
          const photos = value.photos.map(
            ({ file: _file, thumb: _thumb, result: _result, ...photo }) =>
              photo,
          );
          store.put({ ...value, photos }, "current");
        } else {
          store.delete("current");
          tx.objectStore("originals").clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error("编辑参数未能保存。"));
      });
    } finally {
      db.close();
    }
  });
}
