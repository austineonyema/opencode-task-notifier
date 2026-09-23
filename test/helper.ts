/** Shared `osascript` PATH-shim for delivery tests. Not a test file. */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface Shim {
  readLog: () => string[]
  waitForLog: (count: number) => Promise<string[]>
  restore: () => void
}

export function installOsascriptShim(): Shim {
  const dir = mkdtempSync(join(tmpdir(), "notifier-test-"))
  const log = join(dir, "osascript.log")
  const shim = join(dir, "osascript")
  writeFileSync(shim, `#!/bin/zsh\nprint -r -- "$@" >> "${log}"\n`)
  execFileSync("chmod", ["+x", shim])
  const savedPath = process.env.PATH
  process.env.PATH = `${dir}:${savedPath ?? ""}`

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

  const restore = (): void => {
    process.env.PATH = savedPath
    rmSync(dir, { recursive: true, force: true })
  }

  return { readLog, waitForLog, restore }
}
