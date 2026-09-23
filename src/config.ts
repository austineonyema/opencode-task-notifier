/**
 * User configuration.
 *
 * File: `~/.config/opencode/task-notifier.json` (all keys optional).
 * Absent or malformed config falls back to defaults — notifications
 * always work out of the box.
 *
 * A dedicated config file is used instead of `ctx.options` on purpose:
 * this plugin loads as a loose file from the global plugins directory,
 * and registering it a second time through the `plugins` array (the only
 * way to pass `ctx.options`) would create duplicate configured instances.
 * When this becomes an npm package, config migrates to the standard
 * `ctx.options` mechanism.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { NotificationKind } from "./events.ts"

export type SoundSetting = string | boolean
export type SoundConfig = false | true | string | Partial<Record<NotificationKind, SoundSetting>>

export interface NotifierConfig {
  completion: boolean
  error: boolean
  permission: boolean
  sound: SoundConfig
}

export const DEFAULT_CONFIG: NotifierConfig = {
  completion: true,
  error: true,
  permission: true,
  sound: false,
}

/** Per-type default macOS sounds used when `sound: true`. */
export const DEFAULT_SOUNDS: Record<NotificationKind, string> = {
  completion: "Glass",
  error: "Basso",
  permission: "Ping",
}

export const CONFIG_FILE = join(homedir(), ".config", "opencode", "task-notifier.json")

/** Validate raw (parsed-JSON) input. Never throws: falls back to defaults. */
export function loadConfig(raw: unknown): NotifierConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_CONFIG }
  const input = raw as Record<string, unknown>
  const flag = (key: NotificationKind): boolean =>
    typeof input[key] === "boolean" ? (input[key] as boolean) : DEFAULT_CONFIG[key]
  return {
    completion: flag("completion"),
    error: flag("error"),
    permission: flag("permission"),
    sound: normalizeSound(input["sound"]),
  }
}

function normalizeSound(raw: unknown): SoundConfig {
  if (raw === undefined) return DEFAULT_CONFIG.sound
  if (typeof raw === "boolean") return raw
  if (typeof raw === "string") return raw
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const input = raw as Record<string, unknown>
    const out: Partial<Record<NotificationKind, SoundSetting>> = {}
    for (const kind of ["completion", "error", "permission"] as const) {
      const value = input[kind]
      if (typeof value === "string" || typeof value === "boolean") out[kind] = value
    }
    return out
  }
  return DEFAULT_CONFIG.sound
}

/** Read the config file from disk. Never throws: returns undefined when absent/unreadable. */
export function readConfigFile(path: string = CONFIG_FILE): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

export function isEnabled(config: NotifierConfig, kind: NotificationKind): boolean {
  return config[kind] === true
}

/** Resolve the macOS sound name for a kind, or null for silence. */
export function soundFor(config: NotifierConfig, kind: NotificationKind): string | null {
  const { sound } = config
  if (sound === false) return null
  if (sound === true) return DEFAULT_SOUNDS[kind]
  if (typeof sound === "string") return sound || null
  const setting = sound[kind]
  if (setting === undefined) return null
  if (setting === false) return null
  if (setting === true) return DEFAULT_SOUNDS[kind]
  return setting || null
}
