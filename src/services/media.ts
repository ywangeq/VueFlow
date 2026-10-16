import type { AssetVersion, MediaKind, Project } from "../domain/types";

// Only one transport owns audio output, including silent inter-chapter gaps.
let playbackOwner: { id: symbol; pause: () => void } | null = null;
export function claimPlayback(id: symbol, pause: () => void) {
  if (playbackOwner?.id === id) return;
  const previous = playbackOwner;
  playbackOwner = { id, pause };
  previous?.pause();
}
export function releasePlayback(id: symbol) {
  if (playbackOwner?.id === id) playbackOwner = null;
}

export const volume = (gain: number) =>
  Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
export function selectedVersion(
  chapter: Project["chapters"][number],
  kind: MediaKind,
): AssetVersion | null {
  const id = kind === "audio" ? chapter.activeAudioId : chapter.activeVideoId;
  return (
    chapter.versions.find(
      (version) => version.id === id && version.kind === kind,
    ) ?? null
  );
}
export function probeMedia(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio",
    );
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timeout);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("读取媒体时长超时，请检查文件格式。"));
    }, 15000);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = element.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0)
        reject(new Error("媒体没有可读取的有限时长。"));
      else resolve(duration);
    };
    element.onerror = () => {
      cleanup();
      reject(
        new Error(
          "浏览器无法读取该媒体，请使用 MP3、WAV 或 MP4 等支持的格式。",
        ),
      );
    };
    element.src = url;
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Render selected audio only. Review approval is deliberately required for delivery. */
export async function exportAudio(project: Project): Promise<Blob> {
  if (!project.chapters.length) throw new Error("请先添加章节并导入音频。");
  const items = project.chapters.map((chapter) => {
    const version = selectedVersion(chapter, "audio");
    if (!version)
      throw new Error(`「${chapter.title}」缺少选中的音频，无法完整导出。`);
    if (
      version.textSnapshot !== chapter.text ||
      (version.directionSnapshot !== undefined &&
        version.directionSnapshot !== chapter.direction)
    )
      throw new Error(
        `「${chapter.title}」音频对应旧文稿或表演要求，请重新生成或恢复原内容。`,
      );
    if (
      chapter.comments.some(
        (comment) => !comment.resolved && comment.versionId === version.id,
      )
    )
      throw new Error(
        `「${chapter.title}」当前音频还有未解决的评论，请完成返修或确认解决。`,
      );
    if (!chapter.approvedVersionIds.includes(version.id))
      throw new Error(`请先审听并通过「${chapter.title}」的当前音频版本。`);
    return { chapter, version };
  });
  const estimated = items.reduce(
    (sum, { chapter, version }, index) =>
      sum +
      version.duration +
      (index < items.length - 1 ? Math.max(0, chapter.gap) : 0),
    0,
  );
  if (!Number.isFinite(estimated) || estimated > 900)
    throw new Error("浏览器 WAV 导出限 15 分钟，请分批导出章节。");
  const decoder = new AudioContext({ sampleRate: 44100 });
  try {
    const decoded: AudioBuffer[] = [];
    let total = 0;
    // Sequential decode keeps in-flight memory bounded.
    for (const { chapter, version } of items) {
      const response = await fetch(version.url);
      if (!response.ok)
        throw new Error(`读取「${chapter.title}」失败 (${response.status})。`);
      const data = await response.arrayBuffer();
      if (data.byteLength > 150 * 1024 * 1024)
        throw new Error("单个音频超过 150 MB，请压缩或分段后重试。");
      const buffer = await decoder.decodeAudioData(data);
      total += buffer.duration;
      if (total > 900)
        throw new Error("真实解码时长超过 15 分钟，请分批导出。");
      decoded.push(buffer);
    }
    const duration =
      total +
      items
        .slice(0, -1)
        .reduce((sum, item) => sum + Math.max(0, item.chapter.gap), 0);
    if (duration > 900) throw new Error("包含停顿后的时长超过 15 分钟。");
    const context = new OfflineAudioContext(
      2,
      Math.ceil(duration * 44100),
      44100,
    );
    let offset = 0;
    items.forEach(({ chapter }, index) => {
      const source = context.createBufferSource();
      source.buffer = decoded[index];
      const gain = context.createGain();
      gain.gain.value = volume(chapter.gain) * volume(project.masterGain);
      source.connect(gain);
      gain.connect(context.destination);
      source.start(offset);
      offset += decoded[index].duration + Math.max(0, chapter.gap);
    });
    const rendered = await context.startRendering();
    return encodeWav(rendered);
  } finally {
    await decoder.close();
  }
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const str = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, bytes.byteLength - 44, true);
  const data = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let frame = 0; frame < buffer.length; frame++)
    for (let c = 0; c < channels; c++) {
      const value = Math.max(-1, Math.min(1, data[c]![frame]!));
      view.setInt16(
        44 + (frame * channels + c) * 2,
        value < 0 ? value * 32768 : value * 32767,
        true,
      );
    }
  return new Blob([bytes], { type: "audio/wav" });
}
