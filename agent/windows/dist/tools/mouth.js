"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mouthSpeak = mouthSpeak;
const powershell_1 = require("./shared/powershell");
function normalizeRate(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(-10, Math.min(10, Math.trunc(n)));
}
function normalizeVolume(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(0, Math.min(100, Math.trunc(n)));
}
async function mouthSpeak(args = {}) {
    const text = String(args.text || args.content || '').trim();
    if (!text)
        throw new Error('text is required for speech.speak');
    const rate = normalizeRate(args.rate, 0);
    const volume = normalizeVolume(args.volume, 100);
    const voiceName = String(args.voice || args.voice_name || '').trim();
    const script = [
        'Add-Type -AssemblyName System.Speech',
        '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        `$synth.Rate = ${rate}`,
        `$synth.Volume = ${volume}`,
        voiceName ? `$synth.SelectVoice(${(0, powershell_1.quotePsSingle)(voiceName)})` : '',
        `$synth.Speak(${(0, powershell_1.quotePsSingle)(text)})`,
    ].filter(Boolean).join('\n');
    const result = await (0, powershell_1.runPowerShellScript)(script);
    if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'speech synthesis failed');
    }
    return {
        success: true,
        text,
        length: text.length,
        rate,
        volume,
        voice: voiceName || null,
    };
}
