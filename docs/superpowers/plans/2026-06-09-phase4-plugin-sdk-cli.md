# Phase 4: Plugin SDK + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@nerve/plugin-sdk` workspace package for plugin developers (types + Zod) and a `nerve-plugin` CLI for validating and scaffolding plugins.

**Architecture:** The SDK is a standalone TypeScript package in `packages/plugin-sdk/` that re-exports plugin types and Zod. Plugin developers import from `@nerve/plugin-sdk` in their tool modules. The CLI is a simple Node.js script (`bin/nerve-plugin.js`) that validates manifests and scaffolds new plugins.

**Tech Stack:** TypeScript, Zod, Node.js CLI

**Spec reference:** `docs/superpowers/specs/2026-06-08-plugin-system-design.md` Sections 13.1–13.4

**Prerequisite:** Phase 1–3 complete.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `packages/plugin-sdk/package.json` | SDK package manifest |
| Create | `packages/plugin-sdk/tsconfig.json` | TypeScript config |
| Create | `packages/plugin-sdk/src/index.ts` | Main export — re-exports types + zod |
| Create | `packages/plugin-sdk/src/types.ts` | Plugin type definitions (subset of plugin-types.ts) |
| Create | `packages/plugin-sdk/bin/nerve-plugin.js` | CLI entry point |
| Create | `packages/plugin-sdk/scripts/validate.js` | Manifest + tool validation |
| Create | `packages/plugin-sdk/scripts/init.js` | Plugin scaffolding |

---

### Task 1: Create SDK package structure

**Files:**
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Create: `packages/plugin-sdk/src/index.ts`

- [ ] **Step 1: Create packages/plugin-sdk/ directory**

Run: `mkdir -p packages/plugin-sdk/src packages/plugin-sdk/bin packages/plugin-sdk/scripts`

- [ ] **Step 2: Create package.json**

Create `packages/plugin-sdk/package.json`:

```json
{
  "name": "@nerve/plugin-sdk",
  "version": "0.1.0",
  "description": "SDK for building Nerve plugins",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "nerve-plugin": "./bin/nerve-plugin.js"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  },
  "files": [
    "dist",
    "bin",
    "scripts"
  ],
  "license": "MIT"
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/plugin-sdk/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create src/index.ts**

Create `packages/plugin-sdk/src/index.ts`:

```typescript
export { z } from 'zod'
export type { ZodType, ZodObject } from 'zod'

// Plugin type definitions for tool modules
export interface PluginToolContext {
  readonly pluginId: string
  readonly pluginDir: string
  readonly sessionId: string
  readonly scope: 'user' | 'project'
  readonly trust: 'local' | 'project' | 'marketplace'
  readonly projectDir?: string
  readonly fs?: {
    readFile(path: string): Promise<string>
    readDir(path: string): Promise<string[]>
    exists(path: string): Promise<boolean>
    writeFile(path: string, content: string): Promise<void>
    mkdir(path: string): Promise<void>
  }
  readonly shell?: {
    exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  readonly net?: {
    fetch(url: string, opts?: RequestInit): Promise<Response>
  }
}

export type PluginToolExecute<T extends Record<string, any>> = (
  args: T,
  ctx: PluginToolContext,
) => Promise<{ output: string } | { error: string } | Record<string, unknown>>

// Helper type for defining tools with Zod schema
export interface PluginToolDefinition<T extends Record<string, any>> {
  description: string
  schema: import('zod').ZodObject<any>
  execute: PluginToolExecute<T>
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/
git commit -m "feat: add @nerve/plugin-sdk package with types"
```

---

### Task 2: Add CLI — validate command

**Files:**
- Create: `packages/plugin-sdk/bin/nerve-plugin.js`
- Create: `packages/plugin-sdk/scripts/validate.js`

- [ ] **Step 1: Create CLI entry point**

Create `packages/plugin-sdk/bin/nerve-plugin.js`:

```javascript
#!/usr/bin/env node

const [,, command, ...args] = process.argv

const commands = {
  validate: () => require('../scripts/validate.js'),
  init: () => require('../scripts/init.js'),
  help: () => {
    console.log(`
nerve-plugin — Nerve Plugin CLI

Usage:
  nerve-plugin validate <plugin-dir>   Validate a plugin directory
  nerve-plugin init <name>             Create a new plugin scaffold
  nerve-plugin help                    Show this help
`)
  },
}

const cmd = commands[command]
if (!cmd) {
  console.error(`Unknown command: ${command}`)
  commands.help()
  process.exit(1)
}

cmd()
```

- [ ] **Step 2: Create validate script**

Create `packages/plugin-sdk/scripts/validate.js`:

```javascript
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

// 1. Check plugin.json exists
if (!fs.existsSync(manifestPath)) {
  fail('plugin.json not found')
  process.exit(1)
}
ok('plugin.json found')

// 2. Parse and validate manifest
let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  ok('plugin.json is valid JSON')
} catch (err) {
  fail(`plugin.json parse error: ${err.message}`)
  process.exit(1)
}

// 3. Required fields
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

// 4. Validate permissions
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

// 5. Validate tool entries
if (manifest.tools) {
  if (!Array.isArray(manifest.tools)) {
    fail('manifest.tools must be an array')
  } else {
    for (const tool of manifest.tools) {
      if (!tool.name) {
        fail('tool entry missing "name"')
        continue
      }
      if (!tool.module) {
        fail(`tool "${tool.name}" missing "module"`)
        continue
      }
      const modulePath = path.join(resolvedDir, tool.module)
      if (!fs.existsSync(modulePath)) {
        fail(`tool "${tool.name}" module not found: ${tool.module}`)
      } else {
        // Try to check exports
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

// 6. Check for auto-discoverable components
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

// Summary
console.log('')
if (errors === 0) {
  console.log('✅ Plugin validation passed')
} else {
  console.log(`❌ Plugin validation failed with ${errors} error(s)`)
  process.exit(1)
}
```

- [ ] **Step 3: Make CLI executable**

Run: `chmod +x packages/plugin-sdk/bin/nerve-plugin.js` (on Unix) or ensure the shebang line is present.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-sdk/
git commit -m "feat: add nerve-plugin validate CLI command"
```

---

### Task 3: Add CLI — init command

**Files:**
- Create: `packages/plugin-sdk/scripts/init.js`

- [ ] **Step 1: Create init script**

Create `packages/plugin-sdk/scripts/init.js`:

```javascript
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

// Create directory structure
fs.mkdirSync(path.join(targetDir, 'tools'), { recursive: true })

// Create plugin.json
const manifest = {
  name,
  version: '0.1.0',
  description: '',
  permissions: [],
  tools: [
    { name: 'hello', module: './tools/hello.ts' },
  ],
}
fs.writeFileSync(
  path.join(targetDir, 'plugin.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)

// Create example tool
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

// Summary
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/plugin-sdk/
git commit -m "feat: add nerve-plugin init scaffolding command"
```

---

### Task 4: Build and test CLI

- [ ] **Step 1: Install SDK dependencies**

Run: `cd packages/plugin-sdk && npm install`

- [ ] **Step 2: Build SDK**

Run: `cd packages/plugin-sdk && npm run build`
Expected: `dist/` directory created with `.js` and `.d.ts` files

- [ ] **Step 3: Test validate command**

Run: `node packages/plugin-sdk/bin/nerve-plugin.js validate ~/.nerve/plugins/hyperframes`
(If hyperframes plugin exists, it should validate. Otherwise test with any plugin directory.)

Expected: Validation output with ✓/✗ markers.

- [ ] **Step 4: Test init command**

Run: `node packages/plugin-sdk/bin/nerve-plugin.js init test-plugin`
Expected: Creates `test-plugin/` directory with `plugin.json` and `tools/hello.ts`

Clean up: `rm -rf test-plugin`

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/
git commit --allow-empty -m "verify: plugin SDK and CLI working"
```
