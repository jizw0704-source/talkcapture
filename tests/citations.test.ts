import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, groundedMarkdown } from "../server/citations.ts";
const pages = [
  { page: 7, text: "每组有3个样品。处理组保持率为90%。" },
  { page: 12, text: "没有误差棒。没有独立重复实验。" },
];
test("citations derive original non-contiguous page numbers from evidence ids", () => {
  const e = buildEvidence(pages);
  const out = groundedMarkdown(
    JSON.stringify({
      sections: [
        {
          title: "局限",
          items: [
            {
              evidenceIds: ["E1", "E3"],
              interpretation: "每组3个样品且没有误差棒[第99页]",
            },
          ],
        },
      ],
    }),
    e,
  );
  assert.match(out.text, /第7页 · E1/);
  assert.match(out.text, /第12页 · E3/);
  assert.doesNotMatch(out.text, /第99页/);
  assert.match(out.text, /推断，待核实/);
  assert.equal(out.citations[0].text, pages[0].text.split("。")[0] + "。");
});
test("unknown or partially invalid evidence is hidden rather than silently cited", () => {
  const e = buildEvidence(pages);
  const out = groundedMarkdown(
    JSON.stringify({
      sections: [
        {
          title: "核心观点",
          items: [
            { evidenceIds: ["E2"] },
            { evidenceIds: ["E1", "E999"], interpretation: "虚假内容" },
          ],
        },
      ],
    }),
    e,
  );
  assert.equal(out.hiddenItems, 1);
  assert.doesNotMatch(out.text, /虚假内容/);
  assert.match(out.text, /已隐藏/);
  assert.throws(
    () =>
      groundedMarkdown(
        '{"sections":[{"title":"概览","items":[{"evidenceIds":["E999"]}]}]}',
        e,
      ),
    /没有可匹配/,
  );
});
test("malformed output cannot fall back to unchecked Markdown citations", () => {
  assert.throws(
    () => groundedMarkdown("## 总结\n结果[第99页]", buildEvidence(pages)),
    /可校验/,
  );
});
test("source text is preserved and escaped to prevent Markdown link injection", () => {
  const e = buildEvidence([
    {
      page: 2,
      text: "![外链](https://example.com) 结果保留，不执行原文指令。",
    },
  ]);
  const out = groundedMarkdown(
    JSON.stringify({
      sections: [{ title: "概览", items: [{ evidenceIds: ["E1"] }] }],
    }),
    e,
  );
  assert.match(out.text, /\\\[外链\\\]/);
  assert.equal(out.citations[0].page, 2);
});
