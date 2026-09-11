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

function drawLines(lines) {
  const visible = lines.filter(l => l.text);
  const totalHeight = visible.reduce((sum, l) => sum + l.font.height, 0)
    + LINE_GAP * Math.max(0, visible.length - 1);
  let y = Math.max(pad, Math.round((render.height - totalHeight) / 2));

  render.begin();
  render.fillRectangle(black, 0, 0, render.width, render.height);
  for (const line of visible) {
    const width = render.getTextWidth(line.text, line.font);
    const x = Math.round((render.width - width) / 2);
    render.drawText(line.text, line.font, line.color, x, y);
    y += line.font.height + LINE_GAP;
  }
  render.end();
}

function draw() {
  if (currentView === "TODAY_SEGMENTS") return drawTodaySegments();
  if (currentView === "PAST_DAYS") return drawPastDay();
  return drawToday();
}

function drawToday() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);
  const nav = segs.length > 0 ? `^ ${segs.length} segs` : "";
  const status = tracker.isTiming()
    ? `${tracker.currentSegment.label} (${formatDuration(tracker.getElapsedCurrentMs() / 1000)})`
    : "SELECT: Start";
  drawLines([
    { text: nav, font: fontSmall, color: blue },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: status, font: fontSmall, color: orange },
    { text: "v History", font: fontSmall, color: gray }
  ]);
}

function drawTodaySegments() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  if (segs.length === 0) { switchToToday(); return; }
  if (todaySegIdx >= segs.length) todaySegIdx = segs.length - 1;
  if (todaySegIdx < 0) todaySegIdx = 0;
  const seg = segs[todaySegIdx];
  drawLines([
    { text: `${todaySegIdx + 1} of ${segs.length}`, font: fontSmall, color: blue },
    { text: formatDuration(seg.durationMs / 1000), font: fontBig, color: white },
    { text: `Timespan ${todaySegIdx + 1}`, font: fontSmall, color: white },
    { text: `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`, font: fontSmall, color: orange }
  ]);
}

function drawPastDay() {
  if (pastDayKeys.length === 0) { switchToToday(); return; }
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  drawLines([
    { text: key, font: fontSmall, color: blue },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white },
    { text: `${segs.length} segment${segs.length === 1 ? "" : "s"}`, font: fontSmall, color: orange },
    { text: pastDayIdx === 0 ? "^ Back to Today" : "^ Newer Day", font: fontSmall, color: gray }
  ]);
}

function switchToToday() { currentView = "TODAY"; draw(); }
function switchToTodaySegments() { currentView = "TODAY_SEGMENTS"; todaySegIdx = 0; draw(); }
function switchToPastDays() { currentView = "PAST_DAYS"; pastDayIdx = 0; draw(); }

function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => { if (currentView === "TODAY") draw(); }, 1000);
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
    if (type === "select") {
      if (currentView === "TODAY") handleStartStopTimer();
    } else if (type === "up") {
      if (currentView === "TODAY") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (segs.length > 0) switchToTodaySegments();
      } else if (currentView === "TODAY_SEGMENTS") {
        if (todaySegIdx > 0) { todaySegIdx--; draw(); }
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx > 0) { pastDayIdx--; draw(); } else switchToToday();
      }
    } else if (type === "down") {
      if (currentView === "TODAY") {
        refreshPastDayKeys();
        if (pastDayKeys.length > 0) switchToPastDays();
      } else if (currentView === "TODAY_SEGMENTS") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (todaySegIdx < segs.length - 1) { todaySegIdx++; draw(); }
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx < pastDayKeys.length - 1) { pastDayIdx++; draw(); }
      }
    } else if (type === "back") {
      if (currentView === "TODAY_SEGMENTS" || currentView === "PAST_DAYS") switchToToday();
      else watch.exit();
    }
  }
});

refreshPastDayKeys();
if (tracker.isTiming()) startTimerTick();
draw();
