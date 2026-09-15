function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function getDefaultLabel(index) {
  return `Timespan ${index}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  // Short durations (< 1hr) show minutes and seconds, each labeled with
  // its own unit letter; long durations (>= 1hr) drop seconds entirely
  // and show hours and minutes, each labeled - keeps the display compact
  // on the watch's small screen while staying unambiguous at a glance.
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m ${pad2(secs)}s`;
}

// Reused across every call instead of `new Date(timestamp)` per call: this
// Moddable XS Pebble port leaks a small chunk allocation on every Date
// constructor invocation (confirmed by bisection - Date.now() alone does
// not leak, `new Date(x)` does, and reusing one instance via setTime()
// does not). getDayKey()/formatTimeOfDay() are called on nearly every
// draw/timer-tick, so constructing a fresh Date each time reliably
// exhausts the 128KB heap within a few dozen redraws.
const sharedDate = new Date();
function dateAt(timestamp) {
  sharedDate.setTime(timestamp);
  return sharedDate;
}

export function formatTimeOfDay(timestamp) {
  const d = dateAt(timestamp);
  let hrs = d.getHours();
  const mins = d.getMinutes();
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  hrs = hrs % 12 || 12;
  return `${hrs}:${pad2(mins)} ${ampm}`;
}

export function getDayKey(timestamp) {
  const d = dateAt(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class WorkTracker {
  constructor(initialState = {}) {
    // Structure: { "YYYY-MM-DD": [ { id, label, startTime, stopTime, durationMs }, ... ] }
    this.days = initialState.days || {};
    this.currentSegment = initialState.currentSegment || null; // { id, label, startTime }
  }

  isTiming() {
    return this.currentSegment !== null;
  }

  getElapsedCurrentMs(now = Date.now()) {
    if (!this.isTiming()) return 0;
    return Math.max(0, now - this.currentSegment.startTime);
  }

  start(label, startTime = Date.now()) {
    if (this.isTiming()) {
      this.stop(startTime);
    }
    const dayKey = getDayKey(startTime);
    const index = this.getDaySegments(dayKey).length + 1;
    const resolvedLabel = (label && label.trim().length > 0)
      ? label.trim()
      : getDefaultLabel(index);

    this.currentSegment = {
      id: `${startTime}-${Math.floor(Math.random() * 1e6)}`,
      label: resolvedLabel,
      startTime
    };
    return this.currentSegment;
  }

  stop(stopTime = Date.now()) {
    if (!this.isTiming()) return null;

    const durationMs = Math.max(0, stopTime - this.currentSegment.startTime);
    const completed = {
      ...this.currentSegment,
      stopTime,
      durationMs
    };

    const dayKey = getDayKey(completed.startTime);
    if (!this.days[dayKey]) {
      this.days[dayKey] = [];
    }
    this.days[dayKey].push(completed);
    this.currentSegment = null;

    return completed;
  }

  getSortedDayKeys() {
    const today = getDayKey(Date.now());
    const keys = Object.keys(this.days);
    if (!keys.includes(today)) keys.push(today);
    keys.sort(); // Chronological: earliest to latest
    return keys;
  }

  getDaySegments(dayKey) {
    return this.days[dayKey] || [];
  }

  getDayTotalMs(dayKey, now = Date.now()) {
    let total = (this.days[dayKey] || []).reduce((acc, seg) => acc + seg.durationMs, 0);
    if (this.isTiming() && getDayKey(this.currentSegment.startTime) === dayKey) {
      total += Math.max(0, now - this.currentSegment.startTime);
    }
    return total;
  }

  /**
   * Merges target segment with previous (index - 1) or next (index + 1).
   * Direction: -1 for previous, 1 for next.
   * Business rule: The other segment's name is retained.
   */
  mergeAdjacent(dayKey, targetSegmentId, direction) {
    const segs = this.days[dayKey];
    if (!segs || segs.length < 2) return null;

    const targetIdx = segs.findIndex((s) => s.id === targetSegmentId);
    if (targetIdx === -1) return null;

    const neighborIdx = targetIdx + direction;
    if (neighborIdx < 0 || neighborIdx >= segs.length) return null;

    const target = segs[targetIdx];
    const neighbor = segs[neighborIdx];

    // Build merged segment using neighbor's label
    const merged = {
      id: neighbor.id,
      label: neighbor.label,
      startTime: Math.min(target.startTime, neighbor.startTime),
      stopTime: Math.max(target.stopTime, neighbor.stopTime),
      durationMs: target.durationMs + neighbor.durationMs
    };

    // Remove both and insert merged segment in chronological position
    const minIdx = Math.min(targetIdx, neighborIdx);
    segs.splice(minIdx, 2, merged);
    return merged;
  }

  /**
   * Removes a single segment from a day, used by the Segment Actions menu's
   * long-press-to-delete. Returns true if a segment was found and removed,
   * false otherwise (unknown dayKey/segmentId).
   */
  deleteSegment(dayKey, segmentId) {
    const segs = this.days[dayKey];
    if (!segs) return false;
    const idx = segs.findIndex((s) => s.id === segmentId);
    if (idx === -1) return false;
    segs.splice(idx, 1);
    return true;
  }

  /**
   * Sets a segment's label, used by the Segment Actions menu's dictation
   * feature. Trims and ignores blank text (mirroring start()'s label
   * handling) so a failed/empty transcription leaves the label unchanged.
   * Returns true if a segment was found and updated, false otherwise.
   */
  setSegmentLabel(dayKey, segmentId, label) {
    const segs = this.days[dayKey];
    if (!segs) return false;
    const trimmed = (label || "").trim();
    if (!trimmed) return false;
    const seg = segs.find((s) => s.id === segmentId);
    if (!seg) return false;
    seg.label = trimmed;
    return true;
  }

  /**
   * Sets the in-progress (currently running) segment's label, used by the
   * base Today view's long-press-SELECT dictation feature. Mirrors
   * setSegmentLabel()'s trim/blank-ignore handling. Returns true if a
   * timer was running and got updated, false otherwise (nothing running).
   */
  setCurrentSegmentLabel(label) {
    if (!this.isTiming()) return false;
    const trimmed = (label || "").trim();
    if (!trimmed) return false;
    this.currentSegment.label = trimmed;
    return true;
  }

  serialize() {
    return JSON.stringify({
      days: this.days,
      currentSegment: this.currentSegment
    });
  }

  static deserialize(raw) {
    if (!raw) return new WorkTracker();
    try {
      return new WorkTracker(JSON.parse(raw));
    } catch {
      return new WorkTracker();
    }
  }
}
