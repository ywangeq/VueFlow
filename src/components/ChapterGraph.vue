<script setup lang="ts">
import { computed, ref } from "vue";
import RelationGraph, {
  type GraphLink,
  type GraphNode,
} from "../vendor/scaffold/components/charts/RelationGraph.vue";
import type { Chapter } from "../domain/types";
import { combinedChapterStatus } from "../domain/project";

const props = defineProps<{
  chapters: Chapter[];
  selectedId: string | null;
  projectTitle: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const view = ref<"graph" | "list">("graph");
const size = ref({ w: 760, h: 600 });
const columns = computed(() =>
  Math.max(1, Math.min(3, Math.floor(size.value.w / 190))),
);
const height = computed(() =>
  Math.max(480, 240 + Math.ceil(props.chapters.length / columns.value) * 180),
);

function chapterState(chapter: Chapter) {
  // The domain helper owns validity and approval policy for both the outline and graph.
  const status = combinedChapterStatus(chapter);
  if (status === "待生成")
    return { text: status, tone: "accent" as const, ratio: 0 };
  if (status === "待更新")
    return { text: status, tone: "danger" as const, ratio: 0.25 };
  if (status === "待修改")
    return { text: status, tone: "danger" as const, ratio: 0.5 };
  if (status === "已通过")
    return { text: status, tone: "lime" as const, ratio: 1 };
  return {
    text: status,
    tone: "accent" as const,
    ratio: 0.75,
  };
}
function mediaCounts(chapter: Chapter) {
  const audio = chapter.versions.filter(
    (version) => version.kind === "audio",
  ).length;
  const video = chapter.versions.filter(
    (version) => version.kind === "video",
  ).length;
  return `音频 ${audio}版 · 视频 ${video}版`;
}
const nodes = computed<GraphNode[]>(() => {
  const w = size.value.w || 760;
  const result: GraphNode[] = [
    {
      id: "__project__",
      x: w / 2,
      y: 104,
      label: props.projectTitle || "未命名工程",
      sub: `${props.chapters.length} 个章节 · 音视频共用工作流`,
      kind: "core",
      size: 88,
      interactive: false,
      title: props.projectTitle,
    },
  ];
  props.chapters.forEach((chapter, index) => {
    const row = Math.floor(index / columns.value);
    const rowCount = Math.min(
      columns.value,
      props.chapters.length - row * columns.value,
    );
    const col = index % columns.value;
    const state = chapterState(chapter);
    const media = mediaCounts(chapter);
    result.push({
      id: chapter.id,
      x: ((col + 0.5) * w) / rowCount,
      y: 280 + row * 180,
      label: `${String(index + 1).padStart(2, "0")}  ${chapter.title || "未命名章节"}`,
      sub: `${state.text}\n${media}`,
      kind: "hub",
      size: 88,
      count: String(index + 1).padStart(2, "0"),
      tone: state.tone,
      ratio: state.ratio,
      icon: "layers",
      from: "__project__",
      delay: Math.min(index * 0.045, 0.5),
      title: `${chapter.title}：${state.text}，${media}`,
    });
  });
  return result;
});
const links = computed<GraphLink[]>(() =>
  props.chapters.map((chapter) => ({
    a: "__project__",
    b: chapter.id,
    shape: "v",
    flow: "forward",
    tone: chapterState(chapter).tone,
  })),
);
function selectNode(node: GraphNode) {
  if (props.chapters.some((chapter) => chapter.id === node.id))
    emit("select", node.id);
}
</script>

<template>
  <section class="chapter-graph" aria-label="章节工作流">
    <div class="graph-topline">
      <span class="graph-title"
        ><i aria-hidden="true"></i>章节关系<span class="graph-count"
          >{{ chapters.length }} 个节点</span
        ></span
      >
      <div class="view-toggle" role="group" aria-label="工作流视图">
        <button
          type="button"
          :aria-pressed="view === 'graph'"
          @click="view = 'graph'"
        >
          节点
        </button>
        <button
          type="button"
          :aria-pressed="view === 'list'"
          @click="view = 'list'"
        >
          列表
        </button>
      </div>
    </div>
    <p v-if="!chapters.length" class="graph-empty">
      添加文稿并拆分章节，即可开始构建。
    </p>
    <div v-else-if="view === 'graph'" class="graph-scroll">
      <RelationGraph
        v-model:size="size"
        :style="{ height: `${height}px` }"
        :nodes="nodes"
        :links="links"
        :active-id="selectedId"
        variant="stage"
        :label="`${projectTitle}，音视频章节节点；使用 Tab 或方向键选择章节`"
        @select="selectNode"
      />
    </div>
    <ol v-else class="graph-chapter-list">
      <li v-for="(chapter, index) in chapters" :key="chapter.id">
        <button
          type="button"
          :aria-pressed="selectedId === chapter.id"
          @click="emit('select', chapter.id)"
        >
          <span class="graph-chapter-index">{{
            String(index + 1).padStart(2, "0")
          }}</span>
          <span class="graph-chapter-copy">
            <span class="chapter-name">{{
              chapter.title || "未命名章节"
            }}</span>
            <span class="graph-media-counts">{{ mediaCounts(chapter) }}</span>
          </span>
          <span class="chapter-status">{{ chapterState(chapter).text }}</span>
        </button>
      </li>
    </ol>
    <p v-if="chapters.length && view === 'graph'" class="graph-help">
      同一节点管理旁白与画面 · 选中章节查看素材和评论
    </p>
  </section>
</template>

<style scoped>
/* Hallmark · atmospheric workbench · sci-fi graph panel.
 * pre-emit critique: P4 H4 E4 S5 R4 V4 */
.chapter-graph {
  --graph-surface: oklch(17% 0.028 263);
  --graph-panel: oklch(21% 0.034 263);
  --graph-rule: oklch(33% 0.045 263);
  --graph-text: oklch(94% 0.018 255);
  --graph-muted: oklch(73% 0.04 258);
  --graph-blue: oklch(78% 0.135 233);
  --graph-violet: oklch(76% 0.14 295);
  --graph-selected: oklch(28% 0.065 277);
  --graph-focus: oklch(79% 0.12 238);
  padding: 16px;
  color: var(--graph-text);
  background: var(--graph-surface);
  color-scheme: dark;
  min-width: 0;
}
.graph-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--graph-rule);
  margin-bottom: 14px;
  color: var(--graph-muted);
  font-size: 12px;
}
.view-toggle {
  display: flex;
  border: 1px solid var(--graph-rule);
  border-radius: 8px;
  padding: 2px;
  background: var(--graph-panel);
}
.view-toggle button {
  padding: 5px 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--graph-muted);
  cursor: pointer;
  font: inherit;
}
.view-toggle button[aria-pressed="true"] {
  background: var(--graph-selected);
  color: var(--graph-text);
}
.graph-scroll {
  max-height: 610px;
  overflow: auto;
  border-radius: 14px;
}
.graph-help {
  color: var(--graph-muted);
  font-size: 11px;
  margin: 12px 0 0;
  line-height: 1.7;
}
.graph-empty {
  padding: 100px 24px;
  text-align: center;
  color: var(--graph-muted);
  background: var(--graph-surface);
  border: 1px dashed var(--graph-rule);
  border-radius: 14px;
}
.graph-chapter-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  max-height: 610px;
  overflow: auto;
}
.graph-chapter-list button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 16px;
  text-align: left;
  font: inherit;
  border: 1px solid var(--graph-rule);
  background: var(--graph-panel);
  border-radius: 10px;
  color: var(--graph-text);
  cursor: pointer;
}
.graph-chapter-list button[aria-pressed="true"] {
  background: var(--graph-selected);
  border-color: var(--graph-violet);
}
.graph-chapter-index {
  font: 12px monospace;
  color: var(--graph-blue);
}
.graph-chapter-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}
.graph-media-counts {
  color: var(--graph-muted);
  font-size: 11px;
}
.chapter-name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.chapter-status {
  flex-shrink: 0;
  color: var(--graph-muted);
  font-size: 11px;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-hub .rg-text) {
  width: 170px;
  box-sizing: border-box;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-hub .rg-sub) {
  width: 100%;
  max-width: 100%;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-core .rg-body),
.chapter-graph :deep(.rg.is-stage .rg-node.is-core .rg-text) {
  width: 220px;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-core .rg-label) {
  max-width: 210px;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-core .rg-sub) {
  width: 220px;
  max-width: 220px;
  text-align: center;
}
.chapter-graph :deep(.rg-sub) {
  white-space: pre-line;
  line-height: 1.5;
}
button:focus-visible {
  outline: 2px solid var(--graph-focus);
  outline-offset: 3px;
}

.graph-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  font-weight: 600;
  color: var(--graph-text);
}
.graph-title > i {
  width: 7px;
  height: 7px;
  background: var(--graph-blue);
  box-shadow: 0 0 9px var(--graph-blue);
}
.graph-count {
  color: var(--graph-muted);
  font-size: 10px;
  font-weight: 400;
  margin-left: 5px;
  white-space: nowrap;
}
.chapter-graph :deep(.rg) {
  --graph-mode: dark;
  --graph-ink: 180, 201, 236;
  --graph-accent: 77, 192, 255;
  --graph-lime: 172, 139, 255;
  --graph-danger: 255, 122, 151;
  --graph-paper: 15, 26, 48;
  --graph-1: 92, 176, 255;
  --graph-2: 77, 192, 255;
  --graph-3: 172, 139, 255;
  --graph-4: 255, 122, 151;
  --graph-5: 130, 153, 255;
  --ink: var(--graph-text);
  --ink-soft: var(--graph-muted);
  --ink-faint: var(--graph-muted);
  --blue: var(--graph-blue);
  --blue-soft: var(--graph-selected);
  --lime: var(--graph-violet);
  --leaf-text: var(--graph-violet);
  --lime-soft: var(--graph-selected);
  --red-text: oklch(77% 0.15 10);
  --red-soft: var(--graph-panel);
  --surface-solid: var(--graph-surface);
  --node-bg: var(--graph-panel);
  --line-strong: var(--graph-rule);
  --shade: 100, 154, 230;
  --ambient-a: transparent;
  --ambient-b: transparent;
  --glass-line: var(--graph-rule);
  --pill-bg: var(--graph-panel);
  --float-bg: var(--graph-panel);
  --hover-bg: var(--graph-selected);
  --press-bg: var(--graph-selected);
  --focus: var(--graph-focus);
  --edge: none;
  --e1: none;
  --e2: none;
  --e3: none;
  --float-inset: none;
  --pill-inset: none;
  --thread: var(--graph-blue);
  --thread-active: var(--graph-blue);
  --pulse-halo: var(--graph-selected);
  border: 1px solid var(--graph-rule);
  border-radius: 8px;
  box-shadow: none;
  background:
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--graph-rule) 26%, transparent) 1px,
        transparent 1px
      )
      0 0 / 32px 32px,
    linear-gradient(
        color-mix(in srgb, var(--graph-rule) 26%, transparent) 1px,
        transparent 1px
      )
      0 0 / 32px 32px,
    var(--graph-surface);
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-hub .rg-text) {
  background: var(--graph-surface);
  border: 1px solid var(--graph-rule);
  padding: 7px 9px;
  border-radius: 5px;
  top: calc(100% + 9px);
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-hub .rg-body) {
  border-radius: 12px;
}
.chapter-graph :deep(.rg-tools) {
  border-radius: 6px;
  backdrop-filter: none;
}
.chapter-graph :deep(.rg-tools button) {
  border-radius: 3px;
}
.chapter-graph :deep(.rg-node.is-active .rg-label) {
  color: var(--graph-violet) !important;
}
.chapter-graph :deep(.rg.is-stage .rg-node.is-hub.is-active .rg-text) {
  border-color: var(--graph-violet);
  background: var(--graph-selected);
}
.graph-help {
  border-top: 1px solid var(--graph-rule);
  padding-top: 12px;
  font-size: 10px;
}
.graph-scroll {
  scrollbar-color: var(--graph-rule) var(--graph-surface);
}
@media (max-width: 600px) {
  .chapter-graph {
    padding: 12px;
  }
  .graph-count {
    display: none;
  }
}
.chapter-graph :deep(.rg-node.is-dim .rg-body) {
  opacity: 0.65;
}
</style>
