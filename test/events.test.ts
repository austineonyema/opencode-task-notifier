import { describe, expect, test } from "bun:test"
import { claimEvent, eventKey, kindOf } from "../src/events.ts"

describe("kindOf", () => {
  test("classifies notifiable events", () => {
    expect(kindOf({ type: "session.execution.succeeded" })).toBe("completion")
    expect(kindOf({ type: "session.execution.failed" })).toBe("error")
    expect(kindOf({ type: "permission.asked" })).toBe("permission")
    expect(kindOf({ type: "session.created" })).toBeNull()
    expect(kindOf({ type: "session.idle" })).toBeNull()
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
