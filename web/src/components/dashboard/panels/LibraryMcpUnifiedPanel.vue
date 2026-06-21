<script setup lang="ts">
import { computed } from 'vue'
import type { IntrinsicMcpView, LibraryMcpFullView } from '@/api/librarian'
import CatalogMcpScopeEditor, { type CatalogMcpTool } from '@/components/dashboard/modals/CatalogMcpScopeEditor.vue'
import LibraryMcpScopeEditor from '@/components/dashboard/modals/LibraryMcpScopeEditor.vue'

const props = withDefaults(defineProps<{
  catalog?: LibraryMcpFullView | null
  mode?: 'knowledge' | 'workshop'
  workshopDeviceId?: string
  boundAiConfigId?: number | null
  boundAiName?: string
  governanceMcpTools?: string[]
}>(), {
  catalog: null,
  mode: 'knowledge',
  workshopDeviceId: '',
  boundAiConfigId: null,
  boundAiName: '',
  governanceMcpTools: () => [],
})

const emit = defineEmits<{
  (e: 'governance-saved', tools: string[]): void
}>()

const flattenTools = (view: IntrinsicMcpView | null | undefined): CatalogMcpTool[] => {
  const rows: CatalogMcpTool[] = []
  for (const category of view?.categories || []) {
    for (const tool of category.tools || []) {
      const name = String(tool.name || '').trim()
      if (!name) continue
      rows.push({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        destructive: tool.destructive,
      })
    }
  }
  return rows
}

const governanceTools = computed(() => flattenTools(props.catalog?.governance))
</script>

<template>
  <LibraryMcpScopeEditor
    v-if="mode === 'workshop' && workshopDeviceId && catalog"
    :catalog="catalog"
    :workshop-device-id="workshopDeviceId"
    :bound-ai-config-id="boundAiConfigId"
    :bound-ai-name="boundAiName"
    :governance-mcp-tools="governanceMcpTools"
    :refresh-key="`${boundAiConfigId ?? ''}-${workshopDeviceId}`"
    @governance-saved="tools => emit('governance-saved', tools)"
  />
  <CatalogMcpScopeEditor
    v-else-if="governanceTools.length"
    title="图书馆 MCP 权限"
    subtitle="完整图书馆 MCP"
    :tools="governanceTools"
    readonly
  />
</template>