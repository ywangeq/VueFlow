<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { Project, MediaKind, Chapter } from "./domain/types";
import {
  activeVersion,
  segmentStatus,
  flattenSegments,
  findSegment,
  chapterForSegment,
  groupStatus,
  newSegment,
  combinedChapterStatus,
  segmentDuration,
  newChapter,
  formatTime,
} from "./domain/project";
import { splitSegment } from "./domain/script";
import { api } from "./services/api";
import { probeMedia, exportAudio, downloadBlob } from "./services/media";
import ChapterGraph from "./components/ChapterGraph.vue";
import SegmentInspector from "./components/SegmentInspector.vue";
import SequencePlayer from "./components/SequencePlayer.vue";
import StudioIcon from "./components/StudioIcon.vue";
import ScriptImport from "./components/ScriptImport.vue";
const project = ref<Project | null>(null),
  selectedId = ref<string | null>(null);
const busy = ref(false),
  dirty = ref(false),
  error = ref(""),
  notice = ref(""),
  loaded = ref(false);
const importing = ref(false);
const scopeChapterId = ref<string | null>(null);
const playhead = ref<{
  segmentId: string;
  time: number;
  versionId: string;
} | null>(null);
const segment = computed(() =>
  project.value && selectedId.value
    ? findSegment(project.value, selectedId.value)
    : null,
);
const chapter = computed(() =>
  project.value && selectedId.value
    ? chapterForSegment(project.value, selectedId.value)
    : null,
);
const segments = computed(() =>
  project.value ? flattenSegments(project.value) : [],
);
const approved = computed(
  () =>
    segments.value.filter((c) => combinedChapterStatus(c) === "已通过")
      .length ?? 0,
);
const available = computed(
  () =>
    segments.value.filter(
      (c) => activeVersion(c, "audio") || activeVersion(c, "video"),
    ).length ?? 0,
);
const duration = computed(() => {
  const playable =
    segments.value.filter(
      (c) => activeVersion(c, "audio") || activeVersion(c, "video"),
    ) ?? [];
  return playable.reduce(
    (sum, c, i) =>
      sum + segmentDuration(c) + (i < playable.length - 1 ? c.gap : 0),
    0,
  );
});
const approvedAudio = computed(
  () =>
    segments.value.filter((c) => segmentStatus(c, "audio") === "已通过")
      .length ?? 0,
);
const pendingCount = computed(
  () =>
    project.value?.jobs.filter((j) => j.status === "awaiting_external")
      .length ?? 0,
);
function accept(next: Project) {
  project.value = next;
  dirty.value = false;
  if (!selectedId.value || !findSegment(next, selectedId.value))
    selectedId.value =
      flattenSegments(next)[0]?.id ??
      flattenSegments(next, true)[0]?.id ??
      null;
  if (
    scopeChapterId.value &&
    !next.chapters.some((c) => c.id === scopeChapterId.value)
  )
    scopeChapterId.value = null;
}
function markDirty() {
  dirty.value = true;
  notice.value = "";
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
async function flush() {
  if (project.value && dirty.value) accept(await api.save(project.value));
}
function save() {
  return run(async () => {
    await flush();
    notice.value = "已保存到本机";
  });
}
async function load() {
  await run(async () => {
    accept(await api.load());
    loaded.value = true;
  });
}
function importScript(chapters: Chapter[]) {
  if (!project.value) return;
  if (project.value.chapters.length + chapters.length > 200) {
    error.value = "一个工程最多 200 章，请分批创建工程。";
    return;
  }
  project.value.chapters.push(...chapters);
  selectedId.value = chapters[0]?.segments[0]?.id ?? selectedId.value;
  scopeChapterId.value = chapters[0]?.id ?? null;
  importing.value = false;
  markDirty();
  save();
}
function recoverDraft() {
  if (!project.value) return;
  downloadBlob(
    new Blob(
      [
        JSON.stringify(
          { format: "vueflow-unsaved-draft/v1", project: project.value },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "vueflow-unsaved-draft.json",
  );
  load();
}
function addChapter() {
  if (!project.value) return;
  if (project.value.chapters.length >= 200) {
    error.value = "一个工程最多200章。";
    return;
  }
  const c = newChapter(project.value.chapters.length + 1);
  project.value.chapters.push(c);
  selectedId.value = c.segments[0]?.id ?? null;
  scopeChapterId.value = c.id;
  markDirty();
  save();
}
function move(index: number, delta: number) {
  if (!project.value) return;
  const list = project.value.chapters;
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  markDirty();
  save();
}
function queue(mediaKind: MediaKind, commentIds: string[]) {
  const id = selectedId.value;
  if (!id) return;
  run(async () => {
    await flush();
    accept(await api.queue(id, { kind: mediaKind, commentIds }));
    notice.value =
      "任务已保存：导出交接清单后由 Codex 在外部生成，完成后到「素材与任务」导入结果。";
  });
}
function cancel(jobId: string) {
  run(async () => {
    await flush();
    accept(await api.cancel(jobId));
    notice.value = "任务已取消";
  });
}
function upload(file: File, mediaKind: MediaKind, jobId?: string) {
  const id = selectedId.value;
  if (!id) return;
  run(async () => {
    await flush();
    const measured = await probeMedia(file);
    const next = await api.upload(id, file, {
      kind: mediaKind,
      duration: measured,
      jobId,
    });
    accept(next);
    const imported = findSegment(next, id);
    const completed = jobId
      ? next.jobs.find((j) => j.id === jobId)?.completedVersionId
      : null;
    const active = imported ? activeVersion(imported, mediaKind)?.id : null;
    notice.value =
      completed && completed !== active
        ? "结果已保存为历史版本：任务基线已更新，保留了当前选用版本。可到「素材与任务」比较。"
        : "素材已导入，旧版本仍可回看。请在「音画与评论」验收。";
  });
}
function exportMix() {
  run(async () => {
    await flush();
    if (!project.value) return;
    const blob = await exportAudio(project.value);
    downloadBlob(blob, `${project.value.title || "配音"}-合成.wav`);
    notice.value = "WAV 已导出，包含各段音量、总音量和段后停顿。";
  });
}
function exportProject() {
  run(async () => {
    await flush();
    if (!project.value) return;
    downloadBlob(await api.exportFile(), "vueflow-project.zip");
    notice.value = "工程包已导出，包含配置、任务、评论和全部音视频文件。";
  });
}
function handoff() {
  run(async () => {
    await flush();
    if (!project.value) return;
    const p = project.value;
    const jobs = p.jobs.filter((j) => j.status === "awaiting_external");
    if (!jobs.length) throw new Error("请先选择句段，创建一个生成或返修任务。");
    const tasks = jobs.map((j) => {
      const c = findSegment(p, j.segmentId);
      return {
        ...j,
        chapterTitle: chapterForSegment(p, j.segmentId)?.title,
        segmentTitle: c?.title,
        comments:
          ("commentSnapshots" in j
            ? j.commentSnapshots
            : c?.comments.filter((comment) =>
                j.commentIds.includes(comment.id),
              )) ?? [],
      };
    });
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              format: "vueflow-handoff/v2",
              projectId: p.id,
              revision: p.revision,
              execution: "manual-external",
              instructions:
                "按任务快照在已授权工具中生成；MiniMax 仅使用已有本人音色和网页额度，不切换API。完成后通过对应句段任务导入文件。保留任务ID与基线版本，过期结果不自动激活。",
              tasks,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "vueflow-handoff.json",
    );
    notice.value = `已导出 ${jobs.length} 个待执行任务；尚未调用 MiniMax 或视频服务。`;
  });
}

function selectGroup(id: string | null) {
  scopeChapterId.value = id;
  if (id)
    selectedId.value =
      project.value?.chapters
        .find((c) => c.id === id)
        ?.segments.find((s) => s.enabled)?.id ??
      project.value?.chapters.find((c) => c.id === id)?.segments[0]?.id ??
      null;
}
function selectSegment(id: string) {
  selectedId.value = id;
  scopeChapterId.value = project.value
    ? (chapterForSegment(project.value, id)?.id ?? null)
    : null;
}
function addSegment() {
  if (!chapter.value || !project.value) return;
  if (
    chapter.value.segments.length >= 2000 ||
    flattenSegments(project.value, true).length >= 5000
  ) {
    error.value = "句段已达工程上限，请拆分工程。";
    return;
  }
  const item = newSegment(chapter.value.segments.length + 1);
  chapter.value.segments.push(item);
  selectedId.value = item.id;
  markDirty();
  save();
}
function moveSegment(id: string, delta: number) {
  if (!project.value) return;
  const group = chapterForSegment(project.value, id);
  if (!group) return;
  const i = group.segments.findIndex((s) => s.id === id),
    j = i + delta;
  if (j < 0 || j >= group.segments.length) return;
  [group.segments[i], group.segments[j]] = [
    group.segments[j],
    group.segments[i],
  ];
  markDirty();
  save();
}
function splitSelected() {
  const id = selectedId.value;
  if (!id) return;
  run(async () => {
    await flush();
    if (!project.value) return;
    const original = findSegment(project.value, id),
      group = chapterForSegment(project.value, id);
    if (!original || !group) return;
    if (
      project.value.jobs.some(
        (j) => j.segmentId === original.id && j.status === "awaiting_external",
      )
    )
      throw new Error("请先取消此句段的待执行任务，再拆分。");
    const items = splitSegment(original);
    if (items.length === 1) {
      notice.value = "当前只有一句，无需拆分。";
      return;
    }
    const at = group.segments.findIndex((s) => s.id === original.id);
    group.segments.splice(at, 1, ...items);
    selectedId.value = items[1].id;
    markDirty();
    await flush();
    notice.value =
      "已拆成独立句段。原稿和素材已保留并停用；现有音视频不会自动切割。";
  });
}
function toggleSelected() {
  const id = selectedId.value;
  if (!id) return;
  run(async () => {
    await flush();
    if (!project.value) return;
    const target = findSegment(project.value, id);
    if (!target) return;
    if (
      project.value.jobs.some(
        (j) => j.segmentId === id && j.status === "awaiting_external",
      )
    )
      throw new Error("请先取消此句段的待执行任务。");
    target.enabled = !target.enabled;
    markDirty();
    await flush();
  });
}
function importFile(file: File, applyGraph: boolean) {
  run(async () => {
    await flush();
    const existingIds = new Set(project.value?.chapters.map((c) => c.id));
    const next = await api.importFile(file, applyGraph);
    accept(next);
    selectGroup(
      next.chapters.find((c) => !existingIds.has(c.id))?.id ??
        scopeChapterId.value,
    );
    importing.value = false;
    notice.value = "文件已导入并追加到工程；原有内容保留。";
  });
}

onMounted(load);
window.addEventListener("beforeunload", (event) => {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
});
</script>
<template>
  <div class="studio-app" v-if="project">
    <header class="app-header">
      <a class="brand" href="#" aria-label="VueFlow 工作台"
        ><span class="brand-mark"><StudioIcon name="nodes" :size="23" /></span
        ><span>VueFlow<small>音视频工作台</small></span></a
      >
      <div class="header-project">
        <span class="project-dot"></span
        ><input
          v-model="project.title"
          :disabled="busy"
          aria-label="项目名称"
          @input="markDirty"
          maxlength="120"
        /><span class="save-state">{{
          dirty ? "有未保存修改" : "已保存到本机"
        }}</span>
      </div>
      <div class="header-actions">
        <button class="secondary" :disabled="busy" @click="importing = true">
          <StudioIcon name="upload" />导入
        </button>
        <button class="secondary" :disabled="busy" @click="exportProject">
          <StudioIcon name="download" />工程备份</button
        ><button class="primary" :disabled="busy || !dirty" @click="save">
          <StudioIcon name="save" />{{ busy ? "处理中…" : "保存" }}
        </button>
      </div>
    </header>
    <nav class="workspace-bar" aria-label="工作区">
      <div class="unified-workspace-label">
        <StudioIcon name="nodes" />章节工作流<span>音画在同一节点构建</span>
      </div>
      <div class="workspace-context">
        <span class="local-indicator"></span>本地工作区<span class="divider"
          >/</span
        >非商业用途
      </div>
      <a
        class="repo-link"
        href="https://github.com/ywangeq/VueFlow"
        target="_blank"
        rel="noreferrer"
        >项目仓库 ↗</a
      >
    </nav>
    <div v-if="error" class="message error" role="alert">
      <span>{{ error }}</span
      ><button
        v-if="error.includes('工程已更新')"
        class="secondary small"
        @click="recoverDraft"
      >
        下载草稿并重新载入</button
      ><button class="text-button" @click="error = ''">关闭</button>
    </div>
    <div v-if="notice" class="message notice" role="status">
      <span>{{ notice }}</span
      ><button class="text-button" @click="notice = ''">关闭</button>
    </div>
    <div class="workspace-grid">
      <aside class="outline" aria-label="章节顺序">
        <div class="outline-title">
          <h2>章节</h2>
          <span>{{ project.chapters.length }}</span
          ><button
            class="icon-button"
            aria-label="新增章节"
            :disabled="busy"
            @click="addChapter"
          >
            <StudioIcon name="plus" />
          </button>
        </div>
        <p class="outline-caption">从一段想法，到完整作品。</p>
        <ol class="chapter-list">
          <li
            v-for="(c, index) in project.chapters"
            :key="c.id"
            :class="{ selected: c.id === scopeChapterId }"
          >
            <button
              class="chapter-select"
              :aria-current="c.id === scopeChapterId ? 'step' : undefined"
              @click="selectGroup(c.id)"
            >
              <span class="chapter-index">{{
                String(index + 1).padStart(2, "0")
              }}</span
              ><span class="chapter-copy"
                ><strong>{{ c.title }}</strong
                ><small
                  ><span
                    class="tiny-dot"
                    :class="{
                      'is-approved': groupStatus(c) === '已通过',
                    }"
                  ></span
                  >{{ groupStatus(c) }} ·
                  {{ c.segments.filter((s) => s.enabled).length }} 句</small
                ></span
              >
            </button>
            <ol v-if="scopeChapterId === c.id" class="segment-list">
              <li
                v-for="(item, si) in c.segments"
                :key="item.id"
                :class="{
                  'selected-segment': item.id === selectedId,
                  'disabled-segment': !item.enabled,
                }"
              >
                <button class="segment-select" @click="selectSegment(item.id)">
                  <strong>{{ item.title }}</strong
                  ><small
                    >{{
                      !item.enabled
                        ? "原稿 · 已停用"
                        : combinedChapterStatus(item)
                    }}
                    · {{ item.text.slice(0, 24) || "待写文稿" }}</small
                  >
                </button>
                <div>
                  <button
                    class="text-button"
                    :disabled="busy || si === 0"
                    :aria-label="'上移句段' + item.title"
                    @click="moveSegment(item.id, -1)"
                  >
                    ↑</button
                  ><button
                    class="text-button"
                    :disabled="busy || si === c.segments.length - 1"
                    :aria-label="'下移句段' + item.title"
                    @click="moveSegment(item.id, 1)"
                  >
                    ↓
                  </button>
                </div>
              </li>
            </ol>
            <div class="chapter-reorder">
              <button
                class="icon-button tiny"
                :aria-label="`上移${c.title}`"
                :disabled="busy || index === 0"
                @click="move(index, -1)"
              >
                <StudioIcon name="up" :size="13" /></button
              ><button
                class="icon-button tiny"
                :aria-label="`下移${c.title}`"
                :disabled="busy || index === project.chapters.length - 1"
                @click="move(index, 1)"
              >
                <StudioIcon name="down" :size="13" />
              </button>
            </div>
          </li>
        </ol>
        <button class="outline-add" :disabled="busy" @click="importing = true">
          <StudioIcon name="upload" :size="16" />导入文稿 / 工程文件
        </button>
        <button class="outline-add" :disabled="busy" @click="addChapter">
          <StudioIcon name="plus" :size="16" />添加章节
        </button>
        <button
          class="outline-add"
          :disabled="busy || !chapter"
          @click="addSegment"
        >
          <StudioIcon name="plus" :size="16" />当前章节添加句段
        </button>
        <label v-if="chapter" class="chapter-title-edit"
          >章节名称<input
            v-model="chapter.title"
            :disabled="busy"
            maxlength="120"
            @input="markDirty"
            @change="save"
        /></label>
        <details class="graph-settings">
          <summary>图谱配置</summary>
          <label
            >列间距<input
              type="number"
              min="160"
              max="640"
              v-model.number="project.graph.columnWidth"
              :disabled="busy"
              @input="markDirty"
              @change="save" /></label
          ><label
            >行间距<input
              type="number"
              min="80"
              max="600"
              v-model.number="project.graph.rowGap"
              :disabled="busy"
              @input="markDirty"
              @change="save" /></label
          ><small>播放顺序遵循左侧章节、句段顺序。</small>
        </details>
        <div class="outline-bottom">
          <div>
            <span class="muted">待执行任务</span
            ><strong>{{ pendingCount }}</strong>
          </div>
          <button
            class="secondary full"
            :disabled="busy || !pendingCount"
            @click="handoff"
          >
            <StudioIcon name="download" :size="16" />导出交接清单
          </button>
          <p class="hint">
            生成任务交给 Codex 或外部工具执行，素材回填后在这里审听。
          </p>
        </div>
      </aside>
      <main class="canvas-column">
        <div class="canvas-toolbar">
          <div>
            <span class="eyebrow">MEDIA WORKSPACE</span>
            <h1>让声音与画面，一起成形。</h1>
          </div>
          <div class="progress-label">
            <strong
              >{{ approved }}<span>/ {{ segments.length }}</span></strong
            ><span>句段已通过</span>
          </div>
        </div>
        <div class="stage-wrap">
          <ChapterGraph
            :chapters="project.chapters"
            :selected-segment-id="selectedId"
            :scope-chapter-id="scopeChapterId"
            :graph="project.graph"
            :project-title="project.title"
            @select-segment="selectSegment"
            @select-chapter="selectGroup"
          />
        </div>
        <div class="canvas-summary">
          <span><span class="legend-dot ready"></span>已通过</span
          ><span><span class="legend-dot review"></span>待审阅 / 修改</span
          ><span><span class="legend-dot missing"></span>待生成</span
          ><span class="summary-duration"
            >{{ available }} 段可播放 · {{ formatTime(duration) }}</span
          >
        </div>
        <section class="sequence-section" aria-label="音画连续预览">
          <div class="sequence-heading">
            <div>
              <h2>音画连续预览</h2>
              <p>同一句段的旁白与画面共用进度，按章节、句段顺序衔接。</p>
            </div>
            <button
              class="secondary small"
              :disabled="
                busy || approvedAudio !== segments.length || !segments.length
              "
              @click="exportMix"
            >
              <StudioIcon name="download" :size="16" />导出声音 WAV
            </button>
          </div>
          <SequencePlayer
            :project="project"
            @select="selectSegment"
            @time="playhead = $event"
          /><label class="master-volume"
            >总音量
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="project.masterGain"
              :disabled="busy"
              @input="markDirty"
              @change="save"
            /><output
              >{{ Math.round(project.masterGain * 100) }}%</output
            ></label
          >
        </section>
      </main>
      <SegmentInspector
        v-if="segment"
        :key="segment.id"
        :segment="segment"
        :chapter-title="chapter?.title ?? ''"
        :project="project"
        :busy="busy"
        :playhead="playhead"
        @split="splitSelected"
        @toggle="toggleSelected"
        @dirty="markDirty"
        @save="save"
        @upload="upload"
        @queue="queue"
        @cancel="cancel"
        @notice="notice = $event"
      />
      <aside v-else class="inspector empty-inspector">
        添加章节，开始构建。
      </aside>
    </div>
    <ScriptImport
      v-if="importing"
      :error="error"
      :busy="busy"
      @close="importing = false"
      @import="importScript"
      @file="importFile"
    />
  </div>
  <div v-else class="loading-screen">
    <span class="brand-mark"><StudioIcon name="nodes" :size="28" /></span>
    <h1>VueFlow</h1>
    <p>{{ error || "正在打开本地工作区…" }}</p>
    <button v-if="error" class="primary" @click="load">重新连接</button>
  </div>
</template>
