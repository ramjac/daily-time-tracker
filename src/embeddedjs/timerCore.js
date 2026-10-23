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
  // Show only units meaningful at the duration's scale: seconds below a
  // minute, minutes+seconds below an hour, and hours+minutes from there.
  // Each shown value keeps its unit letter so no colon interpretation is
  // needed on the watch's small display.
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${pad2(secs)}s`;
}

// A completed segment's duration is always stopTime - startTime, so it's
// computed on demand rather than stored as its own field - storing it
// separately would be redundant data that could (in principle) drift out
// of sync with start/stop, and every persisted segment costs precious
// bytes against Pebble's small per-key/total storage budgets (see
// "Persistent storage architecture" in the repo's copilot instructions).
export function getSegmentDurationMs(seg) {
  return Math.max(0, seg.stopTime - seg.startTime);
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
    // `days` holds the full segment list ONLY for whichever day(s) are
    // currently loaded into memory - always today, plus at most one past
    // day while its Segments/Actions view is open (see
    // loadDaySegments()/unloadDaySegments() below, and main.js's lazy-load
    // orchestration, which persists each day under its own storage key so
    // unloaded days cost no memory and don't need to be read/written just
    // because a *different* day changed). Structure: { "YYYY-MM-DD": [
    // { id, label, startTime, stopTime }, ... ] } - no durationMs field;
    // a segment's duration is always computed on demand as
    // stopTime - startTime (see getSegmentDurationMs()) since storing it
    // separately would be redundant and cost extra persisted bytes.
    this.days = initialState.days || {};
    // `dayTotals` is a lightweight index covering EVERY day that has ever
    // recorded a segment, not just currently-loaded ones: { "YYYY-MM-DD":
    // { totalMs, count } }. This is what lets PAST_DAYS page through every
    // day's total/segment-count for display without loading (or even
    // having ever loaded, this session) that day's full segment list - a
    // freshly deserialized index-only tracker has zero loaded days but a
    // complete dayTotals map. Kept in sync with `days` by
    // _recomputeDayTotals() after every mutation of a loaded day.
    this.dayTotals = initialState.dayTotals || {};
    this.currentSegment = initialState.currentSegment || null; // { id, label, startTime }
    // Small incrementing counter used to generate segment ids - cheaper
    // to persist and compare than a timestamp+random string, since a
    // segment id is only ever used to find that segment again within its
    // own day's array (never displayed, never compared across days).
    // Persisted in the index so ids stay unique across restarts.
    this.nextSegmentId = initialState.nextSegmentId || 1;
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
    const index = this.getDaySegmentCount(dayKey) + 1;
    const resolvedLabel = (label && label.trim().length > 0)
      ? label.trim()
      : getDefaultLabel(index);

    this.currentSegment = {
      id: this.nextSegmentId++,
      label: resolvedLabel,
      startTime
    };
    return this.currentSegment;
  }

  stop(stopTime = Date.now()) {
    if (!this.isTiming()) return null;

    const completed = {
      ...this.currentSegment,
      stopTime
    };

    const dayKey = getDayKey(completed.startTime);
    if (!this.days[dayKey]) {
      this.days[dayKey] = [];
    }
    this.days[dayKey].push(completed);
    this._recomputeDayTotals(dayKey);
    this.currentSegment = null;

    return completed;
  }

  // True if a day's full segment list currently lives in `this.days`
  // (as opposed to only being known about via the lightweight
  // `dayTotals` index). Days other than today are only loaded on demand.
  isDayLoaded(dayKey) {
    return Object.prototype.hasOwnProperty.call(this.days, dayKey);
  }

  // Brings a day's full segment list into memory (called by the
  // persistence layer after reading that day's storage key) - a no-op
  // in terms of the lightweight index, which already knows this day's
  // total/count regardless of load state.
  loadDaySegments(dayKey, segments) {
    this.days[dayKey] = segments || [];
  }

  // Frees a day's full segment list from memory without touching its
  // dayTotals index entry, so its total/count remain available for
  // PAST_DAYS display; the day can be reloaded later via
  // loadDaySegments(). Callers are expected to have already persisted
  // any pending changes before unloading.
  unloadDaySegments(dayKey) {
    delete this.days[dayKey];
  }

  // Removes a day entirely - both its loaded segments (if any) and its
  // dayTotals index entry - used when a day's last segment is deleted
  // (nothing left worth remembering) or when storage pressure requires
  // sacrificing the oldest known day to make room for a write.
  forgetDay(dayKey) {
    delete this.days[dayKey];
    delete this.dayTotals[dayKey];
  }

  // Recomputes a loaded day's lightweight index entry (total duration +
  // segment count) from its current in-memory segment list. Called after
  // any mutation that adds/removes/merges segments within a loaded day,
  // so `dayTotals` never drifts out of sync with `days`. Label-only edits
  // (setSegmentLabel/setCurrentSegmentLabel) don't change duration/count
  // and so don't need this.
  _recomputeDayTotals(dayKey) {
    const segs = this.days[dayKey] || [];
    if (segs.length === 0) {
      delete this.dayTotals[dayKey];
      return;
    }
    const totalMs = segs.reduce((acc, seg) => acc + getSegmentDurationMs(seg), 0);
    this.dayTotals[dayKey] = { totalMs, count: segs.length };
  }

  getSortedDayKeys() {
    const today = getDayKey(Date.now());
    // dayTotals (not `days`) is the authoritative list of every day ever
    // recorded, since a day need not be loaded into memory to be known
    // about - this is what allows PAST_DAYS to page through the full
    // history without loading each day's segments just to list it.
    const keys = Object.keys(this.dayTotals);
    if (!(today in this.dayTotals)) keys.push(today);
    keys.sort(); // Chronological: earliest to latest
    return keys;
  }

  getDaySegments(dayKey) {
    return this.days[dayKey] || [];
  }

  // Segment count for a day, from its loaded list if available or
  // otherwise from the lightweight dayTotals index - callers (e.g.
  // PAST_DAYS' "N timespans" line) never need to load a day's full
  // segment list just to display how many segments it has.
  getDaySegmentCount(dayKey) {
    if (this.isDayLoaded(dayKey)) return this.days[dayKey].length;
    return this.dayTotals[dayKey] ? this.dayTotals[dayKey].count : 0;
  }

  getDayTotalMs(dayKey, now = Date.now()) {
    let total;
    if (this.isDayLoaded(dayKey)) {
      total = this.days[dayKey].reduce((acc, seg) => acc + getSegmentDurationMs(seg), 0);
    } else {
      total = this.dayTotals[dayKey] ? this.dayTotals[dayKey].totalMs : 0;
    }
    if (this.isTiming() && getDayKey(this.currentSegment.startTime) === dayKey) {
      total += Math.max(0, now - this.currentSegment.startTime);
    }
    return total;
  }

  /**
   * Merges target segment with previous (index - 1) or next (index + 1).
   * Direction: -1 for previous, 1 for next.
   * Business rule: The other segment's name is retained. The merged
   * segment's duration is its outer span (from the earlier start to the
   * later stop) rather than the sum of the two segments' own worked
   * durations - if there was a gap between them, that gap is now
   * absorbed into the merged segment's duration (durationMs is no
   * longer stored at all; every segment's duration is always
   * stopTime - startTime, see getSegmentDurationMs()).
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
      stopTime: Math.max(target.stopTime, neighbor.stopTime)
    };

    // Remove both and insert merged segment in chronological position
    const minIdx = Math.min(targetIdx, neighborIdx);
    segs.splice(minIdx, 2, merged);
    this._recomputeDayTotals(dayKey);
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
    this._recomputeDayTotals(dayKey);
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

  // Serializes the lightweight index only: every day's total/count
  // (dayTotals) plus the in-progress segment, if any - NOT any day's full
  // segment list (see serializeDaySegments() for that). This is small
  // enough to always be loaded/saved as a single persistent-storage
  // entry regardless of how much history exists, since it's the piece
  // needed on every draw (current timer state, PAST_DAYS totals) without
  // touching any individual day's data.
  serializeIndex() {
    return JSON.stringify({
      dayTotals: this.dayTotals,
      currentSegment: this.currentSegment,
      nextSegmentId: this.nextSegmentId
    });
  }

  static deserializeIndex(raw) {
    if (!raw) return new WorkTracker();
    try {
      return new WorkTracker(JSON.parse(raw));
    } catch {
      return new WorkTracker();
    }
  }

  // Serializes just one day's full segment list, for persistence under
  // that day's own storage key (e.g. "work_day_2026-01-15") - kept
  // separate from serializeIndex() so a day's data can be loaded/saved
  // independently, without reading or holding any other day's segments
  // in memory. Returns "[]" for an unloaded/unknown day rather than
  // throwing, since callers may serialize right after forgetting a day.
  serializeDaySegments(dayKey) {
    return JSON.stringify(this.days[dayKey] || []);
  }

  // Parses one day's persisted segment list (the counterpart to
  // serializeDaySegments()) back into a plain array, degrading to an
  // empty array on missing/malformed input rather than throwing - a
  // corrupt single day's storage shouldn't take down the whole app.
  static parseDaySegments(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
