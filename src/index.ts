/**
 * OpenCode Task Notifier — global plugin entry point.
 *
 * Done, errored, and permission-needing runs notify; everything else
 * stays silent. `session.idle` is deliberately unused: the server
 * defines it but never emits it on completion (verified live, v2.0.14).
 */
import { Plugin } from "@opencode/plugin"
import { liveDeps, runNotifier } from "./notifier.ts"
import { notifyMacOS } from "./macos.ts"

export default Plugin.define({
  id: "task-notifier",
  async setup(ctx) {
    // Background loop; never blocks setup.
    void runNotifier(
      liveDeps(
        {
          subscribe: () => ctx.event.subscribe(),
          getSession: (input) => ctx.session.get(input),
          notify: (notification, sound) => notifyMacOS(notification, sound),
        },
        ctx.options,
      ),
    )
  },
})
