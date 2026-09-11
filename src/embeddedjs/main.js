import {} from "piu/MC";
import Button from "pebble/button";
import { WorkTracker, formatDuration, formatTimeOfDay, getDayKey, getDefaultLabel } from "timerCore";

const STORAGE_KEY = "work_tracker_state_v2";
const tracker = WorkTracker.deserialize(localStorage.getItem(STORAGE_KEY));
function save() { localStorage.setItem(STORAGE_KEY, tracker.serialize()); }

const isRound = screen.round;
const pad = isRound ? 28 : 10;
const screenSkin = new Skin({ fill: "black" });
const styleHint = new Style({ font: "14px Gothic", color: "#888888" });
const styleBig = new Style({ font: "bold 28px Gothic", color: "#FFFFFF" });
const styleAccent = new Style({ font: "14px Gothic", color: "#FFAA00" });
const styleNav = new Style({ font: "14px Gothic", color: "#55AAFF" });

const line0 = new Text(null, { top: pad, height: 20, left: 0, right: 0, string: "", style: styleNav });
const line1 = new Text(null, { top: pad + 24, height: 36, left: 0, right: 0, string: "", style: styleBig });
const line2 = new Text(null, { top: pad + 64, height: 20, left: 0, right: 0, string: "", style: styleAccent });
const line3 = new Text(null, { bottom: pad, height: 20, left: 0, right: 0, string: "", style: styleHint });

const application = new Application(null, {
  skin: screenSkin,
  contents: [ line0, line1, line2, line3 ]
});

let timerInterval = null;
let currentView = "TODAY";
let pastDayKeys = [];
let pastDayIdx = 0;
let todaySegIdx = 0;

function refreshPastDayKeys() {
  const todayKey = getDayKey(Date.now());
  pastDayKeys = tracker.getSortedDayKeys().filter(k => k !== todayKey).reverse();
}

function renderToday() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);
  line0.style = styleNav;
  line0.string = segs.length > 0 ? `^ ${segs.length} segs` : "";
  line1.style = styleBig;
  line1.string = formatDuration(totalMs / 1000);
  line2.string = tracker.isTiming()
    ? `${tracker.currentSegment.label} (${formatDuration(tracker.getElapsedCurrentMs() / 1000)})`
    : "SELECT: Start";
  line3.string = "v History";
}

function renderTodaySegments() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  if (segs.length === 0) { switchToToday(); return; }
  if (todaySegIdx >= segs.length) todaySegIdx = segs.length - 1;
  if (todaySegIdx < 0) todaySegIdx = 0;
  const seg = segs[todaySegIdx];
  line0.style = styleNav;
  line0.string = `${todaySegIdx + 1} of ${segs.length}: ${seg.label}`;
  line1.style = styleBig;
  line1.string = formatDuration(seg.durationMs / 1000);
  line2.string = `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`;
  line3.string = "";
}

function renderPastDay() {
  if (pastDayKeys.length === 0) { switchToToday(); return; }
  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);
  line0.style = styleNav;
  line0.string = key;
  line1.style = styleBig;
  line1.string = formatDuration(totalMs / 1000);
  line2.string = `${segs.length} segment${segs.length === 1 ? "" : "s"}`;
  line3.string = pastDayIdx === 0 ? "^ Back to Today" : "^ Newer Day";
}

function switchToToday() { currentView = "TODAY"; renderToday(); }
function switchToTodaySegments() { currentView = "TODAY_SEGMENTS"; todaySegIdx = 0; renderTodaySegments(); }
function switchToPastDays() { currentView = "PAST_DAYS"; pastDayIdx = 0; renderPastDay(); }

function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => { if (currentView === "TODAY") renderToday(); }, 1000);
}
function stopTimerTick() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function handleStartStopTimer() {
  if (tracker.isTiming()) {
    tracker.stop();
    stopTimerTick();
    save();
    renderToday();
  } else {
    tracker.start(getDefaultLabel());
    startTimerTick();
    save();
    renderToday();
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
        if (todaySegIdx > 0) { todaySegIdx--; renderTodaySegments(); }
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx > 0) { pastDayIdx--; renderPastDay(); } else switchToToday();
      }
    } else if (type === "down") {
      if (currentView === "TODAY") {
        refreshPastDayKeys();
        if (pastDayKeys.length > 0) switchToPastDays();
      } else if (currentView === "TODAY_SEGMENTS") {
        const segs = tracker.getDaySegments(getDayKey(Date.now()));
        if (todaySegIdx < segs.length - 1) { todaySegIdx++; renderTodaySegments(); }
      } else if (currentView === "PAST_DAYS") {
        if (pastDayIdx < pastDayKeys.length - 1) { pastDayIdx++; renderPastDay(); }
      }
    } else if (type === "back") {
      if (currentView === "TODAY_SEGMENTS" || currentView === "PAST_DAYS") switchToToday();
      else watch.exit();
    }
  }
});

refreshPastDayKeys();
getDefaultLabel(); // prime: force one-time bytecode materialization now, not under tighter runtime pressure later
Math.random().toString(36); // prime
save(); // prime localStorage.setItem path
// Prime tracker.start()/stop() (their first-ever call has a large one-time
// materialization cost that can exceed available memory later); then undo
// the dummy segment so no fake data is recorded.
if (!tracker.isTiming()) {
  const wasEmpty = tracker.days[getDayKey(Date.now())] === undefined;
  tracker.start("__warm__");
  renderToday(); // prime the isTiming()-branch string template path too
  startTimerTick();
  stopTimerTick();
  tracker.stop();
  const wk = getDayKey(Date.now());
  if (tracker.days[wk] && tracker.days[wk].length) {
    tracker.days[wk].pop();
    if (wasEmpty && tracker.days[wk].length === 0) delete tracker.days[wk];
  }
}
if (tracker.isTiming()) startTimerTick();
switchToToday();

export default application;
