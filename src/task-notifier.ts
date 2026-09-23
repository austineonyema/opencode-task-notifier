/**
 * task-notifier — Phase 2 prototype.
 *
 * Global OpenCode plugin (v2 API) that sends native macOS notifications
 * for session task-run outcomes.
 *
 * Event semantics (verified empirically against server v2.0.14, Sep 2026):
 * - `session.execution.succeeded` fires exactly once when the agent run
 *   finishes successfully → completion notification.
 * - `session.execution.failed` fires when the run errors → error notification.
 * - `permission.asked` fires when the agent needs user approval →
 *   waiting-for-input notification.
 * - `session.idle` is defined in the schema but the server does NOT emit
 *   it on task completion — do not use it.
 * - `session.execution.interrupted` (user cancelled) is deliberately
 *   silent: the user already knows they cancelled.
 * - Nothing is sent on `session.created`, so merely opening OpenCode
 *   stays silent.
 *
 * Delivery is fire-and-forget via `osascript`; failures never
 * propagate to the host.
 *
 * `notificationFor` and `notifyMacOS` are exported for tests. They are
 * pure / side-effect-isolated on purpose: event routing stays separate
 * from delivery so additional platforms can be added later.
 */

import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"

export interface Notification {
  title: string
  body: string
}

/** Map an OpenCode event type to a notification, or null for silence. */
export function notificationFor(eventType: string): Notification | null {
  switch (eventType) {
    case "session.execution.succeeded":
      return { title: "🟢 OpenCode", body: "Task completed — ready for review." }
    case "session.execution.failed":
      return { title: "🔴 OpenCode", body: "Task encountered an error." }
    case "permission.asked":
      return { title: "🟡 OpenCode", body: "OpenCode is waiting for your input." }
    default:
      return null
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
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe()) {
          const notification = notificationFor(event.type)
          if (notification) {
            notifyMacOS(notification)
          }
        }
      } catch {
        // Event stream errors must never break the session.
      }
    })()
  },
})
