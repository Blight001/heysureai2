// Skill-card local replay loop — the `card.execute` endpoint tool (S2，见
// doc/沉淀技能卡片-设计方案.md §4.2/§4.3）。
//
// 思路：一段已验证成功的动作序列在 endpoint 本地一口气重放，不再逐步往返云端过
// LLM。每步先按锚点定位（image/coord，第一版无 UIA/CV → 主要靠坐标 + vision 兜底），
// 执行对应 endpoint 工具，再校验该步断言；任一步定位歧义/断言不过就**停在该步**，
// 打包失败现场回传，让 AI 精准改那一步并从失败步续跑（§4.3 自愈）。
//
// 权限交集（§6.2）与参数代入（§6.1）已在服务端 skill_card.prepare_execution 完成，
// 这里收到的是 resolved 卡片：steps 里的 {{slot}} 已被实参替换，capability 已校验过。

import { getTool, ToolHandlerArgs } from './registry'

type Json = Record<string, any>

interface Anchor {
  strategy: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  ref?: string
  threshold?: number
}

interface StepTarget {
  anchors?: Anchor[]
  region?: Json
  disambiguate?: Json
  ordinal?: number | null
  expect_count?: number
  vision_fallback?: { enabled?: boolean; hint?: string }
}

interface Step {
  index: number
  act: string
  tool?: string
  args?: Json
  target?: StepTarget
  assert?: Json
  on_fail?: string
  destructive?: boolean
}

interface ResolvedCard {
  steps?: Step[]
  app_scope?: Json | null
  preconditions?: Json[]
  postconditions?: Json[]
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, Math.max(0, ms || 0)))

// act → 具体 endpoint 工具的兜底映射（录制时会直接写 step.tool，这里兜历史卡片）。
const ACT_TO_TOOL: Record<string, string> = {
  click: 'mouse.click',
  double_click: 'mouse.double_click',
  right_click: 'mouse.right_click',
  scroll: 'mouse.scroll',
  drag: 'mouse.drag',
  move: 'mouse.move',
  type: 'keyboard.type',
  press: 'keyboard.press',
  set_clipboard: 'clipboard.set',
  focus_window: 'window.focus',
  close_window: 'window.close',
  kill_process: 'process.kill',
  write_file: 'fs.write',
  run_shell: 'shell.run',
}

async function callTool(workspaceRoot: string, id: string, args: Json): Promise<any> {
  const def = getTool(id)
  if (!def) throw new Error(`tool ${id} is not available on this endpoint`)
  return await def.handler({ workspaceRoot, args })
}

async function listWindows(workspaceRoot: string): Promise<Json[]> {
  try {
    const res = await callTool(workspaceRoot, 'window.list', {})
    const wins = (res && (res.windows || res.result?.windows)) || []
    return Array.isArray(wins) ? wins : []
  } catch {
    return []
  }
}

function windowMatches(win: Json, needle: string): boolean {
  const n = (needle || '').toLowerCase()
  if (!n) return false
  const title = String(win.title || '').toLowerCase()
  const name = String(win.name || '').toLowerCase()
  return title.includes(n) || name.includes(n)
}

async function captureFailureShot(workspaceRoot: string): Promise<string | undefined> {
  // 失败现场带一张截图，供 AI 视觉判断（§4.3）。截图失败不应掩盖原始故障。
  try {
    const res = await callTool(workspaceRoot, 'screen.capture', { upload_to_server: true })
    const payload = res?.result || res
    return payload?.path || payload?.dataUrl || payload?.workspacePath
  } catch {
    return undefined
  }
}

interface FailureScene {
  success: false
  halted: true
  failed_step: number
  reason: string
  expected?: any
  actual?: any
  resume_from: number
  vision_hint?: string
  screenshot?: string
}

async function failureScene(
  workspaceRoot: string,
  step: Step,
  reason: string,
  actual: any,
  expected?: any,
): Promise<FailureScene> {
  const scene: FailureScene = {
    success: false,
    halted: true,
    failed_step: step.index,
    reason,
    expected,
    actual,
    resume_from: step.index, // 从失败步续跑，而非从头重来（§4.3）
  }
  const hint = step.target?.vision_fallback?.hint
  if (hint) scene.vision_hint = hint
  const shot = await captureFailureShot(workspaceRoot)
  if (shot) scene.screenshot = shot
  return scene
}

interface Located {
  reason?: string        // 定位失败原因：not_found | ambiguous | needs_vision
  detail?: string
  coords: Json           // 注入到工具 args 的坐标（可能为空：如 keyboard.type 不需要定位）
}

// 锚点定位（§2.1/§2.3）。第一版无 UIA/模板匹配，可确定性使用的只有 coord 锚点；
// 仅有 image/region/disambiguate 而无 coord 时，退回 vision（交回 AI 重新视觉发现）。
function locate(target: StepTarget | undefined): Located {
  if (!target) return { coords: {} }
  const anchors = target.anchors || []
  const coordAnchor = anchors.find(a => a.strategy === 'coord' && typeof a.x === 'number')

  // region/disambiguate 需要在屏幕上数候选、按相对邻居消歧——都依赖视觉/CV，第一版
  // 没有则交回 AI（§2.3 铁律二：数不清就停手，绝不乱点）。
  const needsRecognition = !!(target.region || target.disambiguate)

  if (coordAnchor && !needsRecognition) {
    const coords: Json = { x: coordAnchor.x, y: coordAnchor.y }
    if (typeof coordAnchor.to_x === 'number') {
      coords.from_x = coordAnchor.x
      coords.from_y = coordAnchor.y
      coords.to_x = coordAnchor.to_x
      coords.to_y = coordAnchor.to_y
    }
    return { coords }
  }

  const hasImage = anchors.some(a => a.strategy === 'image' || a.strategy === 'uia')
  if (needsRecognition) {
    return { reason: 'needs_vision', detail: 'region/disambiguation requires visual recognition', coords: {} }
  }
  if (hasImage) {
    return { reason: 'needs_vision', detail: 'only image/uia anchors present; no deterministic coordinate', coords: {} }
  }
  return { reason: 'not_found', detail: 'no usable anchor', coords: {} }
}

interface AssertResult { ok: boolean; actual?: any; expected?: any }

// 逐步断言（§3.2）。第一版可确定性校验的断言有限：window 开/关用 window.list 验证，
// 其余（settle / row_removed 等需 CV）退化为「等待 + 放过」，保住结构不捏造结论。
async function evalAssert(workspaceRoot: string, assertion: Json | undefined): Promise<AssertResult> {
  if (!assertion || !assertion.check) {
    await sleep(300)
    return { ok: true }
  }
  const check = String(assertion.check)
  const value = String(assertion.value || '')
  const timeout = Number(assertion.timeout_ms || 1500)

  if (check === 'settle' || check === 'row_removed' || check === 'stable') {
    await sleep(Math.min(timeout, 1500))
    return { ok: true }
  }

  const deadline = Date.now() + timeout
  while (true) {
    const wins = await listWindows(workspaceRoot)
    const present = wins.some(w => windowMatches(w, value))
    if (check === 'window_closed') {
      if (!present) return { ok: true }
    } else if (check === 'window_open' || check === 'window_active' || check === 'active_window_matches') {
      if (present) return { ok: true }
    } else {
      // 未知断言类型：不假装能验证，等一下放过。
      await sleep(Math.min(timeout, 800))
      return { ok: true }
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        expected: `${check}: ${value}`,
        actual: check === 'window_closed' ? `window "${value}" still present` : `window "${value}" not found`,
      }
    }
    await sleep(250)
  }
}

async function checkPrecondition(workspaceRoot: string, pc: Json): Promise<boolean> {
  const check = String(pc?.check || '')
  const value = String(pc?.value || '')
  if (check === 'active_window_matches' || check === 'window_open') {
    const wins = await listWindows(workspaceRoot)
    return wins.some(w => windowMatches(w, value))
  }
  // requires:[...] 这类环境前置（已装某软件 / 已登录）无法本地确定性校验，
  // 不在 endpoint 假阳性放行也不硬拦——交由调用方在 prepare 阶段把关，这里放过。
  return true
}

export async function cardExecute({ workspaceRoot, args }: ToolHandlerArgs): Promise<any> {
  const resolved: ResolvedCard = (args.resolved || args.card || args) as ResolvedCard
  const steps: Step[] = Array.isArray(resolved.steps) ? resolved.steps : []
  const appScope: Json | null = resolved.app_scope || null
  const preconditions: Json[] = resolved.preconditions || []
  const postconditions: Json[] = resolved.postconditions || []
  const resumeFrom = Number(args.resume_from || 0)
  const dryRun = !!args.dry_run

  if (steps.length === 0) {
    return { success: false, error: 'card has no steps to replay' }
  }

  // 1) 前置条件：不满足直接拒绝，不瞎跑（§4.2-1）。
  for (const pc of preconditions) {
    if (!(await checkPrecondition(workspaceRoot, pc))) {
      return { success: false, halted: true, reason: 'precondition_failed', expected: pc }
    }
  }

  // 2) 作用域锁定（§2.2）：进程过滤 + window.focus 置顶（第一版弱隔离，§5.1）。
  if (appScope && appScope.process) {
    const wins = await listWindows(workspaceRoot)
    const proc = String(appScope.process).toLowerCase()
    const inScope = wins.filter(w => String(w.name || '').toLowerCase().includes(proc.replace(/\.exe$/, '')))
    if (inScope.length === 0) {
      const onMissing = String(appScope.on_missing || 'halt')
      if (onMissing === 'halt') {
        // 目标应用没开 → 停手，绝不去别的窗口找（§2.2 安全底线）。
        return { success: false, halted: true, reason: 'app_not_open', expected: appScope }
      }
    } else if (appScope.window_match) {
      try {
        await callTool(workspaceRoot, 'window.focus', { title: String(appScope.window_match) })
        await sleep(250)
      } catch {
        /* 置顶失败不致命，继续；定位/断言会兜住 */
      }
    }
  }

  // 3) 逐步重放。
  const ran: Json[] = []
  for (const step of steps) {
    if (step.index < resumeFrom) {
      ran.push({ index: step.index, skipped: 'before_resume' })
      continue
    }

    const loc = locate(step.target)
    if (loc.reason) {
      // 锚点全失败：能退回 AI 视觉发现就回传现场（§4.2-5），否则按 not_found 停手。
      return await failureScene(workspaceRoot, step, loc.reason, loc.detail)
    }

    const tool = step.tool || ACT_TO_TOOL[step.act] || step.act
    const callArgs: Json = { ...(step.args || {}), ...loc.coords }

    if (!dryRun) {
      try {
        const res = await callTool(workspaceRoot, tool, callArgs)
        if (res && res.success === false) {
          return await failureScene(workspaceRoot, step, 'exec_error', res.error || res.stderr || 'tool reported failure')
        }
      } catch (e: any) {
        return await failureScene(workspaceRoot, step, 'exec_error', e?.message || String(e))
      }
    }

    const a = await evalAssert(workspaceRoot, step.assert)
    if (!a.ok) {
      const onFail = String(step.on_fail || 'halt')
      if (onFail === 'skip') {
        ran.push({ index: step.index, assert: 'failed_skipped' })
        continue
      }
      return await failureScene(workspaceRoot, step, 'assert_failed', a.actual, a.expected)
    }

    ran.push({ index: step.index, tool, ok: true, dry_run: dryRun || undefined })
  }

  // 4) 后置条件（best-effort，与断言同一套校验）。
  for (const post of postconditions) {
    const a = await evalAssert(workspaceRoot, post)
    if (!a.ok) {
      return {
        success: false,
        halted: true,
        reason: 'postcondition_failed',
        expected: a.expected,
        actual: a.actual,
        replayed: ran.length,
      }
    }
  }

  return { success: true, replayed: ran.length, steps: ran, dry_run: dryRun }
}
