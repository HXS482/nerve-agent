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
