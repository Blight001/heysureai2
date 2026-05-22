// gen-icons.js - generates extension icon sizes from icons/extension_logo.png
// Uses only Node.js built-ins (zlib for PNG inflate/deflate).
import zlib from 'zlib'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.join(__dirname, '..', 'icons')
const sourceIcon = path.join(iconsDir, 'extension_logo.png')
const fallbackSourceIcon = path.join(iconsDir, 'icon128.png')

const CRC = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[i] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function readPng(file) {
  const buf = fs.readFileSync(file)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${file} is not a PNG`)

  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii')
    const data = buf.subarray(pos + 8, pos + 8 + len)
    pos += 12 + len
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`)
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(width * height * channels)
  let rawPos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++]
    const rowStart = y * stride
    const prevStart = rowStart - stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[rowStart + x - channels] : 0
      const up = y > 0 ? pixels[prevStart + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0
      const val = raw[rawPos++]
      if (filter === 0) pixels[rowStart + x] = val
      else if (filter === 1) pixels[rowStart + x] = (val + left) & 255
      else if (filter === 2) pixels[rowStart + x] = (val + up) & 255
      else if (filter === 3) pixels[rowStart + x] = (val + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) pixels[rowStart + x] = (val + paeth(left, up, upLeft)) & 255
      else throw new Error(`unsupported PNG filter: ${filter}`)
    }
  }

  return { width, height, colorType, channels, pixels }
}

function resizeBilinear(src, size) {
  const out = Buffer.alloc(size * size * src.channels)
  const xRatio = src.width / size
  const yRatio = src.height / size

  for (let y = 0; y < size; y++) {
    const sy = (y + 0.5) * yRatio - 0.5
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(src.height - 1, y0 + 1)
    const wy = sy - y0
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) * xRatio - 0.5
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(src.width - 1, x0 + 1)
      const wx = sx - x0
      for (let c = 0; c < src.channels; c++) {
        const p00 = src.pixels[(y0 * src.width + x0) * src.channels + c]
        const p10 = src.pixels[(y0 * src.width + x1) * src.channels + c]
        const p01 = src.pixels[(y1 * src.width + x0) * src.channels + c]
        const p11 = src.pixels[(y1 * src.width + x1) * src.channels + c]
        const top = p00 * (1 - wx) + p10 * wx
        const bottom = p01 * (1 - wx) + p11 * wx
        out[(y * size + x) * src.channels + c] = Math.round(top * (1 - wy) + bottom * wy)
      }
    }
  }

  return out
}

function writePng(file, size, colorType, channels, pixels) {
  const ihdr = Buffer.from([
    0, 0, 0, 0, 0, 0, 0, 0,
    8, colorType,
    0, 0, 0,
  ])
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)

  const stride = size * channels
  const raw = Buffer.alloc(size * (1 + stride))
  for (let y = 0; y < size; y++) {
    const rawStart = y * (1 + stride)
    raw[rawStart] = 0
    pixels.copy(raw, rawStart + 1, y * stride, (y + 1) * stride)
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const idat = zlib.deflateSync(raw, { level: 9 })
  fs.writeFileSync(file, Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]))
}

fs.mkdirSync(iconsDir, { recursive: true })
const srcFile = fs.existsSync(sourceIcon) ? sourceIcon : fallbackSourceIcon
const src = readPng(srcFile)

for (const size of [16, 48, 128]) {
  writePng(
    path.join(iconsDir, `icon${size}.png`),
    size,
    src.colorType,
    src.channels,
    resizeBilinear(src, size),
  )
  console.log(`  icon${size}.png (${size}x${size})`)
}

console.log(`icons generated from ${path.basename(srcFile)}`)
