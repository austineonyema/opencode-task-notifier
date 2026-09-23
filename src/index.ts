/**
 * task-notifier — OpenCode Task Notifier.
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
 * Module layout:
 * - `events.ts` — bus event classification, identity, cross-instance dedupe.
 * - `config.ts` — user configuration (file, validation, sound resolution).
 * - `session.ts` — session context (project, title, elapsed time).
 * - `notifications.ts` — event+context → notification text.
 * - `macos.ts` — `osascript` delivery (fire-and-forget).
 * - `notifier.ts` — the loop with injectable dependencies.
 * - `index.ts` — this file: the OpenCode plugin entry point.
 */
import { Plugin } from "@opencode/plugin"
import { liveDeps, runNotifier } from "./notifier.ts"
import { notifyMacOS } from "./macos.ts"

export default Plugin.define({
  id: "task-notifier",
  async setup(ctx) {
    // Consume the event stream in the background; never block setup.
    // Each event is handled independently so a slow session lookup
    // never delays other notifications.
    void runNotifier(
      liveDeps({
        subscribe: () => ctx.event.subscribe(),
        getSession: (input) => ctx.session.get(input),
        notify: (notification, sound) => notifyMacOS(notification, sound),
      }),
    )
  },
})
