import * as readline from 'readline'
import { spawnPowerShellScript } from './shared/powershell'

interface EarEvent {
  id: number
  timestamp: number
  type: 'recognized' | 'partial' | 'error'
  text: string
  confidence?: number
}

class EarMonitor {
  private child: ReturnType<typeof spawnPowerShellScript> | null = null
  private events: EarEvent[] = []
  private sequence = 0
  private lastError: string | null = null

  start() {
    if (this.child) return { running: true }
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()
Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -Action {
  try {
    $res = $Event.SourceEventArgs.Result
    $payload = [PSCustomObject]@{
      type = 'recognized'
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      text = $res.Text
      confidence = [Math]::Round($res.Confidence, 3)
    }
    Write-Output ($payload | ConvertTo-Json -Compress)
  } catch {
    Write-Output (@{ type = 'error'; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); text = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
} | Out-Null
Register-ObjectEvent -InputObject $recognizer -EventName SpeechHypothesized -Action {
  try {
    $res = $Event.SourceEventArgs.Result
    if ($res -and $res.Text) {
      $payload = [PSCustomObject]@{
        type = 'partial'
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        text = $res.Text
        confidence = [Math]::Round($res.Confidence, 3)
      }
      Write-Output ($payload | ConvertTo-Json -Compress)
    }
  } catch {}
} | Out-Null
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
while ($true) { Start-Sleep -Milliseconds 250 }
`
    this.child = spawnPowerShellScript(script)
    const rl = readline.createInterface({ input: this.child.stdout })
    rl.on('line', line => this.onLine(line))
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString().trim()
      if (text) this.lastError = text
    })
    this.child.on('close', () => {
      this.child = null
    })
    return { running: true }
  }

  stop() {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    return { running: false }
  }

  latest() {
    if (!this.child) this.start()
    return {
      running: !!this.child,
      lastError: this.lastError,
      latest: this.events[this.events.length - 1] || null,
      events: this.events.slice(-20),
    }
  }

  private pushEvent(type: EarEvent['type'], text: string, confidence?: number) {
    const event: EarEvent = {
      id: ++this.sequence,
      timestamp: Date.now(),
      type,
      text,
      confidence,
    }
    this.events.push(event)
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200)
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const parsed = JSON.parse(trimmed)
      const type = String(parsed.type || '').toLowerCase()
      const text = String(parsed.text || '').trim()
      const confidence = parsed.confidence !== undefined ? Number(parsed.confidence) : undefined
      if (!text && type !== 'error') return
      if (type === 'recognized') this.pushEvent('recognized', text, confidence)
      else if (type === 'partial') this.pushEvent('partial', text, confidence)
      else if (type === 'error') this.pushEvent('error', text || 'speech recognition error')
    } catch {
      this.lastError = trimmed
    }
  }
}

const monitor = new EarMonitor()

export async function earStart() {
  return monitor.start()
}

export async function earStop() {
  return monitor.stop()
}

export async function earLatest() {
  return monitor.latest()
}
