import { runPowerShellScript, quotePsSingle } from './shared/powershell'

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

export async function mouthSpeak(args: any = {}) {
  const text = String(args.text || args.content || '').trim()
  if (!text) throw new Error('text is required for speech.speak')

  const rate = normalizeRate(args.rate, 0)
  const volume = normalizeVolume(args.volume, 100)
  const voiceName = String(args.voice || args.voice_name || '').trim()

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
    throw new Error(result.stderr || 'speech synthesis failed')
  }

  return {
    success: true,
    text,
    length: text.length,
    rate,
    volume,
    voice: voiceName || null,
  }
}

