"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mouthSpeak = mouthSpeak;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
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
function quoteVbsString(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}
function cscriptCandidates() {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return [
        `${root}\\System32\\cscript.exe`,
        `${root}\\Sysnative\\cscript.exe`,
        'cscript.exe',
    ];
}
function vbsUnicodeBuffer(content) {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
}
function runCscript(scriptPath) {
    const commands = cscriptCandidates();
    let index = 0;
    return new Promise(resolve => {
        const runNext = (lastError = '') => {
            const command = commands[index++];
            if (!command) {
                resolve({ exitCode: 1, stdout: '', stderr: lastError || 'Windows Script Host is not available' });
                return;
            }
            if (command.includes('\\') && !(0, fs_1.existsSync)(command)) {
                runNext(lastError);
                return;
            }
            const child = (0, child_process_1.spawn)(command, ['//nologo', scriptPath], { windowsHide: true });
            let stdout = '';
            let stderr = '';
            let spawnFailed = false;
            child.stdout.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            child.on('error', err => {
                spawnFailed = true;
                runNext([stderr, err.message].filter(Boolean).join('\n').trim());
            });
            child.on('close', code => {
                if (spawnFailed)
                    return;
                resolve({
                    exitCode: typeof code === 'number' ? code : 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                });
            });
        };
        runNext();
    });
}
async function speakWithSapiCscript(text, rate, volume, voiceName) {
    const dir = path.join(os.tmpdir(), `heysure-sapi-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const scriptPath = path.join(dir, 'speak.vbs');
    const voiceLiteral = quoteVbsString(voiceName);
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
    ].filter(Boolean).join('\r\n');
    await (0, promises_1.mkdir)(dir, { recursive: true });
    try {
        await (0, promises_1.writeFile)(scriptPath, vbsUnicodeBuffer(script));
        const result = await runCscript(scriptPath);
        if (result.exitCode !== 0) {
            throw new Error(result.stderr || result.stdout || 'SAPI speech synthesis failed');
        }
    }
    finally {
        await (0, promises_1.rm)(dir, { recursive: true, force: true });
    }
}
async function mouthSpeak(args = {}) {
    const text = String(args.text || args.content || '').trim();
    if (!text)
        throw new Error('text is required for speech.speak');
    const rate = normalizeRate(args.rate, 0);
    const volume = normalizeVolume(args.volume, 100);
    const voiceName = String(args.voice || args.voice_name || '').trim();
    let method = 'powershell';
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
        method = 'sapi-cscript';
        try {
            await speakWithSapiCscript(text, rate, volume, voiceName);
        }
        catch (err) {
            const psError = result.stderr || 'PowerShell speech synthesis failed';
            const sapiError = err?.message || String(err);
            throw new Error(`speech synthesis failed. PowerShell: ${psError}; SAPI fallback: ${sapiError}`);
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
    };
}
