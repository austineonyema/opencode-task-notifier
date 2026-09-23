/**
 * task-notifier — Phase 4 prototype.
 *
 * Global OpenCode plugin (v2 API) that sends native macOS notifications
 * for session task-run outcomes, enriched with project, session, and
 * timing context, and governed by user configuration.
 *
 * Event semantics (verified empirically against server v2.0.14, Sep 2026):
 * - `session.execution.succeeded` → completion notification.
 * - `session.execution.failed` → error notification (includes the
 *   server-provided error message, truncated — never model output).
 * - `permission.asked` → waiting-for-input notification (includes the
 *   requested action/resource when present).
 * - `session.idle` is defined in the schema but the server does NOT emit
 *   it on task completion — do not use it.
 * - `session.execution.interrupted` (user cancelled) stays silent.
 * - Nothing is sent on `session.created`, so opening OpenCode stays silent.
 *
 * Configuration (`~/.config/opencode/task-notifier.json`, all optional):
 * ```jsonc
 * {
 *   "completion": true,   // notify when tasks finish (default true)
 *   "error": true,        // notify when tasks error (default true)
 *   "permission": true,   // notify when input is needed (default true)
 *   "sound": false        // false | true | "Name" | { completion?, error?, permission? }
 * }
 * ```
 * `sound: true` uses per-type macOS defaults (Glass/Basso/Ping); a string
 * names one sound for all types; an object configures each type
 * individually (`false` silences that type). Absent or malformed config
 * falls back to defaults — notifications always work out of the box.
 * After editing the config, touch this plugin file (or restart the
 * server) so setup re-runs and picks it up.
 *
 * A dedicated config file is used instead of `ctx.options` on purpose:
 * this plugin loads as a loose file from the global plugins directory,
 * and registering it a second time through the `plugins` array (the only
 * way to pass `ctx.options`) would create duplicate configured instances.
 * When this becomes an npm package (Phase 5+), config migrates to the
 * standard `ctx.options` mechanism.
 *
 * Delivery is fire-and-forget via `osascript`; failures never
 * propagate to the host.
 *
 * Pure helpers are exported for tests and kept separate from delivery so
 * additional platforms can be added later.
 */

import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface Notification {
  title: string
  body: string
}

export interface TaskEvent {
  id?: string
  created?: number
  type: string
  data?: Record<string, any>
  location?: { directory?: string }
}

export interface SessionContextInfo {
  project: string | null
  sessionTitle: string | null
  elapsed: string | null
}

export type NotificationKind = "completion" | "error" | "permission"
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

/** Read + validate the config file. Never throws: falls back to defaults. */
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

/** Classify an event, or null when it maps to no notification kind. */
export function kindOf(event: TaskEvent): NotificationKind | null {
  switch (event.type) {
    case "session.execution.succeeded":
      return "completion"
    case "session.execution.failed":
      return "error"
    case "permission.asked":
      return "permission"
    default:
      return null
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

/** Project display name: basename of the working directory. */
export function projectFromDirectory(directory: string | undefined | null): string | null {
  if (!directory) return null
  const trimmed = directory.replace(/\/+$/, "")
  if (!trimmed || trimmed === "/") return null
  const base = trimmed.split("/").pop()
  return base || null
}

/** Human duration: "45s", "3m 12s", "2h 3m". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    const rest = totalSeconds % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value
}

/** Map an event + context to a notification, or null for silence. */
export function buildNotification(
  event: TaskEvent,
  context: SessionContextInfo | null,
): Notification | null {
  const project = context?.project ?? projectFromDirectory(event.location?.directory)
  const name = project ? `OpenCode — ${project}` : "OpenCode"
  const prefix = context?.sessionTitle ? `${context.sessionTitle} — ` : ""
  const elapsed = context?.elapsed ? ` (${context.elapsed})` : ""

  switch (event.type) {
    case "session.execution.succeeded":
      return {
        title: `🟢 ${name}`,
        body: `${prefix}Task completed — ready for review${elapsed}`,
      }
    case "session.execution.failed": {
      const raw = event.data?.error?.message
      const detail = typeof raw === "string" && raw ? `: ${truncate(raw, 100)}` : ""
      return {
        title: `🔴 ${name}`,
        body: `${prefix}Task encountered an error${detail}${elapsed}`,
      }
    }
    case "permission.asked": {
      const action = typeof event.data?.action === "string" ? event.data.action : null
      const resources = Array.isArray(event.data?.resources)
        ? event.data.resources.filter((r): r is string => typeof r === "string")
        : []
      const detail = action
        ? ` (${action}${resources[0] ? `: ${truncate(resources[0], 60)}` : ""})`
        : ""
      return {
        title: `🟡 ${name}`,
        body: `${prefix}OpenCode is waiting for your input${detail}`,
      }
    }
    default:
      return null
  }
}

type SessionGetter = (input: { sessionID: string }) => Promise<any>

/**
 * Best-effort context for an event. Never throws: on any failure it
 * falls back to project-only (or null when even that is unavailable),
 * so the notification still goes out.
 */
export async function resolveContext(
  get: SessionGetter,
  event: TaskEvent,
): Promise<SessionContextInfo | null> {
  const eventProject = projectFromDirectory(event.location?.directory)
  try {
    const sessionID = event.data?.sessionID
    if (typeof sessionID !== "string" || !sessionID) {
      return eventProject ? { project: eventProject, sessionTitle: null, elapsed: null } : null
    }
    const info = await get({ sessionID })
    const sessionTitle =
      typeof info?.title === "string" && info.title ? info.title : null
    const created = info?.time?.created
    const updated = info?.time?.updated ?? Date.now()
    const elapsed =
      typeof created === "number" && typeof updated === "number" && updated >= created
        ? formatElapsed(updated - created)
        : null
    return {
      project: eventProject ?? projectFromDirectory(info?.location?.directory),
      sessionTitle,
      elapsed,
    }
  } catch {
    return eventProject ? { project: eventProject, sessionTitle: null, elapsed: null } : null
  }
}

/**
 * Cross-instance duplicate suppression.
 *
 * OpenCode instantiates global plugins once per active location, and every
 * instance subscribes to the same server-wide event stream — so one bus
 * event would otherwise notify once per location. The claim set lives on
 * `globalThis`, which is shared process-wide, so the first instance to
 * handle an event wins and the rest skip it. Check-and-add is synchronous,
 * hence atomic on the single-threaded event loop. Bounded to avoid
 * unbounded growth.
 */
const MAX_SEEN_EVENTS = 1000

function seenEvents(): Set<string> {
  const g = globalThis as Record<string, unknown>
  let seen = g.__taskNotifierSeenEvents as Set<string> | undefined
  if (!seen) {
    seen = new Set<string>()
    g.__taskNotifierSeenEvents = seen
  }
  if (seen.size > MAX_SEEN_EVENTS) seen.clear()
  return seen
}

/** Event identity: bus ID when present, type+session+timestamp otherwise. */
export function eventKey(event: TaskEvent): string {
  if (event.id) return event.id
  return `${event.type}:${event.data?.sessionID ?? ""}:${event.created ?? ""}`
}

/** Returns true exactly once per event per process; false for repeats. */
export function claimEvent(event: TaskEvent): boolean {
  const seen = seenEvents()
  const key = eventKey(event)
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

export function notifyMacOS(notification: Notification, sound: string | null): void {
  try {
    const script = sound
      ? `display notification "${notification.body}" with title "${notification.title}" sound name "${sound}"`
      : `display notification "${notification.body}" with title "${notification.title}"`
    const child = spawn("osascript", ["-e", script], {
      stdio: "ignore",
      detached: true,
    })
    child.on("error", () => {})
    child.unref()
  } catch {
    // Notification failures must never break the session.
  }
}

export interface NotifierDeps {
  subscribe: () => AsyncIterable<TaskEvent>
  getSession: SessionGetter
  getConfig: () => NotifierConfig
  notify: (notification: Notification, sound: string | null) => void
}

/**
 * The notifier loop with injectable dependencies (config source, delivery).
 * `setup()` wires the real OpenCode context; tests inject stubs.
 */
export async function runNotifier(deps: NotifierDeps): Promise<void> {
  const config = deps.getConfig()
  try {
    for await (const event of deps.subscribe()) {
      void (async () => {
        // Skip duplicates from sibling plugin instances (one per
        // active location) before doing any session lookup work.
        if (!claimEvent(event)) return
        const kind = kindOf(event)
        if (!kind || !isEnabled(config, kind)) return
        const notification = buildNotification(
          event,
          await resolveContext(deps.getSession, event),
        )
        if (notification) {
          deps.notify(notification, soundFor(config, kind))
        }
      })()
    }
  } catch {
    // Event stream errors must never break the session.
  }
}

export default Plugin.define({
  id: "task-notifier",
  async setup(ctx) {
    // Consume the event stream in the background; never block setup.
    // Each event is handled independently so a slow session lookup
    // never delays other notifications.
    void runNotifier({
      subscribe: () => ctx.event.subscribe(),
      getSession: (input) => ctx.session.get(input),
      getConfig: () => loadConfig(readConfigFile()),
      notify: (notification, sound) => notifyMacOS(notification, sound),
    })
  },
})
