import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/domain/project.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpile(source, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
});
const { combinedChapterStatus, chapterDuration, chapterStatus } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const asset = (id, kind, duration = 5) => ({
  id,
  kind,
  duration,
  textSnapshot: "确认的正文",
  directionSnapshot: "自然聊天",
});
function chapter() {
  return {
    text: "确认的正文",
    direction: "自然聊天",
    versions: [asset("audio", "audio", 5), asset("video", "video", 8)],
    comments: [],
    approvedVersionIds: [],
    activeAudioId: "audio",
    activeVideoId: "video",
  };
}

test("one chapter requires review of both selected assets before combined approval", () => {
  const current = chapter();
  assert.equal(combinedChapterStatus(current), "待审阅");
  current.approvedVersionIds.push("audio");
  assert.equal(combinedChapterStatus(current), "待审阅");
  assert.equal(chapterStatus(current, "audio"), "已通过");
  current.approvedVersionIds.push("video");
  assert.equal(combinedChapterStatus(current), "已通过");
});

test("an approved single audio or video track does not require its optional counterpart", () => {
  for (const kind of ["audio", "video"]) {
    const current = chapter();
    current.activeAudioId = kind === "audio" ? "audio" : null;
    current.activeVideoId = kind === "video" ? "video" : null;
    current.approvedVersionIds = [kind];
    assert.equal(combinedChapterStatus(current), "已通过");
  }
  const current = chapter();
  current.activeAudioId = null;
  current.activeVideoId = null;
  current.approvedVersionIds = ["audio", "video"];
  assert.equal(combinedChapterStatus(current), "待生成");
});

test("changed text or direction on either selected asset invalidates combined approval", () => {
  for (const kind of ["audio", "video"]) {
    for (const field of ["textSnapshot", "directionSnapshot"]) {
      const current = chapter();
      current.approvedVersionIds = ["audio", "video"];
      current.versions.find((version) => version.kind === kind)[field] =
        "旧内容";
      assert.equal(combinedChapterStatus(current), "待更新");
    }
  }
  const legacy = chapter();
  delete legacy.versions[0].directionSnapshot;
  assert.equal(combinedChapterStatus(legacy), "待审阅");
});

test("only unresolved comments on selected media block the chapter", () => {
  const current = chapter();
  current.approvedVersionIds = ["audio", "video"];
  current.versions.push(asset("old-video", "video"));
  current.comments = [
    { versionId: "old-video", resolved: false },
    { versionId: "audio", resolved: true },
    { versionId: null, resolved: false },
  ];
  assert.equal(combinedChapterStatus(current), "已通过");
  current.comments.push({ versionId: "video", resolved: false });
  assert.equal(combinedChapterStatus(current), "待修改");
  assert.equal(chapterStatus(current, "audio"), "已通过");
  current.versions[0].textSnapshot = "旧正文";
  assert.equal(combinedChapterStatus(current), "待更新");
});

test("a stale unselected historical asset does not invalidate a reviewed selection", () => {
  const current = chapter();
  current.activeVideoId = null;
  current.versions[1].textSnapshot = "旧视频正文";
  current.approvedVersionIds = ["audio"];
  current.comments.push({ versionId: "video", resolved: false });
  assert.equal(combinedChapterStatus(current), "已通过");
});

test("a chapter spans the longer selected track, not their sum or historical durations", () => {
  const current = chapter();
  current.versions.push(asset("old-audio", "audio", 100));
  assert.equal(chapterDuration(current), 8);
  current.versions[0].duration = 12;
  assert.equal(chapterDuration(current), 12);
  current.activeAudioId = null;
  assert.equal(chapterDuration(current), 8);
  current.activeVideoId = null;
  assert.equal(chapterDuration(current), 0);
  current.activeAudioId = "audio";
  assert.equal(chapterDuration(current), 12);
});
