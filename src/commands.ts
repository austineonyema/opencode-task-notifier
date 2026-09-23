/**
 * CLI command implementations (`install`, `status`, `test`, `uninstall`).
 *
 * All side effects go through the injected `Sys` adapter so commands are
 * unit-testable with stub filesystems. `src/cli.ts` wires the real one.
 */
import { buildNotification } from "./notifications.ts"
import { loadConfig, soundFor } from "./config.ts"
import { notifyMacOS } from "./macos.ts"

export interface Sys {
  exists: (path: string) => boolean
  read: (path: string) => string
  remove: (path: string) => void
  copy: (from: string, to: string) => void
  /** Run a command, capturing stdout. Never throws: reports via `ok`. */
  run: (cmd: string, args: string[], cwd?: string) => { ok: boolean; output: string }
  size: (path: string) => number | null
}

export interface Paths {
  /** Bundled plugin to install, e.g. `<repo>/dist/task-notifier.js`. */
  bundleFile: string
  /** Installed plugin, e.g. `~/.config/opencode/plugins/task-notifier.js`. */
  pluginFile: string
  /** User config, e.g. `~/.config/opencode/task-notifier.json`. */
  configFile: string
  /** Shipped example config, e.g. `<repo>/task-notifier.example.json`. */
  exampleFile: string
  /** Repo root (used as cwd for the build step). */
  repoRoot: string
}

export interface Result {
  ok: boolean
  message: string
}

export function pluginPaths(home: string, repoRoot: string): Paths {
  const base = `${home}/.config/opencode`
  return {
    bundleFile: `${repoRoot}/dist/index.js`,
    pluginFile: `${base}/plugins/task-notifier.js`,
    configFile: `${base}/task-notifier.json`,
    exampleFile: `${repoRoot}/task-notifier.example.json`,
    repoRoot,
  }
}

function registered(run: Sys["run"]): boolean | null {
  const result = run("opencode", ["api", "get", "/api/plugin"])
  if (!result.ok) return null
  try {
    const data = JSON.parse(result.output) as { data?: Array<{ id?: string }> }
    return Array.isArray(data.data) && data.data.some((p) => p.id === "task-notifier")
  } catch {
    return null
  }
}

export function installPlugin(
  sys: Sys,
  paths: Paths,
  opts: { withConfig: boolean } = { withConfig: false },
): Result {
  if (!sys.exists(paths.bundleFile)) {
    const built = sys.run("bun", ["run", "build"], paths.repoRoot)
    if (!built.ok || !sys.exists(paths.bundleFile)) {
      return { ok: false, message: "Build failed: run `bun run build` first.\n" + built.output }
    }
  }
  sys.copy(paths.bundleFile, paths.pluginFile)
  const lines = [`Installed plugin → ${paths.pluginFile}`]
  if (opts.withConfig) {
    if (sys.exists(paths.configFile)) {
      lines.push(`Config already present (left untouched): ${paths.configFile}`)
    } else if (sys.exists(paths.exampleFile)) {
      sys.copy(paths.exampleFile, paths.configFile)
      lines.push(`Installed example config → ${paths.configFile}`)
    } else {
      lines.push(`Example config not found at ${paths.exampleFile}; skipping.`)
    }
  }
  lines.push("The server hot-reloads plugins — no restart needed.")
  return { ok: true, message: lines.join("\n") }
}

export function uninstallPlugin(
  sys: Sys,
  paths: Paths,
  opts: { removeConfig: boolean } = { removeConfig: false },
): Result {
  const lines: string[] = []
  if (sys.exists(paths.pluginFile)) {
    sys.remove(paths.pluginFile)
    lines.push(`Removed plugin: ${paths.pluginFile}`)
  } else {
    lines.push("Plugin is not installed (nothing to remove).")
  }
  if (opts.removeConfig) {
    if (sys.exists(paths.configFile)) {
      sys.remove(paths.configFile)
      lines.push(`Removed config: ${paths.configFile}`)
    } else {
      lines.push("No config file present.")
    }
  } else {
    lines.push(`Config kept: ${paths.configFile}`)
  }
  return { ok: true, message: lines.join("\n") }
}

export function statusPlugin(sys: Sys, paths: Paths): Result {
  const lines = ["Task Notifier status:"]
  const installed = sys.exists(paths.pluginFile)
  if (installed) {
    const size = sys.size(paths.pluginFile)
    lines.push(
      `  plugin: installed (${paths.pluginFile}${size !== null ? `, ${(size / 1024).toFixed(1)} KB` : ""})`,
    )
  } else {
    lines.push(`  plugin: NOT installed (expected at ${paths.pluginFile})`)
  }
  const reg = registered(sys.run)
  const server =
    reg === true
      ? "registered and active"
      : reg === false
        ? installed
          ? "file present but not registered"
          : "not registered (plugin not installed)"
        : "unknown (server unreachable)"
  lines.push(`  server: ${server}`)
  if (sys.exists(paths.configFile)) {
    try {
      const config = loadConfig(JSON.parse(sys.read(paths.configFile)))
      const onoff = (v: boolean): string => (v ? "on" : "off")
      lines.push(
        `  config: ${paths.configFile} ` +
          `(completion=${onoff(config.completion)} error=${onoff(config.error)} ` +
          `permission=${onoff(config.permission)} sound=${JSON.stringify(config.sound)})`,
      )
    } catch {
      lines.push(`  config: ${paths.configFile} (unreadable — defaults in effect)`)
    }
  } else {
    lines.push("  config: none (defaults in effect: all on, silent)")
  }
  return { ok: true, message: lines.join("\n") }
}

export function testNotification(
  sys: Sys,
  paths: Paths,
  notify: (title: string, body: string, sound: string | null) => void = (t, b, s) =>
    notifyMacOS({ title: t, body: b }, s),
): Result {
  let raw: unknown
  try {
    raw = sys.exists(paths.configFile) ? JSON.parse(sys.read(paths.configFile)) : undefined
  } catch {
    raw = undefined
  }
  const config = loadConfig(raw)
  if (!config.completion) {
    return { ok: false, message: "Completion notifications are disabled in config — nothing sent." }
  }
  const notification = buildNotification(
    { type: "session.execution.succeeded", location: { directory: "cli-test" } },
    { project: "cli-test", sessionTitle: "CLI self-test", elapsed: "1s" },
  )
  if (!notification) return { ok: false, message: "Internal error: sample did not map." }
  notify(notification.title, notification.body, soundFor(config, "completion"))
  return { ok: true, message: `Sent test notification: ${notification.title} — ${notification.body}` }
}
