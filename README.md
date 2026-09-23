# opencode-task-notifier

Native desktop notifications for [OpenCode](https://opencode.ai) sessions.
Start a long task, leave the terminal, and get notified when it's done.

> **Status:** Phase 2 prototype (macOS only). Not yet an npm package.

## What it does

OpenCode task-run outcomes arrive as native macOS notifications:

| Event | Notification |
|---|---|
| Task finishes | 🟢 **OpenCode — my-project** — "Add login screen — Task completed — ready for review (3m 12s)" |
| Task errors | 🔴 **OpenCode — my-project** — "Task encountered an error: \<server message\> (3m 12s)" |
| Approval needed | 🟡 **OpenCode — my-project** — "OpenCode is waiting for your input (action: resource)" |

Titles/body degrade gracefully: if the session title or elapsed time
can't be resolved, the notification still fires with whatever is known.

Deliberately silent: session start, user-cancelled runs, and anything
that isn't one of the three outcomes above.

## Requirements

- macOS (notifications go through `osascript`, no dependencies)
- OpenCode v2.x with the `@opencode/plugin` v2 API
  (verified against server v2.0.14 / `@opencode/plugin` 2.0.11)

## Install (manual, for now)

Copy the plugin into OpenCode's global plugin directory:

```bash
cp src/task-notifier.ts ~/.config/opencode/plugins/task-notifier.ts
```

The server hot-reloads plugins — no restart needed. Confirm it's registered:

```bash
opencode api get /api/plugin | grep task-notifier
```

## How it works

The plugin subscribes to OpenCode's server event stream and maps outcomes
to notifications with a pure `notificationFor()` function, kept separate
from delivery so other platforms can be added later.

**Why not `session.idle`?** Although `session.idle` exists in the schema,
we verified empirically (live SSE capture of a full session lifecycle on
server v2.0.14) that the server never emits it on task completion. The
reliable signals are `session.execution.succeeded` / `.failed` and
`permission.asked`. See the comment block at the top of
`src/task-notifier.ts` for details.

Notification delivery is fire-and-forget: failures can never break
or block a session.

OpenCode instantiates global plugins once per active location, so every
instance sees the same server-wide events. A process-shared claim set
(`claimEvent()`) guarantees one banner per event no matter how many
locations are active.

## Tests

```bash
bun install
bun test
```

Unit tests cover the event→notification routing table; integration tests
drive `notifyMacOS` and `setup()` against a shimmed `osascript`.

## Roadmap

- **Phase 2** — distinct notifications: error (`session.execution.failed`),
  waiting-for-input (`permission.asked`)
- **Phase 3** — richer context (project name, session title, elapsed time)
- **Phase 4** — user configuration (per-type toggles, sound, quiet mode)
- **Phase 5** — proper npm package structure
- **Phase 6** — CLI (`install`, `status`, `test`, `uninstall`)
- **Phase 7** — npm distribution

## License

MIT — see [LICENSE](LICENSE).
