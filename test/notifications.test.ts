import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { notificationFor, notifyMacOS } from "../src/task-notifier.ts"

describe("notificationFor", () => {
  test("maps completion to the green notification", () => {
    expect(notificationFor("session.execution.succeeded")).toEqual({
      title: "🟢 OpenCode",
      body: "Task completed — ready for review.",
    })
  })

  test("maps failure to the red notification", () => {
    expect(notificationFor("session.execution.failed")).toEqual({
      title: "🔴 OpenCode",
      body: "Task encountered an error.",
    })
  })

  test("maps permission request to the yellow notification", () => {
    expect(notificationFor("permission.asked")).toEqual({
      title: "🟡 OpenCode",
      body: "OpenCode is waiting for your input.",
    })
  })

  test("stays silent for lifecycle and unrelated events", () => {
    for (const type of [
      "session.created",
      "session.execution.started",
      "session.execution.interrupted",
      "session.idle",
      "session.status",
      "permission.replied",
      "server.connected",
      "rpc.foo",
    ]) {
      expect(notificationFor(type)).toBeNull()
    }
  })
})

describe("delivery", () => {
  let dir: string
  let log: string
  let savedPath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notifier-test-"))
    log = join(dir, "osascript.log")
    const shim = join(dir, "osascript")
    Bun.write(shim, `#!/bin/zsh\nprint -r -- "$@" >> "${log}"\n`)
    require("node:child_process").execFileSync("chmod", ["+x", shim])
    savedPath = process.env.PATH
    process.env.PATH = `${dir}:${savedPath ?? ""}`
  })

  afterEach(() => {
    process.env.PATH = savedPath
    rmSync(dir, { recursive: true, force: true })
  })

  const readLog = (): string[] =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []

  const waitForLog = async (count: number): Promise<string[]> => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const lines = readLog()
      if (lines.length >= count && !(lines.length === 1 && lines[0] === "")) return lines
      await Bun.sleep(200)
    }
    return readLog()
  }

  test("notifyMacOS invokes osascript with title and body", async () => {
    notifyMacOS({ title: "🟢 OpenCode", body: "Task completed — ready for review." })
    expect(await waitForLog(1)).toEqual([
      `-e display notification "Task completed — ready for review." with title "🟢 OpenCode"`,
    ])
  })

  test("plugin setup notifies once per mapped event, in order", async () => {
    async function* events() {
      yield { type: "session.created" }
      yield { type: "session.execution.started" }
      yield { type: "session.execution.succeeded" }
      yield { type: "session.idle" }
      yield { type: "permission.asked" }
      yield { type: "session.execution.failed" }
      yield { type: "session.execution.interrupted" }
    }
    await plugin.setup({ event: { subscribe: () => events() } } as any)
    // Detached spawns can complete out of order; compare as sets.
    expect((await waitForLog(3)).sort()).toEqual([
      `-e display notification "Task completed — ready for review." with title "🟢 OpenCode"`,
      `-e display notification "OpenCode is waiting for your input." with title "🟡 OpenCode"`,
      `-e display notification "Task encountered an error." with title "🔴 OpenCode"`,
    ].sort())
  })
})
