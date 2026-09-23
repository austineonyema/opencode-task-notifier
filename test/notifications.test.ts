import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, {
  buildNotification,
  claimEvent,
  DEFAULT_CONFIG,
  eventKey,
  formatElapsed,
  isEnabled,
  kindOf,
  loadConfig,
  projectFromDirectory,
  readConfigFile,
  resolveContext,
  runNotifier,
  soundFor,
  notifyMacOS,
  type NotifierConfig,
  type Notification,
} from "../src/task-notifier.ts"

describe("projectFromDirectory", () => {
  test("uses the basename", () => {
    expect(projectFromDirectory("/Users/austine/Projects/drizzle-app")).toBe("drizzle-app")
  })
  test("tolerates trailing slashes", () => {
    expect(projectFromDirectory("/Users/austine/Projects/drizzle-app/")).toBe("drizzle-app")
  })
  test("returns null when no project can be derived", () => {
    expect(projectFromDirectory(undefined)).toBeNull()
    expect(projectFromDirectory(null)).toBeNull()
    expect(projectFromDirectory("")).toBeNull()
    expect(projectFromDirectory("/")).toBeNull()
  })
})

describe("formatElapsed", () => {
  test("formats seconds, minutes, and hours", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(45000)).toBe("45s")
    expect(formatElapsed(60000)).toBe("1m")
    expect(formatElapsed(192000)).toBe("3m 12s")
    expect(formatElapsed(3600000)).toBe("1h")
    expect(formatElapsed(7380000)).toBe("2h 3m")
  })
  test("guards invalid input", () => {
    expect(formatElapsed(-5)).toBe("0s")
    expect(formatElapsed(NaN)).toBe("0s")
  })
})

describe("loadConfig", () => {
  test("defaults when absent or malformed", () => {
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(loadConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(loadConfig("nope")).toEqual(DEFAULT_CONFIG)
    expect(loadConfig([1, 2])).toEqual(DEFAULT_CONFIG)
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG)
  })
  test("respects per-type toggles, ignores junk", () => {
    expect(loadConfig({ completion: false, error: "yes", permission: 0 })).toEqual({
      ...DEFAULT_CONFIG,
      completion: false,
    })
  })
  test("normalizes sound variants", () => {
    expect(loadConfig({ sound: true }).sound).toBe(true)
    expect(loadConfig({ sound: "Ping" }).sound).toBe("Ping")
    expect(loadConfig({ sound: { error: "Basso", permission: false } }).sound).toEqual({
      error: "Basso",
      permission: false,
    })
    expect(loadConfig({ sound: { error: 42 } }).sound).toEqual({})
    expect(loadConfig({ sound: 42 }).sound).toBe(false)
  })
})

describe("readConfigFile", () => {
  test("parses a config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notifier-cfg-"))
    try {
      const path = join(dir, "task-notifier.json")
      writeFileSync(path, JSON.stringify({ completion: false }))
      expect(readConfigFile(path)).toEqual({ completion: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test("returns undefined for missing or invalid files", () => {
    expect(readConfigFile(join(tmpdir(), "notifier-nope", "x.json"))).toBeUndefined()
    const dir = mkdtempSync(join(tmpdir(), "notifier-cfg-"))
    try {
      const path = join(dir, "bad.json")
      writeFileSync(path, "{not json")
      expect(readConfigFile(path)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("kindOf / isEnabled / soundFor", () => {
  test("classifies notifiable events", () => {
    expect(kindOf({ type: "session.execution.succeeded" })).toBe("completion")
    expect(kindOf({ type: "session.execution.failed" })).toBe("error")
    expect(kindOf({ type: "permission.asked" })).toBe("permission")
    expect(kindOf({ type: "session.created" })).toBeNull()
    expect(kindOf({ type: "session.idle" })).toBeNull()
  })
  test("toggles gate each kind", () => {
    const config = { ...DEFAULT_CONFIG, permission: false }
    expect(isEnabled(config, "completion")).toBe(true)
    expect(isEnabled(config, "permission")).toBe(false)
  })
  test("sound resolution", () => {
    expect(soundFor(DEFAULT_CONFIG, "completion")).toBeNull()
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "completion")).toBe("Glass")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "error")).toBe("Basso")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: true }, "permission")).toBe("Ping")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: "Tink" }, "error")).toBe("Tink")
    expect(soundFor({ ...DEFAULT_CONFIG, sound: "" }, "error")).toBeNull()
    const perType = { ...DEFAULT_CONFIG, sound: { error: "Basso", permission: false } as const }
    expect(soundFor(perType, "error")).toBe("Basso")
    expect(soundFor(perType, "permission")).toBeNull()
    expect(soundFor(perType, "completion")).toBeNull()
    const perTypeTrue = { ...DEFAULT_CONFIG, sound: { error: true } as const }
    expect(soundFor(perTypeTrue, "error")).toBe("Basso")
  })
})

describe("buildNotification", () => {
  const fullContext = {
    project: "drizzle-app",
    sessionTitle: "Add login screen",
    elapsed: "3m 12s",
  }

  test("completion includes project, title, and elapsed time", () => {
    expect(
      buildNotification({ type: "session.execution.succeeded" }, fullContext),
    ).toEqual({
      title: "🟢 OpenCode — drizzle-app",
      body: "Add login screen — Task completed — ready for review (3m 12s)",
    })
  })

  test("failure includes the truncated server error message", () => {
    expect(
      buildNotification(
        {
          type: "session.execution.failed",
          data: { error: { type: "provider.no-route", message: "Model unavailable: x" } },
        },
        fullContext,
      ),
    ).toEqual({
      title: "🔴 OpenCode — drizzle-app",
      body: "Add login screen — Task encountered an error: Model unavailable: x (3m 12s)",
    })
  })

  test("long error messages are truncated", () => {
    const message = "x".repeat(200)
    const result = buildNotification(
      { type: "session.execution.failed", data: { error: { message } } },
      null,
    )
    expect(result?.body.endsWith("…")).toBe(true)
    expect(result?.body.length).toBeLessThanOrEqual("Task encountered an error: ".length + 100)
  })

  test("permission request includes action and resource", () => {
    expect(
      buildNotification(
        {
          type: "permission.asked",
          data: { action: "external_directory", resources: ["/etc/*"] },
        },
        { project: "drizzle-app", sessionTitle: null, elapsed: null },
      ),
    ).toEqual({
      title: "🟡 OpenCode — drizzle-app",
      body: "OpenCode is waiting for your input (external_directory: /etc/*)",
    })
  })

  test("falls back to event location when context is missing", () => {
    expect(
      buildNotification(
        {
          type: "session.execution.succeeded",
          location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
        },
        null,
      ),
    ).toEqual({
      title: "🟢 OpenCode — drizzle-app",
      body: "Task completed — ready for review",
    })
  })

  test("stays silent for lifecycle and unrelated events", () => {
    for (const type of [
      "session.created",
      "session.execution.started",
      "session.execution.interrupted",
      "session.idle",
      "session.status",
      "permission.replied",
      "server.connected",
    ]) {
      expect(buildNotification({ type }, fullContext)).toBeNull()
    }
  })
})

describe("resolveContext", () => {
  const event = {
    type: "session.execution.succeeded",
    data: { sessionID: "ses_test" },
    location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
  }

  test("resolves project, title, and elapsed from session.get", async () => {
    const get = async () => ({
      title: "Add login screen",
      time: { created: 1000, updated: 193000 },
      location: { directory: "/Users/austine_onyema/Projects/drizzle-app" },
    })
    expect(await resolveContext(get, event)).toEqual({
      project: "drizzle-app",
      sessionTitle: "Add login screen",
      elapsed: "3m 12s",
    })
  })

  test("falls back to project-only when session.get throws", async () => {
    const get = async () => {
      throw new Error("gone")
    }
    expect(await resolveContext(get, event)).toEqual({
      project: "drizzle-app",
      sessionTitle: null,
      elapsed: null,
    })
  })

  test("returns null when nothing is resolvable", async () => {
    expect(await resolveContext(async () => null, { type: "x" })).toBeNull()
  })
})

describe("claimEvent", () => {
  test("prefers the bus event id", () => {
    expect(eventKey({ id: "evt_1", type: "session.execution.succeeded" })).toBe("evt_1")
  })

  test("falls back to type+session+timestamp without an id", () => {
    expect(
      eventKey({ type: "session.execution.succeeded", data: { sessionID: "ses_a" }, created: 7 }),
    ).toBe("session.execution.succeeded:ses_a:7")
  })

  test("claims once, rejects repeats, allows distinct events", () => {
    const first = { id: "evt_dup_1", type: "session.execution.succeeded" }
    const repeat = { id: "evt_dup_1", type: "session.execution.succeeded" }
    const other = { id: "evt_dup_2", type: "session.execution.succeeded" }
    expect(claimEvent(first)).toBe(true)
    expect(claimEvent(repeat)).toBe(false)
    expect(claimEvent(other)).toBe(true)
  })
})

describe("plugin shape", () => {
  test("exports the v2 plugin definition", () => {
    expect(plugin.id).toBe("task-notifier")
    expect(typeof plugin.setup).toBe("function")
  })
})

describe("delivery", () => {
  let dir: string
  let log: string
  let savedPath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notifier-test-"))
    log = join(dir, "osascript.log")
    const shim = join(dir, "osascript")
    Bun.write(shim, `#!/bin/zsh\nprint -r -- "$@" >> "${log}"\n`)
    require("node:child_process").execFileSync("chmod", ["+x", shim])
    savedPath = process.env.PATH
    process.env.PATH = `${dir}:${savedPath ?? ""}`
  })

  afterEach(() => {
    process.env.PATH = savedPath
    rmSync(dir, { recursive: true, force: true })
  })

  const readLog = (): string[] =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []

  const waitForLog = async (count: number): Promise<string[]> => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const lines = readLog()
      if (lines.length >= count && !(lines.length === 1 && lines[0] === "")) return lines
      await Bun.sleep(200)
    }
    return readLog()
  }

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
    expect(await waitForLog(1)).toEqual([
      `-e display notification "Task completed — ready for review." with title "🟢 OpenCode"`,
    ])
  })

  test("notifyMacOS appends the sound name when given", async () => {
    notifyMacOS({ title: "🔴 OpenCode", body: "Task encountered an error." }, "Basso")
    expect(await waitForLog(1)).toEqual([
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
    expect((await waitForLog(3)).sort()).toEqual(
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
    const notify = (n: Notification) => {
      seen.push(`${n.title} | ${n.body}`)
    }
    const deps = {
      subscribe: () => demoEvents("evt_run3"),
      getSession: sessionStub.get,
      getConfig: () => DEFAULT_CONFIG,
      notify: (n: Notification) => notify(n),
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

  test("runNotifier passes the notifier config type", () => {
    const config: NotifierConfig = DEFAULT_CONFIG
    expect(config.completion).toBe(true)
  })
})
