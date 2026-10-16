<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  Segment,
  MediaKind,
  Project,
  ReviewComment,
  AssetVersion,
} from "../domain/types";
import {
  activeVersion,
  combinedChapterStatus,
  formatTime,
  uid,
} from "../domain/project";
import SegmentMediaPreview from "./SegmentMediaPreview.vue";
import { splitSentences } from "../domain/script";
import StudioIcon from "./StudioIcon.vue";
const props = defineProps<{
  segment: Segment;
  chapterTitle: string;
  project: Project;
  busy: boolean;
  playhead: { segmentId: string; time: number; versionId: string } | null;
}>();
const emit = defineEmits<{
  split: [];
  toggle: [];
  dirty: [];
  save: [];
  upload: [file: File, kind: MediaKind, jobId?: string];
  queue: [kind: MediaKind, commentIds: string[]];
  cancel: [jobId: string];
  notice: [text: string];
}>();
const tab = ref("script"),
  draft = ref(""),
  currentTime = ref(0),
  importJob = ref(""),
  commentVersionId = ref("");
const sources = computed(() =>
  [
    activeVersion(props.segment, "audio"),
    activeVersion(props.segment, "video"),
  ].filter((v): v is AssetVersion => !!v),
);
const selected = computed(
  () =>
    sources.value.find((v) => v.id === commentVersionId.value) ??
    sources.value[0] ??
    null,
);
const jobs = computed(() =>
  props.project.jobs.filter((j) => j.segmentId === props.segment.id),
);
const pending = computed(() =>
  jobs.value.filter((j) => j.status === "awaiting_external"),
);
const canSplit = computed(() => props.segment.enabled && splitSentences(props.segment.text).length > 1);
const hasStale = computed(() => sources.value.some(isStale));
const activeComments = computed(() =>
  props.segment.comments.filter(
    (c) => !c.resolved && sources.value.some((v) => v.id === c.versionId),
  ),
);
const kindLabel = (kind: MediaKind) => (kind === "audio" ? "旁白" : "画面");
function isStale(v: AssetVersion) {
  return (
    v.textSnapshot !== props.segment.text ||
    (v.directionSnapshot !== undefined &&
      v.directionSnapshot !== props.segment.direction)
  );
}
function isActive(v: AssetVersion) {
  return sources.value.some((s) => s.id === v.id);
}
function commentAsset(c: ReviewComment) {
  return props.segment.versions.find((v) => v.id === c.versionId);
}
watch(
  () => props.segment.id,
  () => {
    draft.value = "";
    currentTime.value = 0;
    importJob.value = "";
    commentVersionId.value = "";
    tab.value = "script";
  },
);
watch(
  () => sources.value.map((v) => v.id).join("|"),
  () => {
    if (!sources.value.some((v) => v.id === commentVersionId.value))
      commentVersionId.value = sources.value[0]?.id ?? "";
    currentTime.value = 0;
  },
  { immediate: true },
);
watch(
  () => pending.value.map((j) => j.id).join("|"),
  () => {
    if (importJob.value && !pending.value.some((j) => j.id === importJob.value))
      importJob.value = "";
  },
);
watch(
  () => props.playhead,
  (p) => {
    if (p?.segmentId === props.segment.id) currentTime.value = p.time;
  },
);
function pickVersion(v: AssetVersion) {
  if (props.busy || !props.segment.enabled) return;
  if (v.kind === "audio") props.segment.activeAudioId = v.id;
  else props.segment.activeVideoId = v.id;
  commentVersionId.value = v.id;
  emit("dirty");
  emit("save");
}
function approve() {
  if (props.busy || !props.segment.enabled) return;
  if (!sources.value.length || hasStale.value || activeComments.value.length)
    return;
  for (const v of sources.value)
    if (!props.segment.approvedVersionIds.includes(v.id))
      props.segment.approvedVersionIds.push(v.id);
  emit("dirty");
  emit("save");
}
function comment() {
  if (props.busy || !props.segment.enabled) return;
  if (!draft.value.trim() || !selected.value) return;
  props.segment.comments.push({
    id: uid(),
    text: draft.value.trim(),
    versionId: selected.value.id,
    time: Math.min(selected.value.duration, currentTime.value),
    createdAt: new Date().toISOString(),
    resolved: false,
  });
  draft.value = "";
  emit("dirty");
  emit("save");
}
function resolve(c: ReviewComment) {
  if (props.busy || !props.segment.enabled) return;
  c.resolved = !c.resolved;
  emit("dirty");
  emit("save");
}
function regenerate(c: ReviewComment) {
  if (props.busy || !props.segment.enabled) return;
  const v = commentAsset(c);
  if (v && isActive(v) && !c.resolved) emit("queue", v.kind, [c.id]);
}
function queue(kind: MediaKind) {
  if (props.busy || !props.segment.enabled) return;
  const v = activeVersion(props.segment, kind);
  emit(
    "queue",
    kind,
    props.segment.comments
      .filter((c) => !c.resolved && c.versionId === v?.id)
      .map((c) => c.id),
  );
}
function upload(event: Event) {
  if (props.busy || !props.segment.enabled) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const job = pending.value.find((j) => j.id === importJob.value);
  let kind: MediaKind;
  if (file.type.startsWith("video/")) kind = "video";
  else if (file.type.startsWith("audio/")) kind = "audio";
  else if (/\.(mp4|webm|mov)$/i.test(file.name)) kind = "video";
  else if (/\.(mp3|wav|m4a|flac|ogg|opus)$/i.test(file.name)) kind = "audio";
  else {
    emit("notice", "无法识别素材类型，请使用常见音视频格式。");
    return;
  }
  if (job && job.kind !== kind) {
    emit("notice", "所选任务与导入素材不匹配，请选择对应任务或导入独立素材。");
    return;
  }
  emit("upload", file, kind, job?.id);
}
async function copyText() {
  try {
    await navigator.clipboard.writeText(props.segment.text);
    emit("notice", "文稿已复制。");
  } catch {
    emit("notice", "请在文稿框中选中正文复制。");
  }
}
</script>
<template>
  <aside class="inspector" aria-label="句段音画编辑与审阅">
    <div class="inspector-heading">
      <span class="eyebrow">{{ chapterTitle }} · 句段详情</span
      ><span
        class="status-pill"
        :data-status="segment.enabled ? combinedChapterStatus(segment) : '已停用'"
        >{{ segment.enabled ? combinedChapterStatus(segment) : '已停用' }}</span
      >
    </div>
    <input
      class="chapter-title"
      aria-label="句段名称"
      v-model="segment.title"
      :disabled="busy || !segment.enabled"
      maxlength="120"
      @input="emit('dirty')"
    />
    <div class="segment-actions">
      <button type="button" class="secondary small" :disabled="busy || !canSplit || pending.length > 0" @click="emit('split')">逐句拆分</button>
      <button type="button" class="text-button" :disabled="busy || pending.length > 0" @click="emit('toggle')">{{ segment.enabled ? '停用句段' : '启用句段' }}</button>
    </div>
    <p v-if="pending.length" class="hint">先完成或取消待执行任务，再拆分或停用。</p>
    <p v-if="!segment.enabled" class="hint">已停用的原句段保留素材与评论，仅供历史预览；不参与连播、生成或导出。</p>
    <SegmentMediaPreview v-if="!segment.enabled" :segment="segment" :master-gain="project.masterGain" />
    <div class="chapter-sources" aria-label="同一句段的素材">
      <div v-for="kind in ['audio', 'video'] as const" :key="kind">
        <StudioIcon :name="kind" :size="15" /><span>{{ kindLabel(kind) }}</span
        ><strong :title="activeVersion(segment, kind)?.name">{{
          activeVersion(segment, kind)?.name ?? "未添加"
        }}</strong
        ><span v-if="activeVersion(segment, kind)" class="muted">{{
          formatTime(activeVersion(segment, kind)!.duration)
        }}</span>
      </div>
    </div>
    <div class="inspector-tabs" role="tablist" aria-label="句段编辑视图">
      <button
        v-for="t in [
          { id: 'script', label: '文稿与表现' },
          { id: 'review', label: '音画与评论' },
          { id: 'versions', label: '素材与任务' },
        ]"
        :key="t.id"
        role="tab"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <fieldset class="inspector-body" :disabled="busy || !segment.enabled">
      <template v-if="tab === 'script'">
        <label class="field"
          >朗读正文<textarea
            v-model="segment.text"
            rows="8"
            placeholder="写下这一句段想讲的内容…"
            @input="emit('dirty')"
          />
        </label>
        <div class="field-meta">
          <span>{{ segment.text.length }} 字</span
          ><button class="text-button" @click="copyText">
            <StudioIcon name="copy" :size="14" />复制正文
          </button>
        </div>
        <label class="field"
          >本句段表现与画面要求<textarea
            v-model="segment.direction"
            rows="3"
            placeholder="情绪、重音、语速、画面要求…"
            @input="emit('dirty')"
          />
        </label>
        <p class="hint">
          文稿、要求、素材和评论都归属于同一句段。要求不混入朗读正文。
        </p>
        <div class="section-divider"></div>
        <label class="field slider-label"
          >句段声音 <output>{{ Math.round(segment.gain * 100) }}%</output
          ><input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="segment.gain"
            @input="emit('dirty')"
            @change="emit('save')"
        /></label>
        <label class="field compact"
          >段后停顿<span class="input-unit"
            ><input
              type="number"
              min="0"
              max="10"
              step="0.1"
              v-model.number="segment.gap"
              @input="emit('dirty')"
              @change="emit('save')"
            />秒</span
          ></label
        >
        <p class="hint">
          在「音画与评论」用同一个播放进度审阅旁白和画面。目前按句段从零点对齐，精细剪辑时间线后续接入。
        </p>
      </template>
      <template v-else-if="tab === 'review'">
        <SegmentMediaPreview
          v-if="segment.enabled"
          :segment="segment"
          :master-gain="project.masterGain"
          @time="currentTime = $event.time"
        />
        <button
          class="secondary full approve-chapter"
          :disabled="
            busy ||
            !sources.length ||
            hasStale ||
            !!activeComments.length ||
            combinedChapterStatus(segment) === '已通过'
          "
          @click="approve"
        >
          <StudioIcon name="check" :size="16" />{{
            combinedChapterStatus(segment) === "已通过"
              ? "本句段已通过"
              : "标记本句段素材通过"
          }}
        </button>
        <p v-if="hasStale" class="inline-warning">
          文稿或表现要求已更新，请替换过期素材再验收。
        </p>
        <p v-if="activeComments.length" class="hint">
          当前素材还有 {{ activeComments.length }} 条未解决意见。
        </p>
        <div class="section-divider"></div>
        <div class="section-title">
          <h3>本句段评论</h3>
          <span class="muted">{{ formatTime(currentTime) }}</span>
        </div>
        <label class="field"
          >评论定位<select
            v-model="commentVersionId"
            :disabled="!sources.length"
          >
            <option v-if="!sources.length" value="">先添加素材</option>
            <option v-for="v in sources" :key="v.id" :value="v.id">
              {{ kindLabel(v.kind) }} · {{ v.name }}
            </option>
          </select></label
        >
        <textarea
          v-model="draft"
          aria-label="本句段评论"
          rows="3"
          placeholder="例如：这里的画面晚了半拍，或这句停顿太长。"
          :disabled="!selected"
          maxlength="2000"
        />
        <button
          class="secondary full"
          :disabled="busy || !draft.trim() || !selected"
          @click="comment"
        >
          <StudioIcon name="comment" :size="16" />添加评论
        </button>
        <p class="hint">
          所有意见集中在这里，保留具体素材版本和时间点。重新生成只处理对应素材。
        </p>
        <div
          v-for="c in segment.comments.slice().reverse()"
          :key="c.id"
          class="comment-item"
          :class="{ resolved: c.resolved }"
        >
          <div class="comment-meta">
            <span
              >{{ formatTime(c.time) }} ·
              {{ commentAsset(c) ? kindLabel(commentAsset(c)!.kind) : "素材" }}
              ·
              {{
                commentAsset(c) && isActive(commentAsset(c)!)
                  ? "当前版本"
                  : "历史版本"
              }}</span
            ><button class="text-button" @click="resolve(c)">
              {{ c.resolved ? "重新打开" : "标记解决" }}
            </button>
          </div>
          <p>{{ c.text }}</p>
          <button
            v-if="!c.resolved && commentAsset(c) && isActive(commentAsset(c)!)"
            class="text-button"
            @click="regenerate(c)"
          >
            按此评论重新生成 <StudioIcon name="arrow" :size="14" />
          </button>
        </div>
        <p v-if="!segment.comments.length" class="empty-copy">
          在同一节点里审阅声音与画面。
        </p>
      </template>
      <template v-else>
        <div class="section-title">
          <h3>本句段全部素材</h3>
          <span class="muted">{{ segment.versions.length }} 个版本</span>
        </div>
        <button
          v-for="v in segment.versions.slice().reverse()"
          :key="v.id"
          class="version-row"
          :class="{ active: isActive(v) }"
          @click="pickVersion(v)"
        >
          <StudioIcon :name="v.kind" :size="16" /><span
            ><strong>{{ v.name }}</strong
            ><small
              >{{ kindLabel(v.kind) }} · {{ formatTime(v.duration) }} ·
              {{ isActive(v) ? "已选用" : "点击选用"
              }}{{ isStale(v) ? " · 要求已更新" : "" }}</small
            ></span
          ><StudioIcon v-if="isActive(v)" name="check" :size="16" />
        </button>
        <p v-if="!segment.versions.length" class="empty-copy">
          导入旁白或画面，都会进入这个句段节点。
        </p>
        <div class="section-divider"></div>
        <label class="field"
          >绑定生成任务<select v-model="importJob">
            <option value="">导入独立素材</option>
            <option v-for="j in pending" :key="j.id" :value="j.id">
              {{ kindLabel(j.kind) }} ·
              {{ new Date(j.createdAt).toLocaleTimeString("zh-CN") }} ·
              {{ j.commentIds.length ? "评论返修" : "初次生成" }}
            </option>
          </select></label
        >
        <label class="secondary full file-button" :class="{ disabled: busy }"
          ><StudioIcon name="upload" />导入素材<input
            type="file"
            accept="audio/*,video/*"
            :disabled="busy"
            @change="upload"
        /></label>
        <p class="hint">
          自动识别音视频，保存在同一句段。任务过期的结果保留为历史版本。
        </p>
        <div class="section-title task-heading"><h3>本句段生成记录</h3></div>
        <div v-for="j in jobs.slice().reverse()" :key="j.id" class="job-row">
          <div>
            <span class="task-dot" :class="j.status"></span
            ><strong
              >{{ kindLabel(j.kind) }} ·
              {{
                j.status === "awaiting_external"
                  ? "等待外部生成"
                  : j.status === "completed"
                    ? "已导入结果"
                    : "已取消"
              }}</strong
            ><small
              >{{ new Date(j.createdAt).toLocaleString("zh-CN") }} ·
              {{ j.commentIds.length }} 条意见</small
            >
          </div>
          <button
            v-if="j.status === 'awaiting_external'"
            class="text-button"
            @click="emit('cancel', j.id)"
          >
            取消
          </button>
        </div>
        <p v-if="!jobs.length" class="empty-copy">
          创建任务后导出交接清单，外部执行完成再回填到本句段。
        </p>
      </template>
    </fieldset>
    <div class="inspector-footer">
      <div class="generation-actions">
        <button
          class="primary"
          :disabled="busy || !segment.enabled || !segment.text.trim()"
          @click="queue('audio')"
        >
          <StudioIcon name="audio" :size="16" />生成旁白</button
        ><button
          class="secondary"
          :disabled="busy || !segment.enabled || !segment.text.trim()"
          @click="queue('video')"
        >
          <StudioIcon name="video" :size="16" />生成画面
        </button>
      </div>
      <small>同一句段 · 外部生成任务交接</small>
    </div>
  </aside>
</template>

<style scoped>
.segment-actions { display: flex; align-items: center; gap: 14px; margin: 12px 0; }
</style>
