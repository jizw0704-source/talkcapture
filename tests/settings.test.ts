import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createSettingsApi } from "../server/settings.ts";
import { saveModel, readLocal } from "../server/model-config.ts";
test("settings persist server-side, preserve blank keys, never echo credentials, reject cross-origin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talkcapture-settings-")),
    file = pathToFileURL(join(dir, ".env.local"));
  const handler = createSettingsApi(file),
    server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await saveModel(
      {
        model: "MiniMax-M2.5",
        base: "https://api.minimax.cn/v1",
        key: "test-only-secret",
      },
      file,
    );
    let response = await fetch(address + "/api/settings", {
      headers: { "x-desktop-client": "1" },
    });
    let result = await response.json();
    assert.equal(result.keyConfigured, true);
    assert.doesNotMatch(JSON.stringify(result), /test-only-secret/);
    response = await fetch(address + "/api/settings", {
      method: "PUT",
      headers: { "x-desktop-client": "1", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "MiniMax-M2.7",
        base: "https://api.minimax.cn/v1",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await readLocal(file)).MINIMAX_API_KEY, "test-only-secret");
    assert.equal((await readLocal(file)).MINIMAX_MODEL, "MiniMax-M2.7");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    response = await fetch(address + "/api/settings", {
      method: "PUT",
      headers: {
        "x-desktop-client": "1",
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    response = await fetch(address + "/api/settings");
    assert.equal(response.status, 403);
    await assert.rejects(
      saveModel(
        {
          model: "MiniMax-M2.5",
          base: "https://evil.invalid/v1",
          key: "new-secret",
        },
        file,
      ),
    );
    assert.match(await readFile(file, "utf8"), /test-only-secret/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
