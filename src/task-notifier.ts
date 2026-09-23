/**
 * task-notifier — Phase 3 prototype.
 *
 * Global OpenCode plugin (v2 API) that sends native macOS notifications
 * for session task-run outcomes, enriched with project, session, and
 * timing context.
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
 * Context (resolved per event, best-effort — a notification is always
 * sent even if lookups fail):
 * - project: basename of the event/session working directory.
 * - session title + elapsed time: via `session.get`. Titles are
 *   server-generated metadata; nothing is summarized from model output.
 *
 * Delivery is fire-and-forget via `osascript`; failures never
 * propagate to the host.
 *
 * The pure helpers (`projectFromDirectory`, `formatElapsed`,
 * `buildNotification`, `resolveContext`) are exported for tests and kept
 * separate from delivery so additional platforms can be added later.
 */

import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"

export interface Notification {
  title: string
  body: string
}

export interface TaskEvent {
  type: string
  data?: Record<string, any>
  location?: { directory?: string }
}

export interface SessionContextInfo {
  project: string | null
  sessionTitle: string | null
  elapsed: string | null
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

export function notifyMacOS(notification: Notification): void {
  try {
    const child = spawn(
      "osascript",
      ["-e", `display notification "${notification.body}" with title "${notification.title}"`],
      { stdio: "ignore", detached: true },
    )
    child.on("error", () => {})
    child.unref()
  } catch {
    // Notification failures must never break the session.
  }
}

export default Plugin.define({
  id: "task-notifier",
  async setup(ctx) {
    // Consume the event stream in the background; never block setup.
    // Each event is handled independently so a slow session lookup
    // never delays other notifications.
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe()) {
          void (async () => {
            const notification = buildNotification(
              event,
              await resolveContext((input) => ctx.session.get(input), event),
            )
            if (notification) {
              notifyMacOS(notification)
            }
          })()
        }
      } catch {
        // Event stream errors must never break the session.
      }
    })()
  },
})
