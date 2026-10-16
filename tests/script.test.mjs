import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const compile = (source) =>
  ts.transpile(source, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  });
const urlFor = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const projectSource = await readFile(
  new URL("../src/domain/project.ts", import.meta.url),
  "utf8",
);
const domainSource = await readFile(
  new URL("../src/domain/script.ts", import.meta.url),
  "utf8",
);
const projectUrl = urlFor(compile(projectSource));
const compiled = compile(domainSource)
  .replace(/from ["']\.\/project["']/g, "from " + JSON.stringify(projectUrl))
  .replace(/from ["']\.\.\/\.\.\/shared\/script-parser\.mjs["']/g,
    "from " + JSON.stringify(new URL("../shared/script-parser.mjs", import.meta.url).href));
const { splitScript, splitSentences, splitSegment } = await import(urlFor(compiled));
test("chapter headings preserve full spoken paragraphs and remove non-spoken labels", () => {
  const chapters = splitScript(
    "开场前言\n\n# 开场\n你好。\n这是一句完整的话。\n\n# 正文\n数字 1、2、3 都要保留。",
  );
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].segments.map((segment) => segment.text).join(""), "开场前言");
  assert.equal(chapters[1].title, "开场");
  assert.equal(chapters[1].segments.map((segment) => segment.text).join(""), "你好。\n这是一句完整的话。");
  assert.equal(new Set(chapters.map((c) => c.id)).size, 3);
});
test("Chinese headings, blank paragraph fallback and empty sections", () => {
  assert.deepEqual(
    splitScript(
      "第一章：起因\n开始。\n第二章：经过\n然后。\n【结尾】\n谢谢。",
    ).map((c) => c.title),
    ["起因", "经过", "结尾"],
  );
  assert.equal(splitScript("第一段。\n还在同段。\n\n第二段。").length, 2);
  assert.equal(splitScript("# 空标题\n\n# 有内容\n内容。").length, 1);
  assert.equal(splitScript("  \n").length, 0);
  assert.equal(splitScript("# 正在编辑的标题\n").length, 0);
});


test("chapter bodies become independently executable sentence leaves", () => {
  const [group] = splitScript("# 开场\n你好。\n今天试一个想法！最后再看结果。");
  assert.equal(group.segments.length, 3);
  assert.deepEqual(group.segments.map((segment) => segment.text), ["你好。\n", "今天试一个想法！", "最后再看结果。"]);
  assert.ok(group.segments.every((segment) => segment.enabled && segment.versions.length === 0));
  assert.equal(new Set([group.id, ...group.segments.map((segment) => segment.id)]).size, 4);
});

test("sentence splitting preserves quotes, decimals, abbreviations and exact spoken characters", () => {
  const source = '他说：“版本 3.14 可以吗？”\nDr. Li says yes! 下一句。  最后一句';
  const sentences = splitSentences(source);
  assert.equal(sentences.join(""), source);
  assert.ok(sentences.includes('他说：“版本 3.14 可以吗？”\n'));
  assert.ok(sentences.some((sentence) => sentence.includes("Dr. Li says yes!")));
  assert.equal(splitSentences("  \n").length, 0);
});

test("splitting a reviewed leaf retains disabled history and fresh children inherit performance only", () => {
  const [group] = splitScript("# 章节\n第一句。第二句！");
  const original = {
    ...group.segments[0], id: "original", text: "第一句。第二句！", title: "原段",
    direction: "明亮一点", gain: .7, gap: 1.2,
    activeAudioId: "asset", versions: [{id: "asset", kind: "audio"}],
    approvedVersionIds: ["asset"], comments: [{id: "comment", versionId: "asset"}],
  };
  const replacement = splitSegment(original);
  assert.equal(replacement.length, 3);
  assert.equal(replacement[0].enabled, false);
  assert.equal(replacement[0].versions, original.versions);
  assert.equal(replacement[0].comments, original.comments);
  assert.equal(original.enabled, true);
  assert.deepEqual(replacement.slice(1).map((segment) => segment.text), ["第一句。", "第二句！"]);
  assert.deepEqual(replacement.slice(1).map((segment) => segment.gap), [0, 1.2]);
  for (const child of replacement.slice(1)) {
    assert.equal(child.derivedFromId, original.id);
    assert.equal(child.enabled, true);
    assert.equal(child.direction, original.direction);
    assert.equal(child.gain, original.gain);
    assert.equal(child.activeAudioId, null);
    assert.deepEqual(child.versions, []);
    assert.deepEqual(child.approvedVersionIds, []);
    assert.deepEqual(child.comments, []);
  }
  assert.equal(splitSegment(group.segments[0])[0], group.segments[0]);
  assert.deepEqual(splitSegment(replacement[0]), [replacement[0]]);
});
