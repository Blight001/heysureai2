import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { runPowerShellScript, quotePsSingle } from './shared/powershell'

type SpeakMethod = 'powershell' | 'sapi-cscript'

function normalizeRate(value: any, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-10, Math.min(10, Math.trunc(n)))
}

function normalizeVolume(value: any, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.trunc(n)))
}

function quoteVbsString(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function cscriptCandidates(): string[] {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return [
    `${root}\\System32\\cscript.exe`,
    `${root}\\Sysnative\\cscript.exe`,
    'cscript.exe',
  ]
}

function vbsUnicodeBuffer(content: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')])
}

function runCscript(scriptPath: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const commands = cscriptCandidates()
  let index = 0

  return new Promise(resolve => {
    const runNext = (lastError = '') => {
      const command = commands[index++]
      if (!command) {
        resolve({ exitCode: 1, stdout: '', stderr: lastError || 'Windows Script Host is not available' })
        return
      }

      if (command.includes('\\') && !existsSync(command)) {
        runNext(lastError)
        return
      }

      const child = spawn(command, ['//nologo', scriptPath], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      let spawnFailed = false
      child.stdout.on('data', chunk => { stdout += chunk.toString() })
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.on('error', err => {
        spawnFailed = true
        runNext([stderr, err.message].filter(Boolean).join('\n').trim())
      })
      child.on('close', code => {
        if (spawnFailed) return
        resolve({
          exitCode: typeof code === 'number' ? code : 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })
    }

    runNext()
  })
}

async function speakWithSapiCscript(text: string, rate: number, volume: number, voiceName: string): Promise<void> {
  const dir = path.join(os.tmpdir(), `heysure-sapi-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const scriptPath = path.join(dir, 'speak.vbs')
  const voiceLiteral = quoteVbsString(voiceName)
  const script = [
    'Dim synth',
    'Set synth = CreateObject("SAPI.SpVoice")',
    `synth.Rate = ${rate}`,
    `synth.Volume = ${volume}`,
    voiceName ? [
      'Dim voice',
      'For Each voice In synth.GetVoices',
      `  If LCase(voice.GetDescription) = LCase(${voiceLiteral}) Or InStr(1, LCase(voice.GetDescription), LCase(${voiceLiteral}), 1) > 0 Then`,
      '    Set synth.Voice = voice',
      '    Exit For',
      '  End If',
      'Next',
    ].join('\r\n') : '',
    `synth.Speak ${quoteVbsString(text)}`,
  ].filter(Boolean).join('\r\n')

  await mkdir(dir, { recursive: true })
  try {
    await writeFile(scriptPath, vbsUnicodeBuffer(script))
    const result = await runCscript(scriptPath)
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'SAPI speech synthesis failed')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function mouthSpeak(args: any = {}) {
  const text = String(args.text || args.content || '').trim()
  if (!text) throw new Error('text is required for speech.speak')

  const rate = normalizeRate(args.rate, 0)
  const volume = normalizeVolume(args.volume, 100)
  const voiceName = String(args.voice || args.voice_name || '').trim()
  let method: SpeakMethod = 'powershell'

  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.Rate = ${rate}`,
    `$synth.Volume = ${volume}`,
    voiceName ? `$synth.SelectVoice(${quotePsSingle(voiceName)})` : '',
    `$synth.Speak(${quotePsSingle(text)})`,
  ].filter(Boolean).join('\n')

  const result = await runPowerShellScript(script)
  if (result.exitCode !== 0) {
    method = 'sapi-cscript'
    try {
      await speakWithSapiCscript(text, rate, volume, voiceName)
    } catch (err: any) {
      const psError = result.stderr || 'PowerShell speech synthesis failed'
      const sapiError = err?.message || String(err)
      throw new Error(`speech synthesis failed. PowerShell: ${psError}; SAPI fallback: ${sapiError}`)
    }
  }

  return {
    success: true,
    method,
    text,
    length: text.length,
    rate,
    volume,
    voice: voiceName || null,
  }
}
