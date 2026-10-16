import { newChapter, newSegment } from "./project";
import type { Chapter, Segment } from "./types";
import { parseScriptDocument, splitSentences } from "../../shared/script-parser.mjs";

export { splitSentences };

/** Group labels are not spoken; the shared parser owns chapter and sentence boundaries. */
export function splitScript(source: string): Chapter[] {
  if (!source.trim()) return [];
  let parsed: ReturnType<typeof parseScriptDocument>;
  try {
    parsed = parseScriptDocument(source);
  } catch (error) {
    // Live typing a heading is a valid incomplete draft; file imports stay strict in the shared parser.
    if (error instanceof Error && error.message === "文稿没有可导入的正文") return [];
    throw error;
  }
  return parsed.chapters.map((chapter, index) => ({
    ...newChapter(index + 1),
    title: chapter.title.slice(0, 120),
    segments: chapter.segments.map((segment, sentenceIndex) => ({
      ...newSegment(sentenceIndex + 1),
      text: segment.text,
    })),
  }));
}

/** Preserve the original and all its asset/history references as a disabled leaf. */
export function splitSegment(segment: Segment): Segment[] {
  if (!segment.enabled) return [segment];
  const texts = splitSentences(segment.text);
  if (texts.length <= 1) return [segment];
  return [
    { ...segment, enabled: false },
    ...texts.map((text, index) => ({
      ...newSegment(index + 1),
      title: `${segment.title} · ${index + 1}`.slice(0, 120),
      text,
      direction: segment.direction,
      gain: segment.gain,
      gap: index === texts.length - 1 ? segment.gap : 0,
      derivedFromId: segment.id,
    })),
  ];
}
