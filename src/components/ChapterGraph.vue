<script setup lang="ts">
import { computed, ref } from "vue";
import RelationGraph, {
  type GraphLink,
  type GraphNode,
} from "../vendor/scaffold/components/charts/RelationGraph.vue";
import type { Chapter, Segment, GraphConfig } from "../domain/types";
import { combinedChapterStatus, groupStatus } from "../domain/project";

const props = defineProps<{
  chapters: Chapter[];
  selectedSegmentId: string | null;
  scopeChapterId: string | null;
  graph: GraphConfig;
  projectTitle: string;
}>();
const emit = defineEmits<{
  selectSegment: [id: string];
  selectChapter: [id: string | null];
}>();
const view = ref<"graph" | "list">("graph");
const size = ref({ w: 760, h: 600 });
const scope = computed(() => props.chapters.find((chapter) => chapter.id === props.scopeChapterId) ?? null);
const columnWidth = computed(() => Math.max(160, Math.min(640, Number(props.graph.columnWidth) || 220)));
const rowGap = computed(() => Math.max(80, Math.min(600, Number(props.graph.rowGap) || 180)));
const compactLayout = computed(() => rowGap.value < 150);
const columns = computed(() => Math.max(1, Math.min(4, Math.floor(size.value.w / columnWidth.value))));
const coreId = computed(() => scope.value ? `__chapter__:${scope.value.id}` : "__project__");
function stateFor(status: string) {
  if (status === "已停用") return { text: status, tone: "off" as const, ratio: 0 };
  if (status === "待生成") return { text: status, tone: "accent" as const, ratio: 0 };
  if (status === "待更新") return { text: status, tone: "danger" as const, ratio: .25 };
  if (status === "待修改") return { text: status, tone: "danger" as const, ratio: .5 };
  if (status === "已通过") return { text: status, tone: "lime" as const, ratio: 1 };
  return { text: status, tone: "accent" as const, ratio: .75 };
}
function mediaCounts(segment: Segment) {
  const audio = segment.versions.filter((version) => version.kind === "audio").length;
  const video = segment.versions.filter((version) => version.kind === "video").length;
  return `音频 ${audio}版 · 视频 ${video}版`;
}
const entries = computed(() => scope.value
  ? scope.value.segments.map((segment) => ({
      id: segment.id, title: segment.title, enabled: segment.enabled,
      state: stateFor(segment.enabled ? combinedChapterStatus(segment) : "已停用"),
      detail: mediaCounts(segment), count: null as number | null,
    }))
  : props.chapters.map((chapter) => {
      const enabled = chapter.segments.filter((segment) => segment.enabled).length;
      return { id: chapter.id, title: chapter.title, enabled: enabled > 0,
        state: stateFor(groupStatus(chapter)), detail: `${enabled} 个启用句段`, count: enabled };
    }));
const height = computed(() => Math.max(480, 240 + Math.ceil(entries.value.length / columns.value) * rowGap.value));
const activeId = computed(() => scope.value ? props.selectedSegmentId : props.chapters.find((chapter) => chapter.segments.some((segment) => segment.id === props.selectedSegmentId))?.id ?? null);
const nodes = computed<GraphNode[]>(() => {
  const w = size.value.w || 760;
  const result: GraphNode[] = [{
    id: coreId.value, x: w / 2, y: 104,
    label: scope.value?.title || props.projectTitle || "未命名工程",
    sub: scope.value ? `${scope.value.segments.filter((segment) => segment.enabled).length} 个启用句段 · 旁白与画面共用节点` : `${props.chapters.length} 个章节 · 点击下钻句段`,
    kind: "core", size: 88, interactive: false,
    title: scope.value?.title || props.projectTitle,
  }];
  entries.value.forEach((entry, index) => {
    const row = Math.floor(index / columns.value);
    const rowCount = Math.min(columns.value, entries.value.length - row * columns.value);
    result.push({
      id: entry.id, x: ((index % columns.value + (compactLayout.value ? .15 : .5)) * w) / rowCount,
      y: 280 + row * rowGap.value,
      label: `${String(index + 1).padStart(2, "0")}  ${entry.title || "未命名"}`,
      sub: `${entry.state.text}\n${entry.detail}`, kind: "hub", size: compactLayout.value ? 36 : 88,
      count: entry.count ?? String(index + 1).padStart(2, "0"),
      tone: entry.state.tone, ratio: entry.state.ratio,
      icon: scope.value ? "layers" : "dept", from: coreId.value,
      delay: Math.min(index * .045, .5),
      title: `${entry.title}：${entry.state.text}，${entry.detail}${scope.value ? "" : "，点击查看句段"}`,
    });
  });
  return result;
});
const links = computed<GraphLink[]>(() => entries.value.map((entry) => ({
  a: coreId.value, b: entry.id, shape: "v", flow: entry.enabled ? "forward" : "none",
  tone: entry.state.tone === "off" ? "accent" : entry.state.tone,
  dashed: !entry.enabled,
})));
function select(id: string) {
  if (scope.value) emit("selectSegment", id);
  else emit("selectChapter", id);
}
function selectNode(node: GraphNode) {
  if (entries.value.some((entry) => entry.id === node.id)) select(node.id);
}
</script>

<template>
  <section class="chapter-graph" :class="{ 'is-compact-layout': compactLayout }" aria-label="章节与句段工作流">
    <div class="graph-topline">
      <span class="graph-title"><i aria-hidden="true"></i>{{ scope ? '句段关系' : '章节关系' }}<span class="graph-count">{{ entries.length }} 个节点</span></span>
      <div class="view-toggle" role="group" aria-label="工作流视图">
        <button type="button" :aria-pressed="view === 'graph'" @click="view = 'graph'">节点</button>
        <button type="button" :aria-pressed="view === 'list'" @click="view = 'list'">列表</button>
      </div>
    </div>
    <nav v-if="scope" class="graph-breadcrumb" aria-label="图谱层级">
      <button type="button" @click="emit('selectChapter', null)">← 全部章节</button>
      <span aria-hidden="true">/</span><span>{{ scope.title }}</span>
    </nav>
    <p v-if="!entries.length" class="graph-empty">{{ scope ? '在本章添加句段，开始构建。' : '导入文稿或添加章节，开始构建。' }}</p>
    <div v-else-if="view === 'graph'" class="graph-scroll">
      <RelationGraph v-model:size="size" :style="{ height: `${height}px` }" :nodes="nodes" :links="links" :active-id="activeId" variant="stage"
        :label="`${scope?.title || projectTitle}，${scope ? '句段' : '章节'}节点；使用 Tab 或方向键选择，Esc 返回全部章节`"
        @select="selectNode" @back="emit('selectChapter', null)" />
    </div>
    <ol v-else class="graph-chapter-list">
      <li v-for="(entry, index) in entries" :key="entry.id">
        <button type="button" :aria-pressed="activeId === entry.id" @click="select(entry.id)">
          <span class="graph-chapter-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="graph-chapter-copy"><span class="chapter-name">{{ entry.title || '未命名' }}</span><span class="graph-media-counts">{{ entry.detail }}</span></span>
          <span class="chapter-status">{{ entry.state.text }}</span>
        </button>
      </li>
    </ol>
    <p v-if="entries.length && view === 'graph'" class="graph-help">{{ scope ? '每个句段独立管理旁白与画面 · 停用节点保留素材历史' : '章节组织句段 · 点击章节查看可独立生成与返修的句段' }}</p>
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
.graph-breadcrumb {
  display: flex; align-items: center; gap: 10px; font-size: 12px;
  padding-bottom: 14px; color: var(--graph-muted); min-width: 0;
}
.graph-breadcrumb button {
  flex-shrink: 0; border: 1px solid var(--graph-rule); border-radius: 5px;
  background: var(--graph-panel); color: var(--graph-blue); padding: 6px 9px;
}
.graph-breadcrumb > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  width: min(170px, calc(v-bind(columnWidth) * 1px - 10px));
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
.is-compact-layout :deep(.rg.is-stage .rg-node.is-hub .rg-text) {
  top: 50%; left: calc(100% + 7px); translate: 0 -50%;
  width: min(170px, calc(v-bind(columnWidth) * 1px - 68px)); padding: 3px 5px;
}
.is-compact-layout :deep(.rg.is-stage .rg-node.is-hub .rg-label) { max-width: 100%; font-size: 11px; }
.is-compact-layout :deep(.rg.is-stage .rg-node.is-hub .rg-sub) { font-size: 9px; }
.is-compact-layout :deep(.rg.is-stage .rg-node.is-hub .rg-count) { font-size: 12px; }
.is-compact-layout :deep(.rg.is-stage .rg-node.is-hub .rg-dot) { display: none; }

</style>
