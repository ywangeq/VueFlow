<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import type { AssetVersion } from "../domain/types";
import { volume, claimPlayback, releasePlayback } from "../services/media";
const props = defineProps<{
  version: AssetVersion | null;
  gain: number;
  masterGain: number;
}>();
const emit = defineEmits<{ time: [number]; error: [string] }>();
const media = ref<HTMLMediaElement | null>(null);
const owner = Symbol("asset-preview");
function pause() {
  media.value?.pause();
  releasePlayback(owner);
}
function started(event: Event) {
  if (event.target === media.value) claimPlayback(owner, pause);
}
function stopped(event: Event) {
  if (event.target === media.value && media.value?.paused)
    releasePlayback(owner);
}
watch(() => props.version?.id, pause);
watch(
  [media, () => props.gain, () => props.masterGain],
  () => {
    if (media.value)
      media.value.volume = volume(props.gain) * volume(props.masterGain);
  },
  { flush: "post" },
);
onBeforeUnmount(pause);
</script>
<template>
  <div class="asset-preview">
    <component
      :is="version.kind === 'video' ? 'video' : 'audio'"
      v-if="version"
      :key="version.id"
      ref="media"
      :src="version.url"
      controls
      preload="metadata"
      @play="started"
      @pause="stopped"
      @ended="stopped"
      @timeupdate="emit('time', media?.currentTime ?? 0)"
      @error="
        emit('error', '媒体无法播放，请检查文件是否存在以及浏览器支持的格式。')
      "
    />
    <p v-else class="empty">导入音频或视频后，即可在这里审听。</p>
  </div>
</template>
<style scoped>
.asset-preview audio,
.asset-preview video {
  width: 100%;
  max-height: 270px;
  border-radius: 12px;
}
.asset-preview video {
  background: #12171a;
}
.empty {
  color: var(--color-muted);
  font-size: 13px;
  padding: 14px 0;
}
</style>
