import Poco from "commodetto/Poco";
import Button from "pebble/button";
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
  const visible = lines.filter(l => l.text);
  const totalHeight = visible.reduce((sum, l, i) => {
    const gap = i < visible.length - 1 ? (visible[i].gap ?? LINE_GAP) : 0;
    return sum + l.font.height + gap;
  }, 0);
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
    if (!lines) { switchToToday(); return; }
  } else if (currentView === "PAST_DAYS") {
    lines = getPastDayLines();
    if (!lines) { switchToToday(); return; }
  } else if (currentView === "PAST_DAY_SEGMENTS") {
    lines = getPastDaySegmentsLines();
    if (!lines) { returnToPastDays(); return; }
  } else {
    lines = getTodayLines();
  }
  drawLines(lines, offsetY);
}

function getTodayLines() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);
  const nav = segs.length > 0 ? `/\\ ${segs.length} timespans` : "";
  const status = tracker.isTiming()
    ? `${tracker.currentSegment.label} (${formatDuration(tracker.getElapsedCurrentMs() / 1000)})`
    : "SELECT: Start";
  // Wider gaps push the Up/Down nav hints away from the central timer
  // pair; a tight gap keeps "Today's total" hugging the big number above it.
  return [
    { text: nav, font: fontSmall, color: blue, gap: NAV_GAP },
    { text: "Today's total", font: fontSmall, color: gray, gap: 2 },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: status, font: fontSmall, color: orange, gap: NAV_GAP },
    { text: "\\/ History", font: fontSmall, color: gray }
  ];
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
function getSegmentDetailLines(segs, idx) {
  const seg = segs[idx];
  return [
    { text: `${idx + 1} of ${segs.length}`, font: fontSmall, color: blue },
    { text: formatDuration(seg.durationMs / 1000), font: fontBig, color: white },
    { text: `Timespan ${idx + 1}`, font: fontSmall, color: white },
    { text: `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`, font: fontSmall, color: orange }
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
  return getSegmentDetailLines(segs, todaySegIdx);
}

// Returns null when there are no past days (caller falls back to the base
// Today view), mirroring getTodaySegmentsLines()'s pattern so this can
// also be reused as the "outgoing"/"incoming" frame for a slide transition.
function getPastDayLines() {
  if (pastDayKeys.length === 0) return null;
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  const topNav = pastDayIdx === 0 ? "/\\ Today" : "/\\ Next";
  // Mirrors the Today view's layout: a top nav hint, a small label
  // hugging the big duration, the duration itself, a secondary status
  // line, and a bottom nav hint - each pushed away from the center by
  // NAV_GAP so the timer keeps its breathing room.
  return [
    { text: topNav, font: fontSmall, color: blue, gap: NAV_GAP },
    { text: key, font: fontSmall, color: gray, gap: 2 },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: `${segs.length} segment${segs.length === 1 ? "" : "s"}`, font: fontSmall, color: orange, gap: NAV_GAP },
    { text: "\\/ Previous", font: fontSmall, color: gray }
  ];
}

// Segments for whichever past day is currently selected in PAST_DAYS
// (pastDayKeys[pastDayIdx]), unlike getTodaySegmentsLines() which always
// looks at today's segments. Starts at the first (oldest) segment when
// entered, the opposite of Today's segments view which starts at the
// most recent - see switchToPastDaySegments().
function getPastDaySegmentsLines() {
  const key = pastDayKeys[pastDayIdx];
  if (!key) return null;
  const segs = tracker.getDaySegments(key);
  if (segs.length === 0) return null;
  pastDaySegIdx = clampIdx(pastDaySegIdx, segs.length);
  return getSegmentDetailLines(segs, pastDaySegIdx);
}

// Small bounce-back nudge shown when paging past the end of a list (like
// the system menu's bounce at its first/last row). direction is -1 when
// the blocked press was Up (nudge content down then spring back) or 1
// when the blocked press was Down (nudge content up then spring back).
const BOUNCE_FRAMES_PX = [10, 6, 3, 0];
const BOUNCE_FRAME_MS = 45;
let bounceTimer = null;

function bounceAtEdge(direction) {
  if (bounceTimer || transitionTimer) return;
  let i = 0;
  function step() {
    if (i >= BOUNCE_FRAMES_PX.length) { bounceTimer = null; return; }
    draw(direction * BOUNCE_FRAMES_PX[i]);
    i++;
    bounceTimer = setTimeout(step, BOUNCE_FRAME_MS);
  }
  step();
}

// Slide transition shown when moving between the base Today view and the
// segment-detail view, so the direction of the button press (Up = into
// segments, Down/Back = back out) is echoed by the outgoing view sliding
// off screen the same way. Paints both the outgoing and incoming line
// sets into the same frame each step (Poco is immediate-mode, so both
// must be drawn together to appear simultaneously on screen). dir = -1
// slides the outgoing view up and off the top (incoming enters from the
// bottom); dir = 1 slides the outgoing view down and off the bottom
// (incoming enters from the top).
const SLIDE_STEPS = [0.18, 0.4, 0.62, 0.82, 1];
const SLIDE_FRAME_MS = 40;
let transitionTimer = null;

function runSlideTransition(oldLines, newLines, dir) {
  let i = 0;
  function step() {
    if (i >= SLIDE_STEPS.length) { transitionTimer = null; return; }
    const t = SLIDE_STEPS[i];
    const oldOffset = dir * render.height * t;
    const newOffset = oldOffset - dir * render.height;
    render.begin();
    render.fillRectangle(black, 0, 0, render.width, render.height);
    paintLines(oldLines, oldOffset);
    paintLines(newLines, newOffset);
    render.end();
    i++;
    transitionTimer = setTimeout(step, SLIDE_FRAME_MS);
  }
  step();
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
  if (bounceTimer || transitionTimer) return;
  const oldLines = getCurrentLines();
  currentView = newView;
  if (setup) setup();
  const newLines = getCurrentLines();
  runSlideTransition(oldLines, newLines, dir);
}

function switchToToday() { currentView = "TODAY"; draw(); }

// Enters the segments view for whichever past day is currently selected.
// No slide transition here (not requested) - just a plain view switch,
// same as the other purely-internal/no-animation transitions.
function switchToPastDaySegments() {
  currentView = "PAST_DAY_SEGMENTS";
  pastDaySegIdx = 0; // start at the first (oldest) segment, per spec
  draw();
}

function returnToPastDays() { currentView = "PAST_DAYS"; draw(); }

function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentView === "TODAY" && !bounceTimer && !transitionTimer) draw();
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
      id: `${startTime}-${Math.random().toString(36).substr(2, 5)}`,
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

new Button({
  types: ["select", "up", "down", "back"],
  onPush(down, type) {
    if (down) {
      pressedSinceLaunch[type] = true;
      // if (type === "select") { // TEST-ONLY: see block above
      //   selectLongPressFired = false;
      //   selectLongPressTimer = setTimeout(() => {
      //     selectLongPressFired = true;
      //     generateRandomTestPastDay();
      //   }, SELECT_LONG_PRESS_MS);
      // }
      return;
    }
    // if (type === "select" && selectLongPressTimer) { // TEST-ONLY
    //   clearTimeout(selectLongPressTimer);
    //   selectLongPressTimer = null;
    // }
    if (!pressedSinceLaunch[type]) { pressedSinceLaunch[type] = true; return; }
    if (bounceTimer || transitionTimer) return; // ignore input mid-animation
    if (type === "select") {
      // if (selectLongPressFired) { selectLongPressFired = false; return; } // TEST-ONLY
      if (currentView === "TODAY") handleStartStopTimer();
      else if (currentView === "PAST_DAYS") switchToPastDaySegments();
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
      }
    } else if (type === "back") {
      if (currentView === "TODAY_SEGMENTS") slideTransition("TODAY", null, 1);
      else if (currentView === "PAST_DAYS") slideTransition("TODAY", null, -1);
      else if (currentView === "PAST_DAY_SEGMENTS") returnToPastDays();
      else watch.exit();
    }
  }
});

refreshPastDayKeys();
if (tracker.isTiming()) startTimerTick();
draw();
