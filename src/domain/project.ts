import type { Chapter, Segment, Project, MediaKind, AssetVersion } from "./types";
export const uid = () => crypto.randomUUID();
export function activeVersion(
  chapter: Segment,
  kind: MediaKind,
): AssetVersion | null {
  return (
    chapter.versions.find(
      (v) =>
        v.kind === kind &&
        v.id ===
        (kind === "audio" ? chapter.activeAudioId : chapter.activeVideoId),
    ) ?? null
  );
}
export function segmentStatus(chapter: Segment, kind: MediaKind): string {
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
/** A chapter may contain audio, video, or both; only its selected assets need review. */
export function combinedChapterStatus(chapter: Segment): string {
  const versions = [
    activeVersion(chapter, "audio"),
    activeVersion(chapter, "video"),
  ].filter((version): version is AssetVersion => version !== null);
  if (!versions.length) return "待生成";
  if (
    versions.some(
      (version) =>
        version.textSnapshot !== chapter.text ||
        (version.directionSnapshot !== undefined &&
          version.directionSnapshot !== chapter.direction),
    )
  )
    return "待更新";
  const activeIds = new Set(versions.map((version) => version.id));
  if (
    chapter.comments.some(
      (comment) =>
        !comment.resolved &&
        comment.versionId !== null &&
        activeIds.has(comment.versionId),
    )
  )
    return "待修改";
  return versions.every((version) =>
    chapter.approvedVersionIds.includes(version.id),
  )
    ? "已通过"
    : "待审阅";
}

/** Audio and video in one chapter share its timeline span. */
export function segmentDuration(chapter: Segment): number {
  return Math.max(
    activeVersion(chapter, "audio")?.duration ?? 0,
    activeVersion(chapter, "video")?.duration ?? 0,
  );
}

export function flattenSegments(project: Project, includeDisabled = false): Segment[] {
  return project.chapters.flatMap((chapter) =>
    includeDisabled ? chapter.segments : chapter.segments.filter((segment) => segment.enabled),
  );
}

export function findSegment(project: Project, id: string): Segment | null {
  return flattenSegments(project, true).find((segment) => segment.id === id) ?? null;
}

export function chapterForSegment(project: Project, id: string): Chapter | null {
  return project.chapters.find((chapter) => chapter.segments.some((segment) => segment.id === id)) ?? null;
}

export function groupStatus(chapter: Chapter): string {
  const segments = chapter.segments.filter((segment) => segment.enabled);
  if (!segments.length) return "已停用";
  const statuses = segments.map(combinedChapterStatus);
  if (statuses.includes("待更新")) return "待更新";
  if (statuses.includes("待修改")) return "待修改";
  if (statuses.every((status) => status === "已通过")) return "已通过";
  if (statuses.every((status) => status === "待生成")) return "待生成";
  return "待审阅";
}

/** Chapter duration follows enabled segment order, including internal gaps only. */
export function projectChapterDuration(chapter: Chapter): number {
  const segments = chapter.segments.filter((segment) => segment.enabled);
  return segments.reduce((total, segment, index) =>
    total + segmentDuration(segment) + (index < segments.length - 1 ? segment.gap : 0), 0);
}

export function newSegment(index: number): Segment {
  return {
    id: uid(),
    title: `句段 ${index}`,
    enabled: true,
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

export function newChapter(index: number): Chapter {
  return { id: uid(), title: `章节 ${index}`, segments: [newSegment(1)] };
}

export function formatTime(seconds = 0) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
