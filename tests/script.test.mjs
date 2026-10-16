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
const compiled = compile(domainSource).replace(
  /from ["']\.\/project["']/g,
  "from " + JSON.stringify(projectUrl),
);
const { splitScript } = await import(urlFor(compiled));
test("chapter headings preserve full spoken paragraphs and remove non-spoken labels", () => {
  const chapters = splitScript(
    "开场前言\n\n# 开场\n你好。\n这是一句完整的话。\n\n# 正文\n数字 1、2、3 都要保留。",
  );
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].text, "开场前言");
  assert.equal(chapters[1].title, "开场");
  assert.equal(chapters[1].text, "你好。\n这是一句完整的话。");
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
});
