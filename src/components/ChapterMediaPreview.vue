<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from "vue";
import type { Chapter } from "../domain/types";
import {
  chapterPlayback,
  volume,
  claimPlayback,
  releasePlayback,
  waitForMediaReady,
  syncChapterMedia,
} from "../services/media";
const props = defineProps<{
  chapter: Chapter;
  masterGain: number;
  compact?: boolean;
}>();
const emit = defineEmits<{
  time: [{ chapterId: string; time: number; versionId: string }];
  playing: [boolean];
  starting: [];
  ended: [];
}>();
const plan = computed(() => chapterPlayback(props.chapter));
const audioVersion = computed(() => plan.value.audio);
const videoVersion = computed(() => plan.value.video);
const audio = ref<HTMLAudioElement | null>(null),
  video = ref<HTMLVideoElement | null>(null);
const audioDuration = ref(0),
  videoDuration = ref(0);
const duration = computed(() =>
  Math.max(
    audioDuration.value || audioVersion.value?.duration || 0,
    videoDuration.value || videoVersion.value?.duration || 0,
  ),
);
const available = computed(() => !!(audioVersion.value || videoVersion.value));
const playing = ref(false),
  position = ref(0),
  error = ref("");
const owner = Symbol("chapter-media");
let interval: ReturnType<typeof setInterval> | undefined;
let request = 0;
let pendingReady: AbortController | null = null;
const format = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
function clearClock() {
  if (interval) clearInterval(interval);
  interval = undefined;
}
function setVolumes() {
  const gain = volume(props.chapter.gain) * volume(props.masterGain);
  if (audio.value) audio.value.volume = gain;
  if (video.value) {
    video.value.muted = !!audioVersion.value;
    video.value.volume = gain;
  }
}
function publish() {
  const version =
    audioVersion.value &&
    position.value <= (audioDuration.value || audioVersion.value.duration)
      ? audioVersion.value
      : videoVersion.value || audioVersion.value;
  if (version)
    emit("time", {
      chapterId: props.chapter.id,
      time: Math.min(
        position.value,
        version.kind === "audio"
          ? audioDuration.value || version.duration
          : videoDuration.value || version.duration,
      ),
      versionId: version.id,
    });
}
function pause(notify = true) {
  request++;
  pendingReady?.abort();
  pendingReady = null;
  playing.value = false;
  clearClock();
  audio.value?.pause();
  video.value?.pause();
  releasePlayback(owner);
  if (notify) emit("playing", false);
}
function seek(seconds: number) {
  position.value = Math.max(0, Math.min(duration.value, seconds));
  for (const element of [audio.value, video.value])
    if (element && Number.isFinite(element.duration)) {
      element.currentTime = Math.min(position.value, element.duration);
      if (position.value >= element.duration) element.pause();
    }
  publish();
}
function stop() {
  pause();
  seek(0);
}
function tick(event?: Event) {
  if (event && event.target !== audio.value && event.target !== video.value)
    return;
  if (!playing.value) return;
  position.value = Math.min(
    duration.value,
    syncChapterMedia(audio.value, video.value),
  );
  publish();
  const elements = [audio.value, video.value].filter(
    (element): element is HTMLMediaElement => !!element,
  );
  for (const element of elements)
    if (element.paused && position.value < element.duration - 0.02) {
      const token = request;
      void element.play().catch(() => {
        if (token === request) {
          pause();
          error.value = "媒体无法继续同步播放，请重新导入素材。";
        }
      });
    }
  if (
    position.value >= duration.value - 0.02 ||
    elements.every((element) => element.ended)
  ) {
    position.value = duration.value;
    publish();
    pause(false);
    emit("ended");
  }
}
async function play() {
  if (!available.value) return;
  emit("starting");
  if (position.value >= duration.value - 0.02) seek(0);
  claimPlayback(owner, pause);
  const token = ++request;
  error.value = "";
  playing.value = true;
  await nextTick();
  if (token !== request) return;
  setVolumes();
  const elements = [audio.value, video.value].filter(
    (element): element is HTMLMediaElement =>
      !!element &&
      (!Number.isFinite(element.duration) || position.value < element.duration),
  );
  pendingReady?.abort();
  const controller = new AbortController();
  pendingReady = controller;
  try {
    // Await both sources before either can audibly move off the shared start/seek point.
    await Promise.all(
      elements.map((element) => waitForMediaReady(element, controller.signal)),
    );
    if (token !== request) return;
    for (const element of elements)
      if (Math.abs(element.currentTime - position.value) > 0.005)
        element.currentTime = position.value;
    await Promise.all(
      elements.map((element) => waitForMediaReady(element, controller.signal)),
    );
    if (token !== request) return;
    const results = await Promise.allSettled(
      elements.map((element) => element.play()),
    );
    if (token !== request) return;
    if (results.some((result) => result.status === "rejected"))
      throw new Error("播放失败，请检查素材格式并再次点击播放。");
    // A browser may resolve video.play() before audio.play(); align to narration once both started.
    position.value = syncChapterMedia(audio.value, video.value, 0);
    clearClock();
    interval = setInterval(tick, 40);
    emit("playing", true);
  } catch (cause) {
    if (token !== request) return;
    pause();
    error.value = cause instanceof Error ? cause.message : "媒体播放失败。";
  } finally {
    if (pendingReady === controller) pendingReady = null;
    controller.abort();
  }
}
function scrub(event: Event) {
  const resume = playing.value;
  pause(false);
  seek(Number((event.target as HTMLInputElement).value));
  if (resume && position.value < duration.value) void play();
  else emit("playing", false);
}
function loaded(kind: "audio" | "video") {
  const element = kind === "audio" ? audio.value : video.value;
  if (element && Number.isFinite(element.duration)) {
    if (kind === "audio") audioDuration.value = element.duration;
    else videoDuration.value = element.duration;
    if (position.value > 0)
      element.currentTime = Math.min(position.value, element.duration);
  }
  setVolumes();
}
function failed(event: Event) {
  if (event.target !== audio.value && event.target !== video.value) return;
  pause();
  error.value = "媒体读取失败，请检查文件是否存在或更换浏览器支持的格式。";
}
watch(
  () =>
    `${props.chapter.id}:${audioVersion.value?.id}:${videoVersion.value?.id}`,
  () => {
    pause();
    position.value = 0;
    audioDuration.value = 0;
    videoDuration.value = 0;
    error.value = "";
  },
);
watch(
  [audio, video, () => props.chapter.gain, () => props.masterGain],
  setVolumes,
  { flush: "post" },
);
onBeforeUnmount(() => pause(false));
defineExpose({ play, pause, stop, seek });
</script>
<template>
  <div class="chapter-media-preview" :class="{ compact }">
    <video
      v-if="videoVersion"
      :key="videoVersion.id"
      ref="video"
      data-media-role="chapter-video"
      :src="videoVersion.url"
      :muted="!!audioVersion"
      preload="auto"
      playsinline
      @loadedmetadata="loaded('video')"
      @ended="tick"
      @error="failed"
    />
    <audio
      v-if="audioVersion"
      :key="audioVersion.id"
      ref="audio"
      data-media-role="chapter-audio"
      :src="audioVersion.url"
      preload="auto"
      @loadedmetadata="loaded('audio')"
      @ended="tick"
      @error="failed"
    />
    <div v-if="!available" class="empty">导入本章音频或视频，开始预览。</div>
    <div v-else class="source-note">
      {{
        audioVersion && videoVersion
          ? "音频 + 视频同步预览 · 视频原声已静音"
          : audioVersion
            ? "音频预览 · 本章暂无视频"
            : "视频预览 · 使用视频原声"
      }}
    </div>
    <div class="track-strip" aria-label="同起点音视频轨道">
      <div class="track-row">
        <span>旁白</span>
        <div class="track-lane">
          <div
            v-if="audioVersion"
            class="track-clip audio-clip"
            :style="{
              width: `${duration ? ((audioDuration || audioVersion.duration) / duration) * 100 : 0}%`,
            }"
          >
            {{ format(audioDuration || audioVersion.duration) }}
          </div>
          <small v-else>未添加</small
          ><i
            :style="{ left: `${duration ? (position / duration) * 100 : 0}%` }"
          ></i>
        </div>
      </div>
      <div class="track-row">
        <span>画面</span>
        <div class="track-lane">
          <div
            v-if="videoVersion"
            class="track-clip video-clip"
            :style="{
              width: `${duration ? ((videoDuration || videoVersion.duration) / duration) * 100 : 0}%`,
            }"
          >
            {{ format(videoDuration || videoVersion.duration) }}
          </div>
          <small v-else>未添加</small
          ><i
            :style="{ left: `${duration ? (position / duration) * 100 : 0}%` }"
          ></i>
        </div>
      </div>
      <div class="track-scale">
        <span>0:00</span><span>{{ format(duration) }}</span>
      </div>
    </div>
    <div class="controls">
      <button
        type="button"
        :disabled="!available"
        class="play"
        @click="playing ? pause() : play()"
      >
        {{ playing ? "暂停" : "播放" }}</button
      ><button type="button" :disabled="!available" @click="stop">停止</button
      ><span class="clock"
        >{{ format(position) }} / {{ format(duration) }}</span
      >
    </div>
    <input
      type="range"
      aria-label="本章音视频共同进度"
      min="0"
      :max="duration || 0"
      step="0.1"
      :value="position"
      :disabled="!duration"
      @input="scrub"
    />
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </div>
</template>
<style scoped>
audio {
  display: none;
}
video {
  width: 100%;
  max-height: 270px;
  background: #12171a;
  border-radius: 10px;
  margin-bottom: 10px;
}
.source-note,
.empty,
.clock {
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.7;
}
.source-note {
  margin-bottom: 10px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clock {
  margin-left: auto;
}
button {
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  padding: 6px 12px;
  color: inherit;
}
button:disabled {
  opacity: 0.4;
}
.play {
  background: var(--color-accent);
  color: #fff;
  border-color: transparent;
}
input {
  width: 100%;
  accent-color: var(--color-accent);
  margin: 12px 0 0;
}
.error {
  font-size: 12px;
  color: var(--color-danger);
}
.compact video {
  max-height: 280px;
}
.track-strip {
  margin: 12px 0;
}
.track-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 5px 0;
}
.track-row > span {
  font-size: 10px;
  color: var(--color-muted);
  width: 26px;
}
.track-lane {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 23px;
  background: var(--color-soft);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  overflow: hidden;
}
.track-clip {
  height: 100%;
  min-width: 2px;
  font-size: 10px;
  padding: 3px 6px;
  white-space: nowrap;
  overflow: hidden;
}
.audio-clip {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.video-clip {
  background: var(--color-success-soft);
  color: var(--color-success);
}
.track-lane small {
  font-size: 10px;
  color: var(--color-faint);
  padding-left: 6px;
}
.track-lane i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-text);
  pointer-events: none;
  transform: translateX(-1px);
}
.track-scale {
  display: flex;
  justify-content: space-between;
  padding-left: 34px;
  color: var(--color-faint);
  font-size: 9px;
}
</style>
