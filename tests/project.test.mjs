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
const { combinedChapterStatus, segmentDuration, segmentStatus, groupStatus, flattenSegments, findSegment, chapterForSegment, newChapter, newSegment, projectChapterDuration } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const asset = (id, kind, duration = 5) => ({
  id,
  kind,
  duration,
  textSnapshot: "确认的正文",
  directionSnapshot: "自然聊天",
});
function segment() {
  return {
    id: "segment-1",
    title: "第一句",
    enabled: true,
    gain: 1,
    gap: 0.4,
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
  const current = segment();
  assert.equal(combinedChapterStatus(current), "待审阅");
  current.approvedVersionIds.push("audio");
  assert.equal(combinedChapterStatus(current), "待审阅");
  assert.equal(segmentStatus(current, "audio"), "已通过");
  current.approvedVersionIds.push("video");
  assert.equal(combinedChapterStatus(current), "已通过");
});

test("an approved single audio or video track does not require its optional counterpart", () => {
  for (const kind of ["audio", "video"]) {
    const current = segment();
    current.activeAudioId = kind === "audio" ? "audio" : null;
    current.activeVideoId = kind === "video" ? "video" : null;
    current.approvedVersionIds = [kind];
    assert.equal(combinedChapterStatus(current), "已通过");
  }
  const current = segment();
  current.activeAudioId = null;
  current.activeVideoId = null;
  current.approvedVersionIds = ["audio", "video"];
  assert.equal(combinedChapterStatus(current), "待生成");
});

test("changed text or direction on either selected asset invalidates combined approval", () => {
  for (const kind of ["audio", "video"]) {
    for (const field of ["textSnapshot", "directionSnapshot"]) {
      const current = segment();
      current.approvedVersionIds = ["audio", "video"];
      current.versions.find((version) => version.kind === kind)[field] =
        "旧内容";
      assert.equal(combinedChapterStatus(current), "待更新");
    }
  }
  const legacy = segment();
  delete legacy.versions[0].directionSnapshot;
  assert.equal(combinedChapterStatus(legacy), "待审阅");
});

test("only unresolved comments on selected media block the chapter", () => {
  const current = segment();
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
  assert.equal(segmentStatus(current, "audio"), "已通过");
  current.versions[0].textSnapshot = "旧正文";
  assert.equal(combinedChapterStatus(current), "待更新");
});

test("a stale unselected historical asset does not invalidate a reviewed selection", () => {
  const current = segment();
  current.activeVideoId = null;
  current.versions[1].textSnapshot = "旧视频正文";
  current.approvedVersionIds = ["audio"];
  current.comments.push({ versionId: "video", resolved: false });
  assert.equal(combinedChapterStatus(current), "已通过");
});

test("a chapter spans the longer selected track, not their sum or historical durations", () => {
  const current = segment();
  current.versions.push(asset("old-audio", "audio", 100));
  assert.equal(segmentDuration(current), 8);
  current.versions[0].duration = 12;
  assert.equal(segmentDuration(current), 12);
  current.activeAudioId = null;
  assert.equal(segmentDuration(current), 8);
  current.activeVideoId = null;
  assert.equal(segmentDuration(current), 0);
  current.activeAudioId = "audio";
  assert.equal(segmentDuration(current), 12);
});


test("chapter groups aggregate only enabled leaves", () => {
  const first = segment();
  first.approvedVersionIds = ["audio", "video"];
  const old = { ...segment(), id: "old", enabled: false };
  old.versions[0].textSnapshot = "旧文稿";
  const group = { id: "chapter-1", title: "章节", segments: [old, first] };
  assert.equal(groupStatus(group), "已通过");
  group.segments.push({ ...segment(), id: "new" });
  assert.equal(groupStatus(group), "待审阅");
  first.comments.push({ versionId: "audio", resolved: false });
  assert.equal(groupStatus(group), "待修改");
  first.direction = "新表现要求";
  assert.equal(groupStatus(group), "待更新");
  group.segments.forEach((item) => { item.enabled = false; });
  assert.equal(groupStatus(group), "已停用");
});

test("hierarchical lookup preserves disabled history and playback uses enabled document order", () => {
  const old = { ...segment(), id: "old", enabled: false };
  const first = { ...segment(), id: "first" };
  const second = { ...segment(), id: "second" };
  const group = { id: "chapter-1", title: "章节一", segments: [old, first] };
  const project = { chapters: [group, { id: "chapter-2", title: "章节二", segments: [second] }] };
  assert.deepEqual(flattenSegments(project).map((item) => item.id), ["first", "second"]);
  assert.deepEqual(flattenSegments(project, true).map((item) => item.id), ["old", "first", "second"]);
  assert.equal(findSegment(project, "old"), old);
  assert.equal(chapterForSegment(project, "old"), group);
  assert.equal(findSegment(project, "missing"), null);
  assert.equal(chapterForSegment(project, "missing"), null);
  assert.equal(projectChapterDuration(group), 8);
  group.segments.push(second);
  assert.equal(projectChapterDuration(group), 16.4);
});

test("a new chapter owns fresh independent execution leaves", () => {
  const group = newChapter(2);
  assert.equal(group.title, "章节 2");
  assert.equal(group.segments.length, 1);
  assert.equal(group.segments[0].enabled, true);
  assert.equal("text" in group, false);
  const next = newSegment(2);
  assert.notEqual(next.id, group.segments[0].id);
  next.comments.push({ id: "new-comment" });
  assert.deepEqual(group.segments[0].comments, []);
});
