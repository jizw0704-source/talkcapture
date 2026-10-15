import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { analysisApi } from "../server/analysis.ts";
async function withServer(action: (port: number) => Promise<void>) {
  const server = createServer((req, res) => void analysisApi(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await action((server.address() as { port: number }).port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
function post(port: number, path: string, body: unknown, origin?: string) {
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (v) => (text += v));
        res.on("end", () =>
          resolve({ status: res.statusCode!, data: JSON.parse(text) }),
        );
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
test("analysis rejects cross-origin requests and oversized reports before model calls", async () => {
  await withServer(async (port) => {
    assert.equal(
      (await post(port, "/api/analysis/summary", {}, "https://example.com"))
        .status,
      403,
    );
    const result = await post(port, "/api/analysis/summary", {
      pages: [{ page: 1, text: "长".repeat(40001) }],
    });
    assert.equal(result.status, 503);
    assert.match(result.data.error, /容量/);
  });
});
test("MiniMax receives only selected page text, with no images, filenames or unrelated data", async () => {
  const original = globalThis.fetch;
  const previous = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = "test-placeholder";
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages.length, 2);
    assert.equal(JSON.parse(body.messages[1].content).sources[0].page, 7);
    assert.match(body.messages[0].content, /未经信任/);
    assert.doesNotMatch(
      JSON.stringify(body),
      /private-file|OTHER-REPORT|IMAGE-BYTES|private-title/,
    );
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-placeholder",
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                sections: [
                  {
                    title: "核心观点",
                    items: [
                      { evidenceIds: ["E1"], interpretation: "材料表面研究" },
                    ],
                  },
                ],
                questions: [],
              }),
            },
          },
        ],
      }),
    );
  }) as typeof fetch;
  try {
    await withServer(async (port) => {
      const result = await post(port, "/api/analysis/summary", {
        title: "private-title",
        filename: "private-file",
        image: "IMAGE-BYTES",
        otherReport: "OTHER-REPORT",
        pages: [
          {
            page: 7,
            text: "材料表面研究与界面钝化的实验方法及其局限性，需要根据完整资料核对所有结论。",
          },
        ],
      });
      assert.equal(result.status, 200);
      assert.match(result.data.text, /第7页/);
    });
    assert.deepEqual(calls, ["https://api.minimax.cn/v1/chat/completions"]);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = previous;
  }
});
test("MiniMax errors do not expose upstream bodies or credentials", async () => {
  const original = globalThis.fetch,
    previous = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = "test-secret";
  try {
    for (const status of [401, 429, 500]) {
      globalThis.fetch = (async () =>
        new Response("test-secret upstream private body", {
          status,
        })) as typeof fetch;
      await withServer(async (port) => {
        const result = await post(port, "/api/analysis/summary", {
          pages: [
            {
              page: 1,
              text: "足够长的合成报告文字，验证错误信息不包含上游返回的任何敏感内容。",
            },
          ],
        });
        assert.equal(result.status, 503);
        assert.doesNotMatch(
          JSON.stringify(result.data),
          /test-secret|upstream private/,
        );
      });
    }
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = previous;
  }
});
