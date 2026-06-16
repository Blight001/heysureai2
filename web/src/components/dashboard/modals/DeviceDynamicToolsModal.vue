<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  listDeviceTools,
  upsertDeviceTool,
  toggleDeviceTool,
  deleteDeviceTool,
  type DeviceToolType,
  type DeviceDynamicTool,
  type DynamicToolStep,
} from '@/api/deviceTools'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const TABS: { key: DeviceToolType; label: string }[] = [
  { key: 'desktop', label: '桌面端' },
  { key: 'browser', label: '浏览器' },
]
const NAME_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/

const deviceType = ref<DeviceToolType>('desktop')
const tools = ref<DeviceDynamicTool[]>([])
const availableTools = ref<{ name: string; description: string }[]>([])
const loading = ref(false)
const error = ref('')
const notice = ref('')

// null = list view; otherwise the editor is open for a new or existing tool.
type ParamRow = { name: string; type: string; description: string; required: boolean }
type ArgRow = { key: string; value: string }
type StepDraft = {
  op: 'call' | 'set' | 'return'
  tool: string
  args: ArgRow[]
  save_as: string
  name: string
  value: string
}
interface Draft {
  original: string // existing tool name being edited, '' for new
  name: string
  description: string
  params: ParamRow[]
  steps: StepDraft[]
}
const draft = ref<Draft | null>(null)
const saving = ref(false)

const currentTabLabel = computed(() => TABS.find(t => t.key === deviceType.value)?.label || '')

const load = async () => {
  if (!props.show) return
  loading.value = true
  error.value = ''
  try {
    const data = await listDeviceTools(deviceType.value)
    tools.value = data.tools || []
    availableTools.value = data.availableTools || []
  } catch (err: any) {
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.show, value => { if (value) { draft.value = null; notice.value = ''; load() } }, { immediate: true })
watch(deviceType, () => { draft.value = null; notice.value = ''; load() })

const coerce = (raw: string): unknown => {
  const v = String(raw ?? '')
  if (v.includes('${')) return v // template — keep as string
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}
const stringifyValue = (value: unknown): string =>
  value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)

const blankStep = (): StepDraft => ({ op: 'call', tool: '', args: [], save_as: '', name: '', value: '' })

const newTool = () => {
  draft.value = {
    original: '',
    name: '',
    description: '',
    params: [],
    steps: [blankStep()],
  }
  notice.value = ''
  error.value = ''
}

const editTool = (tool: DeviceDynamicTool) => {
  const props_ = (tool.input_schema?.properties as Record<string, any>) || {}
  const required = Array.isArray(tool.input_schema?.required) ? (tool.input_schema!.required as string[]) : []
  draft.value = {
    original: tool.name,
    name: tool.name,
    description: tool.description,
    params: Object.entries(props_).map(([name, spec]) => ({
      name,
      type: String((spec as any)?.type || 'string'),
      description: String((spec as any)?.description || ''),
      required: required.includes(name),
    })),
    steps: (tool.code || []).map((step: DynamicToolStep) => ({
      op: step.op,
      tool: String(step.tool || ''),
      args: Object.entries(step.args || {}).map(([key, value]) => ({ key, value: stringifyValue(value) })),
      save_as: String(step.save_as || ''),
      name: String(step.name || ''),
      value: stringifyValue(step.value),
    })),
  }
  if (!draft.value.steps.length) draft.value.steps = [blankStep()]
  notice.value = ''
  error.value = ''
}

const buildInputSchema = (params: ParamRow[]): Record<string, unknown> => {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of params) {
    const name = p.name.trim()
    if (!name) continue
    properties[name] = { type: p.type, ...(p.description.trim() ? { description: p.description.trim() } : {}) }
    if (p.required) required.push(name)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

const buildCode = (steps: StepDraft[]): DynamicToolStep[] =>
  steps.map(step => {
    if (step.op === 'set') return { op: 'set', name: step.name.trim(), value: coerce(step.value) }
    if (step.op === 'return') return { op: 'return', value: coerce(step.value) }
    const args: Record<string, unknown> = {}
    for (const a of step.args) {
      const key = a.key.trim()
      if (key) args[key] = coerce(a.value)
    }
    const out: DynamicToolStep = { op: 'call', tool: step.tool.trim(), args }
    if (step.save_as.trim()) out.save_as = step.save_as.trim()
    return out
  })

const save = async () => {
  if (!draft.value) return
  const d = draft.value
  const name = d.name.trim()
  if (!NAME_RE.test(name)) { error.value = '工具名不合法（小写字母/数字/点，如 custom.collect）'; return }
  if (!d.description.trim()) { error.value = '请填写工具说明'; return }
  if (!d.steps.length) { error.value = '至少需要一条指令'; return }
  for (const step of d.steps) {
    if (step.op === 'call' && !step.tool.trim()) { error.value = 'call 指令需要选择目标工具'; return }
    if (step.op === 'set' && !step.name.trim()) { error.value = 'set 指令需要变量名'; return }
  }
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await upsertDeviceTool(deviceType.value, {
      name,
      description: d.description.trim(),
      input_schema: buildInputSchema(d.params),
      code: buildCode(d.steps),
    })
    notice.value = `已保存，已推送到 ${res.pushedToDevices} 台在线设备`
    draft.value = null
    await load()
  } catch (err: any) {
    error.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

const toggle = async (tool: DeviceDynamicTool) => {
  try {
    await toggleDeviceTool(deviceType.value, tool.name, !tool.enabled)
    await load()
  } catch (err: any) {
    error.value = err?.message || '切换失败'
  }
}

const remove = async (tool: DeviceDynamicTool) => {
  if (!window.confirm(`删除动态工具 ${tool.name}？设备将恢复内置实现。`)) return
  try {
    await deleteDeviceTool(deviceType.value, tool.name)
    if (draft.value?.original === tool.name) draft.value = null
    await load()
  } catch (err: any) {
    error.value = err?.message || '删除失败'
  }
}

const addStep = () => draft.value?.steps.push(blankStep())
const removeStep = (i: number) => draft.value?.steps.splice(i, 1)
const moveStep = (i: number, delta: number) => {
  const steps = draft.value?.steps
  if (!steps) return
  const j = i + delta
  if (j < 0 || j >= steps.length) return
  const [s] = steps.splice(i, 1)
  steps.splice(j, 0, s)
}
const addArg = (step: StepDraft) => step.args.push({ key: '', value: '' })
const addParam = () => draft.value?.params.push({ name: '', type: 'string', description: '', required: false })
</script>

<template>
  <Transition name="fade">
    <div v-if="props.show" class="fixed inset-0 z-[85] bg-black/40 flex items-center justify-center" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-[680px] max-h-[82vh] p-4 overflow-auto" @click.stop>
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">设备动态 MCP 工具（网页管理 · 自动下发）</div>
          <button type="button" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" @click="emit('close')">✕</button>
        </div>

        <!-- device type tabs -->
        <div class="mb-3 flex gap-1">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            type="button"
            class="rounded-lg px-3 py-1 text-xs font-medium border"
            :class="deviceType === tab.key
              ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
              : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'"
            @click="deviceType = tab.key"
          >{{ tab.label }}</button>
          <div class="ml-auto text-[10px] text-zinc-400 self-center">改动会立即推送到所有在线{{ currentTabLabel }}设备</div>
        </div>

        <div v-if="notice" class="mb-3 text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">{{ notice }}</div>
        <div v-if="error" class="mb-3 text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{{ error }}</div>

        <!-- LIST VIEW -->
        <template v-if="!draft">
          <div v-if="loading" class="text-xs text-zinc-500 py-6 text-center">加载中…</div>
          <template v-else>
            <div class="mb-2 flex justify-between items-center">
              <div class="text-[11px] text-zinc-500">共 {{ tools.length }} 个动态工具</div>
              <button type="button" class="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500" @click="newTool">+ 新建工具</button>
            </div>
            <div v-if="!tools.length" class="text-xs text-zinc-400 py-6 text-center">还没有动态工具。连接一台{{ currentTabLabel }}设备后会自动播种其内置工具，或点「新建工具」。</div>
            <div class="space-y-1.5">
              <div
                v-for="tool in tools"
                :key="tool.name"
                class="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 flex items-center gap-3"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ tool.name }}</div>
                  <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{{ tool.description }}</div>
                </div>
                <label class="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer shrink-0">
                  <input type="checkbox" class="h-3.5 w-3.5 accent-indigo-500" :checked="tool.enabled" @change="toggle(tool)" />
                  启用
                </label>
                <button type="button" class="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline shrink-0" @click="editTool(tool)">编辑</button>
                <button type="button" class="text-[11px] text-rose-600 dark:text-rose-300 hover:underline shrink-0" @click="remove(tool)">删除</button>
              </div>
            </div>
          </template>
        </template>

        <!-- EDITOR VIEW -->
        <template v-else>
          <div class="space-y-3">
            <div class="grid grid-cols-1 gap-2">
              <label class="block">
                <span class="text-[11px] text-zinc-500">工具名</span>
                <input
                  v-model="draft.name"
                  :disabled="!!draft.original"
                  placeholder="custom.collect_page"
                  class="mt-0.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2.5 py-1.5 text-xs font-mono disabled:opacity-60"
                />
              </label>
              <label class="block">
                <span class="text-[11px] text-zinc-500">工具说明（AI 看到的描述）</span>
                <textarea v-model="draft.description" rows="2" class="mt-0.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2.5 py-1.5 text-xs" />
              </label>
            </div>

            <!-- params -->
            <div>
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">入参（input_schema）</span>
                <button type="button" class="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline" @click="addParam">+ 参数</button>
              </div>
              <div v-if="!draft.params.length" class="text-[10px] text-zinc-400">无参数</div>
              <div v-for="(p, i) in draft.params" :key="i" class="mb-1 flex items-center gap-1.5">
                <input v-model="p.name" placeholder="参数名" class="w-28 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                <select v-model="p.type" class="rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-1.5 py-1 text-[11px]">
                  <option>string</option><option>number</option><option>boolean</option><option>object</option><option>array</option>
                </select>
                <input v-model="p.description" placeholder="说明" class="flex-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px]" />
                <label class="flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" v-model="p.required" class="h-3 w-3 accent-indigo-500" />必填</label>
                <button type="button" class="text-rose-500 text-xs px-1" @click="draft.params.splice(i, 1)">✕</button>
              </div>
            </div>

            <!-- steps -->
            <div>
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">程序步骤（顺序执行）</span>
                <button type="button" class="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline" @click="addStep">+ 步骤</button>
              </div>
              <div v-for="(step, i) in draft.steps" :key="i" class="mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 bg-zinc-50/60 dark:bg-zinc-800/40">
                <div class="flex items-center gap-1.5 mb-1.5">
                  <span class="text-[10px] text-zinc-400 w-4">{{ i + 1 }}</span>
                  <select v-model="step.op" class="rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-1.5 py-1 text-[11px]">
                    <option value="call">call 调用工具</option>
                    <option value="set">set 设变量</option>
                    <option value="return">return 返回</option>
                  </select>
                  <div class="ml-auto flex items-center gap-1">
                    <button type="button" class="text-[11px] text-zinc-400 hover:text-zinc-600 px-1" @click="moveStep(i, -1)">↑</button>
                    <button type="button" class="text-[11px] text-zinc-400 hover:text-zinc-600 px-1" @click="moveStep(i, 1)">↓</button>
                    <button type="button" class="text-rose-500 text-xs px-1" @click="removeStep(i)">✕</button>
                  </div>
                </div>

                <!-- call -->
                <div v-if="step.op === 'call'" class="space-y-1.5 pl-5">
                  <div class="flex items-center gap-1.5">
                    <input
                      v-model="step.tool"
                      list="device-tool-targets"
                      placeholder="目标工具，如 builtin:keyboard.type"
                      class="flex-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono"
                    />
                    <input v-model="step.save_as" placeholder="存到 vars.（可选）" class="w-32 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                  </div>
                  <div v-for="(a, ai) in step.args" :key="ai" class="flex items-center gap-1.5">
                    <input v-model="a.key" placeholder="参数名" class="w-28 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                    <input v-model="a.value" placeholder="值或模板，如 ${args.text}" class="flex-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                    <button type="button" class="text-rose-500 text-xs px-1" @click="step.args.splice(ai, 1)">✕</button>
                  </div>
                  <button type="button" class="text-[10px] text-indigo-600 dark:text-indigo-300 hover:underline" @click="addArg(step)">+ 参数</button>
                </div>

                <!-- set -->
                <div v-else-if="step.op === 'set'" class="flex items-center gap-1.5 pl-5">
                  <input v-model="step.name" placeholder="变量名" class="w-32 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                  <input v-model="step.value" placeholder="值或模板" class="flex-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                </div>

                <!-- return -->
                <div v-else class="pl-5">
                  <input v-model="step.value" placeholder="返回值或模板，如 ${vars.result}" class="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-[11px] font-mono" />
                </div>
              </div>
              <datalist id="device-tool-targets">
                <option v-for="t in availableTools" :key="t.name" :value="`builtin:${t.name}`">{{ t.description }}</option>
                <option v-for="t in availableTools" :key="`raw-${t.name}`" :value="t.name" />
              </datalist>
              <p class="text-[10px] text-zinc-400 leading-relaxed">
                用 <code>builtin:工具名</code> 调用设备原生能力；模板支持 <code>${'{'}args.x{'}'}</code>、<code>${'{'}vars.x{'}'}</code>、<code>${'{'}last{'}'}</code>。
              </p>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" @click="draft = null">取消</button>
              <button type="button" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-60" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存并下发' }}</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>
