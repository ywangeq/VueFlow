<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { Project, MediaKind, Chapter } from "./domain/types";
import {
  activeVersion,
  chapterStatus,
  newChapter,
  formatTime,
} from "./domain/project";
import { api } from "./services/api";
import { probeMedia, exportAudio, downloadBlob } from "./services/media";
import ChapterGraph from "./components/ChapterGraph.vue";
import ChapterInspector from "./components/ChapterInspector.vue";
import SequencePlayer from "./components/SequencePlayer.vue";
import StudioIcon from "./components/StudioIcon.vue";
import ScriptImport from "./components/ScriptImport.vue";
const project = ref<Project | null>(null),
  selectedId = ref<string | null>(null),
  kind = ref<MediaKind>("audio");
const busy = ref(false),
  dirty = ref(false),
  error = ref(""),
  notice = ref(""),
  loaded = ref(false);
const importing = ref(false);
const playhead = ref<{
  chapterId: string;
  time: number;
  versionId: string;
} | null>(null);
const chapter = computed(
  () => project.value?.chapters.find((c) => c.id === selectedId.value) ?? null,
);
const approved = computed(
  () =>
    project.value?.chapters.filter(
      (c) => chapterStatus(c, kind.value) === "已通过",
    ).length ?? 0,
);
const available = computed(
  () =>
    project.value?.chapters.filter((c) => activeVersion(c, kind.value))
      .length ?? 0,
);
const duration = computed(() => {
  const playable =
    project.value?.chapters.filter((c) => activeVersion(c, kind.value)) ?? [];
  return playable.reduce(
    (sum, c, i) =>
      sum +
      (activeVersion(c, kind.value)?.duration ?? 0) +
      (i < playable.length - 1 ? c.gap : 0),
    0,
  );
});
const pendingCount = computed(
  () =>
    project.value?.jobs.filter((j) => j.status === "awaiting_external")
      .length ?? 0,
);
function accept(next: Project) {
  project.value = next;
  dirty.value = false;
  if (!next.chapters.some((c) => c.id === selectedId.value))
    selectedId.value = next.chapters[0]?.id ?? null;
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
  selectedId.value = chapters[0]?.id ?? selectedId.value;
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
  const c = newChapter(project.value.chapters.length + 1);
  project.value.chapters.push(c);
  selectedId.value = c.id;
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
function queue(commentIds: string[]) {
  const id = selectedId.value;
  const mediaKind = kind.value;
  if (!id) return;
  run(async () => {
    await flush();
    accept(await api.queue(id, { kind: mediaKind, commentIds }));
    notice.value =
      "任务已保存：导出交接清单后由 Codex 在外部生成，完成后到「版本与任务」导入结果。";
  });
}
function cancel(jobId: string) {
  run(async () => {
    await flush();
    accept(await api.cancel(jobId));
    notice.value = "任务已取消";
  });
}
function upload(file: File, jobId?: string) {
  const id = selectedId.value;
  if (!id) return;
  const mediaKind = kind.value;
  run(async () => {
    await flush();
    const measured = await probeMedia(file);
    const next = await api.upload(id, file, {
      kind: mediaKind,
      duration: measured,
      jobId,
    });
    accept(next);
    const imported = next.chapters.find((c) => c.id === id);
    const completed = jobId
      ? next.jobs.find((j) => j.id === jobId)?.completedVersionId
      : null;
    const active = imported ? activeVersion(imported, mediaKind)?.id : null;
    notice.value =
      completed && completed !== active
        ? "结果已保存为历史版本：任务基线已更新，保留了当前选用版本。可到「版本与任务」比较。"
        : "素材已导入，旧版本仍可回看。请在「试听与评论」验收。";
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
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            { format: "vueflow-project/v1", project: project.value },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "vueflow-project.json",
    );
    notice.value =
      "已导出工程元数据；音视频文件保存在本机 data/media，备份时需一并保存。";
  });
}
function handoff() {
  run(async () => {
    await flush();
    if (!project.value) return;
    const p = project.value;
    const jobs = p.jobs.filter((j) => j.status === "awaiting_external");
    if (!jobs.length) throw new Error("请先选择章节，创建一个生成或返修任务。");
    const tasks = jobs.map((j) => {
      const c = p.chapters.find((c) => c.id === j.chapterId);
      return {
        ...j,
        chapterTitle: c?.title,
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
              format: "vueflow-handoff/v1",
              projectId: p.id,
              revision: p.revision,
              execution: "manual-external",
              instructions:
                "按任务快照在已授权工具中生成；MiniMax 仅使用已有本人音色和网页额度，不切换API。完成后通过对应章节任务导入文件。保留任务ID与基线版本，过期结果不自动激活。",
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
        <button class="secondary" :disabled="busy" @click="exportProject">
          <StudioIcon name="download" />工程备份</button
        ><button class="primary" :disabled="busy || !dirty" @click="save">
          <StudioIcon name="save" />{{ busy ? "处理中…" : "保存" }}
        </button>
      </div>
    </header>
    <nav class="workspace-bar" aria-label="工作区">
      <div class="media-switch">
        <button
          :class="{ active: kind === 'audio' }"
          :aria-pressed="kind === 'audio'"
          :disabled="busy"
          @click="kind = 'audio'"
        >
          <StudioIcon name="audio" />音频构建</button
        ><button
          :class="{ active: kind === 'video' }"
          :aria-pressed="kind === 'video'"
          :disabled="busy"
          @click="kind = 'video'"
        >
          <StudioIcon name="video" />视频构建
        </button>
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
            :class="{ selected: c.id === selectedId }"
          >
            <button
              class="chapter-select"
              :aria-current="c.id === selectedId ? 'step' : undefined"
              @click="selectedId = c.id"
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
                      'is-approved': chapterStatus(c, kind) === '已通过',
                    }"
                  ></span
                  >{{ chapterStatus(c, kind) }}</small
                ></span
              >
            </button>
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
          <StudioIcon name="upload" :size="16" />按章节导入文稿
        </button>
        <button class="outline-add" :disabled="busy" @click="addChapter">
          <StudioIcon name="plus" :size="16" />添加章节
        </button>
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
            <span class="eyebrow">{{
              kind === "audio" ? "AUDIO WORKSPACE" : "VIDEO WORKSPACE"
            }}</span>
            <h1>
              {{
                kind === "audio" ? "让每一段，都说到位。" : "让声音，拥有画面。"
              }}
            </h1>
          </div>
          <div class="progress-label">
            <strong
              >{{ approved
              }}<span>/ {{ project.chapters.length }}</span></strong
            ><span>章节已通过</span>
          </div>
        </div>
        <div class="stage-wrap">
          <ChapterGraph
            :chapters="project.chapters"
            :selected-id="selectedId"
            :kind="kind"
            :project-title="project.title"
            @select="selectedId = $event"
          />
        </div>
        <div class="canvas-summary">
          <span><span class="legend-dot ready"></span>已通过</span
          ><span><span class="legend-dot review"></span>待试听 / 修改</span
          ><span><span class="legend-dot missing"></span>待生成</span
          ><span class="summary-duration"
            >{{ available }} 段可播放 · {{ formatTime(duration) }}</span
          >
        </div>
        <section class="sequence-section" aria-label="全文合成审听">
          <div class="sequence-heading">
            <div>
              <h2>{{ kind === "audio" ? "全文审听" : "章节视频预览" }}</h2>
              <p>
                {{
                  kind === "audio"
                    ? "按照章节顺序连播，试听每一次衔接。"
                    : "按章节顺序播放已导入视频，保留音视频共用的审阅记录。"
                }}
              </p>
            </div>
            <button
              v-if="kind === 'audio'"
              class="secondary small"
              :disabled="
                busy ||
                approved !== project.chapters.length ||
                !project.chapters.length
              "
              @click="exportMix"
            >
              <StudioIcon name="download" :size="16" />导出 WAV</button
            ><span v-else class="status-pill">视频合成导出待接入</span>
          </div>
          <SequencePlayer
            :project="project"
            :kind="kind"
            @select="selectedId = $event"
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
      <ChapterInspector
        v-if="chapter"
        :key="chapter.id"
        :chapter="chapter"
        :project="project"
        :kind="kind"
        :busy="busy"
        :playhead="playhead"
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
      @close="importing = false"
      @import="importScript"
    />
  </div>
  <div v-else class="loading-screen">
    <span class="brand-mark"><StudioIcon name="nodes" :size="28" /></span>
    <h1>VueFlow</h1>
    <p>{{ error || "正在打开本地工作区…" }}</p>
    <button v-if="error" class="primary" @click="load">重新连接</button>
  </div>
</template>
