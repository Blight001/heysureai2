<script setup lang="ts">
import { computed } from 'vue';
import type { InlineContent as InlineContentType } from '@/utils/chatParser';
import MarkdownText from './MarkdownText.vue';

const props = withDefaults(defineProps<{
  content: InlineContentType[];
  appliedEdits: string[];
  appliedSignatures: string[];
  actionResults: Record<string, string>;
  actionResultsBySignature: Record<string, string>;
  enableMcpTextBubble?: boolean;
  plainTextMode?: boolean;
  mcpIcon?: string;
}>(), {
  enableMcpTextBubble: true,
  plainTextMode: false,
  mcpIcon: '',
});

interface TextChunk {
  kind: 'plain' | 'mcp';
  content: string;
}

const MCP_HEADER_LINE_RE = /^(?:#{1,6}\s*)?(\[MCP执行[^\]]*\]|\[工具参数\]|\[工具执行结果\]|系统已执行工具[：:].*|工具(?:名称)?[：:].*|执行状态[：:].*|状态[：:].*|可用工具[：:].*)$/i;

const normalizeLineBreaks = (raw: string) => String(raw || '').replace(/\r\n?/g, '\n');

const decodeEscapedNewlinesIfNeeded = (raw: string) => {
  const normalized = normalizeLineBreaks(raw);
  if (normalized.includes('\n')) return normalized;
  if (!/(\\r\\n|\\n|\\u000a)/i.test(normalized)) return normalized;
  return normalized
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\u000a/gi, '\n')
    .replace(/\\t/g, '  ');
};

const splitTextChunks = (raw: string): TextChunk[] => {
  const normalized = normalizeLineBreaks(raw);
  if (!normalized) return [];
  if (!props.enableMcpTextBubble) return [{ kind: 'plain', content: normalized }];

  const lines = normalized.split('\n');
  const headerIdx = lines.findIndex((line) => MCP_HEADER_LINE_RE.test(line.trim()));
  if (headerIdx < 0) return [{ kind: 'plain', content: normalized }];

  const plainText = lines.slice(0, headerIdx).join('\n').trimEnd();
  const mcpText = lines.slice(headerIdx).join('\n').trim();
  const chunks: TextChunk[] = [];
  if (plainText) chunks.push({ kind: 'plain', content: plainText });
  if (mcpText) chunks.push({ kind: 'mcp', content: decodeEscapedNewlinesIfNeeded(mcpText) });
  return chunks.length > 0 ? chunks : [{ kind: 'plain', content: normalized }];
};

const mcpLines = (raw: string) => decodeEscapedNewlinesIfNeeded(raw).split('\n');

const appliedEditsSet = computed(() => new Set(props.appliedEdits));
const appliedSignaturesSet = computed(() => new Set(props.appliedSignatures));

const emit = defineEmits<{
  (e: 'apply', blockIdx: number): void;
  (e: 'revert', blockIdx: number): void;
}>();

const getBlockIndex = (blockId: string): number => {
  const parts = blockId.split('-');
  return parseInt(parts[parts.length - 1], 10);
};

const stableStringify = (value: any): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

const simpleHash = (input: string) => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
};

const blockSignature = (block: any) => {
  const raw = [
    block?.type || '',
    block?.tool || '',
    block?.filename || '',
    block?.command || '',
    block?.search || '',
    block?.replace || '',
    block?.content || '',
    stableStringify(block?.arguments || {}),
  ].join('|');
  return `sig_${simpleHash(raw)}`;
};

const getMcpBlockIcon = () => {
  return props.mcpIcon ?? '';
};

const getBlockInfo = (block: any) => {
  if (block.type === 'mcp') return { icon: getMcpBlockIcon(), label: 'MCP', target: block.tool };
  if (block.type === 'edit') return { icon: '📝', label: '修改', target: block.filename };
  if (block.type === 'create') return { icon: '✨', label: '创建', target: block.filename };
  if (block.type === 'delete') return { icon: '🗑️', label: '删除', target: block.filename };
  if (block.type === 'run') return { icon: '▶️', label: '运行', target: block.command };
  return { icon: '❓', label: '未知', target: '' };
};

const getActionResult = (block: any) => {
  const blockId = block?.id || '';
  const sig = blockSignature(block);
  return props.actionResults[blockId] || props.actionResultsBySignature[sig] || '';
};
const hasActionResult = (block: any) => !!getActionResult(block).trim();
const isFailed = (block: any) => {
  const raw = getActionResult(block);
  if (!raw) return false;
  const text = raw.toLowerCase();

  // Prefer explicit status markers from backend result rendering.
  if (text.includes('状态: 成功') || text.includes('执行状态：成功') || text.includes('执行状态: 成功')) return false;
  if (text.includes('状态: 失败') || text.includes('执行状态：失败') || text.includes('执行状态: 失败')) return true;

  // Fallback: detect concrete error signals; avoid matching "errors" map in successful payloads.
  return (
    /\berror\b/.test(text)
    || /"success"\s*:\s*false/.test(text)
    || /"error"\s*:/.test(text)
    || text.includes('unknown mcp tool')
    || text.includes('access denied')
    || text.includes('mcp is disabled')
    || text.includes('ai is stopped')
    || text.includes('执行失败')
  );
};
const isApplied = (block: any) => {
  const blockId = block?.id || '';
  const sig = blockSignature(block);
  return appliedEditsSet.value.has(blockId) || appliedSignaturesSet.value.has(sig) || hasActionResult(block);
};
</script>

<template>
  <div class="inline-content-wrapper">
    <template v-for="(item, idx) in content" :key="idx">
      <template v-if="item.type === 'text'">
        <template v-for="(chunk, chunkIdx) in splitTextChunks(item.content || '')" :key="`txt-${idx}-${chunkIdx}`">
          <MarkdownText v-if="chunk.kind === 'plain'" :text="chunk.content" :plainTextMode="props.plainTextMode" />
          <div v-else class="mcp-text-bubble">
            <div class="mcp-text-header">MCP 操作</div>
            <div class="mcp-text-content font-mono text-[11px] leading-4">
              <div
                v-for="(line, lineIdx) in mcpLines(chunk.content)"
                :key="`mcp-line-${idx}-${chunkIdx}-${lineIdx}`"
                class="mcp-line"
                :class="{ 'mcp-line-empty': line.length === 0 }"
              >
                {{ line || ' ' }}
              </div>
            </div>
          </div>
        </template>
      </template>
      <div v-else-if="item.type === 'block' && item.block" class="block my-1.5 text-xs">
        <div class="flex items-center gap-2">
          <span
            class="shrink-0 h-1.5 w-1.5 rounded-full"
            :class="isApplied(item.block)
              ? (isFailed(item.block) ? 'bg-rose-500' : 'bg-emerald-500')
              : 'bg-indigo-500 animate-pulse'"
          ></span>
          <span class="font-medium text-zinc-500 dark:text-zinc-400">{{ getBlockInfo(item.block).label }}</span>
          <span class="font-mono text-[10px] text-zinc-600 dark:text-zinc-300 truncate max-w-[220px]">{{ getBlockInfo(item.block).target }}</span>
          <button
            v-if="!isApplied(item.block)"
            @click="emit('apply', getBlockIndex(item.block!.id))"
            class="ml-auto px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors text-[10px]"
          >
            确认
          </button>
          <span
            v-else
            class="ml-auto text-[10px] font-medium"
            :class="isFailed(item.block) ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'"
          >
            {{ isFailed(item.block) ? '失败' : '完成' }}
          </span>
        </div>
        <div
          v-if="getActionResult(item.block)"
          class="mt-1 ml-0.5 pl-2.5 border-l border-zinc-200 dark:border-zinc-700/80"
        >
          <div class="result-view font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
            {{ getActionResult(item.block) }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.inline-content-wrapper {
  line-height: 1.45;
}
.result-view {
  max-height: 240px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Quiet, Codex-style: a thin left rail instead of a loud filled bubble. */
.mcp-text-bubble {
  margin: 0.25rem 0;
  padding-left: 0.6rem;
  border-left: 1px solid rgb(228, 228, 231);
}

.dark .mcp-text-bubble {
  border-left-color: rgba(63, 63, 70, 0.8);
}

.mcp-text-header {
  line-height: 1.2;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: rgb(113, 113, 122);
  margin-bottom: 0.15rem;
}

.dark .mcp-text-header {
  color: rgb(161, 161, 170);
}

.mcp-text-content {
  max-height: 260px;
  overflow-y: auto;
  color: rgb(113, 113, 122);
}

.dark .mcp-text-content {
  color: rgb(161, 161, 170);
}

.mcp-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.mcp-line-empty {
  min-height: 0.65rem;
}
</style>
