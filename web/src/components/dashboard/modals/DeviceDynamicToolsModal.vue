<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatDateTime } from '@/utils/datetime'
import {
  listDeviceTools,
  upsertDeviceTool,
  toggleDeviceTool,
  setDeviceToolStatus,
  deleteDeviceTool,
  listDeviceToolVersions,
  restoreDeviceToolVersion,
  listDeviceToolStats,
  listDeviceToolFailures,
  getPermissionPolicy,
  setPermissionPolicy,
  getDeviceRuntimes,
  type PermissionDecision,
  type DeviceToolType,
  type DeviceDynamicTool,
  type DeviceToolVersion,
  type DeviceToolStat,
  type DeviceToolFailure,
  type DynamicToolStep,
  type ToolRuntime,
} from '@/api/deviceTools'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const TABS: { key: DeviceToolType; label: string }[] = [
  { key: 'desktop', label: '桌面端' },
  { key: 'browser', label: '浏览器' },
  { key: 'android', label: '安卓端' },
]
const NAME_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/

const deviceType = ref<DeviceToolType>('desktop')
const tools = ref<DeviceDynamicTool[]>([])
const availableTools = ref<{ name: string; description: string }[]>([])
const statsByTool = ref<Record<string, DeviceToolStat>>({})
const listQuery = ref('')
const filteredTools = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  if (!q) return tools.value
  return tools.value.filter(t =>
    [t.name, t.description].some(s => String(s || '').toLowerCase().includes(q)),
  )
})
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
// Desktop implementation kind: server-stored JS, or plain source for a device
// runtime (python/powershell/shell). Browser is always the safe DSL (program).
type DesktopKind = 'js' | ToolRuntime
interface Draft {
  original: string // existing tool name being edited, '' for new
  name: string
  description: string
  params: ParamRow[]
  steps: StepDraft[]
  js: string // desktop: server-stored JS body run with (args, cap, ctx)
  desktopKind: DesktopKind // desktop only: how the implementation runs
  source: string // desktop runtime: python/powershell/shell body
  permissions: string // desktop runtime: comma/space-separated permission tags
}

const DESKTOP_KINDS: { key: DesktopKind; label: string }[] = [
  { key: 'js', label: 'JS（cap 能力库）' },
  { key: 'python', label: 'Python' },
  { key: 'powershell', label: 'PowerShell' },
  { key: 'shell', label: 'Shell' },
]

// Desktop tools are real JS / runtime source; browser/android tools use the safe DSL.
const isDesktop = computed(() => deviceType.value === 'desktop')
const isJsMode = computed(() => isDesktop.value && draft.value?.desktopKind === 'js')
const isRuntimeMode = computed(() => isDesktop.value && draft.value != null && draft.value.desktopKind !== 'js')
const JS_TEMPLATE = "// 可用: args(入参) / cap(设备能力库) / ctx(workspaceRoot)\n// 例: return await cap.call('keyboard.type', { text: args.text })\nreturn await cap.call('namespace.tool', args)"
const SOURCE_TEMPLATES: Record<ToolRuntime, string> = {
  python: "# 可用: args(dict 入参)。把结果赋给 result 返回；print 输出进 stdout。\n# 例: result = {'sum': args.get('a', 0) + args.get('b', 0)}\nresult = {'ok': True}",
  powershell: "# 支持 ${args.x} 模板。\nWrite-Output \"hello ${args.name}\"",
  shell: "# 支持 ${args.x} 模板。\necho \"hello ${args.name}\"",
}
const sourceTemplate = (kind: DesktopKind): string => (kind === 'js' ? '' : SOURCE_TEMPLATES[kind])
const draft = ref<Draft | null>(null)
const saving = ref(false)
const versions = ref<DeviceToolVersion[]>([])
const versionsOpen = ref(false)
const versionsLoading = ref(false)

const currentTabLabel = computed(() => TABS.find(t => t.key === deviceType.value)?.label || '')

const load = async () => {
  if (!props.show) return
  loading.value = true
  error.value = ''
  try {
    const data = await listDeviceTools(deviceType.value)
    tools.value = data.tools || []
    availableTools.value = data.availableTools || []
    try {
      const s = await listDeviceToolStats(deviceType.value)
      statsByTool.value = Object.fromEntries((s.stats || []).map(st => [st.tool, st]))
    } catch {
      statsByTool.value = {}
    }
    if (deviceType.value === 'desktop') {
      try {
        const r = await getDeviceRuntimes('desktop')
        onlineRuntimes.value = r.runtimes || { python: false, powershell: false, shell: false }
      } catch {
        onlineRuntimes.value = { python: false, powershell: false, shell: false }
      }
    }
  } catch (err: any) {
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

const failures = ref<DeviceToolFailure[]>([])
const failuresOpen = ref(false)
const failuresLoading = ref(false)

const loadFailures = async () => {
  if (!draft.value?.original) { failures.value = []; return }
  failuresLoading.value = true
  try {
    const data = await listDeviceToolFailures(draft.value.original)
    failures.value = data.failures || []
  } catch (err: any) {
    error.value = err?.message || '失败记录加载失败'
  } finally {
    failuresLoading.value = false
  }
}

const toggleFailures = () => {
  failuresOpen.value = !failuresOpen.value
  if (failuresOpen.value && !failures.value.length) loadFailures()
}

const ratePct = (s?: DeviceToolStat) => (s ? Math.round((s.failure_rate || 0) * 100) : 0)

// Permission policy editor (desktop only): per-tag allow/confirm/deny override
// of the device's built-in defaults. '' means "use the device default".
const policyOpen = ref(false)
const policyTags = ref<string[]>([])
const policy = ref<Record<string, PermissionDecision | ''>>({})
const policySaving = ref(false)

// Runtime availability across the user's online desktop devices — drives a
// "no online device can run this" hint in the runtime editor.
const onlineRuntimes = ref<Record<string, boolean>>({ python: false, powershell: false, shell: false })
const runtimeUnavailable = computed(() =>
  isRuntimeMode.value && draft.value != null && draft.value.desktopKind !== 'js'
  && onlineRuntimes.value[draft.value.desktopKind] === false,
)

const loadPolicy = async () => {
  if (deviceType.value !== 'desktop') return
  try {
    const data = await getPermissionPolicy('desktop')
    policyTags.value = data.knownTags || []
    const next: Record<string, PermissionDecision | ''> = {}
    for (const t of policyTags.value) next[t] = (data.policy && data.policy[t]) || ''
    policy.value = next
  } catch { /* policy is optional; stay silent */ }
}

const togglePolicy = () => {
  policyOpen.value = !policyOpen.value
  if (policyOpen.value && !policyTags.value.length) loadPolicy()
}

const savePolicy = async () => {
  policySaving.value = true
  error.value = ''
  notice.value = ''
  try {
    const out: Record<string, PermissionDecision> = {}
    for (const [tag, dec] of Object.entries(policy.value)) if (dec) out[tag] = dec as PermissionDecision
    const res = await setPermissionPolicy('desktop', out)
    notice.value = `权限策略已保存，已推送到 ${res.pushedToDevices} 台在线设备`
  } catch (err: any) {
    error.value = err?.message || '保存权限策略失败'
  } finally {
    policySaving.value = false
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
    js: isDesktop.value ? JS_TEMPLATE : '',
    desktopKind: 'js',
    source: '',
    permissions: '',
  }
  versions.value = []
  versionsOpen.value = false
  failures.value = []
  failuresOpen.value = false
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
    js: String(tool.js || ''),
    desktopKind: tool.code_kind === 'runtime' && tool.runtime ? tool.runtime : 'js',
    source: String(tool.source || ''),
    permissions: (tool.permissions || []).join(', '),
  }
  if (!draft.value.steps.length) draft.value.steps = [blankStep()]
  if (isDesktop.value && draft.value.desktopKind === 'js' && !draft.value.js.trim()) draft.value.js = JS_TEMPLATE
  versions.value = []
  versionsOpen.value = false
  failures.value = []
  failuresOpen.value = false
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
  let definition
  if (isJsMode.value) {
    if (!d.js.trim()) { error.value = '请填写 JS 代码'; return }
    definition = {
      name,
      description: d.description.trim(),
      input_schema: buildInputSchema(d.params),
      code_kind: 'js' as const,
      js: d.js,
    }
  } else if (isRuntimeMode.value) {
    if (!d.source.trim()) { error.value = '请填写运行时源码'; return }
    definition = {
      name,
      description: d.description.trim(),
      input_schema: buildInputSchema(d.params),
      code_kind: 'runtime' as const,
      runtime: d.desktopKind as ToolRuntime,
      source: d.source,
      permissions: d.permissions.split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
    }
  } else {
    if (!d.steps.length) { error.value = '至少需要一条指令'; return }
    for (const step of d.steps) {
      if (step.op === 'call' && !step.tool.trim()) { error.value = 'call 指令需要选择目标工具'; return }
      if (step.op === 'set' && !step.name.trim()) { error.value = 'set 指令需要变量名'; return }
    }
    definition = {
      name,
      description: d.description.trim(),
      input_schema: buildInputSchema(d.params),
      code_kind: 'program' as const,
      code: buildCode(d.steps),
    }
  }
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await upsertDeviceTool(deviceType.value, definition)
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

const approve = async (tool: DeviceDynamicTool) => {
  error.value = ''
  notice.value = ''
  try {
    const res = await setDeviceToolStatus(deviceType.value, tool.name, 'active')
    notice.value = `已批准 ${tool.name}，已下发到 ${res.pushedToDevices} 台在线设备`
    await load()
  } catch (err: any) {
    error.value = err?.message || '批准失败'
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

const fmtTime = (ts: number) => formatDateTime(ts, '--')
const actionLabel = (a: string) => ({ upsert: '修改', delete: '删除', restore: '回滚' } as Record<string, string>)[a] || a

const loadVersions = async () => {
  if (!draft.value?.original) { versions.value = []; return }
  versionsLoading.value = true
  try {
    const data = await listDeviceToolVersions(deviceType.value, draft.value.original)
    versions.value = data.versions || []
  } catch (err: any) {
    error.value = err?.message || '历史版本加载失败'
  } finally {
    versionsLoading.value = false
  }
}

const toggleVersions = () => {
  versionsOpen.value = !versionsOpen.value
  if (versionsOpen.value && !versions.value.length) loadVersions()
}

const restore = async (versionId: number) => {
  if (!window.confirm('回滚到该版本？当前内容会被覆盖（并记录为一次新版本，可再回滚）。')) return
  error.value = ''
  notice.value = ''
  try {
    const res = await restoreDeviceToolVersion(deviceType.value, versionId)
    notice.value = `已回滚，已推送到 ${res.pushedToDevices} 台在线设备`
    draft.value = null
    versionsOpen.value = false
    await load()
  } catch (err: any) {
    error.value = err?.message || '回滚失败'
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

// Swap in the matching starter template when the desktop implementation kind
// changes, but never clobber code the operator already typed.
const KNOWN_TEMPLATES = [JS_TEMPLATE, ...Object.values(SOURCE_TEMPLATES)]
const onDesktopKindChange = () => {
  const d = draft.value
  if (!d) return
  if (d.desktopKind === 'js') {
    if (!d.js.trim() || KNOWN_TEMPLATES.includes(d.source.trim())) d.js = d.js.trim() || JS_TEMPLATE
  } else if (!d.source.trim() || KNOWN_TEMPLATES.includes(d.source.trim())) {
    d.source = sourceTemplate(d.desktopKind)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="props.show" class="fixed inset-0 z-[610] bg-black/40 flex items-center justify-center p-4" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-[680px] max-h-[82vh] p-4 overflow-auto" @click.stop>
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
            <div class="mb-2 flex justify-between items-center gap-2">
              <input
                v-model="listQuery"
                type="search"
                placeholder="搜索工具…"
                class="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
              />
              <button type="button" class="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500" @click="newTool">+ 新建</button>
            </div>
            <div v-if="!tools.length" class="text-xs text-zinc-400 py-6 text-center">还没有动态工具。连接一台{{ currentTabLabel }}设备后，可点「新建」组合其已上报能力。</div>
            <div v-else-if="!filteredTools.length" class="text-xs text-zinc-400 py-6 text-center">没有匹配的工具</div>
            <div class="space-y-1.5">
              <div
                v-for="tool in filteredTools"
                :key="tool.name"
                class="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 flex items-center gap-3"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ tool.name }}</div>
                  <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{{ tool.description }}</div>
                </div>
                <span
                  v-if="statsByTool[tool.name]?.total"
                  class="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                  :class="(statsByTool[tool.name].failures || 0) > 0
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'"
                  :title="`调用 ${statsByTool[tool.name].total} 次，失败 ${statsByTool[tool.name].failures} 次`"
                >失败 {{ statsByTool[tool.name].failures }}/{{ statsByTool[tool.name].total }}（{{ ratePct(statsByTool[tool.name]) }}%）</span>
                <span
                  v-if="tool.status === 'draft'"
                  class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  title="AI 提交的草稿，批准后才会下发到设备"
                >待批准</span>
                <button
                  v-if="tool.status === 'draft'"
                  type="button"
                  class="text-[11px] text-emerald-600 dark:text-emerald-300 hover:underline shrink-0"
                  @click="approve(tool)"
                >批准</button>
                <label class="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer shrink-0">
                  <input type="checkbox" class="h-3.5 w-3.5 accent-indigo-500" :checked="tool.enabled" @change="toggle(tool)" />
                  启用
                </label>
                <button type="button" class="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline shrink-0" @click="editTool(tool)">编辑</button>
                <button type="button" class="text-[11px] text-rose-600 dark:text-rose-300 hover:underline shrink-0" @click="remove(tool)">删除</button>
              </div>
            </div>

            <!-- permission policy (desktop only): per-tag allow/confirm/deny override -->
            <div v-if="deviceType === 'desktop'" class="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <button type="button" class="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300" @click="togglePolicy">
                <span>权限策略（runtime 工具的 allow / confirm / deny）</span>
                <span class="text-zinc-400">{{ policyOpen ? '收起' : '展开' }}</span>
              </button>
              <div v-if="policyOpen" class="border-t border-zinc-200 dark:border-zinc-700 p-2">
                <p class="mb-2 text-[10px] text-zinc-400 leading-relaxed">
                  覆盖设备内置默认值；「默认」表示沿用设备默认（只读多为允许、写入/输入多需确认、删除/提权拒绝）。改动保存后立即下发到在线设备。
                </p>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                  <label v-for="tag in policyTags" :key="tag" class="flex items-center gap-1.5">
                    <span class="flex-1 font-mono text-[10px] text-zinc-600 dark:text-zinc-300 truncate" :title="tag">{{ tag }}</span>
                    <select v-model="policy[tag]" class="rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-1 py-0.5 text-[10px]">
                      <option value="">默认</option>
                      <option value="allow">允许</option>
                      <option value="confirm">确认</option>
                      <option value="deny">拒绝</option>
                    </select>
                  </label>
                </div>
                <div class="mt-2 flex justify-end">
                  <button type="button" class="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-60" :disabled="policySaving" @click="savePolicy">{{ policySaving ? '保存中…' : '保存策略并下发' }}</button>
                </div>
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

            <!-- desktop implementation kind: JS (cap) or a device runtime -->
            <div v-if="isDesktop">
              <span class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">实现方式</span>
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="k in DESKTOP_KINDS"
                  :key="k.key"
                  type="button"
                  class="rounded-lg px-2.5 py-1 text-[11px] font-medium border"
                  :class="draft.desktopKind === k.key
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'"
                  @click="draft.desktopKind = k.key; onDesktopKindChange()"
                >{{ k.label }}</button>
              </div>
            </div>

            <!-- JS editor (desktop): server-stored code run on the device -->
            <div v-if="isJsMode">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">实现代码（JS · 在设备上执行）</span>
                <span class="text-[10px] text-zinc-400">服务器存储 · 改完即下发同步</span>
              </div>
              <textarea
                v-model="draft.js"
                rows="10"
                spellcheck="false"
                class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/50 px-2.5 py-2 text-[11px] font-mono leading-relaxed"
              />
              <p class="mt-1 text-[10px] text-zinc-400 leading-relaxed">
                作用域内可用：<code>args</code>（入参）、<code>cap</code>（设备原生能力库，如 <code>await cap.call('keyboard.type', args)</code> 或 <code>cap.keyboard.type(args)</code>）、<code>ctx.workspaceRoot</code>。用 <code>return</code> 返回结果。
              </p>
              <details class="mt-1">
                <summary class="text-[10px] text-indigo-600 dark:text-indigo-300 cursor-pointer">可用能力（{{ availableTools.length }}）</summary>
                <div class="mt-1 flex flex-wrap gap-1">
                  <code v-for="t in availableTools" :key="t.name" class="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">{{ t.name }}</code>
                </div>
              </details>
            </div>

            <!-- runtime editor (desktop): plain source run by python/powershell/shell -->
            <div v-else-if="isRuntimeMode">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">实现源码（{{ draft.desktopKind }} · 在设备上执行）</span>
                <span class="text-[10px] text-zinc-400">服务器存储 · 改完即下发同步</span>
              </div>
              <div v-if="runtimeUnavailable" class="mb-1 text-[10px] text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 rounded px-2 py-1">
                当前没有在线桌面设备报告支持 {{ draft.desktopKind }} 运行时（python 需 npm run setup:python 或安装解释器）。仍可保存，设备具备该运行时后即可调用。
              </div>
              <textarea
                v-model="draft.source"
                rows="10"
                spellcheck="false"
                class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/50 px-2.5 py-2 text-[11px] font-mono leading-relaxed"
              />
              <p class="mt-1 text-[10px] text-zinc-400 leading-relaxed">
                <template v-if="draft.desktopKind === 'python'">入参在 <code>args</code> 字典里；把结果赋给 <code>result</code> 返回。需要设备已装 Python（或设 <code>HEYSURE_PYTHON</code>）。</template>
                <template v-else>命令/脚本支持 <code>${'{'}args.x{'}'}</code> 模板。</template>
                高风险操作请在下方声明权限标签，设备会按策略弹窗确认或拒绝。
              </p>
              <label class="mt-2 block">
                <span class="text-[11px] text-zinc-500">权限标签（逗号分隔，可留空）</span>
                <input
                  v-model="draft.permissions"
                  placeholder="如 shell.write, filesystem.read, network"
                  class="mt-0.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2.5 py-1.5 text-[11px] font-mono"
                />
              </label>
            </div>

            <!-- steps (browser/android): the safe call/set/return DSL -->
            <div v-else>
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
                用 <code>builtin:工具名</code> 调用设备原生能力；目标工具名与参数均支持模板，如 <code>${'{'}args.tool{'}'}</code>、<code>${'{'}args.x{'}'}</code>、<code>${'{'}vars.x{'}'}</code>、<code>${'{'}last{'}'}</code>。
              </p>
            </div>

            <!-- version history / rollback (existing tools only) -->
            <div v-if="draft.original" class="rounded-lg border border-zinc-200 dark:border-zinc-700">
              <button type="button" class="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300" @click="toggleVersions">
                <span>历史版本（改坏了可回滚）</span>
                <span class="text-zinc-400">{{ versionsOpen ? '收起' : '展开' }}</span>
              </button>
              <div v-if="versionsOpen" class="border-t border-zinc-200 dark:border-zinc-700 p-2 space-y-1 max-h-44 overflow-auto">
                <div v-if="versionsLoading" class="text-[10px] text-zinc-400 py-2 text-center">加载中…</div>
                <div v-else-if="!versions.length" class="text-[10px] text-zinc-400 py-2 text-center">暂无历史版本</div>
                <div
                  v-for="v in versions"
                  :key="v.version_id"
                  class="flex items-center gap-2 rounded border border-zinc-100 dark:border-zinc-800 px-2 py-1"
                >
                  <span class="text-[10px] px-1 rounded" :class="v.action === 'delete' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'">{{ actionLabel(v.action) }}</span>
                  <span class="text-[10px] text-zinc-500">{{ v.actor === 'ai' ? 'AI' : '网页' }}</span>
                  <span class="text-[10px] text-zinc-400 flex-1 truncate">{{ fmtTime(v.created_at) }} · {{ v.revision.slice(0, 8) }}</span>
                  <button type="button" class="text-[10px] text-indigo-600 dark:text-indigo-300 hover:underline shrink-0" @click="restore(v.version_id)">还原</button>
                </div>
              </div>
            </div>

            <!-- failure trail (existing tools only): locate each failure in chat -->
            <div v-if="draft.original" class="rounded-lg border border-zinc-200 dark:border-zinc-700">
              <button type="button" class="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300" @click="toggleFailures">
                <span>
                  失败记录
                  <span v-if="statsByTool[draft.original]?.total" class="text-zinc-400">
                    （{{ statsByTool[draft.original].failures }}/{{ statsByTool[draft.original].total }} · {{ ratePct(statsByTool[draft.original]) }}%）
                  </span>
                </span>
                <span class="text-zinc-400">{{ failuresOpen ? '收起' : '展开' }}</span>
              </button>
              <div v-if="failuresOpen" class="border-t border-zinc-200 dark:border-zinc-700 p-2 space-y-1 max-h-44 overflow-auto">
                <div v-if="failuresLoading" class="text-[10px] text-zinc-400 py-2 text-center">加载中…</div>
                <div v-else-if="!failures.length" class="text-[10px] text-zinc-400 py-2 text-center">暂无失败记录</div>
                <div
                  v-for="(f, i) in failures"
                  :key="i"
                  class="rounded border border-zinc-100 dark:border-zinc-800 px-2 py-1"
                >
                  <div class="text-[10px] text-rose-600 dark:text-rose-300 break-words">{{ f.error || '失败' }}</div>
                  <div class="mt-0.5 text-[10px] text-zinc-400">
                    {{ fmtTime(f.created_at) }} · 会话 <span class="font-mono">{{ f.session_id || '—' }}</span>
                    <span v-if="f.message_id"> · 消息 #{{ f.message_id }}</span>
                    <span v-if="f.ai_config_id"> · AI #{{ f.ai_config_id }}</span>
                  </div>
                </div>
              </div>
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
  </Teleport>
</template>
