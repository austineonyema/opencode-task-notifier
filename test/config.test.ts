import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_CONFIG,
  isEnabled,
  loadConfig,
  readConfigFile,
  soundFor,
} from "../src/config.ts"

describe("loadConfig", () => {
  test("defaults when absent or malformed", () => {
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(loadConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(loadConfig("nope")).toEqual(DEFAULT_CONFIG)
    expect(loadConfig([1, 2])).toEqual(DEFAULT_CONFIG)
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG)
  })
  test("respects per-type toggles, ignores junk", () => {
    expect(loadConfig({ completion: false, error: "yes", permission: 0 })).toEqual({
      ...DEFAULT_CONFIG,
      completion: false,
    })
  })
  test("normalizes sound variants", () => {
    expect(loadConfig({ sound: true }).sound).toBe(true)
    expect(loadConfig({ sound: "Ping" }).sound).toBe("Ping")
    expect(loadConfig({ sound: { error: "Basso", permission: false } }).sound).toEqual({
      error: "Basso",
      permission: false,
    })
    expect(loadConfig({ sound: { error: 42 } }).sound).toEqual({})
    expect(loadConfig({ sound: 42 }).sound).toBe(false)
  })
})

describe("readConfigFile", () => {
  test("parses a config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notifier-cfg-"))
    try {
      const path = join(dir, "task-notifier.json")
      writeFileSync(path, JSON.stringify({ completion: false }))
      expect(readConfigFile(path)).toEqual({ completion: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test("returns undefined for missing or invalid files", () => {
    expect(readConfigFile(join(tmpdir(), "notifier-nope", "x.json"))).toBeUndefined()
    const dir = mkdtempSync(join(tmpdir(), "notifier-cfg-"))
    try {
      const path = join(dir, "bad.json")
      writeFileSync(path, "{not json")
      expect(readConfigFile(path)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("isEnabled", () => {
  test("gates each kind", () => {
    const config = { ...DEFAULT_CONFIG, permission: false }
    expect(isEnabled(config, "completion")).toBe(true)
    expect(isEnabled(config, "permission")).toBe(false)
  })
})

describe("soundFor", () => {
  test("resolves all sound shapes", () => {
    expect(soundFor(DEFAULT_CONFIG, "completion")).toBeNull()
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "completion")).toBe("Glass")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "error")).toBe("Basso")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "permission")).toBe("Ping")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: "Tink" }, "error")).toBe("Tink")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: "" }, "error")).toBeNull()
    const perType = { ...DEFAULT_CONFIG, sound: { error: "Basso", permission: false } as const }
    expect(soundFor(perType, "error")).toBe("Basso")
    expect(soundFor(perType, "permission")).toBeNull()
    expect(soundFor(perType, "completion")).toBeNull()
    const perTypeTrue = { ...DEFAULT_CONFIG, sound: { error: true } as const }
    expect(soundFor(perTypeTrue, "error")).toBe("Basso")
  })
})
