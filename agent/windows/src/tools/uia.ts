// UI Automation (UIA) tools — read the Windows accessibility tree and act on
// real controls instead of guessing pixel coordinates from a screenshot.
//
// 原理：Windows 把每个原生控件（按钮/输入框/列表项…）暴露成一棵可访问性树
// （类似桌面版 DOM）。我们用 PowerShell 加载 System.Windows.Automation 遍历这棵
// 树，拿到每个元素的精确包围盒和可执行动作（Invoke/Toggle/Select…）。
//
// 坐标系一致性（最易出 bug 的地方）：UIA 的 BoundingRectangle 与 SetCursorPos 都
// 工作在物理像素。我们把 PowerShell 进程显式设为 per-monitor DPI aware，让"读到的
// 坐标"和"点下去的坐标"处于同一坐标系，因此 ui.click 的物理点击回退不依赖 robotjs
// 的标定换算（toRobotPoint），从根上避开 DPI 缩放导致的"看着对、点着偏"。
//
// 点击优先级：能 Invoke 的元素直接 InvokePattern.Invoke()（最稳、不移动真实光标、
// 不受遮挡影响）；不支持 Invoke 的（或显式要求物理点击 / 右键）才移动光标做真实点击。

import { runPowerShellScript } from './shared/powershell'

function psString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function psBool(value: boolean): string {
  return value ? '$true' : '$false'
}

function psNullableString(value: unknown): string {
  if (value === undefined || value === null || String(value).length === 0) return '$null'
  return psString(String(value))
}

function psInt(value: unknown, fallback: number): string {
  const n = Math.trunc(Number(value))
  return String(Number.isFinite(n) ? n : fallback)
}

// Shared PowerShell prelude: load UIA assemblies, declare Win32 helpers, set
// DPI awareness, and define the tree-walking / element-inspection helpers.
function preludeScript(): string {
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  @{ success = $false; error = 'UIAutomation assemblies unavailable: ' + $_.Exception.Message } | ConvertTo-Json -Compress
  exit 0
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HSUia {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4; fall back to legacy on older OS.
try { [void][HSUia]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][HSUia]::SetProcessDPIAware() } catch {} }

$AE = [System.Windows.Automation.AutomationElement]
$WALKER = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Get-CtName($el) {
  try { return ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', '') } catch { return '' }
}

function Get-Rect($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ([double]::IsInfinity($r.X) -or [double]::IsNaN($r.X)) { return $null }
    if ($r.Width -le 0 -or $r.Height -le 0) { return $null }
    if ([Math]::Abs($r.X) -gt 200000 -or [Math]::Abs($r.Y) -gt 200000) { return $null }
    return @{
      x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height
      center_x = [int]($r.X + $r.Width / 2); center_y = [int]($r.Y + $r.Height / 2)
    }
  } catch { return $null }
}

function Get-Actions($el) {
  $actions = @()
  $p = $null
  try { if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $actions += 'invoke' } } catch {}
  try { if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $actions += 'toggle' } } catch {}
  try { if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $actions += 'select' } } catch {}
  try { if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $actions += 'expand' } } catch {}
  try { if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $actions += 'value' } } catch {}
  return $actions
}

$INTERACTIVE_TYPES = @('Button','MenuItem','TabItem','ListItem','CheckBox','RadioButton','Hyperlink','SplitButton','TreeItem','ComboBox','Edit','Slider','Spinner','Document','Custom')

function Is-Interactive($ct, $actions, $focusable) {
  if ($actions.Count -gt 0) { return $true }
  if ($focusable) { return $true }
  return ($INTERACTIVE_TYPES -contains $ct)
}

function Resolve-Root($titleQuery) {
  if ($null -ne $titleQuery) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::IsControlElementProperty, $true)
    $wins = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $wins) {
      try { if ($w.Current.Name -like ('*' + $titleQuery + '*')) { return $w } } catch {}
    }
    return $null
  }
  $h = [HSUia]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { return $null }
  return $AE::FromHandle($h)
}

# Bounded DFS over the control view; returns up to $cap interactive elements.
# $maxDepth / $nodeCap keep giant trees (e.g. browsers) from blocking forever.
function Walk-Elements($root, $cap, $maxDepth, $nodeCap, $interactiveOnly) {
  $out = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($root, 0))
  $visited = 0
  while ($stack.Count -gt 0 -and $out.Count -lt $cap -and $visited -lt $nodeCap) {
    $frame = $stack.Pop(); $node = $frame[0]; $depth = $frame[1]
    $visited++
    if ($depth -gt 0) {
      try {
        $ct = Get-CtName $node
        $rect = Get-Rect $node
        $offscreen = $false
        try { $offscreen = $node.Current.IsOffscreen } catch {}
        if (($null -ne $rect) -and (-not $offscreen)) {
          $name = ''
          try { $name = $node.Current.Name } catch {}
          $aid = ''
          try { $aid = $node.Current.AutomationId } catch {}
          $enabled = $true
          try { $enabled = $node.Current.IsEnabled } catch {}
          $focusable = $false
          try { $focusable = $node.Current.IsKeyboardFocusable } catch {}
          $actions = Get-Actions $node
          if ((-not $interactiveOnly) -or (Is-Interactive $ct $actions $focusable)) {
            [void]$out.Add(@{
              name = $name; control_type = $ct; automation_id = $aid
              enabled = $enabled; rect = $rect; actions = $actions
            })
          }
        }
      } catch {}
    }
    if ($depth -lt $maxDepth) {
      try {
        $child = $WALKER.GetFirstChild($node)
        while ($null -ne $child) {
          $stack.Push(@($child, $depth + 1))
          $child = $WALKER.GetNextSibling($child)
        }
      } catch {}
    }
  }
  return ,$out
}
`
}

export async function uiInspect(args: any = {}) {
  const title = psNullableString(args.title)
  const interactiveOnly = psBool(args.interactable_only !== false && args.interactive_only !== false)
  const max = psInt(args.max ?? args.limit, 150)
  const maxDepth = psInt(args.max_depth, 40)

  const script = `${preludeScript()}
$root = Resolve-Root ${title}
if ($null -eq $root) {
  @{ success = $false; error = 'No target window (foreground window not found or title not matched).' } | ConvertTo-Json -Compress
  exit 0
}
$winTitle = ''
try { $winTitle = $root.Current.Name } catch {}
$elements = Walk-Elements $root ${max} ${maxDepth} 6000 ${interactiveOnly}
$indexed = @()
for ($i = 0; $i -lt $elements.Count; $i++) {
  $e = $elements[$i]
  $e['index'] = $i
  $indexed += $e
}
@{ success = $true; window = $winTitle; count = $indexed.Count; elements = $indexed } | ConvertTo-Json -Depth 6 -Compress
`

  const { stdout, stderr, exitCode } = await runPowerShellScript(script)
  if (!stdout) {
    throw new Error(stderr || `ui.inspect failed (exit ${exitCode})`)
  }
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`ui.inspect returned non-JSON: ${stdout.slice(0, 500)}`)
  }
}

export async function uiClick(args: any = {}) {
  const title = psNullableString(args.title)
  const name = psNullableString(args.name)
  const automationId = psNullableString(args.automation_id ?? args.automationId)
  const controlType = psNullableString(args.control_type ?? args.controlType)
  const index = psInt(args.index, 0)
  const maxDepth = psInt(args.max_depth, 40)
  const method = String(args.method || 'auto').toLowerCase() // auto | invoke | mouse
  const button = String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left'
  const double = psBool(args.double === true || args.double_click === true)

  if (automationId === '$null' && name === '$null' && controlType === '$null') {
    throw new Error('ui.click requires at least one of: name, automation_id, control_type')
  }

  const script = `${preludeScript()}
$root = Resolve-Root ${title}
if ($null -eq $root) {
  @{ success = $false; error = 'No target window (foreground window not found or title not matched).' } | ConvertTo-Json -Compress
  exit 0
}
$wantName = ${name}
$wantAid = ${automationId}
$wantCt = ${controlType}
$wantIndex = ${index}
$method = '${method}'
$button = '${button}'
$double = ${double}

$all = Walk-Elements $root 5000 ${maxDepth} 6000 $true
$matches = @()
foreach ($e in $all) {
  if (($null -ne $wantAid) -and ($e.automation_id -ne $wantAid)) { continue }
  if (($null -ne $wantName) -and ($e.name -ne $wantName)) { continue }
  if (($null -ne $wantCt) -and ($e.control_type -ne $wantCt)) { continue }
  $matches += $e
}
# Fall back to a contains-match on name if no exact match was found.
if (($matches.Count -eq 0) -and ($null -ne $wantName)) {
  foreach ($e in $all) {
    if (($null -ne $wantAid) -and ($e.automation_id -ne $wantAid)) { continue }
    if (($null -ne $wantCt) -and ($e.control_type -ne $wantCt)) { continue }
    if ($e.name -like ('*' + $wantName + '*')) { $matches += $e }
  }
}
if ($matches.Count -eq 0) {
  @{ success = $false; error = 'No matching element'; candidates = ($all | Select-Object -First 40) } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}
if ($wantIndex -ge $matches.Count) { $wantIndex = 0 }
$target = $matches[$wantIndex]

# Re-locate the live AutomationElement (the walk above captured plain hashtables).
$conds = New-Object System.Collections.ArrayList
if ($null -ne $wantAid) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $wantAid))) }
if ($null -ne $target.name -and $target.name.Length -gt 0) { [void]$conds.Add((New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $target.name))) }
$live = $null
if ($conds.Count -gt 0) {
  $cond = if ($conds.Count -eq 1) { $conds[0] } else { New-Object System.Windows.Automation.AndCondition([System.Windows.Automation.Condition[]]$conds.ToArray()) }
  try {
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($f in $found) {
      $r = Get-Rect $f
      if ($null -ne $r -and $r.center_x -eq $target.rect.center_x -and $r.center_y -eq $target.rect.center_y) { $live = $f; break }
    }
    if (($null -eq $live) -and ($found.Count -gt 0)) { $live = $found[0] }
  } catch {}
}

$cx = $target.rect.center_x
$cy = $target.rect.center_y
$used = 'none'

function Do-MouseClick($x, $y, $btn, $dbl) {
  [void][HSUia]::SetCursorPos([int]$x, [int]$y)
  Start-Sleep -Milliseconds 40
  $down = if ($btn -eq 'right') { 0x08 } else { 0x02 }
  $up = if ($btn -eq 'right') { 0x10 } else { 0x04 }
  [HSUia]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
  [HSUia]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
  if ($dbl) {
    Start-Sleep -Milliseconds 60
    [HSUia]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
    [HSUia]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
  }
}

$canInvoke = ($null -ne $live) -and ($target.actions -contains 'invoke')
if (($button -eq 'right') -or $double) { $method = 'mouse' }

if (($method -eq 'invoke') -or (($method -eq 'auto') -and $canInvoke)) {
  if ($null -eq $live) {
    @{ success = $false; error = 'Element matched but live handle not found for invoke; retry with method=mouse.' } | ConvertTo-Json -Compress
    exit 0
  }
  $p = $null
  if ($live.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
    $p.Invoke(); $used = 'invoke'
  } elseif ($live.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) {
    $p.Select(); $used = 'select'
  } elseif ($live.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {
    $p.Toggle(); $used = 'toggle'
  } else {
    Do-MouseClick $cx $cy $button $double; $used = 'mouse'
  }
} else {
  # Prefer the element's own clickable point when available.
  if ($null -ne $live) {
    try {
      $pt = $live.GetClickablePoint()
      $cx = [int]$pt.X; $cy = [int]$pt.Y
    } catch {}
    try { [void]$live.SetFocus() } catch {}
  }
  Do-MouseClick $cx $cy $button $double; $used = 'mouse'
}

@{ success = $true; method = $used; button = $button; double = $double; position = @{ x = $cx; y = $cy }; element = @{ name = $target.name; control_type = $target.control_type; automation_id = $target.automation_id; rect = $target.rect } } | ConvertTo-Json -Depth 6 -Compress
`

  const { stdout, stderr, exitCode } = await runPowerShellScript(script)
  if (!stdout) {
    throw new Error(stderr || `ui.click failed (exit ${exitCode})`)
  }
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`ui.click returned non-JSON: ${stdout.slice(0, 500)}`)
  }
}
