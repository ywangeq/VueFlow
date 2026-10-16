<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  nodes:
    "M9 4H4v5h5V4Zm11 0h-5v5h5V4ZM9 15H4v5h5v-5Zm11 0h-5v5h5v-5ZM9 6.5h6M6.5 9v6M17.5 9v6M9 17.5h6",
  audio:
    "M9 18V5l12-2v13M9 8l12-2M6 21c1.66 0 3-1.12 3-2.5S7.66 16 6 16s-3 1.12-3 2.5S4.34 21 6 21Zm12-2c1.66 0 3-1.12 3-2.5S19.66 14 18 14s-3 1.12-3 2.5 1.34 2.5 3 2.5Z",
  video: "M3 5h13v14H3V5Zm13 5 5-3v10l-5-3",
  plus: "M12 5v14M5 12h14",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  check: "m5 12 4 4L19 6",
  comment:
    "M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  up: "m6 14 6-6 6 6",
  down: "m6 10 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  copy: "M9 9h12v12H9V9ZM15 9V3H3v12h6",
};
</script>
<template>
  <svg
    :width="size || 18"
    :height="size || 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.nodes" />
  </svg>
</template>
