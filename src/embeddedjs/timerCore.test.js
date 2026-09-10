import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WorkTracker,
  formatDuration,
  formatTimeOfDay,
  getDayKey
} from "./timerCore.js";

describe("Timer Core - Multi-Day & Segment Operations", () => {
  it("computes accurate YYYY-MM-DD day keys", () => {
    const timestamp = new Date(2026, 8, 3, 14, 30, 0).getTime();
    assert.equal(getDayKey(timestamp), "2026-09-03");
  });

  it("buckets completed segments into their respective day keys", () => {
    const tracker = new WorkTracker();
    const day1 = new Date(2026, 8, 1, 10, 0, 0).getTime();
    const day2 = new Date(2026, 8, 2, 10, 0, 0).getTime();

    tracker.start("Task Day 1", day1);
    tracker.stop(day1 + 3600000); // 1 hr

    tracker.start("Task Day 2", day2);
    tracker.stop(day2 + 1800000); // 30 min

    assert.equal(tracker.getDayTotalMs("2026-09-01"), 3600000);
    assert.equal(tracker.getDayTotalMs("2026-09-02"), 1800000);
    assert.equal(tracker.getDaySegments("2026-09-01").length, 1);
    assert.equal(tracker.getDaySegments("2026-09-02").length, 1);
  });

  it("computes elapsed time for an active segment", () => {
    const tracker = new WorkTracker();
    const startTime = 1000000;

    assert.equal(tracker.getElapsedCurrentMs(startTime + 5000), 0);
    tracker.start("Active Task", startTime);

    assert.equal(tracker.getElapsedCurrentMs(startTime + 5000), 5000);
    assert.equal(tracker.getElapsedCurrentMs(startTime - 1), 0);
  });

  it("renames an existing segment without modifying time data", () => {
    const tracker = new WorkTracker();
    const t0 = 1000000;
    tracker.start("Old Name", t0);
    const seg = tracker.stop(t0 + 5000);
    const dayKey = getDayKey(t0);

    const renamed = tracker.renameSegment(dayKey, seg.id, "Client Review");
    assert.equal(renamed.label, "Client Review");
    assert.equal(renamed.durationMs, 5000);
    assert.equal(tracker.getDaySegments(dayKey)[0].label, "Client Review");
  });

  it("merges target segment with the previous segment, retaining previous name", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("First Task", t0);
    const seg1 = tracker.stop(t0 + 10000); // 10s

    tracker.start("Second Task", t0 + 15000);
    const seg2 = tracker.stop(t0 + 35000); // 20s

    // Merge Second Task (index 1) with previous (index 0, "First Task")
    const merged = tracker.mergeAdjacent(dayKey, seg2.id, -1);

    assert.ok(merged);
    assert.equal(merged.label, "First Task"); // Other segment's name is kept
    assert.equal(merged.durationMs, 30000);   // 10s + 20s
    assert.equal(merged.startTime, t0);
    assert.equal(merged.stopTime, t0 + 35000);

    const remaining = tracker.getDaySegments(dayKey);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, seg1.id);
  });

  it("merges target segment with the next segment, retaining next name", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Initial Prep", t0);
    const seg1 = tracker.stop(t0 + 10000); // 10s

    tracker.start("Main Work", t0 + 12000);
    const seg2 = tracker.stop(t0 + 22000); // 10s

    // Merge Initial Prep (index 0) with next (index 1, "Main Work")
    const merged = tracker.mergeAdjacent(dayKey, seg1.id, 1);

    assert.ok(merged);
    assert.equal(merged.label, "Main Work"); // Other segment's name is kept
    assert.equal(merged.durationMs, 20000);
    assert.equal(merged.id, seg2.id);

    const remaining = tracker.getDaySegments(dayKey);
    assert.equal(remaining.length, 1);
  });

  it("safely handles out-of-bounds merges", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Solo Task", t0);
    const seg = tracker.stop(t0 + 10000);

    // Merge previous when no previous exists
    const invalidPrev = tracker.mergeAdjacent(dayKey, seg.id, -1);
    assert.equal(invalidPrev, null);

    // Merge next when no next exists
    const invalidNext = tracker.mergeAdjacent(dayKey, seg.id, 1);
    assert.equal(invalidNext, null);
  });
});
