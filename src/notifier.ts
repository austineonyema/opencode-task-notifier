/**
 * The notifier loop with injectable dependencies (config source, session
 * lookup, delivery). The plugin entry wires the real OpenCode context;
 * tests inject stubs.
 */
import { claimEvent, kindOf, type NotificationKind, type TaskEvent } from "./events.ts"
import { isEnabled, loadConfig, readConfigFile, soundFor, type NotifierConfig } from "./config.ts"
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
        // Skip duplicates from sibling plugin instances (one per
        // active location) before doing any session lookup work.
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

/** Production dependencies: live bus, session lookup, config file, macOS. */
export function liveDeps(overrides: {
  subscribe: () => AsyncIterable<TaskEvent>
  getSession: SessionGetter
  notify: (notification: Notification, sound: string | null) => void
}): NotifierDeps {
  return {
    ...overrides,
    getConfig: () => loadConfig(readConfigFile()),
  }
}
