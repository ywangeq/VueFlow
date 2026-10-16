<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import type { Project } from "../domain/types";
import {
  selectedVersion,
  claimPlayback,
  releasePlayback,
} from "../services/media";
import ChapterMediaPreview from "./ChapterMediaPreview.vue";
const props = defineProps<{ project: Project }>();
const emit = defineEmits<{
  select: [string];
  time: [{ chapterId: string; time: number; versionId: string }];
}>();
const items = computed(() =>
  props.project.chapters.filter(
    (chapter) =>
      selectedVersion(chapter, "audio") || selectedVersion(chapter, "video"),
  ),
);
const missing = computed(
  () => props.project.chapters.length - items.value.length,
);
const missingAudio = computed(
  () =>
    props.project.chapters.filter(
      (chapter) => !selectedVersion(chapter, "audio"),
    ).length,
);
const missingVideo = computed(
  () =>
    props.project.chapters.filter(
      (chapter) => !selectedVersion(chapter, "video"),
    ).length,
);
const stale = computed(
  () =>
    items.value.filter((chapter) =>
      ["audio", "video"].some((kind) => {
        const version = selectedVersion(chapter, kind as "audio" | "video");
        return (
          version &&
          (version.textSnapshot !== chapter.text ||
            (version.directionSnapshot !== undefined &&
              version.directionSnapshot !== chapter.direction))
        );
      }),
    ).length,
);
const index = ref(0),
  playing = ref(false),
  gapLeft = ref(0);
const current = computed(() => items.value[index.value]);
const preview = ref<InstanceType<typeof ChapterMediaPreview> | null>(null);
const owner = Symbol("sequence-gap");
let timer: ReturnType<typeof setInterval> | undefined,
  tick = 0;
let transition = 0;
function clearTimer() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
function pause() {
  transition++;
  playing.value = false;
  clearTimer();
  releasePlayback(owner);
  preview.value?.pause();
}
async function play() {
  if (!current.value) return;
  playing.value = true;
  emit("select", current.value.id);
  if (gapLeft.value > 0) {
    startGap();
    return;
  }
  releasePlayback(owner);
  await preview.value?.play();
}
function stop() {
  pause();
  gapLeft.value = 0;
  index.value = 0;
  preview.value?.stop();
}
async function choose(next: number, autoplay = playing.value) {
  pause();
  gapLeft.value = 0;
  index.value = next;
  const token = transition;
  await nextTick();
  if (token !== transition) return;
  if (current.value) emit("select", current.value.id);
  if (autoplay) void play();
}
function startGap() {
  clearTimer();
  claimPlayback(owner, pause);
  tick = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    gapLeft.value = Math.max(0, gapLeft.value - (now - tick) / 1000);
    tick = now;
    if (!gapLeft.value) {
      clearTimer();
      releasePlayback(owner);
      void choose(index.value + 1, true);
    }
  }, 50);
}
function ended() {
  if (index.value >= items.value.length - 1) {
    playing.value = false;
    return;
  }
  playing.value = true;
  gapLeft.value = Math.max(0, current.value?.gap ?? 0);
  if (gapLeft.value) startGap();
  else void choose(index.value + 1, true);
}
function transportStarting() {
  clearTimer();
  releasePlayback(owner);
  gapLeft.value = 0;
}
function transportPlaying(value: boolean) {
  playing.value = value;
  if (!value) {
    clearTimer();
    releasePlayback(owner);
  } else {
    gapLeft.value = 0;
    clearTimer();
    releasePlayback(owner);
    if (current.value) emit("select", current.value.id);
  }
}
watch(
  () =>
    `${props.project.id}:${props.project.chapters.map((chapter) => `${chapter.id}:${chapter.activeAudioId}:${chapter.activeVideoId}`).join("|")}`,
  stop,
);
onBeforeUnmount(pause);
</script>
<template>
  <section class="sequence-player" aria-label="全文章节音视频预览">
    <div class="sequence-status">
      <span>{{ items.length }} / {{ project.chapters.length }} 章可播放</span
      ><span>旁白与画面共用章节顺序</span>
    </div>
    <p
      v-if="missing || missingAudio || missingVideo || stale"
      class="notice"
      role="status"
    >
      <span v-if="missing">{{ missing }} 章暂无素材，连播时跳过。 </span
      ><span v-if="missingAudio">{{ missingAudio }} 章未添加旁白。 </span
      ><span v-if="missingVideo">{{ missingVideo }} 章未添加画面。 </span
      ><span v-if="stale">{{ stale }} 章素材对应旧文稿或表演要求。</span>
    </p>
    <div class="chapter-transport">
      <button
        type="button"
        :disabled="!items.length || index === 0"
        aria-label="上一章"
        @click="choose(index - 1)"
      >
        ←</button
      ><strong>{{ current?.title ?? "等待导入素材" }}</strong
      ><button
        type="button"
        :disabled="!items.length || index >= items.length - 1"
        aria-label="下一章"
        @click="choose(index + 1)"
      >
        →
      </button>
    </div>
    <ChapterMediaPreview
      v-if="current"
      :key="current.id"
      ref="preview"
      :chapter="current"
      :master-gain="project.masterGain"
      compact
      @starting="transportStarting"
      @playing="transportPlaying"
      @ended="ended"
      @time="emit('time', $event)"
    />
    <div v-if="gapLeft > 0" class="gap-transport">
      <span>章节间停顿 · {{ gapLeft.toFixed(1) }}s</span
      ><button type="button" @click="playing ? pause() : play()">
        {{ playing ? "暂停" : "继续" }}</button
      ><button type="button" @click="stop">停止</button>
    </div>
    <div v-if="items.length > 1" class="chapter-jumps">
      <button
        v-for="(chapter, i) in items"
        :key="chapter.id"
        type="button"
        :class="{ active: i === index }"
        @click="choose(i)"
      >
        {{ i + 1 }}. {{ chapter.title }}
      </button>
    </div>
  </section>
</template>
<style scoped>
.sequence-status {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--color-muted);
  font-size: 11px;
}
.notice {
  color: var(--color-warning);
  font-size: 11px;
  line-height: 1.8;
  margin: 10px 0;
}
.chapter-transport {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
}
.chapter-transport strong {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
}
.chapter-jumps,
.gap-transport {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.gap-transport {
  align-items: center;
  font-size: 12px;
  color: var(--color-muted);
}
button {
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: inherit;
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 11px;
}
button:disabled {
  opacity: 0.4;
}
.chapter-jumps .active {
  background: var(--color-accent);
  color: #fff;
  border-color: transparent;
}
</style>
