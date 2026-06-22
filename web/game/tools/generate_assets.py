#!/usr/bin/env python3
"""HeySure 游戏世界 · 像素资产生成器。

确定性地生成 web/game/assets/ 下的全部 PNG（无随机种子漂移，重跑结果一致）。
所有素材按 1x 内部分辨率手绘、NEAREST 放大 2 倍输出，统一 32px 瓦片标准：

  tileset.png                 16x16@1x -> 32x32 瓦片 x16 格（8 列 x 2 行）
  tree.png                    16x24@1x -> 32x48
  building_spawn.png          32x32@1x -> 64x64   x4 帧（出生地泉水）
  building_library.png        48x48@1x -> 96x96   x2 帧（传承知识库/图书馆）
  building_workshop_desktop.png 32x32@1x -> 64x64 x4 帧（桌面 agent 作坊·机械坊）
  building_workshop_browser.png 32x40@1x -> 64x80 x4 帧（浏览器 agent 作坊·瞭望塔）
  building_workshop_knowledge.png 32x40@1x -> 64x80 x4 帧（知识工坊·学者书斋，悬浮魔典脉冲）
  building_workshop_android.png 32x40@1x -> 64x80 x4 帧（安卓 agent 作坊·移动信号坊，天线信号波脉冲）
  char_*.png                  16x24@1x -> 32x48，4 列 x 5 行：
                              行 0-3 = 走路 下/左/右/上（第 0 帧兼站立），
                              行 4 = [闭眼 idle, 坐下, 跪倒, 躺倒]
  emotes.png                  16x16 直绘 x8：沙漏/灯泡/对勾/感叹号/放大镜/Zzz/卷轴/骷髅
  effect_smoke.png            8x8@1x  -> 16x16   x4 帧
  effect_sparkle.png          8x8@1x  -> 16x16   x4 帧

用法：python3 generate_assets.py   （输出到 ../assets/）
"""

from __future__ import annotations

import math
import os
import random

from PIL import Image

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
SCALE = 2

# ---------------------------------------------------------------- 调色板
OUT = (34, 32, 52, 255)            # 通用描边
SKIN = (236, 188, 145, 255)
SKIN_SH = (205, 146, 99, 255)

GRASS = (96, 148, 86, 255)
GRASS_D = (78, 126, 72, 255)
GRASS_L = (118, 168, 98, 255)
PATH = (192, 158, 110, 255)
PATH_D = (164, 132, 90, 255)
WATER = (74, 124, 184, 255)
WATER_L = (134, 184, 224, 255)
WATER_D = (56, 98, 152, 255)
STONE = (148, 148, 156, 255)
STONE_D = (112, 112, 122, 255)
STONE_L = (180, 180, 188, 255)
SLATE = (104, 118, 142, 255)       # 青石板瓦（图书馆陡顶）
SLATE_D = (78, 90, 112, 255)
SLATE_L = (132, 146, 168, 255)
WOOD = (122, 86, 54, 255)
WOOD_D = (94, 64, 40, 255)
WALL = (216, 192, 150, 255)
WALL_SH = (188, 162, 120, 255)
ROOF = (158, 92, 60, 255)
ROOF_D = (124, 70, 46, 255)
GOLD = (236, 196, 92, 255)
GOLD_D = (196, 150, 56, 255)
FLAME_O = (240, 140, 52, 255)
FLAME_Y = (252, 210, 100, 255)
FLAME_W = (255, 246, 200, 255)
INDIGO = (92, 102, 188, 255)
INDIGO_D = (68, 76, 152, 255)
PAPER = (244, 238, 218, 255)


def darken(c, k=0.78):
    return (int(c[0] * k), int(c[1] * k), int(c[2] * k), c[3])


class C:
    """极简像素画布：putpixel 级 API + NEAREST 放大。"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    def px(self, x, y, col):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.img.putpixel((x, y), col)

    def rect(self, x, y, w, h, col):
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                self.px(xx, yy, col)

    def hline(self, x, y, w, col):
        self.rect(x, y, w, 1, col)

    def vline(self, x, y, h, col):
        self.rect(x, y, 1, h, col)

    def outline(self, x, y, w, h, col):
        self.hline(x, y, w, col)
        self.hline(x, y + h - 1, w, col)
        self.vline(x, y, h, col)
        self.vline(x + w - 1, y, h, col)

    def disc(self, cx, cy, r, col):
        for yy in range(int(cy - r), int(cy + r + 1)):
            for xx in range(int(cx - r), int(cx + r + 1)):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r + r * 0.5:
                    self.px(xx, yy, col)

    def ring(self, cx, cy, r, col):
        for a in range(0, 360, 4):
            self.px(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)), col)

    def paste(self, other, x, y):
        self.img.alpha_composite(other.img, (int(x), int(y)))

    def mirrored(self):
        m = C(self.w, self.h)
        m.img = self.img.transpose(Image.FLIP_LEFT_RIGHT)
        return m

    def add_silhouette_outline(self, col=OUT):
        """给非透明区域的外缘补一圈描边（像素风统一轮廓）。"""
        src = self.img.copy()
        for y in range(self.h):
            for x in range(self.w):
                if src.getpixel((x, y))[3] != 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and src.getpixel((nx, ny))[3] != 0:
                        self.px(x, y, col)
                        break


def save_strip(frames, name, scale=SCALE):
    """把多帧横向拼成 strip 并放大保存。"""
    w, h = frames[0].w, frames[0].h
    strip = C(w * len(frames), h)
    for i, f in enumerate(frames):
        strip.paste(f, i * w, 0)
    strip.img.resize((strip.w * scale, strip.h * scale), Image.NEAREST).save(os.path.join(OUT_DIR, name))
    print(f"  {name}  {w * scale}x{h * scale} x{len(frames)}帧")


# ================================================================ 地形
def gen_tileset():
    T = 16
    tiles = []

    def grass_base(c, seed, base=GRASS):
        rng = random.Random(seed)
        c.rect(0, 0, T, T, base)
        for _ in range(7):
            c.px(rng.randrange(T), rng.randrange(T), GRASS_D)
        for _ in range(4):
            c.px(rng.randrange(T), rng.randrange(T), GRASS_L)

    # 0-2 草地 abc
    for i in range(3):
        c = C(T, T)
        grass_base(c, 10 + i)
        tiles.append(c)
    # 3 暗草（阴影区）
    c = C(T, T)
    grass_base(c, 13, base=GRASS_D)
    tiles.append(c)
    # 4/5 花草
    for i, col in enumerate([(224, 96, 96, 255), (240, 208, 96, 255)]):
        c = C(T, T)
        grass_base(c, 20 + i)
        rng = random.Random(30 + i)
        for _ in range(3):
            x, y = rng.randrange(2, T - 2), rng.randrange(2, T - 2)
            c.px(x, y, col)
            c.px(x, y + 1, GRASS_D)
        tiles.append(c)
    # 6 高草
    c = C(T, T)
    grass_base(c, 40)
    rng = random.Random(41)
    for _ in range(6):
        x, y = rng.randrange(1, T - 1), rng.randrange(3, T - 1)
        c.vline(x, y - 3, 3, GRASS_L)
    tiles.append(c)
    # 7 土路
    c = C(T, T)
    rng = random.Random(50)
    c.rect(0, 0, T, T, PATH)
    for _ in range(8):
        c.px(rng.randrange(T), rng.randrange(T), PATH_D)
    for _ in range(3):
        c.px(rng.randrange(T), rng.randrange(T), (210, 178, 130, 255))
    tiles.append(c)
    # 8 路缘（上草下路）
    c = C(T, T)
    grass_base(c, 60)
    c.rect(0, 6, T, T - 6, PATH)
    rng = random.Random(61)
    for x in range(T):
        if rng.random() < 0.5:
            c.px(x, 6, GRASS_D)
    for _ in range(5):
        c.px(rng.randrange(T), rng.randrange(8, T), PATH_D)
    tiles.append(c)
    # 9/10 水（两帧波纹）
    for f in range(2):
        c = C(T, T)
        c.rect(0, 0, T, T, WATER)
        rng = random.Random(70)
        for _ in range(4):
            x, y = rng.randrange(1, T - 4), rng.randrange(1, T - 1)
            c.hline((x + f * 2) % (T - 3), y, 3, WATER_L)
        for _ in range(3):
            c.px(rng.randrange(T), rng.randrange(T), WATER_D)
        tiles.append(c)
    # 11 草地碎石
    c = C(T, T)
    grass_base(c, 80)
    c.disc(6, 9, 3, STONE)
    c.disc(11, 11, 2, STONE_D)
    c.px(5, 8, STONE_L)
    tiles.append(c)
    # 12 灌木
    c = C(T, T)
    grass_base(c, 90)
    c.disc(8, 9, 5, GRASS_D)
    c.disc(7, 8, 3, (110, 158, 92, 255))
    c.px(6, 6, GRASS_L)
    c.px(10, 8, GRASS_L)
    tiles.append(c)
    # 13/14 石板广场（两变体）
    for f in range(2):
        c = C(T, T)
        rng = random.Random(100 + f)
        c.rect(0, 0, T, T, (172, 170, 178, 255))
        # 石板接缝
        for yy in (0, 8):
            c.hline(0, yy, T, (140, 138, 148, 255))
        for xx in (0, 8):
            c.vline(xx + (4 if f else 0), 0, T, (140, 138, 148, 255))
        for _ in range(5):
            c.px(rng.randrange(T), rng.randrange(T), (190, 188, 196, 255))
        for _ in range(3):
            c.px(rng.randrange(T), rng.randrange(T), (150, 148, 158, 255))
        tiles.append(c)
    # 15 预留空位
    while len(tiles) < 16:
        tiles.append(C(T, T))

    sheet = C(T * 8, T * 2)
    for i, t in enumerate(tiles):
        sheet.paste(t, (i % 8) * T, (i // 8) * T)
    sheet.img.resize((sheet.w * SCALE, sheet.h * SCALE), Image.NEAREST).save(os.path.join(OUT_DIR, "tileset.png"))
    print(f"  tileset.png  {sheet.w * SCALE}x{sheet.h * SCALE} 16 瓦片")


def gen_tree():
    c = C(16, 24)
    c.rect(7, 13, 2, 9, WOOD)
    c.px(6, 21, WOOD_D)
    c.px(9, 21, WOOD_D)
    c.disc(8, 8, 6, GRASS_D)
    c.disc(6, 7, 4, GRASS)
    c.disc(10, 5, 3, GRASS_L)
    c.add_silhouette_outline()
    save_strip([c], "tree.png")


# ================================================================ 建筑
def gen_spawn():
    """出生地：石环泉水 + 光柱呼吸。"""
    frames = []
    for f in range(4):
        c = C(32, 32)
        # 石环
        c.disc(16, 20, 10, STONE)
        c.disc(16, 20, 8, STONE_D)
        c.disc(16, 20, 7, WATER)
        # 波光（按帧旋转）
        for i in range(3):
            a = math.radians(f * 30 + i * 120)
            c.px(16 + 4 * math.cos(a), 20 + 4 * math.sin(a) * 0.6, WATER_L)
            c.px(16 + 5 * math.cos(a + 0.8), 20 + 5 * math.sin(a + 0.8) * 0.6, WATER_L)
        # 环沿高光
        c.px(9, 16, STONE_L)
        c.px(22, 24, STONE_L)
        # 光柱（高度随帧呼吸）
        glow = (200, 240, 255, 90)
        glow2 = (230, 250, 255, 130)
        h = [10, 12, 14, 12][f]
        c.rect(14, 18 - h, 4, h, glow)
        c.rect(15, 18 - h + 2, 2, h - 2, glow2)
        # 泉心亮点
        c.px(16, 19, FLAME_W if f % 2 else WATER_L)
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_spawn.png")


def gen_library():
    """图书馆：古典欧风石造馆——青石板陡顶 + 金饰尖、石砌墙、玫瑰窗、罗马拱窗拱门。
    帧0 平时 / 帧1 玫瑰窗与拱窗点亮（有待审批知识时用）。"""
    glass = (96, 116, 156, 255)
    glass_lit = (250, 214, 120, 255)
    halo = (255, 230, 150, 160)
    frames = []
    for f in range(2):
        lit = f == 1
        g = glass_lit if lit else glass
        c = C(48, 48)
        # 顶部金饰尖
        c.vline(24, 2, 4, GOLD_D)
        c.px(24, 1, GOLD)
        # 青石板山形陡顶（横向石板层理 + 檐口压暗）
        for i, y in enumerate(range(6, 21)):
            half = 2 + i * 1.45
            col = SLATE_D if y >= 19 else (SLATE_L if i % 3 == 0 else SLATE)
            c.hline(24 - half, y, half * 2, col)
        c.hline(23, 5, 3, SLATE_D)
        # 石砌墙体（错缝砖纹 + 右侧背光面压暗）
        c.rect(4, 20, 40, 26, STONE_L)
        for by in range(24, 46, 4):
            c.hline(5, by, 38, STONE)
        for k, by in enumerate(range(24, 42, 4)):
            for bx in range(8 if k % 2 else 6, 43, 8):
                c.vline(bx, by + 1, 3, STONE)
        c.rect(40, 20, 4, 26, STONE)
        c.outline(4, 20, 40, 26, STONE_D)
        # 角部壁柱
        c.rect(4, 20, 3, 26, STONE)
        c.vline(6, 20, 26, STONE_D)
        c.rect(41, 20, 3, 26, STONE)
        c.vline(41, 20, 26, STONE_D)
        # 檐下金饰带
        c.hline(5, 20, 38, GOLD_D)
        # 玫瑰窗（门拱正上方）：金辐条 + 金环
        c.disc(24, 25, 3, g)
        c.vline(24, 22, 7, GOLD_D)
        c.hline(21, 25, 7, GOLD_D)
        c.ring(24, 25, 3, GOLD_D)
        c.px(24, 25, GOLD)
        if lit:
            for gx, gy in ((20, 21), (28, 21), (24, 20)):
                c.px(gx, gy, halo)
        # 罗马拱窗 x2（石拱边 + 中梃 + 窗台）
        for wx in (8, 34):
            c.hline(wx + 1, 27, 5, g)
            c.rect(wx, 28, 7, 8, g)
            c.hline(wx + 1, 26, 5, STONE_D)
            c.px(wx, 27, STONE_D)
            c.px(wx + 6, 27, STONE_D)
            c.vline(wx - 1, 28, 9, STONE_D)
            c.vline(wx + 7, 28, 9, STONE_D)
            c.vline(wx + 3, 27, 9, STONE_D)
            c.hline(wx - 1, 36, 9, STONE)
            if lit:
                c.px(wx + 1, 29, FLAME_W)
                c.px(wx + 5, 33, FLAME_W)
        # 罗马拱门：石门套 + 拱缘 + 拱心石 + 木双开门
        c.disc(24, 35, 6, STONE)
        c.rect(18, 35, 12, 11, STONE)
        for a in range(180, 361, 6):
            c.px(24 + 6 * math.cos(math.radians(a)), 35 + 6 * math.sin(math.radians(a)), STONE_D)
        c.rect(23, 28, 2, 2, STONE_L)  # 拱心石
        c.disc(24, 35, 4, WOOD)
        c.rect(20, 35, 8, 11, WOOD)
        c.disc(24, 36, 3, WOOD_D)
        c.rect(21, 36, 6, 10, WOOD_D)
        c.vline(24, 33, 13, WOOD)  # 双开门中缝
        c.px(22, 41, GOLD)
        c.px(26, 41, GOLD)
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_library.png")


def gen_workshop_desktop():
    """桌面 agent 作坊（机械坊）：墙面大齿轮 4 帧旋转 + 火花。"""
    frames = []
    for f in range(4):
        c = C(32, 32)
        # 烟囱
        c.rect(8, 2, 4, 7, STONE_D)
        c.rect(7, 2, 6, 2, STONE)
        # 平顶
        c.rect(4, 8, 26, 5, (84, 74, 70, 255))
        c.hline(4, 8, 26, (104, 92, 86, 255))
        # 墙体
        c.rect(6, 13, 22, 15, (146, 134, 122, 255))
        c.rect(24, 13, 4, 15, (124, 112, 102, 255))
        c.outline(6, 13, 22, 15, WOOD_D)
        # 门
        c.rect(9, 18, 6, 10, WOOD_D)
        c.px(13, 23, GOLD)
        # 齿轮（按帧转动）
        gx, gy = 22, 19
        c.disc(gx, gy, 5, (172, 172, 184, 255))
        c.disc(gx, gy, 2, (90, 90, 102, 255))
        for i in range(8):
            a = math.radians(i * 45 + f * 11.25)
            c.px(gx + 6 * math.cos(a), gy + 6 * math.sin(a), (140, 140, 152, 255))
        # 火花
        if f in (1, 3):
            c.px(28, 12, GOLD)
            c.px(29, 11, FLAME_W)
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_workshop_desktop.png")


def gen_workshop_browser():
    """浏览器 agent 作坊（瞭望塔）：塔顶水晶球 4 帧脉冲。"""
    crystal = [(150, 100, 220, 255), (180, 140, 245, 255), (215, 200, 255, 255), (180, 140, 245, 255)]
    frames = []
    for f in range(4):
        c = C(32, 40)
        # 塔身
        c.rect(10, 14, 12, 25, (150, 144, 160, 255))
        c.rect(19, 14, 3, 25, (126, 120, 138, 255))
        c.outline(10, 14, 12, 25, WOOD_D)
        # 雉堞
        for mx in (10, 14, 18):
            c.rect(mx, 12, 2, 2, (150, 144, 160, 255))
        c.rect(20, 12, 2, 2, (126, 120, 138, 255))
        # 窗缝 + 门
        c.rect(15, 20, 2, 4, (60, 58, 74, 255))
        c.rect(13, 31, 6, 8, WOOD_D)
        c.px(17, 35, GOLD)
        # 水晶球 + 底座
        c.rect(14, 10, 4, 2, STONE_D)
        c.disc(16, 6, 4, crystal[f])
        c.px(15, 4, FLAME_W)
        # 光晕（亮帧）
        if f == 2:
            for a in range(0, 360, 45):
                c.px(16 + 6 * math.cos(math.radians(a)), 6 + 6 * math.sin(math.radians(a)), (220, 240, 255, 130))
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_workshop_browser.png")


def gen_workshop_knowledge():
    """知识工坊（知识与进化）：学者书斋——暖木墙体 + 靛蓝坡顶 + 悬浮发光魔典 4 帧脉冲。
    服务端内置作坊，**专属贴图**，不再复用传承图书馆，避免世界里出现两座图书馆。"""
    glow_seq = [
        (150, 170, 240, 255),
        (190, 205, 255, 255),
        (232, 240, 255, 255),
        (190, 205, 255, 255),
    ]
    frames = []
    for f in range(4):
        c = C(32, 40)
        g = glow_seq[f]
        # 墙体（暖木 + 砖缝，右侧背光压暗）
        c.rect(5, 18, 22, 21, WALL)
        c.rect(22, 18, 5, 21, WALL_SH)
        for by in range(23, 39, 5):
            c.hline(6, by, 20, WALL_SH)
        c.outline(5, 18, 22, 21, WOOD_D)
        # 靛蓝坡顶（层理）+ 金檐 + 顶饰
        for i, y in enumerate(range(10, 18)):
            half = 2 + i * 1.5
            c.hline(16 - half, y, half * 2, INDIGO if i % 2 else INDIGO_D)
        c.hline(4, 17, 24, GOLD_D)
        c.vline(16, 6, 4, GOLD_D)
        c.px(16, 5, GOLD)
        # 圆窗 x2（透出靛蓝学识之光）
        for wx in (9, 23):
            c.disc(wx, 27, 2, g)
            c.ring(wx, 27, 2, GOLD_D)
        # 木门
        c.rect(13, 30, 6, 9, WOOD_D)
        c.px(17, 35, GOLD)
        # 悬浮魔典（书脊居中 + 翻开双页 + 文字行），按帧上下浮动
        by = 2 + (f % 2)
        c.rect(11, by, 10, 6, PAPER)
        c.rect(10, by, 1, 6, WOOD_D)
        c.rect(21, by, 1, 6, WOOD_D)
        c.vline(16, by, 6, GOLD_D)
        c.hline(12, by + 2, 3, INDIGO_D)
        c.hline(18, by + 2, 3, INDIGO_D)
        c.hline(12, by + 4, 3, INDIGO_D)
        c.hline(18, by + 4, 3, INDIGO_D)
        # 知识火花：环绕魔典脉冲旋转（金 / 靛光交替）
        for k in range(4):
            a = math.radians(k * 90 + f * 22.5)
            col = g if (f + k) % 2 == 0 else GOLD
            c.px(16 + 8 * math.cos(a), by + 3 + 6 * math.sin(a), col)
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_workshop_knowledge.png")


def gen_workshop_android():
    """安卓 agent 作坊（移动信号坊）：绿机体墙 + 安卓吉祥物头像嵌屏，顶部天线信号波 4 帧脉冲。"""
    A_GREEN = (120, 196, 80, 255)       # 安卓机器人绿
    A_GREEN_D = (96, 166, 62, 255)
    A_GREEN_L = (170, 222, 120, 255)
    SCREEN = (40, 46, 42, 255)          # 嵌墙暗屏
    signal_seq = [
        (150, 220, 110, 150),
        (180, 238, 140, 200),
        (210, 250, 170, 240),
        (180, 238, 140, 200),
    ]
    frames = []
    for f in range(4):
        c = C(32, 40)
        g = signal_seq[f]
        # 天线杆 + 顶灯（信号源）
        c.vline(16, 3, 9, STONE_D)
        c.disc(16, 3, 2, g[:3] + (255,))
        c.px(16, 1, FLAME_W)
        # 信号波（顶灯两侧弧线，按帧外扩脉冲）
        rad = 4 + f * 2
        for a in (-60, -35, 35, 60):
            c.px(16 + rad * math.sin(math.radians(a)), 3 + rad * (1 - math.cos(math.radians(a))) * 0.4, g)
        # 平台檐口
        c.rect(4, 12, 24, 4, A_GREEN_D)
        c.hline(4, 12, 24, A_GREEN_L)
        # 墙体（绿机体 + 右侧背光压暗）
        c.rect(6, 16, 20, 23, A_GREEN)
        c.rect(22, 16, 4, 23, A_GREEN_D)
        c.outline(6, 16, 20, 23, OUT)
        # 嵌墙暗屏（衬托吉祥物）
        c.rect(9, 19, 14, 11, SCREEN)
        c.outline(9, 19, 14, 11, OUT)
        # 安卓吉祥物头像（圆顶 + 两触角 + 两眼，屏内发光绿）
        c.disc(16, 25, 4, A_GREEN_L)
        c.rect(12, 25, 9, 4, A_GREEN_L)
        c.px(13, 20, A_GREEN_L); c.px(14, 21, A_GREEN_L)
        c.px(19, 20, A_GREEN_L); c.px(18, 21, A_GREEN_L)
        c.px(14, 24, OUT); c.px(18, 24, OUT)
        # 门
        c.rect(12, 31, 8, 8, WOOD_D)
        c.px(18, 35, GOLD)
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "building_workshop_android.png")


# ================================================================ 角色
LOOKS = {
    # 核心管理员（数字社会管理员）：紫袍金冠（深棕发，避免与金冠混色）
    "char_admin": dict(hair=(74, 54, 40, 255), shirt=(124, 82, 180, 255), pants=(70, 50, 110, 255), accessory="crown"),
    # 辅助管理员：青披风 + 提灯（全图巡逻）
    "char_assistant": dict(hair=(52, 42, 46, 255), shirt=(52, 150, 150, 255), pants=(40, 90, 96, 255), accessory="lantern", cape=(36, 116, 122, 255)),
    # 图书管理员：绿衣 + 眼镜 + 书
    "char_librarian": dict(hair=(106, 76, 48, 255), shirt=(96, 150, 84, 255), pants=(70, 100, 60, 255), accessory="glasses_book"),
    # 普通数字成员皮肤族
    "char_member_blue": dict(hair=(106, 76, 48, 255), shirt=(86, 120, 190, 255), pants=(54, 70, 110, 255)),
    "char_member_red": dict(hair=(52, 42, 46, 255), shirt=(190, 92, 86, 255), pants=(110, 56, 54, 255)),
    "char_member_amber": dict(hair=(106, 76, 48, 255), shirt=(210, 160, 70, 255), pants=(120, 92, 46, 255)),
    "char_member_slate": dict(hair=(52, 42, 46, 255), shirt=(130, 136, 150, 255), pants=(76, 80, 92, 255)),
}
BOOTS = (60, 50, 54, 255)


def _leg(c, x, lift, pants):
    bottom = 22 - lift
    c.rect(x, 17, 3, bottom - 1 - 17, pants)
    c.rect(x, bottom - 1, 3, 2, BOOTS)


def _head(c, d, lk, dy=0):
    hair, skin = lk["hair"], SKIN
    if d == "up":
        c.rect(5, 2 + dy, 6, 8, hair)
    elif d == "down":
        c.rect(5, 2 + dy, 6, 3, hair)
        c.px(5, 5 + dy, hair)
        c.px(10, 5 + dy, hair)
        c.rect(6, 5 + dy, 4, 1, skin)
        c.rect(5, 6 + dy, 6, 4, skin)
        c.px(6, 7 + dy, OUT)
        c.px(9, 7 + dy, OUT)
        c.px(7, 9 + dy, SKIN_SH)
        c.px(8, 9 + dy, SKIN_SH)
    else:  # left（右向由镜像生成）
        c.rect(5, 2 + dy, 6, 3, hair)
        c.rect(7, 5 + dy, 4, 5, hair)
        c.rect(5, 5 + dy, 2, 5, skin)
        c.px(5, 7 + dy, OUT)


def _torso_frontback(c, lk, f, dy=0):
    shirt = lk["shirt"]
    arm_dy = [0, -1, 0, 1][f]
    c.rect(4, 10 + dy, 8, 6, shirt)
    c.rect(10, 10 + dy, 2, 6, darken(shirt))
    c.hline(4, 16 + dy, 8, darken(lk["pants"]))
    # 双臂（行走摆动）
    c.rect(3, 10 + dy + arm_dy, 1, 4, darken(shirt))
    c.px(3, 14 + dy + arm_dy, SKIN)
    c.rect(12, 10 + dy - arm_dy, 1, 4, darken(shirt))
    c.px(12, 14 + dy - arm_dy, SKIN)


def _accessory(c, d, lk, dy=0):
    acc = lk.get("accessory")
    if acc == "crown":
        c.hline(6, 1 + dy, 4, GOLD)
        c.px(6, 0 + dy, GOLD)
        c.px(8, 0 + dy, GOLD)
        c.px(7, 1 + dy, (224, 96, 96, 255))
    elif acc == "glasses_book" and d == "down":
        c.hline(5, 7 + dy, 6, (80, 70, 90, 255))
        c.px(6, 7 + dy, (190, 210, 230, 255))
        c.px(9, 7 + dy, (190, 210, 230, 255))
        c.rect(6, 12 + dy, 4, 3, PAPER)
        c.vline(8, 12 + dy, 3, ROOF)
    elif acc == "lantern" and d == "down":
        c.px(12, 15 + dy, OUT)
        c.rect(11, 16 + dy, 3, 3, GOLD)
        c.px(12, 17 + dy, FLAME_W)


def _cape_back(c, d, lk, dy=0):
    cape = lk.get("cape")
    if not cape:
        return
    if d == "up":
        c.rect(4, 10 + dy, 8, 8, cape)
        for x in (5, 8, 11):
            c.px(x, 18 + dy, cape)
    elif d == "down":
        c.vline(3, 10 + dy, 7, cape)
        c.vline(12, 10 + dy, 7, cape)
    else:
        c.rect(4, 10 + dy, 2, 8, cape)


def _char_walk_frame(d, f, lk):
    c = C(16, 24)
    lift_l, lift_r = [(0, 0), (2, 0), (0, 0), (0, 2)][f]
    if d in ("down", "up"):
        _cape_back(c, d, lk)
        _leg(c, 5, lift_l, lk["pants"])
        _leg(c, 8, lift_r, lk["pants"])
        _torso_frontback(c, lk, f)
        _head(c, d, lk)
        _accessory(c, d, lk)
    else:  # left
        _cape_back(c, d, lk)
        step = [0, 1, 0, -1][f]
        _leg(c, 6 - step, lift_r, darken(lk["pants"]))  # 后腿
        _leg(c, 8 + step, lift_l, lk["pants"])           # 前腿
        c.rect(5, 10, 6, 6, lk["shirt"])
        c.hline(5, 16, 6, darken(lk["pants"]))
        c.rect(7 + step, 11, 2, 4, darken(lk["shirt"]))  # 摆臂
        c.px(7 + step, 15, SKIN)
        _head(c, d, lk)
        _accessory(c, d, lk)
    c.add_silhouette_outline()
    return c


def _char_pose(pose, lk):
    c = C(16, 24)
    if pose == "idle":  # 闭眼眨眼帧
        _cape_back(c, "down", lk)
        _leg(c, 5, 0, lk["pants"])
        _leg(c, 8, 0, lk["pants"])
        _torso_frontback(c, lk, 0)
        _head(c, "down", lk)
        c.px(6, 7, SKIN_SH)
        c.px(9, 7, SKIN_SH)
        _accessory(c, "down", lk)
    elif pose == "sit":
        dy = 4
        _cape_back(c, "down", lk, dy)
        _torso_frontback(c, lk, 0, dy)
        _head(c, "down", lk, dy)
        _accessory(c, "down", lk, dy)
        c.rect(4, 20, 8, 2, lk["pants"])  # 盘坐的腿
        c.rect(2, 20, 2, 2, BOOTS)
        c.rect(12, 20, 2, 2, BOOTS)
    elif pose == "collapse":  # 跪倒
        dy = 6
        _torso_frontback(c, lk, 0, dy)
        _head(c, "down", lk, dy)
        c.px(6, 7 + dy, SKIN_SH)  # 闭眼
        c.px(9, 7 + dy, SKIN_SH)
        _accessory(c, "down", lk, dy)
        c.rect(4, 21, 8, 2, darken(lk["pants"]))
    elif pose == "lying":  # 躺倒（横置）
        c.rect(1, 17, 4, 5, lk["hair"])        # 头发（头朝左）
        c.rect(4, 18, 2, 3, SKIN)              # 侧脸
        c.px(4, 19, SKIN_SH)                   # 闭眼
        c.rect(6, 17, 5, 5, lk["shirt"])       # 躯干
        c.rect(11, 18, 3, 4, lk["pants"])      # 腿
        c.rect(14, 18, 2, 2, BOOTS)
        c.rect(14, 20, 2, 2, BOOTS)
    c.add_silhouette_outline()
    return c


def gen_characters():
    FW, FH = 16, 24
    for name, lk in LOOKS.items():
        sheet = C(FW * 4, FH * 5)
        rows = ["down", "left", "right", "up"]
        for r, d in enumerate(rows):
            for f in range(4):
                if d == "right":
                    frame = _char_walk_frame("left", f, lk).mirrored()
                else:
                    frame = _char_walk_frame(d, f, lk)
                sheet.paste(frame, f * FW, r * FH)
        for i, pose in enumerate(["idle", "sit", "collapse", "lying"]):
            sheet.paste(_char_pose(pose, lk), i * FW, 4 * FH)
        sheet.img.resize((sheet.w * SCALE, sheet.h * SCALE), Image.NEAREST).save(os.path.join(OUT_DIR, f"{name}.png"))
        print(f"  {name}.png  {FW * SCALE}x{FH * SCALE} x20帧（4 向行走 + 4 姿态）")


# ================================================================ 表情 / 特效
def gen_emotes():
    """16x16 直绘（UI 气泡用，不再放大）。顺序见 manifest。"""
    icons = []

    def new():
        c = C(16, 16)
        icons.append(c)
        return c

    # 0 沙漏（token 预警）
    c = new()
    for i in range(4):
        c.hline(4 + i, 3 + i, 8 - i * 2, GOLD if i > 1 else (90, 80, 60, 255))
        c.hline(4 + i, 12 - i, 8 - i * 2, GOLD_D)
    c.hline(3, 2, 10, OUT)
    c.hline(3, 13, 10, OUT)
    # 1 灯泡（知识沉淀）
    c = new()
    c.disc(8, 6, 4, (250, 220, 110, 255))
    c.px(7, 4, FLAME_W)
    c.rect(6, 11, 4, 2, STONE)
    c.hline(6, 13, 4, STONE_D)
    # 2 对勾（任务完成）
    c = new()
    for i in range(3):
        c.px(3 + i, 8 + i, (96, 190, 110, 255))
        c.px(3 + i, 9 + i, (96, 190, 110, 255))
    for i in range(6):
        c.px(6 + i, 10 - i, (96, 190, 110, 255))
        c.px(6 + i, 11 - i, (96, 190, 110, 255))
    # 3 感叹号（异常/待办）
    c = new()
    c.rect(7, 2, 2, 8, (224, 96, 96, 255))
    c.rect(7, 12, 2, 2, (224, 96, 96, 255))
    # 4 放大镜（辅助管理员巡查）
    c = new()
    c.ring(7, 6, 4, (70, 90, 140, 255))
    c.ring(7, 6, 3, (70, 90, 140, 255))
    c.px(5, 5, (190, 210, 230, 255))
    for i in range(4):
        c.px(10 + i, 9 + i, WOOD_D)
    # 5 Zzz（停用打盹）
    c = new()

    def z(x, y, s, col):
        c.hline(x, y, s, col)
        for i in range(s - 1):
            c.px(x + s - 2 - i, y + 1 + i, col)
        c.hline(x, y + s - 1, s, col)

    z(2, 8, 5, (140, 150, 190, 255))
    z(7, 4, 4, (160, 170, 210, 255))
    z(11, 1, 3, (180, 190, 230, 255))
    # 6 任务卷轴（领任务）
    c = new()
    c.rect(3, 4, 10, 8, PAPER)
    c.vline(3, 3, 10, (210, 200, 175, 255))
    c.vline(12, 3, 10, (210, 200, 175, 255))
    c.hline(5, 6, 6, (150, 150, 160, 255))
    c.hline(5, 8, 5, (150, 150, 160, 255))
    c.hline(5, 10, 6, (150, 150, 160, 255))
    # 7 骷髅（死亡标记）
    c = new()
    c.disc(8, 6, 4, (235, 235, 240, 255))
    c.rect(6, 10, 5, 3, (235, 235, 240, 255))
    c.px(6, 6, OUT)
    c.px(10, 6, OUT)
    c.px(8, 8, OUT)
    c.px(7, 11, OUT)
    c.px(9, 11, OUT)

    for c in icons:
        c.add_silhouette_outline()
    save_strip(icons, "emotes.png", scale=1)


def gen_envelope():
    """信封（AI 互发消息的信使精灵）。"""
    c = C(12, 9)
    c.rect(1, 1, 10, 7, PAPER)
    c.outline(1, 1, 10, 7, OUT)
    # 封口折线
    for i in range(5):
        c.px(1 + i, 1 + i * 0.8, (200, 188, 160, 255))
        c.px(10 - i, 1 + i * 0.8, (200, 188, 160, 255))
    c.px(5, 4, (200, 188, 160, 255))
    c.px(6, 4, (200, 188, 160, 255))
    # 红色火漆点
    c.px(5, 5, (200, 80, 80, 255))
    c.px(6, 5, (200, 80, 80, 255))
    c.add_silhouette_outline()
    save_strip([c], "envelope.png")


def gen_lamp():
    """灯柱：帧0 熄灭 / 帧1 点亮（夜晚切换）。"""
    frames = []
    for f in range(2):
        c = C(12, 28)
        c.vline(5, 8, 18, (70, 66, 80, 255))
        c.vline(6, 8, 18, (90, 86, 100, 255))
        c.rect(3, 25, 6, 2, (70, 66, 80, 255))
        # 灯头
        c.rect(3, 2, 6, 6, (70, 66, 80, 255))
        c.rect(4, 3, 4, 4, FLAME_Y if f else (110, 116, 140, 255))
        if f:
            c.px(5, 4, FLAME_W)
            c.px(6, 4, FLAME_W)
            c.px(2, 4, (255, 230, 150, 140))
            c.px(9, 4, (255, 230, 150, 140))
        c.px(5, 1, (90, 86, 100, 255))
        c.px(6, 1, (90, 86, 100, 255))
        c.add_silhouette_outline()
        frames.append(c)
    save_strip(frames, "lamp.png")


def gen_fence():
    """栅栏：帧0 横栏 / 帧1 立柱（拼线段用）。"""
    frames = []
    # 横栏
    c = C(16, 16)
    c.hline(0, 6, 16, WOOD)
    c.hline(0, 7, 16, WOOD_D)
    c.hline(0, 11, 16, WOOD)
    c.hline(0, 12, 16, WOOD_D)
    for x in (2, 13):
        c.vline(x, 3, 11, WOOD)
        c.vline(x + 1, 3, 11, WOOD_D)
    c.add_silhouette_outline()
    frames.append(c)
    # 立柱
    c = C(16, 16)
    c.vline(7, 3, 11, WOOD)
    c.vline(8, 3, 11, WOOD_D)
    c.px(7, 2, WOOD)
    c.px(8, 2, WOOD)
    c.add_silhouette_outline()
    frames.append(c)
    save_strip(frames, "fence.png")


def gen_bench():
    """长椅。"""
    c = C(20, 12)
    c.rect(1, 3, 18, 3, WOOD)
    c.hline(1, 5, 18, WOOD_D)
    c.rect(1, 7, 2, 4, WOOD_D)
    c.rect(17, 7, 2, 4, WOOD_D)
    c.hline(3, 7, 14, WOOD)
    c.add_silhouette_outline()
    save_strip([c], "bench.png")


def gen_signpost():
    """路牌（出生地指路）。"""
    c = C(16, 20)
    c.vline(7, 4, 14, WOOD)
    c.vline(8, 4, 14, WOOD_D)
    c.rect(2, 3, 12, 5, (206, 178, 132, 255))
    c.outline(2, 3, 12, 5, WOOD_D)
    c.hline(4, 5, 7, (150, 128, 96, 255))
    c.px(13, 5, (150, 128, 96, 255))
    c.add_silhouette_outline()
    save_strip([c], "signpost.png")


def gen_butterfly():
    """蝴蝶：2 帧扇翅（运行时 tint 出多色）。"""
    frames = []
    for f in range(2):
        c = C(8, 8)
        body = (90, 70, 50, 255)
        wing = (240, 170, 70, 255)
        wing_l = (255, 210, 120, 255)
        c.vline(4, 2, 4, body)
        if f == 0:  # 展翅
            for dx in (1, 6):
                c.rect(dx, 2, 2, 3, wing)
            c.px(1, 2, wing_l)
            c.px(7, 2, wing_l)
        else:  # 收翅
            c.rect(2, 2, 2, 3, wing)
            c.rect(5, 2, 2, 3, wing)
            c.px(2, 2, wing_l)
            c.px(6, 2, wing_l)
        frames.append(c)
    save_strip(frames, "butterfly.png")


def gen_glow():
    """径向光晕（夜间灯光/萤火虫，ADD 混合用）。"""
    c = C(32, 32)
    for yy in range(32):
        for xx in range(32):
            r = math.hypot(xx - 15.5, yy - 15.5) / 14.0
            if r < 1.0:
                a = int(255 * (1 - r) ** 2)
                c.px(xx, yy, (255, 255, 255, a))
    save_strip([c], "glow.png", scale=1)


def gen_clouds():
    """云朵（开场加载层）：两个形态变体，柔边半透明，无描边。"""
    frames = []
    for f in range(2):
        c = C(64, 32)
        rng = random.Random(800 + f)
        body = (236, 242, 250, 235)
        lite = (250, 252, 255, 245)
        shade = (198, 212, 232, 210)
        # 叠 5~6 个椭圆团块拼出云形
        blobs = [(18, 20, 11), (32, 16, 13), (46, 20, 10), (26, 22, 9), (40, 23, 8)]
        if f == 1:
            blobs = [(14, 21, 9), (27, 17, 12), (42, 18, 11), (52, 22, 7), (33, 23, 10)]
        for cx, cy, r in blobs:
            for yy in range(int(cy - r * 0.6), int(cy + r * 0.6) + 1):
                for xx in range(cx - r, cx + r + 1):
                    if ((xx - cx) / r) ** 2 + ((yy - cy) / (r * 0.6)) ** 2 <= 1.0:
                        c.px(xx, yy, body)
        # 顶部高光 / 底部阴影
        for cx, cy, r in blobs:
            for xx in range(cx - r + 2, cx + r - 1):
                c.px(xx, cy - int(r * 0.6) + 1, lite)
        for xx in range(8, 58):
            for yy in range(24, 28):
                if c.img.getpixel((xx, yy))[3] != 0:
                    c.px(xx, yy, shade)
        # 边缘随机抠几个像素做柔边
        for _ in range(20):
            x, y = rng.randrange(64), rng.randrange(32)
            px = c.img.getpixel((x, y))
            if px[3] != 0:
                neighbors = sum(
                    1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 0 <= x + dx < 64 and 0 <= y + dy < 32 and c.img.getpixel((x + dx, y + dy))[3] != 0
                )
                if neighbors < 4:
                    c.px(x, y, (0, 0, 0, 0))
        frames.append(c)
    save_strip(frames, "cloud.png")


def gen_toolbox_bag():
    """工具箱挎包（绑定工具箱的 AI 成员右侧挂饰）。
    6x8@1x -> 12x16，单帧静态图。"""
    BAG = (122, 82, 46, 255)          # 皮革主体（暖棕）
    BAG_D = (88, 54, 24, 255)         # 皮革暗面
    BAG_L = (160, 116, 68, 255)       # 皮革高光（翻盖）
    BUCKLE = (208, 168, 64, 255)      # 金属扣
    STRAP_C = (74, 46, 20, 255)       # 肩带（深棕）

    c = C(6, 8)
    # 肩带（顶部两像素，暗示延伸到肩）
    c.px(3, 0, STRAP_C)
    c.px(3, 1, STRAP_C)
    # 翻盖（高光色）
    c.hline(1, 2, 4, BAG_L)
    c.hline(0, 3, 6, BAG_L)
    # 金属扣（翻盖底中心）
    c.px(2, 3, BUCKLE)
    c.px(3, 3, BUCKLE)
    # 包体
    c.rect(0, 4, 6, 4, BAG)
    # 右侧和底部阴影
    c.vline(5, 4, 4, BAG_D)
    c.hline(0, 7, 5, BAG_D)
    # 前口袋轮廓
    c.outline(1, 5, 3, 2, BAG_D)
    # 角落铆钉
    c.px(0, 4, BUCKLE)

    c.add_silhouette_outline()
    save_strip([c], "effect_toolbox_bag.png")


def gen_effects():
    # 烟雾 4 帧：扩散 + 淡出
    frames = []
    for f in range(4):
        c = C(8, 8)
        r = [1, 2, 3, 3][f]
        a = [220, 190, 130, 70][f]
        grey = (200, 200, 205, a)
        c.disc(4, 4 - f, r, grey)
        if f >= 1:
            c.px(2, 5 - f, (230, 230, 235, a))
        frames.append(c)
    save_strip(frames, "effect_smoke.png")
    # 火花 4 帧：点 → 十字 → 星 → 余烬
    frames = []
    for f in range(4):
        c = C(8, 8)
        if f == 0:
            c.px(4, 4, FLAME_W)
        elif f == 1:
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                c.px(4 + dx, 4 + dy, FLAME_Y)
            c.px(4, 4, FLAME_W)
        elif f == 2:
            for dx, dy in ((0, 0), (2, 0), (-2, 0), (0, 2), (0, -2), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                c.px(4 + dx, 4 + dy, FLAME_Y)
            c.px(4, 4, FLAME_W)
        else:
            c.px(3, 3, (252, 210, 100, 140))
            c.px(5, 5, (252, 210, 100, 140))
        frames.append(c)
    save_strip(frames, "effect_sparkle.png")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"输出目录: {OUT_DIR}")
    gen_tileset()
    gen_tree()
    gen_spawn()
    gen_library()
    gen_workshop_desktop()
    gen_workshop_browser()
    gen_workshop_knowledge()
    gen_workshop_android()
    gen_characters()
    gen_emotes()
    gen_envelope()
    gen_lamp()
    gen_fence()
    gen_bench()
    gen_signpost()
    gen_butterfly()
    gen_glow()
    gen_clouds()
    gen_effects()
    gen_toolbox_bag()
    print("完成。")


if __name__ == "__main__":
    main()
