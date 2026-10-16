<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import type { MediaKind, Project } from "../domain/types";
import {
  selectedVersion,
  volume,
  claimPlayback,
  releasePlayback,
} from "../services/media";
const props = defineProps<{ project: Project; kind: MediaKind }>();
const emit = defineEmits<{
  select: [string];
  time: [{ chapterId: string; time: number; versionId: string }];
}>();
const items = computed(() =>
  props.project.chapters.flatMap((chapter) => {
    const version = selectedVersion(chapter, props.kind);
    return version ? [{ chapter, version }] : [];
  }),
);
const missing = computed(
  () => props.project.chapters.length - items.value.length,
);
const stale = computed(
  () =>
    items.value.filter(
      ({ chapter, version }) =>
        chapter.text !== version.textSnapshot ||
        (version.directionSnapshot !== undefined &&
          chapter.direction !== version.directionSnapshot),
    ).length,
);
const unapproved = computed(
  () =>
    items.value.filter(
      ({ chapter, version }) =>
        !chapter.approvedVersionIds.includes(version.id),
    ).length,
);
const index = ref(0);
const current = computed(() => items.value[index.value]);
const media = ref<HTMLMediaElement | null>(null);
const playing = ref(false);
const position = ref(0);
const duration = ref(0);
const gapLeft = ref(0);
const error = ref("");
let timer: ReturnType<typeof setInterval> | undefined;
let gapTick = 0;
let playRequest = 0;
const owner = Symbol("sequence-player");
const fmt = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function clearTimer() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
function pause() {
  playRequest++;
  playing.value = false;
  media.value?.pause();
  clearTimer();
  releasePlayback(owner);
}
function mediaPaused(event: Event) {
  if (
    event.target === media.value &&
    media.value?.paused &&
    !media.value.ended &&
    gapLeft.value <= 0
  )
    pause();
}
function stop() {
  pause();
  gapLeft.value = 0;
  position.value = 0;
  index.value = 0;
  error.value = "";
  if (media.value) media.value.currentTime = 0;
  duration.value = current.value?.version.duration ?? 0;
}
function report(event?: Event) {
  if (event && event.target !== media.value) return;
  position.value = media.value?.currentTime ?? 0;
  if (current.value)
    emit("time", {
      chapterId: current.value.chapter.id,
      time: position.value,
      versionId: current.value.version.id,
    });
}
function applyVolume() {
  if (media.value && current.value)
    media.value.volume =
      volume(current.value.chapter.gain) * volume(props.project.masterGain);
}
async function play() {
  if (!current.value) return;
  error.value = "";
  claimPlayback(owner, pause);
  playing.value = true;
  const request = ++playRequest;
  emit("select", current.value.chapter.id);
  if (gapLeft.value > 0) {
    startGap();
    return;
  }
  await nextTick();
  if (request !== playRequest) return;
  applyVolume();
  try {
    await media.value?.play();
  } catch {
    if (request === playRequest) {
      pause();
      error.value = "播放失败，请检查媒体格式或再次点击播放。";
    }
  }
}
async function choose(next: number, autoplay = playing.value) {
  pause();
  gapLeft.value = 0;
  position.value = 0;
  duration.value = 0;
  index.value = next;
  await nextTick();
  if (current.value) emit("select", current.value.chapter.id);
  if (autoplay) await play();
}
function startGap() {
  clearTimer();
  gapTick = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    gapLeft.value = Math.max(0, gapLeft.value - (now - gapTick) / 1000);
    gapTick = now;
    if (gapLeft.value <= 0) {
      clearTimer();
      void choose(index.value + 1, true);
    }
  }, 50);
}
function ended(event: Event) {
  if (event.target !== media.value || !playing.value) return;
  if (index.value >= items.value.length - 1) {
    playing.value = false;
    releasePlayback(owner);
    return;
  }
  gapLeft.value = Math.max(0, current.value?.chapter.gap ?? 0);
  if (gapLeft.value) startGap();
  else void choose(index.value + 1, true);
}
function seek(event: Event) {
  if (!media.value) return;
  gapLeft.value = 0;
  clearTimer();
  media.value.currentTime = Number((event.target as HTMLInputElement).value);
  report();
  if (playing.value) void play();
}
function loaded() {
  duration.value = Number.isFinite(media.value?.duration)
    ? media.value!.duration
    : 0;
  applyVolume();
}
watch(
  () =>
    `${props.kind}:${props.project.id}:${props.project.chapters.map((chapter) => `${chapter.id}:${selectedVersion(chapter, props.kind)?.id ?? "-"}`).join("|")}`,
  stop,
);
watch(
  [media, () => current.value?.chapter.gain, () => props.project.masterGain],
  applyVolume,
  { flush: "post" },
);
onBeforeUnmount(pause);
</script>
<template>
  <section class="sequence-player" aria-label="章节连续试听">
    <div class="sequence-heading">
      <strong>全片{{ kind === "audio" ? "审听" : "预览" }}</strong
      ><span>{{ items.length }} / {{ project.chapters.length }} 章可播放</span>
    </div>
    <p v-if="missing || stale || unapproved" class="notice" role="status">
      <span v-if="missing">{{ missing }} 章缺少素材，试听将跳过。 </span
      ><span v-if="stale">{{ stale }} 章对应旧文稿或表演要求。 </span
      ><span v-if="unapproved">{{ unapproved }} 章尚未通过审听。</span>
    </p>
    <component
      :is="kind === 'video' ? 'video' : 'audio'"
      v-if="current"
      :key="current.version.id"
      ref="media"
      :src="current.version.url"
      preload="metadata"
      playsinline
      @pause="mediaPaused"
      @loadedmetadata="loaded"
      @timeupdate="report"
      @ended="ended"
      @error="
        pause();
        error = '媒体读取失败，连续播放已暂停，请检查当前章节素材。';
      "
    />
    <div class="transport">
      <button
        type="button"
        :disabled="!items.length || index === 0"
        aria-label="上一章"
        @click="choose(index - 1)"
      >
        ←
      </button>
      <button
        type="button"
        class="play"
        :disabled="!items.length"
        @click="playing ? pause() : play()"
      >
        {{ playing ? "暂停" : "播放" }}
      </button>
      <button type="button" :disabled="!items.length" @click="stop">
        停止
      </button>
      <button
        type="button"
        :disabled="!items.length || index >= items.length - 1"
        aria-label="下一章"
        @click="choose(index + 1)"
      >
        →
      </button>
      <span class="current-title">{{
        current?.chapter.title ?? "等待导入素材"
      }}</span>
      <span class="clock">{{
        gapLeft > 0
          ? `停顿 ${gapLeft.toFixed(1)}s`
          : `${fmt(position)} / ${fmt(duration)}`
      }}</span>
    </div>
    <input
      aria-label="当前章节进度"
      type="range"
      min="0"
      :max="duration || 0"
      step="0.1"
      :value="position"
      :disabled="!duration"
      @input="seek"
    />
    <div v-if="items.length > 1" class="chapter-jumps">
      <button
        v-for="(item, i) in items"
        :key="item.chapter.id"
        type="button"
        :class="{ active: i === index }"
        @click="choose(i)"
      >
        {{ i + 1 }}. {{ item.chapter.title }}
      </button>
    </div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.sequence-player {
  padding: 0;
  background: var(--color-surface);
}
.sequence-heading,
.transport {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sequence-heading {
  justify-content: space-between;
  margin-bottom: 10px;
}
.sequence-heading span,
.clock {
  font-size: 12px;
  color: var(--color-muted);
}
.sequence-player video {
  width: 100%;
  max-height: 300px;
  background: #12171a;
  border-radius: 10px;
  margin-bottom: 10px;
}
.sequence-player audio {
  display: none;
}
.transport {
  flex-wrap: wrap;
}
button {
  border: 1px solid var(--color-line);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 7px 10px;
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
.play,
.chapter-jumps .active {
  background: var(--color-accent);
  color: #fff;
  border-color: transparent;
}
.current-title {
  flex: 1;
  font-size: 13px;
  min-width: 110px;
}
input[type="range"] {
  width: 100%;
  margin: 12px 0 3px;
  accent-color: var(--color-accent);
}
.notice {
  color: var(--color-warning);
  font-size: 12px;
  line-height: 1.6;
  margin: 6px 0 12px;
}
.chapter-jumps {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}
.chapter-jumps button {
  font-size: 11px;
  padding: 5px 8px;
}
</style>
