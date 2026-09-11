import Poco from "commodetto/Poco";
import Button from "pebble/button";
import { WorkTracker, formatDuration, formatTimeOfDay, getDayKey, getDefaultLabel } from "timerCore";

const STORAGE_KEY = "work_tracker_state_v2";
const tracker = WorkTracker.deserialize(localStorage.getItem(STORAGE_KEY));
function save() { localStorage.setItem(STORAGE_KEY, tracker.serialize()); }

const render = new Poco(screen);
const pad = screen.round ? 28 : 10;

// Fonts & colors are created once and reused across every redraw.
const fontBig = new render.Font("Gothic-Bold", 28);
const fontSmall = new render.Font("Gothic-Regular", 14);
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

function refreshPastDayKeys() {
  const todayKey = getDayKey(Date.now());
  pastDayKeys = tracker.getSortedDayKeys().filter(k => k !== todayKey).reverse();
}

function drawLines(lines) {
  render.begin();
  render.fillRectangle(black, 0, 0, render.width, render.height);
  let y = pad;
  for (const line of lines) {
    if (line.text) render.drawText(line.text, line.font, line.color, pad, y);
    y += line.height;
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
    { text: nav, font: fontSmall, color: blue, height: 20 },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white, height: 36 },
    { text: status, font: fontSmall, color: orange, height: 20 },
    { text: "v History", font: fontSmall, color: gray, height: 20 }
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
    { text: `${todaySegIdx + 1} of ${segs.length}: ${seg.label}`, font: fontSmall, color: blue, height: 20 },
    { text: formatDuration(seg.durationMs / 1000), font: fontBig, color: white, height: 36 },
    { text: `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`, font: fontSmall, color: orange, height: 20 },
    { text: "", font: fontSmall, color: gray, height: 20 }
  ]);
}

function drawPastDay() {
  if (pastDayKeys.length === 0) { switchToToday(); return; }
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  drawLines([
    { text: key, font: fontSmall, color: blue, height: 20 },
    { text: formatDuration(totalMs / 1000), font: fontBig, color: white, height: 36 },
    { text: `${segs.length} segment${segs.length === 1 ? "" : "s"}`, font: fontSmall, color: orange, height: 20 },
    { text: pastDayIdx === 0 ? "^ Back to Today" : "^ Newer Day", font: fontSmall, color: gray, height: 20 }
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
    if (down) return;
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
