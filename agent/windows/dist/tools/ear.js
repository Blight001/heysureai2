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
exports.earStart = earStart;
exports.earStop = earStop;
exports.earLatest = earLatest;
const readline = __importStar(require("readline"));
const powershell_1 = require("./shared/powershell");
class EarMonitor {
    constructor() {
        this.child = null;
        this.events = [];
        this.sequence = 0;
        this.lastError = null;
    }
    start() {
        if (this.child)
            return { running: true };
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
`;
        this.child = (0, powershell_1.spawnPowerShellScript)(script);
        const rl = readline.createInterface({ input: this.child.stdout });
        rl.on('line', line => this.onLine(line));
        this.child.stderr.on('data', chunk => {
            const text = chunk.toString().trim();
            if (text)
                this.lastError = text;
        });
        this.child.on('close', () => {
            this.child = null;
        });
        return { running: true };
    }
    stop() {
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
        return { running: false };
    }
    latest() {
        if (!this.child)
            this.start();
        return {
            running: !!this.child,
            lastError: this.lastError,
            latest: this.events[this.events.length - 1] || null,
            events: this.events.slice(-20),
        };
    }
    pushEvent(type, text, confidence) {
        const event = {
            id: ++this.sequence,
            timestamp: Date.now(),
            type,
            text,
            confidence,
        };
        this.events.push(event);
        if (this.events.length > 200)
            this.events.splice(0, this.events.length - 200);
    }
    onLine(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        try {
            const parsed = JSON.parse(trimmed);
            const type = String(parsed.type || '').toLowerCase();
            const text = String(parsed.text || '').trim();
            const confidence = parsed.confidence !== undefined ? Number(parsed.confidence) : undefined;
            if (!text && type !== 'error')
                return;
            if (type === 'recognized')
                this.pushEvent('recognized', text, confidence);
            else if (type === 'partial')
                this.pushEvent('partial', text, confidence);
            else if (type === 'error')
                this.pushEvent('error', text || 'speech recognition error');
        }
        catch {
            this.lastError = trimmed;
        }
    }
}
const monitor = new EarMonitor();
async function earStart() {
    return monitor.start();
}
async function earStop() {
    return monitor.stop();
}
async function earLatest() {
    return monitor.latest();
}
