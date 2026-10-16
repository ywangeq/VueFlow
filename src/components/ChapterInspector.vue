<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  Chapter,
  MediaKind,
  Project,
  ReviewComment,
} from "../domain/types";
import {
  activeVersion,
  chapterStatus,
  formatTime,
  uid,
} from "../domain/project";
import AssetPreview from "./AssetPreview.vue";
import StudioIcon from "./StudioIcon.vue";
const props = defineProps<{
  chapter: Chapter;
  project: Project;
  kind: MediaKind;
  busy: boolean;
  playhead: { chapterId: string; time: number; versionId: string } | null;
}>();
const emit = defineEmits<{
  dirty: [];
  save: [];
  upload: [file: File, jobId?: string];
  queue: [commentIds: string[]];
  cancel: [jobId: string];
  notice: [text: string];
}>();
const tab = ref("script"),
  draft = ref(""),
  currentTime = ref(0),
  importJob = ref("");
const selected = computed(() => activeVersion(props.chapter, props.kind));
const jobs = computed(() =>
  props.project.jobs.filter(
    (j) => j.chapterId === props.chapter.id && j.kind === props.kind,
  ),
);
const visibleComments = computed(() =>
  props.chapter.comments.filter((c) =>
    props.chapter.versions.some(
      (v) => v.id === c.versionId && v.kind === props.kind,
    ),
  ),
);
const pending = computed(() =>
  jobs.value.filter((j) => j.status === "awaiting_external"),
);
const stale = computed(
  () =>
    !!selected.value &&
    (selected.value.textSnapshot !== props.chapter.text ||
      (selected.value.directionSnapshot !== undefined &&
        selected.value.directionSnapshot !== props.chapter.direction)),
);
watch(
  () => pending.value.map((j) => j.id).join("|"),
  () => {
    if (importJob.value && !pending.value.some((j) => j.id === importJob.value))
      importJob.value = "";
  },
);
const label = computed(() => (props.kind === "audio" ? "音频" : "视频"));
watch(
  () => props.chapter.id,
  () => {
    draft.value = "";
    currentTime.value = 0;
    importJob.value = "";
    tab.value = "script";
  },
);
watch(
  () => props.kind,
  () => {
    currentTime.value = 0;
    importJob.value = "";
  },
);
watch(
  () => selected.value?.id,
  () => {
    currentTime.value = 0;
  },
);
watch(
  () => props.playhead,
  (p) => {
    if (p?.chapterId === props.chapter.id && p.versionId === selected.value?.id)
      currentTime.value = p.time;
  },
);
function pickVersion(id: string) {
  if (props.kind === "audio") props.chapter.activeAudioId = id;
  else props.chapter.activeVideoId = id;
  emit("dirty");
  emit("save");
}
function approve() {
  const v = selected.value;
  if (!v || stale.value) return;
  if (!props.chapter.approvedVersionIds.includes(v.id))
    props.chapter.approvedVersionIds.push(v.id);
  emit("dirty");
  emit("save");
}
function comment() {
  if (!draft.value.trim() || !selected.value) return;
  props.chapter.comments.push({
    id: uid(),
    text: draft.value.trim(),
    versionId: selected.value.id,
    time: currentTime.value,
    createdAt: new Date().toISOString(),
    resolved: false,
  });
  draft.value = "";
  emit("dirty");
  emit("save");
}
function resolve(c: ReviewComment) {
  c.resolved = !c.resolved;
  emit("dirty");
  emit("save");
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit("upload", file, importJob.value || undefined);
  input.value = "";
}
async function copyText() {
  try {
    await navigator.clipboard.writeText(props.chapter.text);
    emit("notice", "文稿已复制，可前往 MiniMax 网页生成。");
  } catch {
    emit("notice", "无法读取剪贴板权限，请从文稿框选中复制。");
  }
}
</script>
<template>
  <aside class="inspector" aria-label="章节编辑与审听">
    <div class="inspector-heading">
      <span class="eyebrow">章节详情</span
      ><span class="status-pill" :data-status="chapterStatus(chapter, kind)">{{
        chapterStatus(chapter, kind)
      }}</span>
    </div>
    <input
      class="chapter-title"
      aria-label="章节名称"
      v-model="chapter.title"
      :disabled="busy"
      maxlength="120"
      @input="emit('dirty')"
    />
    <div class="inspector-tabs" role="tablist" aria-label="章节编辑视图">
      <button
        v-for="t in [
          { id: 'script', label: '文稿与表现' },
          { id: 'review', label: '试听与评论' },
          { id: 'versions', label: '版本与任务' },
        ]"
        :key="t.id"
        role="tab"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <fieldset class="inspector-body" :disabled="busy">
      <template v-if="tab === 'script'">
        <label class="field"
          >朗读正文<textarea
            v-model="chapter.text"
            rows="9"
            placeholder="写下这一章想讲的内容…"
            @input="emit('dirty')"
          />
        </label>
        <div class="field-meta">
          <span>{{ chapter.text.length }} 字</span
          ><button class="text-button" @click="copyText">
            <StudioIcon name="copy" :size="14" />复制正文
          </button>
        </div>
        <label class="field"
          >表现要求<textarea
            v-model="chapter.direction"
            rows="3"
            placeholder="情绪、重音、语速、画面要求…"
            @input="emit('dirty')"
          />
        </label>
        <p class="hint">表现要求单独保存，不会混进朗读正文。</p>
        <div class="section-divider"></div>
        <label class="field slider-label"
          >章节音量 <output>{{ Math.round(chapter.gain * 100) }}%</output
          ><input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="chapter.gain"
            @input="emit('dirty')"
            @change="emit('save')"
        /></label>
        <label class="field compact"
          >段后停顿
          <span class="input-unit"
            ><input
              type="number"
              min="0"
              max="10"
              step="0.1"
              v-model.number="chapter.gap"
              @input="emit('dirty')"
              @change="emit('save')"
            />秒</span
          ></label
        >
        <p class="hint">音量与停顿用于本地试听和音频合成，无需重新生成。</p>
      </template>
      <template v-else-if="tab === 'review'">
        <AssetPreview
          :version="selected"
          :gain="chapter.gain"
          :master-gain="project.masterGain"
          @time="currentTime = $event"
          @error="emit('notice', $event)"
        />
        <div v-if="selected" class="review-actions">
          <span class="muted">{{ selected.name }}</span
          ><button
            class="secondary small"
            :disabled="
              busy || stale || chapter.approvedVersionIds.includes(selected.id)
            "
            @click="approve"
          >
            <StudioIcon name="check" :size="15" />{{
              chapter.approvedVersionIds.includes(selected.id)
                ? "已通过"
                : "标记通过"
            }}
          </button>
        </div>
        <p v-if="selected && stale" class="inline-warning">
          文稿或表现要求已修改，这个版本对应旧要求。请生成新版后再验收。
        </p>
        <div class="section-divider"></div>
        <div class="section-title">
          <h3>审听评论</h3>
          <span class="muted">{{ formatTime(currentTime) }}</span>
        </div>
        <textarea
          v-model="draft"
          aria-label="审听评论"
          rows="3"
          placeholder="例如：这句停顿长一点，最后的问句再自然一些。"
          :disabled="!selected"
          maxlength="2000"
        />
        <button
          class="secondary full"
          :disabled="busy || !draft.trim() || !selected"
          @click="comment"
        >
          <StudioIcon name="comment" :size="16" />添加到当前版本
        </button>
        <p class="hint">评论绑定当前版本和时间点；点击重新生成才创建任务。</p>
        <div
          v-for="c in [...visibleComments].reverse()"
          :key="c.id"
          class="comment-item"
          :class="{ resolved: c.resolved }"
        >
          <div class="comment-meta">
            <span
              >{{ formatTime(c.time) }} ·
              {{ c.versionId === selected?.id ? "当前版本" : "历史版本" }}</span
            ><button class="text-button" :disabled="busy" @click="resolve(c)">
              {{ c.resolved ? "重新打开" : "标记解决" }}
            </button>
          </div>
          <p>{{ c.text }}</p>
          <button
            v-if="!c.resolved && c.versionId === selected?.id"
            class="text-button"
            :disabled="busy"
            @click="emit('queue', [c.id])"
          >
            按此评论重新生成 <StudioIcon name="arrow" :size="14" />
          </button>
        </div>
        <p v-if="!visibleComments.length" class="empty-copy">
          听到问题，直接在这里留下修改意见。
        </p>
      </template>
      <template v-else>
        <div class="section-title">
          <h3>{{ label }}版本</h3>
          <span class="muted"
            >{{
              chapter.versions.filter((v) => v.kind === kind).length
            }}
            个</span
          >
        </div>
        <button
          v-for="(v, index) in chapter.versions
            .filter((v) => v.kind === kind)
            .slice()
            .reverse()"
          :key="v.id"
          class="version-row"
          :class="{ active: v.id === selected?.id }"
          :disabled="busy"
          @click="pickVersion(v.id)"
        >
          <span
            ><strong>{{ v.name }}</strong
            ><small
              >{{ formatTime(v.duration) }} ·
              {{
                chapter.approvedVersionIds.includes(v.id) ? "已通过" : "待试听"
              }}{{ v.textSnapshot !== chapter.text ? " · 旧稿" : "" }}</small
            ></span
          ><StudioIcon v-if="v.id === selected?.id" name="check" />
        </button>
        <p
          v-if="!chapter.versions.some((v) => v.kind === kind)"
          class="empty-copy"
        >
          还没有{{ label }}，可以先导入已有素材。
        </p>
        <div class="section-divider"></div>
        <label class="field"
          >绑定生成任务<select v-model="importJob">
            <option value="">导入独立素材</option>
            <option v-for="j in pending" :key="j.id" :value="j.id">
              {{ new Date(j.createdAt).toLocaleTimeString("zh-CN") }} ·
              {{ j.commentIds.length ? "评论返修" : "初次生成" }}
            </option>
          </select></label
        >
        <label class="secondary full file-button" :class="{ disabled: busy }"
          ><StudioIcon name="upload" />导入{{ label }}结果<input
            type="file"
            :accept="kind === 'audio' ? 'audio/*' : 'video/*'"
            :disabled="busy"
            @change="upload"
        /></label>
        <p class="hint">
          文件保存在本机。绑定任务时会保留其文稿快照；过期结果不会自动替换当前版本。
        </p>
        <div class="section-title task-heading">
          <h3>生成记录</h3>
          <span class="muted">{{
            kind === "audio" ? "MiniMax 网页交接" : "外部视频制作"
          }}</span>
        </div>
        <div v-for="j in jobs.slice().reverse()" :key="j.id" class="job-row">
          <div>
            <span class="task-dot" :class="j.status"></span
            ><strong>{{
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
            :disabled="busy"
            @click="emit('cancel', j.id)"
          >
            取消
          </button>
        </div>
        <p v-if="!jobs.length" class="empty-copy">
          创建任务后，可导出交接清单给 Codex 执行，再导入结果。
        </p>
      </template>
    </fieldset>
    <div class="inspector-footer">
      <button
        class="primary full"
        :disabled="busy || !chapter.text.trim()"
        @click="
          emit(
            'queue',
            chapter.comments
              .filter((c) => !c.resolved && c.versionId === selected?.id)
              .map((c) => c.id),
          )
        "
      >
        <StudioIcon :name="kind === 'audio' ? 'audio' : 'video'" />{{
          selected ? "创建返修任务" : "创建生成任务"
        }}</button
      ><small
        >{{ kind === "audio" ? "MiniMax 网页生成" : "视频素材外部制作" }} ·
        当前为交接模式</small
      >
    </div>
  </aside>
</template>
