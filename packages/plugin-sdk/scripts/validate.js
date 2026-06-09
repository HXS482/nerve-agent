const fs = require('fs')
const path = require('path')

const pluginDir = process.argv[3]
if (!pluginDir) {
  console.error('Usage: nerve-plugin validate <plugin-dir>')
  process.exit(1)
}

const resolvedDir = path.resolve(pluginDir)
const manifestPath = path.join(resolvedDir, 'plugin.json')

let errors = 0
function ok(msg) { console.log(`  ✓ ${msg}`) }
function fail(msg) { console.error(`  ✗ ${msg}`); errors++ }

console.log(`Validating plugin at: ${resolvedDir}\n`)

if (!fs.existsSync(manifestPath)) {
  fail('plugin.json not found')
  process.exit(1)
}
ok('plugin.json found')

let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  ok('plugin.json is valid JSON')
} catch (err) {
  fail(`plugin.json parse error: ${err.message}`)
  process.exit(1)
}

if (!manifest.name || typeof manifest.name !== 'string') {
  fail('manifest.name is required and must be a string')
} else {
  ok(`name: ${manifest.name}`)
}

if (!manifest.version || typeof manifest.version !== 'string') {
  fail('manifest.version is required and must be a string')
} else {
  ok(`version: ${manifest.version}`)
}

const VALID_PERMISSIONS = [
  'fs:read', 'fs:write', 'shell:execute', 'net:http',
  'nerve:mcp', 'nerve:session', 'nerve:memory', 'nerve:channel',
]
if (manifest.permissions) {
  if (!Array.isArray(manifest.permissions)) {
    fail('manifest.permissions must be an array')
  } else {
    for (const perm of manifest.permissions) {
      if (!VALID_PERMISSIONS.includes(perm)) {
        fail(`unknown permission: ${perm}`)
      }
    }
    ok(`permissions: [${manifest.permissions.join(', ')}]`)
  }
}

if (manifest.tools) {
  if (!Array.isArray(manifest.tools)) {
    fail('manifest.tools must be an array')
  } else {
    for (const tool of manifest.tools) {
      if (!tool.name) { fail('tool entry missing "name"'); continue }
      if (!tool.module) { fail(`tool "${tool.name}" missing "module"`); continue }
      const modulePath = path.join(resolvedDir, tool.module)
      if (!fs.existsSync(modulePath)) {
        fail(`tool "${tool.name}" module not found: ${tool.module}`)
      } else if (tool.module.endsWith('.ts')) {
        // TypeScript files can't be require()'d directly — check source for required exports
        const src = fs.readFileSync(modulePath, 'utf-8')
        const hasSchema = /export\s+(const|let|var|function)\s+schema\b/.test(src)
        const hasExecute = /export\s+(const|let|var|function|default)\s+execute\b/.test(src)
        if (!hasSchema) fail(`tool "${tool.name}" missing "schema" export`)
        if (!hasExecute) fail(`tool "${tool.name}" missing "execute" export`)
        if (hasSchema && hasExecute) ok(`tool "${tool.name}": schema + execute (source check)`)
      } else {
        try {
          const mod = require(modulePath)
          if (!mod.schema) fail(`tool "${tool.name}" missing "schema" export`)
          if (!mod.execute) fail(`tool "${tool.name}" missing "execute" export`)
          if (mod.schema && mod.execute) ok(`tool "${tool.name}": schema + execute ✓`)
        } catch (err) {
          fail(`tool "${tool.name}" import error: ${err.message}`)
        }
      }
    }
  }
}

const skillsDir = path.join(resolvedDir, 'skills')
if (fs.existsSync(skillsDir)) {
  const skills = fs.readdirSync(skillsDir).filter(d =>
    fs.statSync(path.join(skillsDir, d)).isDirectory() &&
    fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))
  )
  ok(`skills: ${skills.length} found (${skills.join(', ')})`)
}

const mcpPath = path.join(resolvedDir, '.mcp.json')
if (fs.existsSync(mcpPath)) {
  try {
    JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
    ok('.mcp.json: valid JSON')
  } catch {
    fail('.mcp.json: invalid JSON')
  }
}

console.log('')
if (errors === 0) {
  console.log('✅ Plugin validation passed')
} else {
  console.log(`❌ Plugin validation failed with ${errors} error(s)`)
  process.exit(1)
}
