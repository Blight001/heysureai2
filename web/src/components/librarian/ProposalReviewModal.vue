<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  approveProposal,
  listProposals,
  rejectProposal,
  type KnowledgeEntryItem,
} from '../../services/librarianApi'

interface Props {
  show: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'resolved'): void
}>()

const loading = ref(false)
const error = ref('')
const items = ref<KnowledgeEntryItem[]>([])
const selectedId = ref<string | null>(null)
const editing = ref(false)
const editedBody = ref('')
const rejectReason = ref('')
const acting = ref(false)
const actionError = ref('')

const selected = computed<KnowledgeEntryItem | null>(
  () => items.value.find(it => it.memory_id === selectedId.value) || null
)

const refresh = async () => {
  loading.value = true
  error.value = ''
  try {
    const token = localStorage.getItem('token') || ''
    const data = await listProposals(token)
    items.value = data.items || []
    if (selectedId.value && !items.value.find(it => it.memory_id === selectedId.value)) {
      selectedId.value = null
    }
    if (!selectedId.value && items.value.length > 0) {
      selectedId.value = items.value[0].memory_id
    }
  } catch (err) {
    error.value = (err as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (val) => {
    if (val) refresh()
    else {
      editing.value = false
      editedBody.value = ''
      rejectReason.value = ''
    }
  },
  { immediate: true }
)

watch(selected, (val) => {
  editing.value = false
  editedBody.value = val?.body || ''
  rejectReason.value = ''
  actionError.value = ''
})

const startEditing = () => {
  if (!selected.value) return
  editedBody.value = selected.value.body || ''
  editing.value = true
}

const cancelEditing = () => {
  editing.value = false
  editedBody.value = selected.value?.body || ''
}

const onApprove = async () => {
  if (!selected.value) return
  acting.value = true
  actionError.value = ''
  try {
    const token = localStorage.getItem('token') || ''
    const body = editing.value ? editedBody.value : undefined
    await approveProposal(token, selected.value.memory_id, body)
    emit('resolved')
    await refresh()
  } catch (err) {
    actionError.value = (err as Error).message || '审批失败'
  } finally {
    acting.value = false
  }
}

const onReject = async () => {
  if (!selected.value) return
  if (!rejectReason.value.trim()) {
    actionError.value = '请填写驳回原因'
    return
  }
  acting.value = true
  actionError.value = ''
  try {
    const token = localStorage.getItem('token') || ''
    await rejectProposal(token, selected.value.memory_id, rejectReason.value.trim())
    emit('resolved')
    await refresh()
  } catch (err) {
    actionError.value = (err as Error).message || '驳回失败'
  } finally {
    acting.value = false
  }
}

const formatTime = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
      <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-zinc-700 dark:text-zinc-200">图书管理员 · 沉淀审批</span>
          <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ items.length }} 条待审</span>
        </div>
        <button class="text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="emit('close')">×</button>
      </div>

      <div class="flex-1 flex overflow-hidden">
        <div class="w-72 border-r border-zinc-100 dark:border-zinc-800 overflow-y-auto custom-scrollbar">
          <div v-if="loading" class="p-4 text-zinc-400 text-xs">加载中…</div>
          <div v-else-if="error" class="p-4 text-rose-500 text-xs">{{ error }}</div>
          <div v-else-if="items.length === 0" class="p-6 text-center text-zinc-400 text-xs">
            暂无待审批条目
          </div>
          <button
            v-for="item in items"
            :key="item.memory_id"
            class="w-full text-left px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 hover:bg-indigo-50 dark:hover:bg-zinc-800/60 transition"
            :class="selectedId === item.memory_id ? 'bg-indigo-50 dark:bg-zinc-800/80 border-l-2 border-l-indigo-500' : ''"
            @click="selectedId = item.memory_id"
          >
            <div class="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate" :title="item.title">{{ item.title }}</div>
            <div class="text-[10px] text-zinc-400 mt-0.5 truncate">
              {{ item.triggers.join(' · ') || '无触发词' }}
            </div>
            <div class="text-[10px] text-zinc-400 mt-0.5">{{ formatTime(item.created_at) }}</div>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar p-5">
          <div v-if="!selected" class="text-center text-zinc-400 text-sm py-10">从左侧选择一条待审条目</div>
          <template v-else>
            <h3 class="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{{ selected.title }}</h3>
            <div class="text-xs text-zinc-500 dark:text-zinc-400 mb-3 space-x-3">
              <span>触发词：{{ selected.triggers.join(' / ') || '（无）' }}</span>
              <span>· 范围：{{ selected.scope }}</span>
              <span v-if="selected.source_job_id">· 来源任务 {{ selected.source_job_id }} · 第 {{ selected.source_generation }} 代</span>
            </div>

            <div class="mb-3 flex gap-2">
              <button
                v-if="!editing"
                class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                @click="startEditing"
              >编辑后再确认</button>
              <button
                v-else
                class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                @click="cancelEditing"
              >取消编辑</button>
            </div>

            <pre
              v-if="!editing"
              class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 max-h-[40vh] overflow-y-auto custom-scrollbar"
            >{{ selected.body || '（无内容）' }}</pre>
            <textarea
              v-else
              v-model="editedBody"
              class="w-full h-[40vh] font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-indigo-400"
            ></textarea>

            <div class="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-4 space-y-3">
              <div>
                <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">驳回原因（如选择驳回）</label>
                <input
                  v-model="rejectReason"
                  type="text"
                  placeholder="例如：与现有条目重复 / 信息不准确"
                  class="w-full text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div v-if="actionError" class="text-xs text-rose-500">{{ actionError }}</div>
              <div class="flex justify-end gap-2">
                <button
                  class="text-xs px-4 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                  :disabled="acting"
                  @click="onReject"
                >驳回</button>
                <button
                  class="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  :disabled="acting"
                  @click="onApprove"
                >{{ editing ? '保存修改并确认' : '确认存档' }}</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
