import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  installPlugin,
  pluginPaths,
  statusPlugin,
  testNotification,
  uninstallPlugin,
  type Paths,
  type Sys,
} from "../src/commands.ts"

function stubSys(files: Record<string, string> = {}): Sys & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(files))
  return {
    store,
    exists: (p) => store.has(p),
    read: (p) => {
      const content = store.get(p)
      if (content === undefined) throw new Error(`missing: ${p}`)
      return content
    },
    remove: (p) => {
      store.delete(p)
    },
    copy: (from, to) => {
      const content = store.get(from)
      if (content === undefined) throw new Error(`missing: ${from}`)
      store.set(to, content)
    },
    run: () => ({ ok: true, output: "" }),
    size: (p) => (store.has(p) ? store.get(p)!.length : null),
  }
}

describe("pluginPaths", () => {
  test("derives the four locations", () => {
    const paths = pluginPaths("/home/u", "/repo")
    expect(paths).toEqual({
      bundleFile: "/repo/dist/task-notifier.js",
      pluginFile: "/home/u/.config/opencode/plugins/task-notifier.js",
      configFile: "/home/u/.config/opencode/task-notifier.json",
      exampleFile: "/repo/task-notifier.example.json",
      repoRoot: "/repo",
    })
  })
})

describe("install/uninstall", () => {
  let dir: string
  let paths: Paths

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notifier-cli-"))
    paths = {
      bundleFile: join(dir, "dist.js"),
      pluginFile: join(dir, "plugins", "task-notifier.js"),
      configFile: join(dir, "task-notifier.json"),
      exampleFile: join(dir, "example.json"),
      repoRoot: dir,
    }
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("install copies the bundle, then uninstall removes it", () => {
    const sys = stubSys({ [paths.bundleFile]: "bundle!" })
    const installed = installPlugin(sys, paths)
    expect(installed.ok).toBe(true)
    expect(sys.store.get(paths.pluginFile)).toBe("bundle!")

    const uninstalled = uninstallPlugin(sys, paths)
    expect(uninstalled.ok).toBe(true)
    expect(sys.store.has(paths.pluginFile)).toBe(false)
  })

  test("install builds first when the bundle is missing", () => {
    const calls: string[][] = []
    const sys = stubSys()
    sys.run = (cmd, args) => {
      calls.push([cmd, ...args])
      sys.store.set(paths.bundleFile, "built!")
      return { ok: true, output: "" }
    }
    const result = installPlugin(sys, paths)
    expect(result.ok).toBe(true)
    expect(calls).toEqual([["bun", "run", "build"]])
    expect(sys.store.get(paths.pluginFile)).toBe("built!")
  })

  test("install fails cleanly when the build fails", () => {
    const sys = stubSys()
    sys.run = () => ({ ok: false, output: "boom" })
    const result = installPlugin(sys, paths)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("boom")
  })

  test("install --with-config copies the example only when absent", () => {
    const sys = stubSys({ [paths.bundleFile]: "b", [paths.exampleFile]: '{"a":1}' })
    installPlugin(sys, paths, { withConfig: true })
    expect(sys.store.get(paths.configFile)).toBe('{"a":1}')

    const sys2 = stubSys({
      [paths.bundleFile]: "b",
      [paths.exampleFile]: '{"a":1}',
      [paths.configFile]: '{"mine":true}',
    })
    const result = installPlugin(sys2, paths, { withConfig: true })
    expect(sys2.store.get(paths.configFile)).toBe('{"mine":true}')
    expect(result.message).toContain("left untouched")
  })

  test("uninstall keeps config by default, removes with flag", () => {
    const sys = stubSys({ [paths.pluginFile]: "b", [paths.configFile]: "{}" })
    uninstallPlugin(sys, paths)
    expect(sys.store.has(paths.configFile)).toBe(true)

    const sys2 = stubSys({ [paths.pluginFile]: "b", [paths.configFile]: "{}" })
    uninstallPlugin(sys2, paths, { removeConfig: true })
    expect(sys2.store.has(paths.configFile)).toBe(false)
  })

  test("uninstall on empty state is harmless", () => {
    const result = uninstallPlugin(stubSys(), paths)
    expect(result.ok).toBe(true)
    expect(result.message).toContain("not installed")
  })
})

describe("status", () => {
  test("reports installed + registered + custom config", () => {
    const paths = pluginPaths("/home/u", "/repo")
    const sys = stubSys({
      [paths.pluginFile]: "x".repeat(100),
      [paths.configFile]: JSON.stringify({ permission: false, sound: true }),
    })
    sys.run = () => ({ ok: true, output: JSON.stringify({ data: [{ id: "task-notifier" }] }) })
    const result = statusPlugin(sys, paths)
    expect(result.message).toContain("installed")
    expect(result.message).toContain("registered and active")
    expect(result.message).toContain("permission=off")
  })

  test("reports missing plugin and unreachable server", () => {
    const paths = pluginPaths("/home/u", "/repo")
    const sys = stubSys()
    sys.run = () => ({ ok: false, output: "down" })
    const result = statusPlugin(sys, paths)
    expect(result.message).toContain("NOT installed")
    expect(result.message).toContain("unreachable")
    expect(result.message).toContain("defaults in effect")
  })

  test("tolerates broken config", () => {
    const paths = pluginPaths("/home/u", "/repo")
    const sys = stubSys({ [paths.pluginFile]: "b", [paths.configFile]: "{oops" })
    const result = statusPlugin(sys, paths)
    expect(result.message).toContain("unreadable")
  })
})

describe("test command", () => {
  test("sends a sample through the injected notifier", () => {
    const paths = pluginPaths("/home/u", "/repo")
    const sys = stubSys({ [paths.configFile]: JSON.stringify({ sound: "Ping" }) })
    const sent: Array<{ title: string; body: string; sound: string | null }> = []
    const result = testNotification(sys, paths, (title, body, sound) => {
      sent.push({ title, body, sound })
    })
    expect(result.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toContain("OpenCode")
    expect(sent[0].sound).toBe("Ping")
  })

  test("refuses when completion is disabled", () => {
    const paths = pluginPaths("/home/u", "/repo")
    const sys = stubSys({ [paths.configFile]: JSON.stringify({ completion: false }) })
    let called = false
    const result = testNotification(sys, paths, () => {
      called = true
    })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  test("writes a fixture through the real fs (sanity)", () => {
    const dir = mkdtempSync(join(tmpdir(), "notifier-cli-"))
    try {
      const path = join(dir, "x.txt")
      writeFileSync(path, "hi")
      expect(stubSys({ [path]: "hi" }).read(path)).toBe("hi")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
