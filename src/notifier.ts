/**
 * Event loop with injectable deps (tests inject stubs).
 */
import { claimEvent, kindOf, type NotificationKind, type TaskEvent } from "./events.ts"
import { isEnabled, readConfigFile, resolveConfig, soundFor, type NotifierConfig } from "./config.ts"
import { buildNotification, type Notification } from "./notifications.ts"
import { resolveContext, type SessionGetter } from "./session.ts"

export interface NotifierDeps {
  subscribe: () => AsyncIterable<TaskEvent>
  getSession: SessionGetter
  getConfig: () => NotifierConfig
  notify: (notification: Notification, sound: string | null) => void
}

export async function runNotifier(deps: NotifierDeps): Promise<void> {
  const config = deps.getConfig()
  try {
    for await (const event of deps.subscribe()) {
      void (async () => {
        // One banner per event across sibling instances.
        if (!claimEvent(event)) return
        const kind: NotificationKind | null = kindOf(event)
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

/** Production deps: live bus, session lookup, layered config, macOS. */
export function liveDeps(
  overrides: {
    subscribe: () => AsyncIterable<TaskEvent>
    getSession: SessionGetter
    notify: (notification: Notification, sound: string | null) => void
  },
  options?: Record<string, unknown>,
): NotifierDeps {
  return {
    ...overrides,
    getConfig: () => resolveConfig(readConfigFile(), options),
  }
}
