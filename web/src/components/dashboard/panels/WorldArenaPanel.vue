<script setup lang="ts">
/**
 * 中间实战区域：直接内嵌游戏世界（/game/ 同源 iframe），实时显示数字社会。
 * 原"项目安排 + 运行中 AI 卡片"功能已按需求移除（2026-06-11）。
 * postMessage 桥：world:open-chat → 父页面打开对应成员聊天弹窗。
 */
import { onMounted, onUnmounted } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'

const emit = defineEmits<{
  (e: 'open-chat', aiConfigId: number): void
}>()

const GAME_URL = '/game/'

const onMessage = (event: MessageEvent) => {
  if (event.origin !== window.location.origin) return
  const data = event.data as { type?: string; aiConfigId?: number } | null
  if (data?.type === 'world:open-chat' && Number.isFinite(Number(data.aiConfigId))) {
    emit('open-chat', Number(data.aiConfigId))
  }
}

onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <section class="flex-1 rounded-2xl border-2 border-zinc-200 flex flex-col overflow-hidden relative dark:border-zinc-700 transition-colors duration-500 bg-[#23262e]">
    <div class="absolute top-0 left-0 bg-zinc-100 text-zinc-500 text-xs px-3 py-1 rounded-br-lg font-medium z-10 border-b border-r border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700 shadow-sm">
      <span class="flex items-center gap-1.5"><AppIcon name="globe" class="w-3.5 h-3.5" /> Agent 进化与实战区域</span>
    </div>
    <iframe
      :src="GAME_URL"
      class="flex-1 w-full border-0"
      title="Agent 进化与实战区域"
    />
  </section>
</template>
