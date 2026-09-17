import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  WorkTracker,
  formatDuration,
  formatTimeOfDay,
  getDayKey,
  getDefaultLabel,
  getSegmentDurationMs
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

  it("formats the default label as Timespan N for a given index", () => {
    assert.equal(getDefaultLabel(1), "Timespan 1");
    assert.equal(getDefaultLabel(3), "Timespan 3");
  });

  it("formats durations with only units meaningful at their scale", () => {
    assert.equal(formatDuration(0), "0s");
    assert.equal(formatDuration(7), "7s");
    assert.equal(formatDuration(59), "59s");
    assert.equal(formatDuration(60), "1m 00s");
    assert.equal(formatDuration(755), "12m 35s");
    assert.equal(formatDuration(3600), "1h 0m");
    assert.equal(formatDuration(11195), "3h 6m");
  });

  it("assigns sequential Timespan N default labels within a day when no label is given", () => {
    const tracker = new WorkTracker();
    const day = new Date(2026, 8, 5, 9, 0, 0).getTime();

    tracker.start(undefined, day);
    tracker.stop(day + 60000);
    tracker.start("", day + 120000);
    tracker.stop(day + 180000);
    tracker.start(undefined, day + 240000);
    tracker.stop(day + 300000);

    const segs = tracker.getDaySegments(getDayKey(day));
    assert.equal(segs[0].label, "Timespan 1");
    assert.equal(segs[1].label, "Timespan 2");
    assert.equal(segs[2].label, "Timespan 3");
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
    // Merged duration is the outer span (earliest start to latest stop),
    // including the 5s gap between the two original segments - it's no
    // longer the sum of their individual worked durations.
    assert.equal(getSegmentDurationMs(merged), 35000);
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
    // Outer span (t0 to t0+22000) includes the 2s gap between segments.
    assert.equal(getSegmentDurationMs(merged), 22000);
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

  it("deletes a segment, leaving the rest of the day untouched", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Keep Me", t0);
    const seg1 = tracker.stop(t0 + 10000);
    tracker.start("Delete Me", t0 + 20000);
    const seg2 = tracker.stop(t0 + 30000);

    const removed = tracker.deleteSegment(dayKey, seg2.id);
    assert.equal(removed, true);

    const remaining = tracker.getDaySegments(dayKey);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, seg1.id);
  });

  it("returns false when deleting an unknown segment or day", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Solo Task", t0);
    tracker.stop(t0 + 10000);

    assert.equal(tracker.deleteSegment(dayKey, "not-a-real-id"), false);
    assert.equal(tracker.deleteSegment("2099-01-01", "not-a-real-id"), false);
  });

  it("sets a segment's label via dictation, trimming whitespace", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Old Label", t0);
    const seg = tracker.stop(t0 + 10000);

    const updated = tracker.setSegmentLabel(dayKey, seg.id, "  Grocery Shopping  ");
    assert.equal(updated, true);
    assert.equal(tracker.getDaySegments(dayKey)[0].label, "Grocery Shopping");
  });

  it("leaves a segment's label unchanged on blank dictation text or unknown ids", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Old Label", t0);
    const seg = tracker.stop(t0 + 10000);

    assert.equal(tracker.setSegmentLabel(dayKey, seg.id, "   "), false);
    assert.equal(tracker.setSegmentLabel(dayKey, "not-a-real-id", "New Label"), false);
    assert.equal(tracker.setSegmentLabel("2099-01-01", seg.id, "New Label"), false);
    assert.equal(tracker.getDaySegments(dayKey)[0].label, "Old Label");
  });

  it("sets the in-progress segment's label via dictation, trimming whitespace", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();

    tracker.start("Old Label", t0);
    const updated = tracker.setCurrentSegmentLabel("  Deep Work  ");
    assert.equal(updated, true);
    assert.equal(tracker.currentSegment.label, "Deep Work");
  });

  it("leaves the in-progress segment's label unchanged on blank dictation text, and no-ops when nothing is running", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();

    assert.equal(tracker.setCurrentSegmentLabel("New Label"), false);

    tracker.start("Old Label", t0);
    assert.equal(tracker.setCurrentSegmentLabel("   "), false);
    assert.equal(tracker.currentSegment.label, "Old Label");
  });

  it("reports a day's total duration and segment count via the lightweight index even after its segments are unloaded from memory", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Task A", t0);
    tracker.stop(t0 + 600000); // 10 min
    tracker.start("Task B", t0 + 700000);
    tracker.stop(t0 + 1300000); // 10 min

    assert.equal(tracker.isDayLoaded(dayKey), true);
    assert.equal(tracker.getDaySegmentCount(dayKey), 2);
    assert.equal(tracker.getDayTotalMs(dayKey), 1200000);

    tracker.unloadDaySegments(dayKey);
    assert.equal(tracker.isDayLoaded(dayKey), false);
    // Total/count remain available from the lightweight index without
    // the day's full segment list being loaded in memory...
    assert.equal(tracker.getDaySegmentCount(dayKey), 2);
    assert.equal(tracker.getDayTotalMs(dayKey), 1200000);
    // ...while asking for the actual segments of an unloaded day yields
    // an empty list (not an error), matching a not-yet-loaded day.
    assert.deepEqual(tracker.getDaySegments(dayKey), []);

    tracker.loadDaySegments(dayKey, [
      { id: "x", label: "Reloaded", startTime: t0, stopTime: t0 + 1200000 }
    ]);
    assert.equal(tracker.isDayLoaded(dayKey), true);
    assert.equal(tracker.getDaySegments(dayKey).length, 1);
  });

  it("forgetDay() removes both a day's loaded segments and its lightweight index entry", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Task", t0);
    tracker.stop(t0 + 60000);
    assert.equal(tracker.getSortedDayKeys().includes(dayKey), true);

    tracker.forgetDay(dayKey);
    assert.equal(tracker.isDayLoaded(dayKey), false);
    assert.equal(tracker.getDaySegmentCount(dayKey), 0);
    assert.equal(tracker.getDayTotalMs(dayKey), 0);
    assert.equal(tracker.getSortedDayKeys().includes(dayKey), false);
  });

  it("drops a day from the lightweight index once its last segment is deleted", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Solo Task", t0);
    const seg = tracker.stop(t0 + 60000);
    assert.equal(tracker.getDaySegmentCount(dayKey), 1);

    tracker.deleteSegment(dayKey, seg.id);
    assert.equal(tracker.getDaySegmentCount(dayKey), 0);
    assert.equal(tracker.getSortedDayKeys().includes(dayKey), false);
  });

  it("round-trips the lightweight index (day totals + in-progress segment) via serializeIndex/deserializeIndex", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Finished Task", t0);
    tracker.stop(t0 + 60000);
    tracker.start("Active Task", t0 + 120000);

    const restored = WorkTracker.deserializeIndex(tracker.serializeIndex());

    assert.equal(restored.getDaySegmentCount(dayKey), 1);
    assert.equal(restored.getDayTotalMs(dayKey, t0 + 60000), 60000);
    assert.equal(restored.isTiming(), true);
    assert.equal(restored.currentSegment.label, "Active Task");
    // The index carries totals/counts only - a freshly deserialized
    // index-only tracker has no day's full segment list loaded yet.
    assert.equal(restored.isDayLoaded(dayKey), false);
  });

  it("round-trips one day's segment list via serializeDaySegments/parseDaySegments, independent of any other day", () => {
    const tracker = new WorkTracker();
    const t0 = new Date(2026, 8, 3, 9, 0, 0).getTime();
    const dayKey = "2026-09-03";

    tracker.start("Task A", t0);
    tracker.stop(t0 + 60000);

    const raw = tracker.serializeDaySegments(dayKey);
    const segs = WorkTracker.parseDaySegments(raw);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].label, "Task A");

    // Malformed/missing input degrades gracefully to an empty list
    // rather than throwing - a corrupt single day's storage shouldn't
    // take down the whole app.
    assert.deepEqual(WorkTracker.parseDaySegments(null), []);
    assert.deepEqual(WorkTracker.parseDaySegments("not json"), []);
  });

  it("keeps a segment that runs past midnight under the day it started, not the day it ended", () => {
    const tracker = new WorkTracker();
    const startTime = new Date(2026, 8, 3, 23, 45, 0).getTime(); // 11:45 PM Sep 3
    const stopTime = new Date(2026, 8, 4, 0, 15, 0).getTime();   // 12:15 AM Sep 4

    tracker.start("Late Night Task", startTime);
    const seg = tracker.stop(stopTime);

    // Full 30-minute duration is preserved, not truncated at midnight.
    assert.equal(getSegmentDurationMs(seg), 30 * 60000);

    // Segment is filed under the start day...
    assert.equal(tracker.getDaySegments("2026-09-03").length, 1);
    assert.equal(tracker.getDaySegments("2026-09-03")[0].id, seg.id);
    assert.equal(tracker.getDayTotalMs("2026-09-03"), 30 * 60000);

    // ...and does not also appear under (or contribute to) the end day.
    assert.equal(tracker.getDaySegments("2026-09-04").length, 0);
    assert.equal(tracker.getDayTotalMs("2026-09-04"), 0);
  });

  it("attributes a still-running overnight segment's elapsed time to its start day, not the new calendar day", () => {
    const tracker = new WorkTracker();
    const startTime = new Date(2026, 8, 3, 23, 0, 0).getTime(); // 11:00 PM Sep 3
    const nowAfterMidnight = new Date(2026, 8, 4, 1, 0, 0).getTime(); // 1:00 AM Sep 4, still running

    tracker.start("Overnight Task", startTime);

    // While active, elapsed time counts toward the start day's total...
    assert.equal(tracker.getDayTotalMs("2026-09-03", nowAfterMidnight), 2 * 3600000);
    // ...and is not double-counted (or counted at all) under the new day
    // it happens to be "now", since the segment hasn't been attributed
    // there and won't be once stopped.
    assert.equal(tracker.getDayTotalMs("2026-09-04", nowAfterMidnight), 0);

    const seg = tracker.stop(nowAfterMidnight);
    assert.equal(getSegmentDurationMs(seg), 2 * 3600000);
    assert.equal(tracker.getDaySegments("2026-09-03").length, 1);
    assert.equal(tracker.getDaySegments("2026-09-04").length, 0);
  });
});

describe("Timer Core - Daylight Saving Time transitions", () => {
  // WorkTracker durations are computed as plain epoch-millisecond
  // subtraction (stopTime - startTime), which is inherently correct
  // across a DST jump - the wall clock's local hour/minute display can
  // skip or repeat an hour, but the underlying instants in time (and
  // their difference) are unaffected. These tests pin a US Eastern-style
  // DST calendar (spring-forward: 2:00 AM -> 3:00 AM; fall-back:
  // 2:00 AM -> 1:00 AM) via TZ so behavior doesn't depend on the host
  // machine's local timezone/DST rules.
  let originalTZ;

  before(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = "America/New_York";
  });

  after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it("reports only 1 real hour elapsed for a timer spanning the spring-forward jump (clocks skip 2 AM -> 3 AM)", () => {
    const tracker = new WorkTracker();
    // 2026-03-08 is a US DST "spring forward" date: 1:30 AM -> 3:30 AM
    // local time is only 1 hour of real elapsed time (2:00-3:00 AM never
    // happens on the clock).
    const startTime = new Date(2026, 2, 8, 1, 30, 0).getTime();
    const stopTime = new Date(2026, 2, 8, 3, 30, 0).getTime();

    tracker.start("Spring Forward Task", startTime);
    const seg = tracker.stop(stopTime);

    assert.equal(getSegmentDurationMs(seg), 1 * 3600000);
    assert.equal(tracker.getDayTotalMs(getDayKey(startTime)), 1 * 3600000);
  });

  it("reports 3 real hours elapsed for a timer spanning the fall-back jump (clocks repeat 1 AM -> 2 AM)", () => {
    const tracker = new WorkTracker();
    // 2026-11-01 is a US DST "fall back" date: 12:30 AM -> 2:30 AM local
    // time is 3 hours of real elapsed time (1:00-2:00 AM happens twice).
    const startTime = new Date(2026, 10, 1, 0, 30, 0).getTime();
    const stopTime = new Date(2026, 10, 1, 2, 30, 0).getTime();

    tracker.start("Fall Back Task", startTime);
    const seg = tracker.stop(stopTime);

    assert.equal(getSegmentDurationMs(seg), 3 * 3600000);
    assert.equal(tracker.getDayTotalMs(getDayKey(startTime)), 3 * 3600000);
  });

  it("computes correct elapsed time for a still-running timer mid-way through a spring-forward jump", () => {
    const tracker = new WorkTracker();
    const startTime = new Date(2026, 2, 8, 1, 30, 0).getTime();
    const nowJustAfterJump = new Date(2026, 2, 8, 3, 0, 0).getTime(); // 30 real minutes later

    tracker.start("Active Spring Forward Task", startTime);
    assert.equal(tracker.getElapsedCurrentMs(nowJustAfterJump), 30 * 60000);
  });
});
