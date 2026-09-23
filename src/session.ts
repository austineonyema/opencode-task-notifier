/**
 * Session context: project name, title, and elapsed run time.
 */
import type { TaskEvent } from "./events.ts"

export interface SessionContextInfo {
  project: string | null
  sessionTitle: string | null
  elapsed: string | null
}

export type SessionGetter = (input: { sessionID: string }) => Promise<any>

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

/** Best-effort: never throws, still notifies when lookups fail. */
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
