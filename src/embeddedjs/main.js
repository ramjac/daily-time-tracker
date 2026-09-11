import Poco from "commodetto/Poco";
import Button from "pebble/button";
import { WorkTracker, formatDuration, formatTimeOfDay, getDayKey, getDefaultLabel } from "timerCore";

const STORAGE_KEY = "work_tracker_state_v2";
const tracker = WorkTracker.deserialize(localStorage.getItem(STORAGE_KEY));
function save() { localStorage.setItem(STORAGE_KEY, tracker.serialize()); }

const render = new Poco(screen);
const pad = screen.round ? 28 : 10;
const LINE_GAP = 6;

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
function paintLines(lines, offsetY) {
  const visible = lines.filter(l => l.text);
  const totalHeight = visible.reduce((sum, l) => sum + l.font.height, 0)
    + LINE_GAP * Math.max(0, visible.length - 1);
  let y = Math.max(pad, Math.round((render.height - totalHeight) / 2)) + offsetY;

  for (const line of visible) {
    const width = render.getTextWidth(line.text, line.font);
    const x = Math.round((render.width - width) / 2);
    render.drawText(line.text, line.font, line.color, x, y);
    y += line.font.height + LINE_GAP;
  }
}

function drawLines(lines, offsetY = 0) {
  render.begin();
  render.fillRectangle(black, 0, 0, render.width, render.height);
  paintLines(lines, offsetY);
  render.end();
}

function draw(offsetY = 0) {
  if (currentView === "TODAY_SEGMENTS") return drawTodaySegments(offsetY);
  if (currentView === "PAST_DAYS") return drawPastDay(offsetY);
  return drawToday(offsetY);
}

function drawToday(offsetY = 0) {
  drawLines(getTodayLines(), offsetY);
}

function getTodayLines() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);
  const nav = segs.length > 0 ? `^ ${segs.length} timespans` : "";
  const status = tracker.isTiming()
    ? `${tracker.currentSegment.label} (${formatDuration(tracker.getElapsedCurrentMs() / 1000)})`
    : "SELECT: Start";
  return [
    { text: nav, font: fontSmall, color: blue },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: status, font: fontSmall, color: orange },
    { text: "v History", font: fontSmall, color: gray }
  ];
}

function drawTodaySegments(offsetY = 0) {
  const lines = getTodaySegmentsLines();
  if (!lines) { switchToToday(); return; }
  drawLines(lines, offsetY);
}

// Returns null when there are no segments today (caller falls back to the
// base Today view) rather than drawing directly, so this can also be used
// to build the "incoming" frame for the slide transition.
function getTodaySegmentsLines() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  if (segs.length === 0) return null;
  if (todaySegIdx >= segs.length) todaySegIdx = segs.length - 1;
  if (todaySegIdx < 0) todaySegIdx = 0;
  const seg = segs[todaySegIdx];
  return [
    { text: `${todaySegIdx + 1} of ${segs.length}`, font: fontSmall, color: blue },
    { text: formatDuration(seg.durationMs / 1000), font: fontBig, color: white },
    { text: `Timespan ${todaySegIdx + 1}`, font: fontSmall, color: white },
    { text: `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`, font: fontSmall, color: orange }
  ];
}

function drawPastDay(offsetY = 0) {
  if (pastDayKeys.length === 0) { switchToToday(); return; }
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  drawLines([
    { text: key, font: fontSmall, color: blue },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: `${segs.length} segment${segs.length === 1 ? "" : "s"}`, font: fontSmall, color: orange },
    { text: pastDayIdx === 0 ? "^ Back to Today" : "^ Newer Day", font: fontSmall, color: gray }
  ], offsetY);
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

function slideToSegments() {
  if (bounceTimer || transitionTimer) return;
  const oldLines = getTodayLines();
  currentView = "TODAY_SEGMENTS";
  const segs = tracker.getDaySegments(getDayKey(Date.now()));
  todaySegIdx = segs.length - 1; // start at the most recent segment
  const newLines = getTodaySegmentsLines();
  runSlideTransition(oldLines, newLines, -1);
}

function slideToToday() {
  if (bounceTimer || transitionTimer) return;
  const oldLines = getTodaySegmentsLines();
  currentView = "TODAY";
  const newLines = getTodayLines();
  runSlideTransition(oldLines, newLines, 1);
}

function switchToToday() { currentView = "TODAY"; draw(); }
function switchToPastDays() { currentView = "PAST_DAYS"; pastDayIdx = 0; draw(); }

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

new Button({
  types: ["select", "up", "down", "back"],
  onPush(down, type) {
    if (down) { pressedSinceLaunch[type] = true; return; }
    if (!pressedSinceLaunch[type]) { pressedSinceLaunch[type] = true; return; }
    if (bounceTimer || transitionTimer) return; // ignore input mid-animation
    if (type === "select") {
      if (currentView === "TODAY") handleStartStopTimer();
    } else if (type === "up") {
      if (currentView === "TODAY") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (segs.length > 0) slideToSegments();
      } else if (currentView === "TODAY_SEGMENTS") {
        if (todaySegIdx > 0) { todaySegIdx--; draw(); } else bounceAtEdge(-1);
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx > 0) { pastDayIdx--; draw(); } else switchToToday();
      }
    } else if (type === "down") {
      if (currentView === "TODAY") {
        refreshPastDayKeys();
        if (pastDayKeys.length > 0) switchToPastDays();
      } else if (currentView === "TODAY_SEGMENTS") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (todaySegIdx < segs.length - 1) { todaySegIdx++; draw(); } else slideToToday();
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx < pastDayKeys.length - 1) { pastDayIdx++; draw(); }
      }
    } else if (type === "back") {
      if (currentView === "TODAY_SEGMENTS") slideToToday();
      else if (currentView === "PAST_DAYS") switchToToday();
      else watch.exit();
    }
  }
});

refreshPastDayKeys();
if (tracker.isTiming()) startTimerTick();
draw();
