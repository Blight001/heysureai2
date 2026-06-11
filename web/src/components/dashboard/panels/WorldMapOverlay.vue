<script setup lang="ts">
/**
 * Agent 进化与实战区域：全屏覆盖层，内嵌同源游戏世界 iframe（/game/）。
 * 同源 → iframe 内直接复用 localStorage token 与 /api、/socket.io，无需传参。
 */
const emit = defineEmits<{ (e: 'close'): void }>()

const GAME_URL = '/game/'

const openInNewTab = () => {
  window.open(GAME_URL, '_blank', 'noopener')
}
</script>

<template>
  <div class="fixed inset-0 z-[80] flex flex-col bg-zinc-950/95">
    <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/90 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-amber-400 text-sm font-bold truncate">Agent 进化与实战区域</span>
        <span class="hidden sm:inline text-[11px] text-zinc-500">拖拽平移 · 滚轮缩放 · 悬浮查看成员/建筑属性</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          @click="openInNewTab"
        >
          新窗口打开
        </button>
        <button
          type="button"
          class="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          @click="emit('close')"
        >
          关闭 ✕
        </button>
      </div>
    </div>
    <iframe
      :src="GAME_URL"
      class="flex-1 w-full border-0"
      title="Agent 进化与实战区域"
    />
  </div>
</template>
