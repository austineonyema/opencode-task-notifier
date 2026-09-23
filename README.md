# opencode-task-notifier

Native desktop notifications for [OpenCode](https://opencode.ai) sessions.
Start a long task, leave the terminal, and get notified when it's done.

> **Status:** Phase 5 package layout (macOS only). Private prototype — not published.

## What it does

OpenCode task-run outcomes arrive as native macOS notifications:

| Event | Notification |
|---|---|
| Task finishes | 🟢 **OpenCode — my-project** — "Add login screen — Task completed — ready for review (3m 12s)" |
| Task errors | 🔴 **OpenCode — my-project** — "Task encountered an error: \<server message\> (3m 12s)" |
| Approval needed | 🟡 **OpenCode — my-project** — "OpenCode is waiting for your input (action: resource)" |

Titles/body degrade gracefully: if the session title or elapsed time
can't be resolved, the notification still fires with whatever is known.

## Configuration

Optional config file at `~/.config/opencode/task-notifier.json`
(absent = all notifications on, silent):

```jsonc
{
  "completion": true, // task finished
  "error": true, // task errored
  "permission": true, // input/approval needed
  // false | true | "SoundName" | { completion?, error?, permission? }
  // true → Glass (done) / Basso (error) / Ping (input)
  "sound": false
}
```

Malformed config falls back to defaults rather than breaking anything.
After editing, touch `~/.config/opencode/plugins/task-notifier.js`
(or restart the server) so the plugin reloads and picks it up.

A working example lives at [`task-notifier.example.json`](task-notifier.example.json) —
copy it to `~/.config/opencode/task-notifier.json` and adjust.

Deliberately silent: session start, user-cancelled runs, and anything
that isn't one of the three outcomes above.

## Requirements

- macOS (notifications go through `osascript`, no dependencies)
- OpenCode v2.x with the `@opencode/plugin` v2 API
  (verified against server v2.0.14 / `@opencode/plugin` 2.0.11)

## Install (manual, for now)

Build the single-file bundle and copy it into OpenCode's global plugin
directory:

```bash
bun run deploy
```

(`deploy` = `bun run build` + copy `dist/task-notifier.js` to
`~/.config/opencode/plugins/`.) The server hot-reloads plugins — no
restart needed. Confirm it's registered:

```bash
opencode api get /api/plugin | grep task-notifier
```

## How it works

The plugin subscribes to OpenCode's server event stream. Each event is
classified (`src/events.ts`), checked against user config (`src/config.ts`),
enriched with session context (`src/session.ts`), mapped to notification
text (`src/notifications.ts`), and delivered (`src/macos.ts`) — all
orchestrated by `runNotifier()` (`src/notifier.ts`) with injectable
dependencies. `src/index.ts` is the thin OpenCode entry point. Event
handling stays separate from delivery so other platforms can be added
later.

**Why not `session.idle`?** Although `session.idle` exists in the schema,
we verified empirically (live SSE capture of a full session lifecycle on
server v2.0.14) that the server never emits it on task completion. The
reliable signals are `session.execution.succeeded` / `.failed` and
`permission.asked`. See the comment block at the top of
`src/index.ts` for details.

Notification delivery is fire-and-forget: failures can never break
or block a session.

OpenCode instantiates global plugins once per active location, so every
instance sees the same server-wide events. A process-shared claim set
(`claimEvent()`) guarantees one banner per event no matter how many
locations are active.

## Develop

```bash
bun install
bun test        # 32 tests (bun)
bun run typecheck  # strict tsc --noEmit
bun run build   # dist/task-notifier.js (single-file bundle)
bun run deploy  # build + install to ~/.config/opencode/plugins/
```

Unit tests cover config validation, the event→notification routing
table, context resolution and fallbacks, cross-instance dedupe, and
per-type toggles/sound; integration tests drive `notifyMacOS` and
`runNotifier()` against a shimmed `osascript`.

## Roadmap

- [x] **Phase 1** — completion notification prototype
- [x] **Phase 2** — distinct notifications: error (`session.execution.failed`),
  waiting-for-input (`permission.asked`)
- [x] **Phase 3** — richer context (project name, session title, elapsed time)
- [x] **Phase 4** — user configuration (per-type toggles, sound)
- [x] **Phase 5** — proper npm package structure
- [ ] **Phase 6** — CLI (`install`, `status`, `test`, `uninstall`)
- [ ] **Phase 7** — npm distribution

## License

MIT — see [LICENSE](LICENSE).
