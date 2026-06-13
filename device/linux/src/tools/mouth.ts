// Text-to-speech on Linux. Prefers speech-dispatcher (spd-say) for natural
// voices and language autodetection, falling back to espeak-ng / espeak. The
// Windows build's -10..10 rate / 0..100 volume contract is preserved and
// mapped onto whichever engine is available.

import { runCmd, firstAvailable } from './shared/command'

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

  const engine = firstAvailable(['spd-say', 'espeak-ng', 'espeak'])
  if (!engine) {
    throw new Error('未找到语音合成引擎，请安装 speech-dispatcher 或 espeak-ng：sudo apt install speech-dispatcher espeak-ng')
  }

  let cmdArgs: string[]
  if (engine === 'spd-say') {
    // spd-say: -r rate (-100..100), -i volume (-100..100), -w wait for end.
    cmdArgs = ['-w', '-r', String(rate * 10), '-i', String(volume - 100)]
    if (voiceName) cmdArgs.push('-y', voiceName)
    cmdArgs.push(text)
  } else {
    // espeak / espeak-ng: -s words-per-minute (~80..450), -a amplitude (0..200).
    const wpm = Math.max(80, Math.min(450, 175 + rate * 15))
    const amplitude = Math.round((volume / 100) * 200)
    cmdArgs = ['-s', String(wpm), '-a', String(amplitude)]
    if (voiceName) cmdArgs.push('-v', voiceName)
    cmdArgs.push(text)
  }

  const result = await runCmd(engine, cmdArgs)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `${engine} 语音合成失败`)
  }

  return {
    success: true,
    text,
    length: text.length,
    rate,
    volume,
    voice: voiceName || null,
    engine,
  }
}
