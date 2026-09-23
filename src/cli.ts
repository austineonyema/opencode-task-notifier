#!/usr/bin/env node
/**
 * `opencode-task-notifier` CLI: install | status | test | uninstall.
 *
 * Usage:
 *   opencode-task-notifier install [--with-config]
 *   opencode-task-notifier status
 *   opencode-task-notifier test
 *   opencode-task-notifier uninstall [--remove-config]
 */
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import {
  installPlugin,
  pluginPaths,
  statusPlugin,
  testNotification,
  uninstallPlugin,
  type Sys,
} from "./commands.ts"

const require = createRequire(import.meta.url)
const pkg: { version: string } = require("../package.json")

const sys: Sys = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  remove: (path) => rmSync(path, { force: true }),
  copy: (from, to) => copyFileSync(from, to),
  run: (cmd, args, cwd) => {
    try {
      const output = execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: 30000 })
      return { ok: true, output }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, output: message }
    }
  },
  size: (path) => {
    try {
      return statSync(path).size
    } catch {
      return null
    }
  },
}

const HELP = `opencode-task-notifier ${pkg.version} — native OpenCode session notifications

Usage:
  opencode-task-notifier install [--with-config]   build + install the plugin
  opencode-task-notifier status                     show install/config/server state
  opencode-task-notifier test                       send a sample notification
  opencode-task-notifier uninstall [--remove-config]  remove the plugin

Options:
  --with-config    also install the example config (only if none exists)
  --remove-config  also delete the user config file
  -h, --help       show this help
  -v, --version    show version`

function main(argv: string[]): number {
  const [command, ...flags] = argv
  const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..")
  const paths = pluginPaths(homedir(), repoRoot)

  switch (command) {
    case "install": {
      const result = installPlugin(sys, paths, { withConfig: flags.includes("--with-config") })
      console.log(result.message)
      return result.ok ? 0 : 1
    }
    case "uninstall": {
      const result = uninstallPlugin(sys, paths, {
        removeConfig: flags.includes("--remove-config"),
      })
      console.log(result.message)
      return result.ok ? 0 : 1
    }
    case "status": {
      const result = statusPlugin(sys, paths)
      console.log(result.message)
      return 0
    }
    case "test": {
      const result = testNotification(sys, paths)
      console.log(result.message)
      return result.ok ? 0 : 1
    }
    case "-h":
    case "--help":
    case undefined:
      console.log(HELP)
      return 0
    case "-v":
    case "--version":
      console.log(pkg.version)
      return 0
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`)
      return 1
  }
}

process.exit(main(process.argv.slice(2)))
