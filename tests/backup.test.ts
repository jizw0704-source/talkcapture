import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { makeBackup, readBackup, cleanProject } from "../src/backup.ts";
import { inspectBackupZip } from "../src/archive.ts";
import { fileDigest } from "../src/recovery.ts";
import type { SavedProject } from "../src/types.ts";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const file = new File([png], "photo.png", {
    type: "image/png",
    lastModified: 123,
  });
  const photo = {
    id: "p1",
    name: file.name,
    size: file.size,
    modified: 123,
    captured: null,
    selection: 0,
    format: "PNG",
    width: 1,
    height: 1,
    rotation: 0,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    brightness: 0,
    contrast: 0,
    processed: true,
    excluded: false,
    warnings: [],
    digest: await fileDigest(file),
    reportId: "r1",
    reportTitle: "Example",
    reportOrder: 0,
    reportReview: "review",
    file,
  };
  return {
    version: 1,
    name: "Project",
    aspect: "wide",
    quality: "quality",
    photos: [photo, { ...photo, id: "p2", excluded: true, reportOrder: 1 }],
  } as SavedProject;
}
test("backup round trip preserves originals, excluded pages, crop and order without secrets", async () => {
  const project = await fixture();
  const blob = await makeBackup(project);
  const data = new Uint8Array(await blob.arrayBuffer());
  assert.equal(inspectBackupZip(data).size, 3);
  const restored = await readBackup(blob);
  assert.deepEqual(cleanProject(restored), cleanProject(project));
  assert.equal(
    await fileDigest(restored.photos[1].file!),
    project.photos[1].digest,
  );
  assert.equal(restored.photos[1].excluded, true);
  const z = await JSZip.loadAsync(data);
  const manifest = await z.file("manifest.json")!.async("string");
  assert.equal(manifest.includes('file":'), false);
  assert.equal(manifest.includes("modelKey"), false);
});
test("backup rejects corruption, unsupported versions, duplicate IDs and missing source", async () => {
  const p = await fixture();
  const b = await makeBackup(p);
  const bytes = new Uint8Array(await b.arrayBuffer());
  bytes[0] = 0;
  await assert.rejects(readBackup(new Blob([bytes])));
  const z = await JSZip.loadAsync(await b.arrayBuffer());
  const meta = JSON.parse(await z.file("manifest.json")!.async("string"));
  meta.version = 99;
  z.file("manifest.json", JSON.stringify(meta));
  await assert.rejects(readBackup(await z.generateAsync({ type: "blob" })));
  const dup = await fixture();
  dup.photos[1].id = "p1";
  assert.throws(() => cleanProject(dup));
  delete p.photos[0].file;
  await assert.rejects(makeBackup(p));
});
test("backup rejects compressed or unexpected entries before decompression", async () => {
  const z = new JSZip();
  z.file("manifest.json", "{}");
  z.file("originals/000.bin", "test", { createFolders: false });
  await assert.rejects(
    readBackup(await z.generateAsync({ type: "blob", compression: "DEFLATE" })),
  );
  z.file("../unexpected", "x");
  await assert.rejects(
    readBackup(await z.generateAsync({ type: "blob", compression: "STORE" })),
  );
});
