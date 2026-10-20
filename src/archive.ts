import JSZip from "jszip";
export const archiveLimit = 512 * 1024 * 1024;
// Our project backups are STORE-only ZIPs. Bound every entry before extraction.
export function inspectBackupZip(data: Uint8Array) {
  if (data.length > archiveLimit)
    throw Error("备份文件超过 512 MB，请分项目保存。");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--)
    if (v.getUint32(end, true) === 0x06054b50) break;
  if (
    end < 0 ||
    v.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + v.getUint16(end + 20, true) !== data.length
  )
    throw Error("备份文件损坏。");
  const count = v.getUint16(end + 10, true),
    offset = v.getUint32(end + 16, true);
  if (
    count < 2 ||
    count > 101 ||
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    offset >= end
  )
    throw Error("备份结构不受支持。");
  let pos = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50)
      throw Error("备份目录损坏。");
    const flags = v.getUint16(pos + 8, true),
      method = v.getUint16(pos + 10, true),
      size = v.getUint32(pos + 24, true),
      packed = v.getUint32(pos + 20, true);
    const len = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true);
    if (pos + 46 + len + extra + comment > end) throw Error("备份目录损坏。");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(pos + 46, pos + 46 + len),
    );
    if (
      flags & 1 ||
      method !== 0 ||
      packed !== size ||
      !/^(?:manifest\.json|originals\/\d{3}\.bin)$/.test(name) ||
      names.has(name)
    )
      throw Error("备份包含不支持的条目。");
    if (name === "manifest.json" && size > 4 * 1024 * 1024)
      throw Error("备份元数据过大。");
    names.add(name);
    total += size;
    if (total > archiveLimit) throw Error("备份内容超过 512 MB。");
    pos += 46 + len + extra + comment;
  }
  if (pos !== end || !names.has("manifest.json"))
    throw Error("备份目录不完整。");
  return names;
}
export async function createZip(
  entries: { name: string; blob: Blob | string }[],
) {
  const zip = new JSZip();
  let total = 0;
  for (const entry of entries) {
    total +=
      typeof entry.blob === "string"
        ? new TextEncoder().encode(entry.blob).length
        : entry.blob.size;
    if (total > archiveLimit)
      throw Error("打包内容超过 512 MB，请减少所选报告。");
    zip.file(
      entry.name,
      typeof entry.blob === "string"
        ? entry.blob
        : await entry.blob.arrayBuffer(),
      { createFolders: false },
    );
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  if (blob.size > archiveLimit)
    throw Error("打包内容超过 512 MB，请减少所选报告。");
  return blob;
}
