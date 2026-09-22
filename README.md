# opencode-task-notifier

Native desktop notifications for [OpenCode](https://opencode.ai) sessions.
Start a long task, leave the terminal, and get notified when it's done.

> **Status:** Phase 1 prototype (macOS only). Not yet an npm package.

## What it does

When an OpenCode session's task run finishes successfully, you get a native
macOS notification:

> **OpenCode**
> Task completed — ready for review.

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

The plugin subscribes to OpenCode's server event stream and notifies on
`session.execution.succeeded`.

**Why not `session.idle`?** Although `session.idle` exists in the schema,
we verified empirically (live SSE capture of a full session lifecycle on
server v2.0.14) that the server never emits it on task completion. The
reliable completion signal is `session.execution.succeeded`. See the
comment block at the top of `src/task-notifier.ts` for details.

Notification delivery is fire-and-forget: failures can never break
or block a session.

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
