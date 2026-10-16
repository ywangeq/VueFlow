import { newChapter } from "./project";
import type { Chapter } from "./types";
/** Preserve spoken content; headings are chapter labels rather than spoken text. */
export function splitScript(source: string): Chapter[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const heading =
    /^(?:#{1,6}\s+(.+)|第[一二三四五六七八九十百零〇\d]+[章节][：:、.\s]*(.*)|【([^】]+)】)\s*$/;
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  if (lines.some((line) => heading.test(line.trim()))) {
    for (const line of lines) {
      const match = heading.exec(line.trim());
      if (match) {
        current = {
          title: (match[1] || match[2] || match[3] || line.trim()).trim(),
          lines: [],
        };
        sections.push(current);
      } else if (current) current.lines.push(line);
      else if (line.trim()) {
        current = { title: "开场", lines: [line] };
        sections.push(current);
      }
    }
  } else {
    for (const paragraph of source.replace(/\r\n?/g, "\n").split(/\n\s*\n/))
      if (paragraph.trim())
        sections.push({
          title: `章节 ${sections.length + 1}`,
          lines: [paragraph],
        });
  }
  return sections
    .filter((s) => s.lines.join("\n").trim())
    .map((section, index) => ({
      ...newChapter(index + 1),
      title: section.title.slice(0, 120),
      text: section.lines.join("\n").trim(),
    }));
}
