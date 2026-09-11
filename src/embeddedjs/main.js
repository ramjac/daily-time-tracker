import Poco from "commodetto/Poco";
import Button from "pebble/button";
import Dictation from "pebble/dictation";
import { WorkTracker, formatDuration, formatTimeOfDay, getDayKey, getDefaultLabel } from "timerCore";

const STORAGE_KEY = "work_tracker_state_v2";
const tracker = WorkTracker.deserialize(localStorage.getItem(STORAGE_KEY));
function save() { localStorage.setItem(STORAGE_KEY, tracker.serialize()); }

const render = new Poco(screen);
const pad = screen.round ? 28 : 10;
const LINE_GAP = 6;
// Extra spacing (in addition to LINE_GAP) between the Up/Down nav hints
// on the base Today view and the central timer content, so the nav text
// sits further from the middle of the screen and the timer gets breathing
// room around it.
const NAV_GAP = LINE_GAP + 14;

// Fonts & colors are created once and reused across every redraw.
// Bitham-Bold is Pebble's dedicated large-digit display font (valid only
// at 42pt); Gothic-Bold/Regular at 18pt (up from 14pt) for the smaller
// status/nav lines - all sizes here are validated system font sizes.
const fontBig = new render.Font("Bitham-Bold", 42);
const fontSmall = new render.Font("Gothic-Regular", 18);
const black = render.makeColor(0, 0, 0);
const white = render.makeColor(255, 255, 255);
const gray = render.makeColor(136, 136, 136);
const orange = render.makeColor(255, 170, 0);
const blue = render.makeColor(85, 170, 255);

let currentView = "TODAY";
let pastDayKeys = [];
let pastDayIdx = 0;
let todaySegIdx = 0;
let pastDaySegIdx = 0;
let timerInterval = null;

// Which segment the Segment Actions menu is currently acting on - set
// when entering the menu (Select on a segments view, in the onPush
// handler below) and read back by draw()/handleSegmentAction().
// sourceView is whichever of TODAY_SEGMENTS/PAST_DAY_SEGMENTS opened the
// menu, so Back and post-action returns land on the right view.
let segActionsSourceView = null;
let segActionsDayKey = null;
let segActionsSegmentId = null;

// The button used to launch the app (e.g. SELECT from the launcher) can
// still be physically held when this script starts running, so the first
// event we see for it is a "release" with no matching press seen in-app.
// Track, per button, whether we've seen a genuine in-app press since
// launch; a release with no prior press is that stale launch release and
// is discarded (but arms the button so the next real press/release cycle
// registers normally). This only delays a button whose release is still
// pending from launch - a button that's already up when the app opens
// behaves with zero delay.
const pressedSinceLaunch = { select: false, up: false, down: false, back: false };

function refreshPastDayKeys() {
  const todayKey = getDayKey(Date.now());
  pastDayKeys = tracker.getSortedDayKeys().filter(k => k !== todayKey).reverse();
}

// Draws one set of centered lines at a vertical pixel offset. Does not
// begin/end/clear the frame - callers that need to draw a single view do
// that themselves (drawLines below); the slide transition paints two line
// sets (outgoing + incoming view) into the same frame.
// Each line may set an optional `gap` overriding the default LINE_GAP
// spacing that follows it (used to pull related lines - like a label and
// its value - closer together, or push unrelated lines further apart).
function paintLines(lines, offsetY) {
  const visible = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text) visible.push(lines[i]);
  }
  let totalHeight = 0;
  for (let i = 0; i < visible.length; i++) {
    totalHeight += visible[i].font.height;
    if (i < visible.length - 1) totalHeight += visible[i].gap ?? LINE_GAP;
  }
  let y = Math.max(pad, Math.round((render.height - totalHeight) / 2)) + offsetY;

  for (const line of visible) {
    const width = render.getTextWidth(line.text, line.font);
    const x = Math.round((render.width - width) / 2);
    render.drawText(line.text, line.font, line.color, x, y);
    y += line.font.height + (line.gap ?? LINE_GAP);
  }
}

function drawLines(lines, offsetY = 0) {
  render.begin();
  render.fillRectangle(black, 0, 0, render.width, render.height);
  paintLines(lines, offsetY);
  render.end();
}

function draw(offsetY = 0) {
  let lines;
  if (currentView === "TODAY_SEGMENTS") {
    lines = getTodaySegmentsLines();
    if (!lines) { switchView("TODAY"); return; }
  } else if (currentView === "PAST_DAYS") {
    lines = getPastDayLines();
    if (!lines) { switchView("TODAY"); return; }
  } else if (currentView === "PAST_DAY_SEGMENTS") {
    lines = getPastDaySegmentsLines();
    if (!lines) { switchView("PAST_DAYS"); return; }
  } else if (currentView === "SEGMENT_ACTIONS") {
    // The menu is only ever entered right after a valid segment is
    // selected, and is only left via merge/delete/back (which change
    // currentView immediately) - so the acted-on segment is always
    // present here; no null-fallback needed (inlined for the same
    // reason as the Select-handler's Segment Actions entry above).
    const daySegs = tracker.getDaySegments(segActionsDayKey);
    const segIdx = daySegs.findIndex((s) => s.id === segActionsSegmentId);
    const seg = daySegs[segIdx];
    const mergeUp = segIdx > 0 ? "/ Merge Up \\" : "";
    const mergeDown = segIdx < daySegs.length - 1 ? "\\ Merge Down /" : "";
    const status = "SELECT: Delete, Hold: Label";
    lines = getSummaryLines(mergeUp, seg.label, seg.durationMs, status, mergeDown);
  } else if (currentView === "SEGMENT_DELETE_CONFIRM") {
    // Same not-null-checked reasoning as the SEGMENT_ACTIONS branch above -
    // this view is only reached right after a valid segment is selected
    // there, and only left via confirm/cancel (which change currentView
    // immediately).
    const seg = tracker.getDaySegments(segActionsDayKey).find((s) => s.id === segActionsSegmentId);
    lines = getSummaryLines("", seg.label, seg.durationMs, "SELECT: Confirm Delete", "BACK: Cancel");
  } else {
    lines = getTodayLines();
  }
  drawLines(lines, offsetY);
}

// Shared line-builder for the 5-line "summary" layout used by Today,
// past-day, and Segment Actions views alike: a top nav hint, a small
// label hugging the big duration, the duration itself, a secondary
// status line, and a bottom nav hint - each pushed away from the center
// by NAV_GAP so the central duration keeps its breathing room. Factored
// out so the three callers don't duplicate this bytecode, which matters
// under this app's tight 128KB code+heap budget.
function getSummaryLines(topNav, label, totalMs, status, bottomNav) {
  return [
    { text: topNav, font: fontSmall, color: blue, gap: NAV_GAP },
    { text: label, font: fontSmall, color: gray, gap: 2 },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: status, font: fontSmall, color: orange, gap: NAV_GAP },
    { text: bottomNav, font: fontSmall, color: gray }
  ];
}

function getTodayLines() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);
  const nav = segs.length > 0 ? `/ ${segs.length} timespans \\` : "";
  const timing = tracker.isTiming();
  const label = timing ? tracker.currentSegment.label : "Today's total";
  const status = timing
    ? `SELECT: Stop (${formatDuration(tracker.getElapsedCurrentMs() / 1000)})`
    : "SELECT: Start";
  return getSummaryLines(nav, label, totalMs, status, "\\ History /");
}

// Clamps a paging index into [0, len-1], used whenever the underlying
// segment/day list may have shrunk since the index was last set.
function clampIdx(idx, len) {
  if (idx >= len) return len - 1;
  if (idx < 0) return 0;
  return idx;
}

// Shared line-builder for a single-segment detail view (used by both
// Today's segments and a past day's segments) - factored out so the two
// callers don't duplicate this bytecode, which matters under this app's
// tight 128KB code+heap budget.
// Adds the same wrapped-arrow nav hints used elsewhere in the app: Up
// pages to an earlier segment ("Previous", hidden at the first segment
// since there's nothing earlier - Up just bounces there), while Down
// normally pages to a later segment ("Next", hidden at the last segment
// unless bottomExitLabel is given) except at the last segment of Today's
// segments view, where Down instead exits back to the base Today view -
// bottomExitLabel (only passed by getTodaySegmentsLines) swaps the bottom
// hint to match that special case.
function getSegmentDetailLines(segs, idx, bottomExitLabel) {
  const seg = segs[idx];
  const atStart = idx === 0;
  const atEnd = idx === segs.length - 1;
  const topNav = atStart ? "" : "/ Previous \\";
  const bottomNav = atEnd ? (bottomExitLabel ? `\\ ${bottomExitLabel} /` : "") : "\\ Next /";
  return [
    { text: topNav, font: fontSmall, color: blue, gap: NAV_GAP },
    { text: `${idx + 1} of ${segs.length}`, font: fontSmall, color: blue },
    { text: formatDuration(seg.durationMs / 1000), font: fontBig, color: white },
    { text: seg.label, font: fontSmall, color: white },
    { text: `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`, font: fontSmall, color: orange, gap: NAV_GAP },
    { text: bottomNav, font: fontSmall, color: gray }
  ];
}

// Returns null when there are no segments today (caller falls back to the
// base Today view) rather than drawing directly, so this can also be used
// to build the "incoming" frame for the slide transition.
function getTodaySegmentsLines() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  if (segs.length === 0) return null;
  todaySegIdx = clampIdx(todaySegIdx, segs.length);
  return getSegmentDetailLines(segs, todaySegIdx, "Today");
}

// Returns null when there are no past days (caller falls back to the base
// Today view), mirroring getTodaySegmentsLines()'s pattern so this can
// also be reused as the "outgoing"/"incoming" frame for a slide transition.
function getPastDayLines() {
  if (pastDayKeys.length === 0) return null;
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  const topNav = pastDayIdx === 0 ? "/ Today \\" : "/ Next \\";
  const bottomNav = pastDayIdx === pastDayKeys.length - 1 ? "" : "\\ Previous /";
  const status = `${segs.length} timespan${segs.length === 1 ? "" : "s"}`;
  return getSummaryLines(topNav, key, totalMs, status, bottomNav);
}

// Segments for whichever past day is currently selected in PAST_DAYS
// (pastDayKeys[pastDayIdx]), unlike getTodaySegmentsLines() which always
// looks at today's segments. Starts at the first (oldest) segment when
// entered, the opposite of Today's segments view which starts at the
// most recent - see switchView().
function getPastDaySegmentsLines() {
  const key = pastDayKeys[pastDayIdx];
  if (!key) return null;
  const segs = tracker.getDaySegments(key);
  if (segs.length === 0) return null;
  pastDaySegIdx = clampIdx(pastDaySegIdx, segs.length);
  return getSegmentDetailLines(segs, pastDaySegIdx);
}

// Small bounce-back nudge shown when paging past the end of a list (like
// the system menu's bounce at its first/last row), and the slide
// transition shown when moving between the base Today view and the
// segment-detail/past-days views (Poco is immediate-mode, so both the
// outgoing and incoming line sets must be painted together each step to
// appear simultaneously). Both share one timer/step function (mode
// switches between "bounce" and "slide") so only one compiled function
// and one timer variable are needed for both animations, instead of two
// near-identical ones - see the 128KB code+heap budget note above
// getCurrentLines(). direction is -1 when the blocked press was Up
// (nudge/slide up) or 1 for Down; for slides, dir = -1 slides the
// outgoing view up and off the top (incoming enters from the bottom),
// dir = 1 the reverse.
const BOUNCE_FRAMES_PX = [10, 6, 3, 0];
const BOUNCE_FRAME_MS = 45;
const SLIDE_STEPS = [0.18, 0.4, 0.62, 0.82, 1];
const SLIDE_FRAME_MS = 40;
let animTimer = null;
let animMode = null; // "bounce" or "slide"
let animDir = 0;
let animStepIdx = 0;
let slideOldLines = null;
let slideNewLines = null;

function animStep() {
  if (animMode === "bounce") {
    if (animStepIdx >= BOUNCE_FRAMES_PX.length) { animTimer = null; return; }
    draw(animDir * BOUNCE_FRAMES_PX[animStepIdx]);
    animStepIdx++;
    animTimer = setTimeout(animStep, BOUNCE_FRAME_MS);
    return;
  }
  if (animStepIdx >= SLIDE_STEPS.length) {
    animTimer = null;
    slideOldLines = null;
    slideNewLines = null;
    return;
  }
  const t = SLIDE_STEPS[animStepIdx];
  const oldOffset = animDir * render.height * t;
  const newOffset = oldOffset - animDir * render.height;
  render.begin();
  render.fillRectangle(black, 0, 0, render.width, render.height);
  paintLines(slideOldLines, oldOffset);
  paintLines(slideNewLines, newOffset);
  render.end();
  animStepIdx++;
  animTimer = setTimeout(animStep, SLIDE_FRAME_MS);
}

function bounceAtEdge(direction) {
  if (animTimer) return;
  animMode = "bounce";
  animDir = direction;
  animStepIdx = 0;
  animStep();
}

function runSlideTransition(oldLines, newLines, dir) {
  animMode = "slide";
  slideOldLines = oldLines;
  slideNewLines = newLines;
  animDir = dir;
  animStepIdx = 0;
  animStep();
}

// Returns the line-set for whichever view is currently active - used to
// snapshot the "outgoing" frame right before switching currentView, and
// again afterward (with setup already applied) for the "incoming" frame.
function getCurrentLines() {
  if (currentView === "TODAY_SEGMENTS") return getTodaySegmentsLines();
  if (currentView === "PAST_DAYS") return getPastDayLines();
  return getTodayLines();
}

// Generic view-switch-with-slide, shared by all four Today<->Segments and
// Today<->PastDays transitions so each direction doesn't need its own
// near-identical function (see getCurrentLines note on the 128KB budget).
// setup (if given) runs after currentView is updated but before the
// incoming frame is captured, so it can set the paging index to start at.
function slideTransition(newView, setup, dir) {
  if (animTimer) return;
  const oldLines = getCurrentLines();
  currentView = newView;
  if (setup) setup();
  const newLines = getCurrentLines();
  runSlideTransition(oldLines, newLines, dir);
}

function switchView(view, setup) {
  currentView = view;
  if (setup) setup();
  draw();
}

// Handles all Segment Actions menu outcomes: merge with the previous (-1)
// or next (1) neighbor, or delete (0). Merge bounces in place when
// there's no such neighbor (mirroring the other edge-of-list bounces);
// otherwise re-points the source view's paging index at the merged
// segment. Either way, returns to the source view afterward.
function handleSegmentAction(direction) {
  if (direction === 0) {
    tracker.deleteSegment(segActionsDayKey, segActionsSegmentId);
  } else {
    const merged = tracker.mergeAdjacent(segActionsDayKey, segActionsSegmentId, direction);
    if (!merged) { bounceAtEdge(direction); return; }
    const idx = tracker.getDaySegments(segActionsDayKey).findIndex((s) => s.id === merged.id);
    if (segActionsSourceView === "TODAY_SEGMENTS") todaySegIdx = idx >= 0 ? idx : 0;
    else pastDaySegIdx = idx >= 0 ? idx : 0;
  }
  save();
  currentView = segActionsSourceView;
  draw();
}

// Single reusable Dictation instance for labeling timespans (today's
// completed segments and past days' segments alike) from the Segment
// Actions menu (short-press SELECT). The target day/segment is
// captured into module-level vars right before each start() call (rather
// than read fresh from segActionsDayKey/segActionsSegmentId when the
// result arrives, in case those globals moved on in the meantime) - the
// Dictation instance itself is a singleton reused across presses, so its
// callbacks read these vars instead of closing over per-call locals that
// would go stale after the first use.
let segmentDictation = null;
let dictationDayKey = null;
let dictationSegmentId = null;
let dictationTargetsCurrent = false;
function ensureSegmentDictation() {
  if (segmentDictation) return;
  segmentDictation = new Dictation({
    // The Dictation system UI consumes whatever button press dismisses
    // it (e.g. confirming the transcription), so control can return to
    // our button handler mid-press-cycle - the next event we see is a
    // release with no matching in-app press, exactly like the stale
    // launch-button release handled by pressedSinceLaunch above. Re-arm
    // the same guard here so that stale release is discarded instead of
    // being treated as a fresh short-press that restarts dictation.
    onReadable() {
      pressedSinceLaunch.select = false;
      const text = this.read();
      if (dictationTargetsCurrent) tracker.setCurrentSegmentLabel(text);
      else tracker.setSegmentLabel(dictationDayKey, dictationSegmentId, text);
      save();
      draw();
    },
    onError() {
      pressedSinceLaunch.select = false;
      draw();
    }
  });
}

function startSegmentLabelDictation() {
  dictationDayKey = segActionsDayKey;
  dictationSegmentId = segActionsSegmentId;
  dictationTargetsCurrent = false;
  ensureSegmentDictation();
  segmentDictation.start();
}

// Labels the in-progress timer from the base Today view (long-press
// SELECT while timing), reusing the same singleton Dictation instance.
function startCurrentSegmentLabelDictation() {
  dictationTargetsCurrent = true;
  ensureSegmentDictation();
  segmentDictation.start();
}

function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentView === "TODAY" && !animTimer) draw();
  }, 1000);
}
function stopTimerTick() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function handleStartStopTimer() {
  if (tracker.isTiming()) {
    tracker.stop();
    stopTimerTick();
    save();
    draw();
  } else {
    tracker.start(getDefaultLabel());
    startTimerTick();
    save();
    draw();
  }
}

/* TEST-ONLY: long-press SELECT to generate a random past day, used to
   exercise history paging without manually creating days of segments by
   hand. Not meant to ship - re-comment this whole block (and the two
   commented hook lines in the Button handler below) before committing.

const SELECT_LONG_PRESS_MS = 600;
let selectLongPressTimer = null;
let selectLongPressFired = false;

function generateRandomTestPastDay() {
  // Each call goes one day further into the past than the last, tracked
  // via a small persisted counter (separate from real app state) so
  // repeated long-presses build up a run of distinct past days.
  const offsetKey = "test_gen_day_offset_v1";
  const offset = parseInt(localStorage.getItem(offsetKey) || "0", 10) + 1;
  localStorage.setItem(offsetKey, String(offset));

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(dayStart.getDate() - offset);
  const dayStartMs = dayStart.getTime();
  const dayKey = getDayKey(dayStartMs);
  const DAY_MS = 24 * 3600000;
  const MIN_SEG_MS = 5 * 60000;
  const MAX_SEG_MS = 2 * 3600000;

  const segCount = 1 + Math.floor(Math.random() * 5); // 1-5 segments
  const durations = [];
  for (let i = 0; i < segCount; i++) {
    durations.push(MIN_SEG_MS + Math.random() * (MAX_SEG_MS - MIN_SEG_MS));
  }
  const totalSegMs = durations.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, DAY_MS - totalSegMs);

  // Random gaps in the segCount + 1 slots before/between/after segments,
  // summing to whatever time is left in the day, so segments land at
  // random sequential (non-overlapping) times.
  const gapWeights = [];
  for (let i = 0; i <= segCount; i++) gapWeights.push(Math.random());
  const gapWeightSum = gapWeights.reduce((a, b) => a + b, 0);
  const gaps = gapWeights.map((w) => (w / gapWeightSum) * remaining);

  const segments = [];
  let cursor = dayStartMs + gaps[0];
  for (let i = 0; i < segCount; i++) {
    const startTime = Math.round(cursor);
    const durationMs = Math.round(durations[i]);
    const stopTime = startTime + durationMs;
    segments.push({
      id: `${startTime}-${Math.floor(Math.random() * 1e6)}`,
      label: getDefaultLabel(new Date(startTime)),
      startTime,
      stopTime,
      durationMs
    });
    cursor = stopTime + gaps[i + 1];
  }

  tracker.days[dayKey] = segments;
  save();
  refreshPastDayKeys();
  draw();
}
*/

// Long-press SELECT triggers dictation (Segment Actions menu, or the
// base Today view while a timer is running); short-press SELECT deletes
// the menu's segment. Detected by measuring press duration on release
// (rather than a separate setTimeout/closure) to keep this cheap under
// this app's tight 128KB code+heap budget.
const LONG_PRESS_MS = 600;
let selectPressStartMs = 0;

new Button({
  types: ["select", "up", "down", "back"],
  onPush(down, type) {
    if (down) {
      pressedSinceLaunch[type] = true;
      if (type === "select") selectPressStartMs = Date.now();
      return;
    }
    if (!pressedSinceLaunch[type]) { pressedSinceLaunch[type] = true; return; }
    if (animTimer) return; // ignore input mid-animation
    if (type === "select") {
      if (currentView === "SEGMENT_ACTIONS") {
        if (Date.now() - selectPressStartMs >= LONG_PRESS_MS) startSegmentLabelDictation();
        else switchView("SEGMENT_DELETE_CONFIRM");
        return;
      }
      if (currentView === "SEGMENT_DELETE_CONFIRM") {
        handleSegmentAction(0);
        return;
      }
      if (currentView === "TODAY") {
        if (tracker.isTiming() && Date.now() - selectPressStartMs >= LONG_PRESS_MS) {
          startCurrentSegmentLabelDictation();
        } else {
          handleStartStopTimer();
        }
      } else if (currentView === "PAST_DAYS") switchView("PAST_DAY_SEGMENTS", () => { pastDaySegIdx = 0; });
      else if (currentView === "TODAY_SEGMENTS" || currentView === "PAST_DAY_SEGMENTS") {
        // Enter the Segment Actions menu for the currently shown segment,
        // pinning down which day/segment its actions apply to (inlined
        // here since it has this one call site - see the 128KB budget
        // note near getCurrentLines()).
        segActionsSourceView = currentView;
        const isToday = currentView === "TODAY_SEGMENTS";
        segActionsDayKey = isToday ? getDayKey(Date.now()) : pastDayKeys[pastDayIdx];
        segActionsSegmentId = tracker.getDaySegments(segActionsDayKey)[isToday ? todaySegIdx : pastDaySegIdx].id;
        currentView = "SEGMENT_ACTIONS";
        draw();
      }
    } else if (type === "up") {
      if (currentView === "TODAY") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (segs.length > 0) {
          slideTransition("TODAY_SEGMENTS", () => {
            todaySegIdx = tracker.getDaySegments(getDayKey(Date.now())).length - 1;
          }, -1);
        }
      } else if (currentView === "TODAY_SEGMENTS") {
        if (todaySegIdx > 0) { todaySegIdx--; draw(); } else bounceAtEdge(-1);
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx > 0) { pastDayIdx--; draw(); } else slideTransition("TODAY", null, -1);
      } else if (currentView === "PAST_DAY_SEGMENTS") {
        if (pastDaySegIdx > 0) { pastDaySegIdx--; draw(); } else bounceAtEdge(-1);
      } else if (currentView === "SEGMENT_ACTIONS") {
        handleSegmentAction(-1);
      }
    } else if (type === "down") {
      if (currentView === "TODAY") {
        refreshPastDayKeys();
        if (pastDayKeys.length > 0) slideTransition("PAST_DAYS", () => { pastDayIdx = 0; }, 1);
      } else if (currentView === "TODAY_SEGMENTS") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (todaySegIdx < segs.length - 1) { todaySegIdx++; draw(); } else slideTransition("TODAY", null, 1);
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx < pastDayKeys.length - 1) { pastDayIdx++; draw(); } else bounceAtEdge(1);
      } else if (currentView === "PAST_DAY_SEGMENTS") {
        const segs = tracker.getDaySegments(pastDayKeys[pastDayIdx]);
        if (pastDaySegIdx < segs.length - 1) { pastDaySegIdx++; draw(); } else bounceAtEdge(1);
      } else if (currentView === "SEGMENT_ACTIONS") {
        handleSegmentAction(1);
      }
    } else if (type === "back") {
      if (currentView === "TODAY_SEGMENTS") slideTransition("TODAY", null, 1);
      else if (currentView === "PAST_DAYS") slideTransition("TODAY", null, -1);
      else if (currentView === "PAST_DAY_SEGMENTS") switchView("PAST_DAYS");
      else if (currentView === "SEGMENT_ACTIONS") { currentView = segActionsSourceView; draw(); }
      else if (currentView === "SEGMENT_DELETE_CONFIRM") { currentView = "SEGMENT_ACTIONS"; draw(); }
      else watch.exit();
    }
  }
});

refreshPastDayKeys();
if (tracker.isTiming()) startTimerTick();
draw();
