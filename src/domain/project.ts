import type { Chapter, MediaKind, AssetVersion } from "./types";
export const uid = () => crypto.randomUUID();
export function activeVersion(
  chapter: Chapter,
  kind: MediaKind,
): AssetVersion | null {
  return (
    chapter.versions.find(
      (v) =>
        v.id ===
        (kind === "audio" ? chapter.activeAudioId : chapter.activeVideoId),
    ) ?? null
  );
}
export function chapterStatus(chapter: Chapter, kind: MediaKind): string {
  const version = activeVersion(chapter, kind);
  if (!version) return "待生成";
  if (
    version.textSnapshot !== chapter.text ||
    (version.directionSnapshot !== undefined &&
      version.directionSnapshot !== chapter.direction)
  )
    return "文稿已更新";
  if (chapter.comments.some((c) => !c.resolved && c.versionId === version.id))
    return "待修改";
  return chapter.approvedVersionIds.includes(version.id) ? "已通过" : "待试听";
}
export function newChapter(index: number): Chapter {
  return {
    id: uid(),
    title: `章节 ${index}`,
    text: "",
    direction: "自然聊天，按语义停顿。",
    gain: 1,
    gap: 0.4,
    approvedVersionIds: [],
    activeAudioId: null,
    activeVideoId: null,
    versions: [],
    comments: [],
  };
}
export function formatTime(seconds = 0) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
