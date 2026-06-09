const fs = require('fs')
const path = require('path')

const name = process.argv[3]
if (!name) {
  console.error('Usage: nerve-plugin init <plugin-name>')
  process.exit(1)
}

const targetDir = path.resolve(name)

if (fs.existsSync(targetDir)) {
  console.error(`Directory already exists: ${targetDir}`)
  process.exit(1)
}

console.log(`Creating plugin: ${name}\n`)

fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true })

const manifest = {
  name,
  version: '0.1.0',
  description: '',
  permissions: [],
  tools: [{ name: 'hello', module: './tools/hello.ts' }],
}
fs.writeFileSync(
  path.join(targetDir, 'plugin.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)

const toolContent = `import { z } from '@nerve/plugin-sdk'
import type { PluginToolExecute } from '@nerve/plugin-sdk'

export const description = 'Say hello'

export const schema = z.object({
  name: z.string().describe('Name to greet'),
})

export const execute: PluginToolExecute<{ name: string }> = async (args, ctx) => {
  return { output: \`Hello, \${args.name}! From plugin \${ctx.pluginId}\` }
}
`
fs.writeFileSync(path.join(targetDir, 'tools', 'hello.ts'), toolContent)

console.log(`✅ Plugin created at: ${targetDir}`)
console.log('')
console.log('Files:')
console.log(`  ${name}/plugin.json`)
console.log(`  ${name}/tools/hello.ts`)
console.log('')
console.log('Next steps:')
console.log(`  cd ${name}`)
console.log('  # Edit plugin.json and tools/ to add your functionality')
console.log('  # Place in ~/.nerve/plugins/ to install')
console.log(`  nerve-plugin validate .`)
