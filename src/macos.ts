/** macOS delivery via `osascript`. Fire-and-forget by design. */
import { spawn } from "node:child_process"
import type { Notification } from "./notifications.ts"

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
