// Microphone speech-to-text on Linux.
//
// Unlike Windows (System.Speech) there is no built-in dictation engine on a
// stock Linux desktop, so this tool drives an external recognizer. Point the
// HS_STT_CMD env var at any program that listens on the microphone and writes
// one JSON object per line to stdout, e.g.
//
//   HS_STT_CMD='vosk-transcriber --model /opt/vosk --json'
//
// Each line should look like { "type": "recognized" | "partial", "text": "...",
// "confidence": 0.9 }. Plain (non-JSON) lines are treated as recognized text.
// When HS_STT_CMD is unset the tool degrades gracefully: it reports that no
// recognizer is configured instead of throwing, so the rest of the agent keeps
// working.

import * as readline from 'readline'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

interface EarEvent {
  id: number
  timestamp: number
  type: 'recognized' | 'partial' | 'error'
  text: string
  confidence?: number
}

function sttCommand(): string {
  return String(process.env.HS_STT_CMD || '').trim()
}

class EarMonitor {
  private child: ChildProcessWithoutNullStreams | null = null
  private events: EarEvent[] = []
  private sequence = 0
  private lastError: string | null = null

  start() {
    if (this.child) return { running: true }
    const cmd = sttCommand()
    if (!cmd) {
      this.lastError = '未配置语音识别命令。请设置环境变量 HS_STT_CMD 指向一个把识别结果按行输出 JSON 的程序（如 vosk）。'
      return { running: false, configured: false, lastError: this.lastError }
    }
    try {
      this.child = spawn('/bin/bash', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch (err: any) {
      this.lastError = err?.message || String(err)
      return { running: false, configured: true, lastError: this.lastError }
    }
    const rl = readline.createInterface({ input: this.child.stdout })
    rl.on('line', line => this.onLine(line))
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString().trim()
      if (text) this.lastError = text
    })
    this.child.on('close', () => { this.child = null })
    this.child.on('error', err => { this.lastError = err.message; this.child = null })
    return { running: true, configured: true }
  }

  stop() {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    return { running: false }
  }

  latest() {
    if (!this.child && sttCommand()) this.start()
    return {
      running: !!this.child,
      configured: !!sttCommand(),
      lastError: this.lastError,
      latest: this.events[this.events.length - 1] || null,
      events: this.events.slice(-20),
    }
  }

  private pushEvent(type: EarEvent['type'], text: string, confidence?: number) {
    const event: EarEvent = { id: ++this.sequence, timestamp: Date.now(), type, text, confidence }
    this.events.push(event)
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200)
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const parsed = JSON.parse(trimmed)
      const type = String(parsed.type || 'recognized').toLowerCase()
      const text = String(parsed.text || '').trim()
      const confidence = parsed.confidence !== undefined ? Number(parsed.confidence) : undefined
      if (!text && type !== 'error') return
      if (type === 'partial') this.pushEvent('partial', text, confidence)
      else if (type === 'error') this.pushEvent('error', text || 'speech recognition error')
      else this.pushEvent('recognized', text, confidence)
    } catch {
      // Not JSON — treat the raw line as recognized text.
      this.pushEvent('recognized', trimmed)
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
