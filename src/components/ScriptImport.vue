<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { splitScript } from "../domain/script";
import type { Chapter } from "../domain/types";
import StudioIcon from "./StudioIcon.vue";
const emit = defineEmits<{ close: []; import: [chapters: Chapter[]] }>();
const dialog = ref<HTMLDialogElement | null>(null),
  text = ref("");
const chapters = computed(() => splitScript(text.value));
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog ref="dialog" class="script-dialog" @close="emit('close')">
    <div class="dialog-heading">
      <h2>整篇文稿，拆成章节</h2>
      <button
        class="icon-button"
        aria-label="关闭文稿导入"
        @click="dialog?.close()"
      >
        <StudioIcon name="close" />
      </button>
    </div>
    <p class="hint">
      用「# 开场」「#
      正文」等标题划分章节；没有标题时按空行分段。新增到当前工程，已有章节会保留。
    </p>
    <label class="field"
      >完整文稿<textarea
        v-model="text"
        rows="12"
        placeholder="# 开场&#10;今天想跟你聊一件事。&#10;&#10;# 正文&#10;这是主要内容。"
        maxlength="100000"
      />
    </label>
    <div class="import-preview">
      <span v-for="(chapter, index) in chapters.slice(0, 8)" :key="chapter.id"
        >{{ index + 1 }}. {{ chapter.title }} ·
        {{ chapter.text.length }} 字</span
      ><span v-if="chapters.length > 8">还有 {{ chapters.length - 8 }} 章</span>
    </div>
    <div class="dialog-actions">
      <span class="muted">识别到 {{ chapters.length }} 个章节</span
      ><button
        class="primary"
        :disabled="!chapters.length || chapters.length > 200"
        @click="emit('import', chapters)"
      >
        添加到工作流
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.script-dialog {
  width: min(620px, calc(100vw - 32px));
  max-height: calc(100vh - 40px);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  padding: 24px;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-panel);
}
.script-dialog::backdrop {
  background: #26334555;
  backdrop-filter: blur(4px);
}
.dialog-heading,
.dialog-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.script-dialog > .hint {
  margin: 10px 0 20px;
}
.dialog-actions {
  margin-top: 20px;
  font-size: 12px;
}
.import-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.import-preview span {
  font-size: 11px;
  background: var(--color-soft);
  padding: 6px 9px;
  border-radius: 6px;
  color: var(--color-muted);
}
</style>
