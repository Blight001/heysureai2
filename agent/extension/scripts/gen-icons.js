// gen-icons.js — generates minimal PNG icon files for the extension
// Uses only Node.js built-ins (zlib for deflate compression)
import zlib from 'zlib'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir  = path.join(__dirname, '..', 'icons')

// Build CRC-32 lookup table (used for PNG chunk CRCs)
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
  const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))])
}

function makePng(size, r, g, b) {
  const SIG  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const IHDR = Buffer.from([
    0, 0, 0, 0,  0, 0, 0, 0,  // width, height (filled below)
    8, 2,                      // bit depth 8, color type RGB
    0, 0, 0,                   // compression, filter, interlace
  ])
  IHDR.writeUInt32BE(size, 0)
  IHDR.writeUInt32BE(size, 4)

  // Raw scanlines: filter byte (0 = None) + RGB pixels per row
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    const base = y * (1 + size * 3)
    raw[base] = 0 // filter None
    for (let x = 0; x < size; x++) {
      const px = base + 1 + x * 3
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([
    SIG,
    pngChunk('IHDR', IHDR),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// Icon variants by connection state (all written at build time; default is the indigo one)
const PALETTE = {
  default: [99, 102, 241],  // indigo — default / disconnected
}

fs.mkdirSync(iconsDir, { recursive: true })

for (const size of [16, 48, 128]) {
  const [r, g, b] = PALETTE.default
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), makePng(size, r, g, b))
  console.log(`  icon${size}.png  (${size}×${size})`)
}
console.log('icons generated ✓')
