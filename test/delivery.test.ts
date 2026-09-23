import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import plugin from "../src/index.ts"
import { DEFAULT_CONFIG, type NotifierConfig } from "../src/config.ts"
import { runNotifier } from "../src/notifier.ts"
import { notifyMacOS } from "../src/macos.ts"
import type { Notification } from "../src/notifications.ts"
import { installOsascriptShim, type Shim } from "./helper.ts"

describe("plugin shape", () => {
  test("exports the v2 plugin definition", () => {
    expect(plugin.id).toBe("task-notifier")
    expect(typeof plugin.setup).toBe("function")
  })
})

describe("delivery", () => {
  let shim: Shim

  beforeEach(() => {
    shim = installOsascriptShim()
  })

  afterEach(() => {
    shim.restore()
  })

  const sessionStub = {
    get: async () => ({
      title: "Add login screen",
      time: { created: 1000, updated: 193000 },
      location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
    }),
  }

  async function* demoEvents(prefix: string) {
    yield { id: `${prefix}_1`, type: "session.created", data: { sessionID: "ses_1" } }
    yield {
      id: `${prefix}_2`,
      type: "session.execution.succeeded",
      data: { sessionID: "ses_1" },
      location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
    }
    yield {
      id: `${prefix}_3`,
      type: "permission.asked",
      data: { sessionID: "ses_1", action: "external_directory", resources: ["/etc/*"] },
      location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
    }
    yield {
      id: `${prefix}_4`,
      type: "session.execution.failed",
      data: { sessionID: "ses_1", error: { message: "boom" } },
      location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
    }
  }

  test("notifyMacOS invokes osascript with title and body", async () => {
    notifyMacOS({ title: "🟢 OpenCode", body: "Task completed — ready for review." }, null)
    expect(await shim.waitForLog(1)).toEqual([
      `-e display notification "Task completed — ready for review." with title "🟢 OpenCode"`,
    ])
  })

  test("notifyMacOS appends the sound name when given", async () => {
    notifyMacOS({ title: "🔴 OpenCode", body: "Task encountered an error." }, "Basso")
    expect(await shim.waitForLog(1)).toEqual([
      `-e display notification "Task encountered an error." with title "🔴 OpenCode" sound name "Basso"`,
    ])
  })

  test("runNotifier sends enriched notifications per outcome", async () => {
    const sounds: Record<string, string | null> = {}
    await runNotifier({
      subscribe: () => demoEvents("evt_run1"),
      getSession: sessionStub.get,
      getConfig: () => ({ ...DEFAULT_CONFIG, sound: true }),
      notify: (n: Notification, sound: string | null) => {
        sounds[n.title] = sound
        notifyMacOS(n, sound)
      },
    })
    // Detached spawns can complete out of order; compare as sets.
    expect((await shim.waitForLog(3)).sort()).toEqual(
      [
        `-e display notification "Add login screen — Task completed — ready for review (3m 12s)" with title "🟢 OpenCode — drizzle-app" sound name "Glass"`,
        `-e display notification "Add login screen — OpenCode is waiting for your input (external_directory: /etc/*)" with title "🟡 OpenCode — drizzle-app" sound name "Ping"`,
        `-e display notification "Add login screen — Task encountered an error: boom (3m 12s)" with title "🔴 OpenCode — drizzle-app" sound name "Basso"`,
      ].sort(),
    )
    expect(sounds).toEqual({
      "🟢 OpenCode — drizzle-app": "Glass",
      "🟡 OpenCode — drizzle-app": "Ping",
      "🔴 OpenCode — drizzle-app": "Basso",
    })
  })

  test("runNotifier respects disabled types", async () => {
    const seen: string[] = []
    await runNotifier({
      subscribe: () => demoEvents("evt_run2"),
      getSession: sessionStub.get,
      getConfig: () => ({ ...DEFAULT_CONFIG, permission: false, error: false }),
      notify: (n: Notification) => {
        seen.push(n.title)
      },
    })
    expect(seen).toEqual(["🟢 OpenCode — drizzle-app"])
  })

  test("sibling runNotifiers (one per location) notify only once per event", async () => {
    const seen: string[] = []
    const deps = {
      subscribe: () => demoEvents("evt_run3"),
      getSession: sessionStub.get,
      getConfig: () => DEFAULT_CONFIG,
      notify: (n: Notification) => {
        seen.push(`${n.title} | ${n.body}`)
      },
    }
    // Simulate three plugin instances (home, drizzle-app, soaverify-mobile)
    // consuming the same bus events concurrently.
    await Promise.all([runNotifier(deps), runNotifier(deps), runNotifier(deps)])
    expect(seen.sort()).toEqual(
      [
        "🟢 OpenCode — drizzle-app | Add login screen — Task completed — ready for review (3m 12s)",
        "🟡 OpenCode — drizzle-app | Add login screen — OpenCode is waiting for your input (external_directory: /etc/*)",
        "🔴 OpenCode — drizzle-app | Add login screen — Task encountered an error: boom (3m 12s)",
      ].sort(),
    )
  })

  test("notifier config type carries the toggles", () => {
    const config: NotifierConfig = DEFAULT_CONFIG
    expect(config.completion).toBe(true)
  })
})
