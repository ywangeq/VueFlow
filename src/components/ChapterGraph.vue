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
  Math.max(510, 270 + Math.ceil(props.chapters.length / columns.value) * 205),
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
      y: 108,
      label: props.projectTitle || "未命名工程",
      sub: `${props.chapters.length} 个章节 · 音视频共用工作流`,
      kind: "core",
      size: 76,
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
      y: 300 + row * 205,
      label: `${String(index + 1).padStart(2, "0")}  ${chapter.title || "未命名章节"}`,
      sub: `${state.text}\n${media}`,
      kind: "hub",
      size: 84,
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
      <span>{{ chapters.length }} 个章节 · 按文稿顺序构建</span>
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
      每个章节同时管理音频与视频 · 表盘展示当前素材验收进度
    </p>
  </section>
</template>

<style scoped>
.chapter-graph {
  min-width: 0;
}
.graph-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 14px;
  color: #7a8385;
  font-size: 12px;
}
.view-toggle {
  display: flex;
  border: 1px solid #dbe0de;
  border-radius: 8px;
  padding: 2px;
  background: #fff;
}
.view-toggle button {
  padding: 5px 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #657071;
  cursor: pointer;
  font: inherit;
}
.view-toggle button[aria-pressed="true"] {
  background: #edf3e8;
  color: #3c5746;
}
.graph-scroll {
  max-height: 610px;
  overflow: auto;
  border-radius: 14px;
}
.graph-help {
  color: #81898b;
  font-size: 11px;
  margin: 12px 0 0;
  line-height: 1.7;
}
.graph-empty {
  padding: 100px 24px;
  text-align: center;
  color: #7a8385;
  background: #f7f9f6;
  border: 1px dashed #d9dfda;
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
  border: 1px solid #e1e6e1;
  background: #fff;
  border-radius: 10px;
  color: #344840;
  cursor: pointer;
}
.graph-chapter-list button[aria-pressed="true"] {
  background: #eef4e8;
  border-color: #83a578;
}
.graph-chapter-index {
  font: 12px monospace;
  color: #788a7d;
}
.graph-chapter-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}
.graph-media-counts {
  color: #788078;
  font-size: 11px;
}
.chapter-name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.chapter-status {
  flex-shrink: 0;
  color: #788078;
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
  outline: 2px solid #618765;
  outline-offset: 3px;
}
</style>
