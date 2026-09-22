/**
 * task-notifier — Phase 1 prototype.
 *
 * Global OpenCode plugin (v2 API) that sends a native macOS notification
 * when a session's task run finishes.
 *
 * Event semantics (verified empirically against server v2.0.14, Sep 2026):
 * - `session.idle` is defined in the schema but the server does NOT emit
 *   it on task completion (a full observed lifecycle produced
 *   `session.execution.succeeded` and zero `session.idle`/`session.status`
 *   events). Subscribing to it yields no notifications — do not use it.
 * - `session.execution.succeeded` fires exactly once when the agent run
 *   finishes successfully. This is the completion signal.
 * - `session.execution.failed` / `session.execution.interrupted` cover
 *   error/cancel paths (Phase 2); `permission.asked` covers the
 *   waiting-for-input path (Phase 2).
 * - No notification is sent on `session.created`, so merely opening
 *   OpenCode stays silent.
 *
 * Delivery is fire-and-forget via `osascript`; failures never
 * propagate to the host.
 */

import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"

const TITLE = "OpenCode"
const BODY = "Task completed — ready for review."

function notifyMacOS(title: string, body: string): void {
  try {
    const child = spawn("osascript", ["-e", `display notification "${body}" with title "${title}"`], {
      stdio: "ignore",
      detached: true,
    })
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
          if (event.type === "session.execution.succeeded") {
            notifyMacOS(TITLE, BODY)
          }
        }
      } catch {
        // Event stream errors must never break the session.
      }
    })()
  },
})
