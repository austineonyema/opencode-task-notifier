import { describe, expect, test } from "bun:test"
import { buildNotification } from "../src/notifications.ts"
import {
  formatElapsed,
  projectFromDirectory,
  resolveContext,
} from "../src/session.ts"

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
