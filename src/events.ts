/** OpenCode bus event primitives: classification, identity, dedupe. */

export interface TaskEvent {
  id?: string
  created?: number
  type: string
  data?: Record<string, any>
  location?: { directory?: string }
}

export type NotificationKind = "completion" | "error" | "permission"

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

/**
 * One bus event would otherwise notify once per location, because
 * OpenCode instantiates global plugins per active location. The claim
 * set lives on `globalThis` (shared process-wide): first instance to
 * handle an event wins. Synchronous check-and-add keeps it atomic.
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
