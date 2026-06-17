// Copies the single-source-of-truth shared modules from device/shared/src into
// this shell's src/ before TypeScript compiles. The copied files are
// gitignored — edit them only in device/shared/src, never the copies here.
//
// Shared files keep their original relative layout so their relative imports
// (e.g. "../store", "./screen") resolve against this shell's own platform
// files after the overlay.
const fs = require('fs')
const path = require('path')

const sharedSrc = path.join(__dirname, '..', '..', 'shared', 'src')
const destSrc = path.join(__dirname, '..', 'src')

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

if (!fs.existsSync(sharedSrc)) {
  console.error(`[sync-shared] shared source not found: ${sharedSrc}`)
  process.exit(1)
}

copyDir(sharedSrc, destSrc)
console.log('[sync-shared] synced device/shared/src -> src')
