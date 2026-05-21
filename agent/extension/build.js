// build.js — esbuild script for HeySure browser extension
import * as esbuild from 'esbuild'
import fs from 'fs'

const watch = process.argv.includes('--watch')

const sharedOpts = {
  bundle: true,
  minify: false,
  platform: 'browser',
  target: 'chrome119',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Suppress node built-ins warning from socket.io-client's unused paths
  logOverride: { 'unsupported-require-call': 'silent' },
}

const entries = [
  { in: 'src/background.ts', out: 'dist/background.js' },
  { in: 'src/content.ts',    out: 'dist/content.js' },
  { in: 'src/popup.ts',      out: 'dist/popup.js' },
]

if (!fs.existsSync('dist')) fs.mkdirSync('dist', { recursive: true })

if (watch) {
  const ctx = await esbuild.context({
    ...sharedOpts,
    entryPoints: entries.map(e => e.in),
    outdir: 'dist',
  })
  await ctx.watch()
  console.log('[esbuild] watching for changes…')
} else {
  for (const entry of entries) {
    await esbuild.build({ ...sharedOpts, entryPoints: [entry.in], outfile: entry.out })
    console.log(`  built ${entry.in} → ${entry.out}`)
  }
  console.log('[esbuild] build complete ✓')
}
