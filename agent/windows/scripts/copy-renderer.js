const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.join(root, 'src', 'renderer', 'index.html')
const chatSrc = path.join(root, 'src', 'renderer', 'offline-chat.html')
const outDir = path.join(root, 'dist', 'renderer')
const dest = path.join(outDir, 'index.html')
const chatDest = path.join(outDir, 'offline-chat.html')

fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(src, dest)
fs.copyFileSync(chatSrc, chatDest)
