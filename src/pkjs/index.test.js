import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAppMessage } from "./appMessageHandler.js";

describe("PKJS AppMessage Payload Validation", () => {
  let pushedPins;
  let deletedPins;
  let mockTimeline;

  beforeEach(() => {
    pushedPins = [];
    deletedPins = [];
    mockTimeline = {
      pushPin: (pin, cb) => {
        pushedPins.push(pin);
        if (cb) cb("success");
      },
      deletePin: (pinId, cb) => {
        deletedPins.push(pinId);
        if (cb) cb("success");
      }
    };
  });

  it("handles valid INSERT_TIMELINE_PIN payload correctly", () => {
    const event = {
      payload: {
        action: "INSERT_TIMELINE_PIN",
        id: "12345",
        label: "Coding",
        startTime: "2026-10-23T10:00:00.000Z",
        durationMs: 3600000
      }
    };

    handleAppMessage(event, mockTimeline);

    assert.equal(pushedPins.length, 1);
    assert.equal(pushedPins[0].id, "work-segment-12345");
    assert.equal(pushedPins[0].time, "2026-10-23T10:00:00.000Z");
    assert.equal(pushedPins[0].duration, 60);
    assert.equal(pushedPins[0].layout.title, "Coding");
    assert.equal(pushedPins[0].layout.subtitle, "60 min logged");
  });

  it("handles numeric id correctly", () => {
    const event = {
      payload: {
        action: "INSERT_TIMELINE_PIN",
        id: 999,
        label: "Meeting",
        startTime: 1700000000000,
        durationMs: 1800000
      }
    };

    handleAppMessage(event, mockTimeline);

    assert.equal(pushedPins.length, 1);
    assert.equal(pushedPins[0].id, "work-segment-999");
    assert.equal(pushedPins[0].duration, 30);
  });

  it("handles valid DELETE_TIMELINE_PIN payload correctly", () => {
    const event = {
      payload: {
        action: "DELETE_TIMELINE_PIN",
        id: "12345"
      }
    };

    handleAppMessage(event, mockTimeline);

    assert.equal(deletedPins.length, 1);
    assert.equal(deletedPins[0], "work-segment-12345");
  });

  it("rejects null, undefined, or non-object events and payloads", () => {
    handleAppMessage(null, mockTimeline);
    handleAppMessage(undefined, mockTimeline);
    handleAppMessage("invalid", mockTimeline);
    handleAppMessage({ payload: null }, mockTimeline);
    handleAppMessage({ payload: "not an object" }, mockTimeline);

    assert.equal(pushedPins.length, 0);
    assert.equal(deletedPins.length, 0);
  });

  it("rejects missing or empty id", () => {
    handleAppMessage({ payload: { action: "INSERT_TIMELINE_PIN", startTime: Date.now(), durationMs: 60000 } }, mockTimeline);
    handleAppMessage({ payload: { action: "INSERT_TIMELINE_PIN", id: "", startTime: Date.now(), durationMs: 60000 } }, mockTimeline);
    handleAppMessage({ payload: { action: "INSERT_TIMELINE_PIN", id: "   ", startTime: Date.now(), durationMs: 60000 } }, mockTimeline);
    handleAppMessage({ payload: { action: "INSERT_TIMELINE_PIN", id: null, startTime: Date.now(), durationMs: 60000 } }, mockTimeline);

    assert.equal(pushedPins.length, 0);
  });

  it("rejects invalid or non-positive durationMs", () => {
    const base = { action: "INSERT_TIMELINE_PIN", id: "1", startTime: "2026-10-23T10:00:00.000Z" };

    handleAppMessage({ payload: { ...base, durationMs: "not a number" } }, mockTimeline);
    handleAppMessage({ payload: { ...base, durationMs: NaN } }, mockTimeline);
    handleAppMessage({ payload: { ...base, durationMs: Infinity } }, mockTimeline);
    handleAppMessage({ payload: { ...base, durationMs: 0 } }, mockTimeline);
    handleAppMessage({ payload: { ...base, durationMs: -1000 } }, mockTimeline);

    assert.equal(pushedPins.length, 0);
  });

  it("rejects invalid Date startTime", () => {
    const base = { action: "INSERT_TIMELINE_PIN", id: "1", durationMs: 60000 };

    handleAppMessage({ payload: { ...base, startTime: "invalid-date-string" } }, mockTimeline);
    handleAppMessage({ payload: { ...base, startTime: null } }, mockTimeline);
    handleAppMessage({ payload: { ...base, startTime: undefined } }, mockTimeline);

    assert.equal(pushedPins.length, 0);
  });
});
