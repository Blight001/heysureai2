// One-off helper: regenerate catalog.json from extension definitions.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import vm from 'vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defsPath = path.resolve(__dirname, '../../../../../device/extension/src/lib/tools/definitions.ts')
let src = fs.readFileSync(defsPath, 'utf8')
src = src.replace(/^import.*$/gm, '')
src = src.replace(/export /g, '')
src = src.replace(/: AIToolDef\[\]/g, '')
const capIdx = src.indexOf('const BROWSER_CAPABILITIES')
if (capIdx > 0) src = src.slice(0, capIdx)

const out = vm.runInNewContext(
  src + '; JSON.stringify(BROWSER_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })), null, 2)',
  {},
)
const catalog = JSON.parse(out)
fs.writeFileSync(path.join(__dirname, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8')
console.log(`wrote ${catalog.length} tools to catalog.json`)