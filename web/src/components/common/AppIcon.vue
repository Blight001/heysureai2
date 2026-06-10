<script setup lang="ts">
/**
 * 自创渐变双色调图标库 — 控制台结构性图标统一出口。
 *
 * 与首页特性卡图标同一视觉语言（渐变填充 + 低透明度副层），
 * 用于替换面板标题 / 按钮上的 emoji 与字符符号。聊天消息里
 * 用户可自定义的图标（ui_thinking_icon 等）不在此范围。
 *
 * 渐变 id 按实例随机生成，避免同页多实例 + 主题切换时的 id 冲突。
 */
export type AppIconName =
  | 'gear'
  | 'shield'
  | 'pen'
  | 'exit'
  | 'brain'
  | 'workshop'
  | 'book'
  | 'globe'
  | 'scroll'
  | 'seed'
  | 'bolt'
  | 'search'
  | 'dna'
  | 'palette'
  | 'sun'
  | 'moon'
  | 'compass'
  | 'crown'
  | 'sparkles'
  | 'robot'

defineProps<{
  name: AppIconName
}>()

const uid = `ai-${Math.random().toString(36).slice(2, 9)}`
const g = (color: string) => `url(#${uid}-${color})`
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="inline-block shrink-0 align-[-0.125em]">
    <defs>
      <linearGradient :id="`${uid}-indigo`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#a5b4fc" /><stop offset="100%" stop-color="#6366f1" />
      </linearGradient>
      <linearGradient :id="`${uid}-violet`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#c4b5fd" /><stop offset="100%" stop-color="#8b5cf6" />
      </linearGradient>
      <linearGradient :id="`${uid}-cyan`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#a5f3fc" /><stop offset="100%" stop-color="#06b6d4" />
      </linearGradient>
      <linearGradient :id="`${uid}-emerald`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6ee7b7" /><stop offset="100%" stop-color="#10b981" />
      </linearGradient>
      <linearGradient :id="`${uid}-amber`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fde68a" /><stop offset="100%" stop-color="#f59e0b" />
      </linearGradient>
      <linearGradient :id="`${uid}-fuchsia`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f0abfc" /><stop offset="100%" stop-color="#d946ef" />
      </linearGradient>
      <linearGradient :id="`${uid}-rose`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fda4af" /><stop offset="100%" stop-color="#f43f5e" />
      </linearGradient>
    </defs>

    <!-- 齿轮（设置） -->
    <template v-if="name === 'gear'">
      <g :fill="g('indigo')" opacity="0.55">
        <rect x="10.75" y="1.8" width="2.5" height="4.4" rx="1.1" />
        <rect x="10.75" y="17.8" width="2.5" height="4.4" rx="1.1" />
        <rect x="1.8" y="10.75" width="4.4" height="2.5" rx="1.1" />
        <rect x="17.8" y="10.75" width="4.4" height="2.5" rx="1.1" />
      </g>
      <g :fill="g('indigo')" opacity="0.55" transform="rotate(45 12 12)">
        <rect x="10.75" y="1.8" width="2.5" height="4.4" rx="1.1" />
        <rect x="10.75" y="17.8" width="2.5" height="4.4" rx="1.1" />
        <rect x="1.8" y="10.75" width="4.4" height="2.5" rx="1.1" />
        <rect x="17.8" y="10.75" width="4.4" height="2.5" rx="1.1" />
      </g>
      <circle cx="12" cy="12" r="5.6" :fill="g('indigo')" />
      <circle cx="12" cy="12" r="2.2" fill="#eef2ff" opacity="0.92" />
    </template>

    <!-- 盾牌（管理员） -->
    <template v-else-if="name === 'shield'">
      <path d="M12 2.1l7.6 2.85v6.15c0 4.9-3.25 8.45-7.6 10.8-4.35-2.35-7.6-5.9-7.6-10.8V4.95z" :fill="g('amber')" />
      <path d="M12 4.4l5.5 2.05v4.55c0 3.7-2.35 6.4-5.5 8.25z" :fill="g('amber')" opacity="0.45" />
      <path d="M8.7 11.9l2.3 2.3 4.5-4.7" stroke="#fffbeb" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
    </template>

    <!-- 钢笔（编辑资料） -->
    <template v-else-if="name === 'pen'">
      <path d="M4 20l1.1-4.2L16.4 4.5a2.15 2.15 0 013.05 3.05L8.2 18.85 4 20z" :fill="g('indigo')" />
      <path d="M14.6 6.3l3.1 3.1" stroke="#e0e7ff" stroke-width="1.5" stroke-linecap="round" />
      <path d="M4 20l1.1-4.2 3.1 3.05z" fill="#312e81" opacity="0.55" />
    </template>

    <!-- 出口（退出登录） -->
    <template v-else-if="name === 'exit'">
      <path d="M13.5 3H6.2A2.2 2.2 0 004 5.2v13.6A2.2 2.2 0 006.2 21h7.3a2.2 2.2 0 002.2-2.2v-2.3h-2.2v2.3H6.2V5.2h7.3v2.3h2.2V5.2A2.2 2.2 0 0013.5 3z" :fill="g('rose')" opacity="0.55" />
      <path d="M16.4 8.2L20.2 12l-3.8 3.8-1.55-1.55L16.1 13H9.5v-2h6.6l-1.25-1.25z" :fill="g('rose')" />
    </template>

    <!-- 智核芯片（主脑 / 智囊团） -->
    <template v-else-if="name === 'brain'">
      <g :fill="g('violet')" opacity="0.5">
        <rect x="7" y="1.6" width="1.7" height="3" rx="0.85" />
        <rect x="11.15" y="1.6" width="1.7" height="3" rx="0.85" />
        <rect x="15.3" y="1.6" width="1.7" height="3" rx="0.85" />
        <rect x="7" y="19.4" width="1.7" height="3" rx="0.85" />
        <rect x="11.15" y="19.4" width="1.7" height="3" rx="0.85" />
        <rect x="15.3" y="19.4" width="1.7" height="3" rx="0.85" />
      </g>
      <rect x="3.8" y="5" width="16.4" height="14" rx="3.6" :fill="g('violet')" />
      <circle cx="12" cy="12" r="3.6" fill="#ffffff" opacity="0.25" />
      <circle cx="12" cy="12" r="1.5" fill="#ede9fe" />
      <path d="M12 8.4v-1.6M12 17.2v-1.6M8.4 12H6.8M17.2 12h-1.6" stroke="#ede9fe" stroke-width="1.1" stroke-linecap="round" opacity="0.7" />
    </template>

    <!-- 锤子（作坊） -->
    <template v-else-if="name === 'workshop'">
      <g transform="rotate(-45 12 12)">
        <rect x="7.6" y="3.6" width="8.8" height="4.8" rx="1.3" :fill="g('amber')" />
        <rect x="11.05" y="8.4" width="1.9" height="11.4" rx="0.95" :fill="g('amber')" opacity="0.55" />
      </g>
      <path d="M19.3 3.1l.45 1.25 1.25.45-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45z" fill="#fde68a" />
    </template>

    <!-- 知识之书 -->
    <template v-else-if="name === 'book'">
      <path d="M11.5 6.2C9.9 4.9 7.8 4.2 5.6 4.2c-1 0-2 .15-2.9.45v13.9c.9-.3 1.9-.45 2.9-.45 2.2 0 4.3.72 5.9 1.95V6.2z" :fill="g('emerald')" opacity="0.5" />
      <path d="M12.5 6.2c1.6-1.3 3.7-2 5.9-2 1 0 2 .15 2.9.45v13.9c-.9-.3-1.9-.45-2.9-.45-2.2 0-4.3.72-5.9 1.95V6.2z" :fill="g('emerald')" />
      <path d="M17.2 1.2l.65 1.75 1.75.65-1.75.65-.65 1.75-.65-1.75-1.75-.65 1.75-.65z" fill="#a7f3d0" />
    </template>

    <!-- 星球（进化竞技场） -->
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="8.4" :fill="g('cyan')" opacity="0.18" />
      <circle cx="12" cy="12" r="8.4" :stroke="g('cyan')" stroke-width="1.6" />
      <ellipse cx="12" cy="12" rx="3.9" ry="8.4" :stroke="g('cyan')" stroke-width="1.3" opacity="0.7" />
      <path d="M3.8 12h16.4" :stroke="g('cyan')" stroke-width="1.3" opacity="0.7" />
      <circle cx="19.6" cy="5" r="1.4" :fill="g('cyan')" />
    </template>

    <!-- 卷轴（英灵殿遗言） -->
    <template v-else-if="name === 'scroll'">
      <path d="M7.2 4H17a2.6 2.6 0 012.6 2.6V20H8.4A2.6 2.6 0 015.8 17.4V6z" :fill="g('amber')" />
      <circle cx="6.6" cy="6.2" r="2.3" :fill="g('amber')" opacity="0.55" />
      <rect x="9.2" y="8.6" width="7.4" height="1.3" rx="0.65" fill="#fffbeb" opacity="0.85" />
      <rect x="9.2" y="11.6" width="7.4" height="1.3" rx="0.65" fill="#fffbeb" opacity="0.65" />
      <rect x="9.2" y="14.6" width="4.8" height="1.3" rx="0.65" fill="#fffbeb" opacity="0.5" />
    </template>

    <!-- 新芽（存活 AI） -->
    <template v-else-if="name === 'seed'">
      <path d="M12 21v-7.6" :stroke="g('emerald')" stroke-width="1.9" stroke-linecap="round" />
      <path d="M12 13.4C12 9.4 9.4 7 5.3 6.7c.2 4.1 2.6 6.5 6.7 6.7z" :fill="g('emerald')" opacity="0.55" />
      <path d="M12 13.4c0-4 2.6-6.4 6.7-6.7-.2 4.1-2.6 6.5-6.7 6.7z" :fill="g('emerald')" />
      <path d="M6 21h12" :stroke="g('emerald')" stroke-width="1.6" stroke-linecap="round" opacity="0.4" />
    </template>

    <!-- 闪电（执行中） -->
    <template v-else-if="name === 'bolt'">
      <path d="M13.9 2.3L5.6 12.9h4.5L9 21.7l8.3-10.6h-4.5l1.1-8.8z" :fill="g('indigo')" />
      <path d="M13.9 2.3l-1.4 8.8h4.8z" :fill="g('indigo')" opacity="0.55" />
    </template>

    <!-- 放大镜（搜索） -->
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6" :fill="g('cyan')" opacity="0.18" />
      <circle cx="10.5" cy="10.5" r="6" :stroke="g('cyan')" stroke-width="2" />
      <path d="M15.3 15.3l5.2 5.2" :stroke="g('cyan')" stroke-width="2.4" stroke-linecap="round" />
      <circle cx="8.3" cy="8.3" r="1.2" fill="#cffafe" opacity="0.85" />
    </template>

    <!-- DNA（归档传承） -->
    <template v-else-if="name === 'dna'">
      <path d="M7.2 2.8c0 6.1 9.6 6.1 9.6 9.2s-9.6 3.1-9.6 9.2" :stroke="g('fuchsia')" stroke-width="1.9" stroke-linecap="round" />
      <path d="M16.8 2.8c0 6.1-9.6 6.1-9.6 9.2s9.6 3.1 9.6 9.2" :stroke="g('fuchsia')" stroke-width="1.9" stroke-linecap="round" opacity="0.5" />
      <path d="M8.6 5.6h6.8M8.6 18.4h6.8M9.8 12h4.4" stroke="#f5d0fe" stroke-width="1.4" stroke-linecap="round" opacity="0.85" />
    </template>

    <!-- 调色盘（界面偏好） -->
    <template v-else-if="name === 'palette'">
      <path d="M12 3a9 9 0 100 18h1.7a2 2 0 001.45-3.38c-.85-.9-.22-2.42 1.02-2.42H19a3.2 3.2 0 003.2-3.2C22.2 6.7 17.6 3 12 3z" :fill="g('violet')" />
      <circle cx="7.4" cy="10.2" r="1.3" fill="#fbcfe8" />
      <circle cx="10.8" cy="6.9" r="1.3" fill="#a5f3fc" />
      <circle cx="15.3" cy="7.5" r="1.3" fill="#fde68a" />
      <circle cx="6.6" cy="14.4" r="1.3" fill="#6ee7b7" />
    </template>

    <!-- 太阳（亮色主题） -->
    <template v-else-if="name === 'sun'">
      <g :fill="g('amber')" opacity="0.6">
        <rect x="11.3" y="1.8" width="1.4" height="3.2" rx="0.7" />
        <rect x="11.3" y="19" width="1.4" height="3.2" rx="0.7" />
        <rect x="1.8" y="11.3" width="3.2" height="1.4" rx="0.7" />
        <rect x="19" y="11.3" width="3.2" height="1.4" rx="0.7" />
      </g>
      <g :fill="g('amber')" opacity="0.6" transform="rotate(45 12 12)">
        <rect x="11.3" y="1.8" width="1.4" height="3.2" rx="0.7" />
        <rect x="11.3" y="19" width="1.4" height="3.2" rx="0.7" />
        <rect x="1.8" y="11.3" width="3.2" height="1.4" rx="0.7" />
        <rect x="19" y="11.3" width="3.2" height="1.4" rx="0.7" />
      </g>
      <circle cx="12" cy="12" r="4" :fill="g('amber')" />
      <circle cx="10.7" cy="10.7" r="1.1" fill="#fffbeb" opacity="0.7" />
    </template>

    <!-- 月亮（暗色主题） -->
    <template v-else-if="name === 'moon'">
      <path d="M20.8 14.4A9 9 0 1110 3.2a7.2 7.2 0 1010.8 11.2z" :fill="g('indigo')" />
      <path d="M17.6 4.4l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z" fill="#c7d2fe" />
    </template>

    <!-- 罗盘（提示词导航） -->
    <template v-else-if="name === 'compass'">
      <circle cx="12" cy="12" r="8.6" :fill="g('cyan')" opacity="0.15" />
      <circle cx="12" cy="12" r="8.6" :stroke="g('cyan')" stroke-width="1.7" />
      <path d="M15.5 8.5l-2.1 5-5 2.1 2.1-5z" :fill="g('cyan')" />
      <circle cx="12" cy="12" r="1.1" fill="#cffafe" />
    </template>

    <!-- 王冠（管理者徽章） -->
    <template v-else-if="name === 'crown'">
      <path d="M4.2 16.2L3 7.6l4.9 3.3L12 4.8l4.1 6.1L21 7.6l-1.2 8.6z" :fill="g('amber')" />
      <rect x="4.2" y="17.4" width="15.6" height="2.4" rx="1" :fill="g('amber')" opacity="0.6" />
      <circle cx="12" cy="12.4" r="1.2" fill="#fffbeb" opacity="0.8" />
    </template>

    <!-- 星辉（AI / 智能） -->
    <template v-else-if="name === 'sparkles'">
      <path d="M9.8 15.9L9 18.75l-.8-2.85a4.5 4.5 0 00-3.1-3.1L2.25 12l2.85-.8a4.5 4.5 0 003.1-3.1L9 5.25l.8 2.85a4.5 4.5 0 003.1 3.1l2.85.8-2.85.8a4.5 4.5 0 00-3.1 3.1z" :fill="g('violet')" />
      <path d="M18.3 8.7L18 9.75l-.3-1.05a3.4 3.4 0 00-2.4-2.4L14.25 6l1.05-.3a3.4 3.4 0 002.4-2.4L18 2.25l.3 1.05a3.4 3.4 0 002.4 2.4L21.75 6l-1.05.3a3.4 3.4 0 00-2.4 2.4z" :fill="g('violet')" opacity="0.7" />
    </template>

    <!-- 机器人（数字成员） -->
    <template v-else-if="name === 'robot'">
      <circle cx="12" cy="2.9" r="1.3" :fill="g('cyan')" />
      <rect x="11.4" y="3.7" width="1.2" height="2.3" rx="0.6" :fill="g('cyan')" />
      <rect x="4" y="6.3" width="16" height="12.5" rx="4" :fill="g('cyan')" />
      <rect x="1.6" y="10" width="1.9" height="5" rx="0.95" :fill="g('cyan')" opacity="0.45" />
      <rect x="20.5" y="10" width="1.9" height="5" rx="0.95" :fill="g('cyan')" opacity="0.45" />
      <circle cx="9" cy="11.6" r="1.5" fill="#082f3d" />
      <circle cx="15" cy="11.6" r="1.5" fill="#082f3d" />
      <circle cx="9.45" cy="11.15" r="0.45" fill="#cffafe" />
      <circle cx="15.45" cy="11.15" r="0.45" fill="#cffafe" />
      <rect x="8.6" y="15.1" width="6.8" height="1.5" rx="0.75" fill="#082f3d" opacity="0.6" />
    </template>
  </svg>
</template>
