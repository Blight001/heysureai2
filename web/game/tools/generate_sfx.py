#!/usr/bin/env python3
"""HeySure 游戏世界 · 8-bit 音效生成器。

确定性生成 web/game/assets/sfx/ 下的全部 WAV（22050Hz / 16bit / mono），
与像素画风配套的 chiptune 风格短音效：

  ui_click.wav   点击/抽屉开合（短方波 blip）
  scroll.wav     领任务卷轴（两音上行）
  success.wav    任务完成/审批通过（大三和弦）
  bell.wav       入殿钟声（衰减正弦 + 泛音）
  chime.wav      火花/传承重生（高音琶音）

用法：python3 generate_sfx.py
"""

import math
import os
import struct
import wave

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "sfx"))
RATE = 22050


def write_wav(name, samples):
    path = os.path.join(OUT_DIR, name)
    clamped = [max(-1.0, min(1.0, s)) for s in samples]
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b"".join(struct.pack("<h", int(s * 32000)) for s in clamped))
    print(f"  sfx/{name}  {len(samples) / RATE * 1000:.0f}ms")


def env(i, n, attack=0.01, release=0.6):
    """简单 AR 包络（attack/release 为总时长占比）。"""
    t = i / n
    if t < attack:
        return t / attack
    if t > 1 - release:
        return max(0.0, (1 - t) / release)
    return 1.0


def square(freq, t):
    return 0.6 if math.sin(2 * math.pi * freq * t) >= 0 else -0.6


def tone(freqs, dur, *, wave_fn="sine", vol=0.5, release=0.6):
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        s = 0.0
        for f in freqs:
            s += square(f, t) if wave_fn == "square" else math.sin(2 * math.pi * f * t)
        out.append(s / len(freqs) * vol * env(i, n, release=release))
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"输出目录: {OUT_DIR}")
    # 点击：5ms 起音 40ms 方波
    write_wav("ui_click.wav", tone([880], 0.05, wave_fn="square", vol=0.35, release=0.8))
    # 卷轴：两音上行
    write_wav("scroll.wav", tone([523], 0.09, wave_fn="square", vol=0.3) + tone([784], 0.13, wave_fn="square", vol=0.3))
    # 完成：C 大三和弦
    write_wav("success.wav", tone([523, 659, 784], 0.3, vol=0.5, release=0.7))
    # 钟声：基音 + 两个非整数泛音，长衰减
    n = int(RATE * 1.0)
    bell = []
    for i in range(n):
        t = i / RATE
        decay = math.exp(-3.2 * t)
        s = (math.sin(2 * math.pi * 660 * t)
             + 0.5 * math.sin(2 * math.pi * 660 * 2.76 * t)
             + 0.25 * math.sin(2 * math.pi * 660 * 5.4 * t))
        bell.append(s / 1.75 * 0.55 * decay)
    write_wav("bell.wav", bell)
    # 琶音：三连高音
    chime = []
    for f in (1318, 1568, 2093):
        chime += tone([f], 0.11, vol=0.32, release=0.7)
    write_wav("chime.wav", chime)
    print("完成。")


if __name__ == "__main__":
    main()
