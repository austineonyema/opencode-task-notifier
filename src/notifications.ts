/**
 * Event + context → notification text. Server metadata only —
 * never model output.
 */
import { projectFromDirectory } from "./session.ts"
import type { SessionContextInfo } from "./session.ts"
import type { TaskEvent } from "./events.ts"

export interface Notification {
  title: string
  body: string
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
