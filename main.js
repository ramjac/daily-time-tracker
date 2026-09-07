import { WorkTracker, formatDuration, formatTimeOfDay, getDayKey } from "timerCore";
import device from "pebble/device";
import Buttons from "pebble/buttons";
import Dictation from "pebble/dictation";
import appMessage from "pebble/app_message";

const STORAGE_KEY = "work_tracker_state_v2";
const tracker = WorkTracker.deserialize(localStorage.getItem(STORAGE_KEY));

let timerInterval = null;

// Views: "TODAY" | "TODAY_SEGMENTS" | "PAST_DAYS" | "SEGMENT_ACTIONS"
let currentView = "TODAY";

// Navigation pointers
let pastDayKeys = []; // Chronological list of completed past days
let pastDayIdx = 0;   // 0 is the most recent past day (yesterday)
let todaySegIdx = 0;  // 0 is the most recent segment recorded today
let actionMenuIdx = 0;

const isRound = device.screen.shape === "round";
const pad = isRound ? 28 : 10;

function save() {
  localStorage.setItem(STORAGE_KEY, tracker.serialize());
}

function refreshPastDayKeys() {
  const todayKey = getDayKey(Date.now());
  pastDayKeys = tracker.getSortedDayKeys()
    .filter(k => k !== todayKey)
    .reverse(); // Index 0 is most recent past day
}

// -------------------------------------------------------------
// Declarative UI Layouts (Alloy / Piu)
// -------------------------------------------------------------
const TodayViewSpec = {
  type: "Container",
  top: 0, bottom: 0, left: 0, right: 0,
  style: { backgroundColor: "#000000" },
  contents: [
    {
      type: "Column",
      top: pad, bottom: pad, left: pad, right: pad,
      contents: [
        { id: "upIndicator", type: "Text", string: "▲ Segments", style: { color: "#55FF55", font: "12px Pebble", horizontalAlignment: "center" } },
        { id: "todayTotal", type: "Text", string: "00:00", style: { color: "#FFFFFF", font: isRound ? "28px Pebble Bold" : "32px Pebble Bold", horizontalAlignment: "center" } },
        { id: "activeLabel", type: "Text", string: "IDLE", style: { color: "#FFAA00", font: "14px Pebble", horizontalAlignment: "center" } },
        { id: "activeElapsed", type: "Text", string: "", style: { color: "#00FFAA", font: "14px Pebble Bold", horizontalAlignment: "center" } },
        { id: "downIndicator", type: "Text", string: "▼ History", style: { color: "#55AAFF", font: "12px Pebble", horizontalAlignment: "center" } }
      ]
    }
  ]
};

const SegmentDetailSpec = {
  type: "Container",
  top: 0, bottom: 0, left: 0, right: 0,
  style: { backgroundColor: "#000000" },
  contents: [
    {
      type: "Column",
      top: pad, bottom: pad, left: pad, right: pad,
      contents: [
        { id: "segIndex", type: "Text", string: "", style: { color: "#888888", font: "12px Pebble", horizontalAlignment: "center" } },
        { id: "segLabel", type: "Text", string: "", style: { color: "#FFAA00", font: "16px Pebble Bold", horizontalAlignment: "center" } },
        { id: "segDuration", type: "Text", string: "", style: { color: "#FFFFFF", font: "22px Pebble Bold", horizontalAlignment: "center" } },
        { id: "segRange", type: "Text", string: "", style: { color: "#AAAAAA", font: "12px Pebble", horizontalAlignment: "center" } },
        { id: "segHint", type: "Text", string: "Select: Edit", style: { color: "#55FF55", font: "10px Pebble", horizontalAlignment: "center" } }
      ]
    }
  ]
};

const PastDaySpec = {
  type: "Container",
  top: 0, bottom: 0, left: 0, right: 0,
  style: { backgroundColor: "#000000" },
  contents: [
    {
      type: "Column",
      top: pad, bottom: pad, left: pad, right: pad,
      contents: [
        { id: "dayDate", type: "Text", string: "", style: { color: "#55AAFF", font: "14px Pebble Bold", horizontalAlignment: "center" } },
        { id: "dayTotal", type: "Text", string: "00:00", style: { color: "#FFFFFF", font: isRound ? "26px Pebble Bold" : "30px Pebble Bold", horizontalAlignment: "center" } },
        { id: "daySegCount", type: "Text", string: "", style: { color: "#AAAAAA", font: "12px Pebble", horizontalAlignment: "center" } },
        { id: "dayNavHint", type: "Text", string: "▲ Back to Today", style: { color: "#888888", font: "10px Pebble", horizontalAlignment: "center" } }
      ]
    }
  ]
};

const ActionMenuSpec = {
  type: "Container",
  top: 0, bottom: 0, left: 0, right: 0,
  style: { backgroundColor: "#111111" },
  contents: [
    {
      type: "Column",
      top: pad, bottom: pad, left: pad, right: pad,
      contents: [
        { id: "menuTitle", type: "Text", string: "MODIFY SEGMENT", style: { color: "#FFAA00", font: "12px Pebble Bold", horizontalAlignment: "center" } },
        { id: "opt0", type: "Text", string: "1. Rename", style: { color: "#FFFFFF", font: "14px Pebble" } },
        { id: "opt1", type: "Text", string: "2. Merge Earlier", style: { color: "#888888", font: "14px Pebble" } },
        { id: "opt2", type: "Text", string: "3. Merge Later", style: { color: "#888888", font: "14px Pebble" } }
      ]
    }
  ]
};

let rootUI = $ui.render(TodayViewSpec);

// -------------------------------------------------------------
// Render Routines
// -------------------------------------------------------------
function renderToday() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const totalMs = tracker.getDayTotalMs(todayKey);

  rootUI.todayTotal.string = formatDuration(totalMs / 1000);
  rootUI.upIndicator.string = segs.length > 0 ? `▲ ${segs.length} Segments` : "▲ (No Segments)";

  if (tracker.isTiming()) {
    const elapsedSec = tracker.getElapsedCurrentMs() / 1000;
    rootUI.activeLabel.string = tracker.currentSegment.label;
    rootUI.activeElapsed.string = `Timing: ${formatDuration(elapsedSec)}`;
    rootUI.activeElapsed.style.color = "#00FFAA";
  } else {
    rootUI.activeLabel.string = "SELECT: Start Timer";
    rootUI.activeElapsed.string = "";
  }
}

function renderTodaySegments() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);

  if (segs.length === 0) {
    switchToToday();
    return;
  }

  // Bound index
  if (todaySegIdx >= segs.length) todaySegIdx = segs.length - 1;
  if (todaySegIdx < 0) todaySegIdx = 0;

  const seg = segs[todaySegIdx];
  rootUI.segIndex.string = `TODAY: ${todaySegIdx + 1} of ${segs.length}`;
  rootUI.segLabel.string = seg.label;
  rootUI.segDuration.string = formatDuration(seg.durationMs / 1000);
  rootUI.segRange.string = `${formatTimeOfDay(seg.startTime)} - ${formatTimeOfDay(seg.stopTime)}`;
}

function renderPastDay() {
  if (pastDayKeys.length === 0) {
    switchToToday();
    return;
  }

  const key = pastDayKeys[pastDayIdx];
  const segs = tracker.getDaySegments(key);
  const totalMs = tracker.getDayTotalMs(key);

  rootUI.dayDate.string = key;
  rootUI.dayTotal.string = formatDuration(totalMs / 1000);
  rootUI.daySegCount.string = `${segs.length} segment${segs.length === 1 ? "" : "s"} logged`;
  rootUI.dayNavHint.string = pastDayIdx === 0 ? "▲ Back to Today" : "▲ Newer Day";
}

function renderActionMenu() {
  const options = ["1. Rename (Voice)", "2. Merge Earlier", "3. Merge Later"];
  [rootUI.opt0, rootUI.opt1, rootUI.opt2].forEach((el, idx) => {
    if (idx === actionMenuIdx) {
      el.string = `> ${options[idx]}`;
      el.style.color = "#FFCC00";
    } else {
      el.string = `  ${options[idx]}`;
      el.style.color = "#888888";
    }
  });
}

// -------------------------------------------------------------
// Transitions
// -------------------------------------------------------------
function switchToToday() {
  currentView = "TODAY";
  rootUI = $ui.render(TodayViewSpec);
  renderToday();
}

function switchToTodaySegments() {
  currentView = "TODAY_SEGMENTS";
  todaySegIdx = 0;
  rootUI = $ui.render(SegmentDetailSpec);
  renderTodaySegments();
}

function switchToPastDays() {
  currentView = "PAST_DAYS";
  pastDayIdx = 0;
  rootUI = $ui.render(PastDaySpec);
  renderPastDay();
}

function switchToActionMenu() {
  currentView = "SEGMENT_ACTIONS";
  actionMenuIdx = 0;
  rootUI = $ui.render(ActionMenuSpec);
  renderActionMenu();
}

// -------------------------------------------------------------
// Engine Loop & Actions
// -------------------------------------------------------------
function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentView === "TODAY") renderToday();
  }, 1000);
}

function stopTimerTick() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function syncPin(seg, action = "INSERT") {
  appMessage.send({
    action: action === "DELETE" ? "DELETE_TIMELINE_PIN" : "INSERT_TIMELINE_PIN",
    id: seg.id,
    label: seg.label,
    startTime: seg.startTime,
    durationMs: seg.durationMs
  });
}

function handleStartStopTimer() {
  if (tracker.isTiming()) {
    const completed = tracker.stop();
    stopTimerTick();
    save();
    renderToday();
    if (completed) syncPin(completed, "INSERT");
  } else {
    Dictation.start({
      confirmationDialog: false,
      onResult: (res) => {
        tracker.start(res?.text);
        startTimerTick();
        save();
        renderToday();
      },
      onError: () => {
        tracker.start(null);
        startTimerTick();
        save();
        renderToday();
      }
    });
  }
}

function handleExecuteAction() {
  const todayKey = getDayKey(Date.now());
  const segs = tracker.getDaySegments(todayKey);
  const targetSeg = segs[todaySegIdx];

  if (actionMenuIdx === 0) {
    // Rename
    Dictation.start({
      confirmationDialog: false,
      onResult: (res) => {
        if (res?.text) {
          const updated = tracker.renameSegment(todayKey, targetSeg.id, res.text);
          save();
          if (updated) syncPin(updated, "INSERT");
        }
        switchToTodaySegments();
      },
      onError: () => switchToTodaySegments()
    });
  } else if (actionMenuIdx === 1) {
    // Merge Earlier (index - 1)
    const merged = tracker.mergeAdjacent(todayKey, targetSeg.id, -1);
    if (merged) {
      save();
      syncPin(targetSeg, "DELETE");
      syncPin(merged, "INSERT");
      todaySegIdx = Math.max(0, todaySegIdx - 1);
    }
    switchToTodaySegments();
  } else if (actionMenuIdx === 2) {
    // Merge Later (index + 1)
    const merged = tracker.mergeAdjacent(todayKey, targetSeg.id, 1);
    if (merged) {
      save();
      syncPin(targetSeg, "DELETE");
      syncPin(merged, "INSERT");
    }
    switchToTodaySegments();
  }
}

// -------------------------------------------------------------
// Button Bindings
// -------------------------------------------------------------
Buttons.on("select", "short", () => {
  if (currentView === "TODAY") {
    handleStartStopTimer();
  } else if (currentView === "TODAY_SEGMENTS") {
    switchToActionMenu();
  } else if (currentView === "SEGMENT_ACTIONS") {
    handleExecuteAction();
  }
});

Buttons.on("up", "short", () => {
  if (currentView === "TODAY") {
    const todayKey = getDayKey(Date.now());
    const segs = tracker.getDaySegments(todayKey);
    if (segs.length > 0) {
      switchToTodaySegments();
    }
  } else if (currentView === "TODAY_SEGMENTS") {
    if (todaySegIdx > 0) {
      todaySegIdx--;
      renderTodaySegments();
    }
  } else if (currentView === "PAST_DAYS") {
    if (pastDayIdx > 0) {
      pastDayIdx--;
      renderPastDay();
    } else {
      // Reached top of past days -> return to Today
      switchToToday();
    }
  } else if (currentView === "SEGMENT_ACTIONS") {
    actionMenuIdx = (actionMenuIdx - 1 + 3) % 3;
    renderActionMenu();
  }
});

Buttons.on("down", "short", () => {
  if (currentView === "TODAY") {
    refreshPastDayKeys();
    if (pastDayKeys.length > 0) {
      switchToPastDays();
    }
  } else if (currentView === "TODAY_SEGMENTS") {
    const segs = tracker.getDaySegments(getDayKey(Date.now()));
    if (todaySegIdx < segs.length - 1) {
      todaySegIdx++;
      renderTodaySegments();
    }
  } else if (currentView === "PAST_DAYS") {
    if (pastDayIdx < pastDayKeys.length - 1) {
      pastDayIdx++;
      renderPastDay();
    }
  } else if (currentView === "SEGMENT_ACTIONS") {
    actionMenuIdx = (actionMenuIdx + 1) % 3;
    renderActionMenu();
  }
});

Buttons.on("back", "short", () => {
  if (currentView === "SEGMENT_ACTIONS") {
    switchToTodaySegments();
  } else if (currentView === "TODAY_SEGMENTS" || currentView === "PAST_DAYS") {
    switchToToday();
  }
  // Standard OS exit handles pressing BACK from TODAY
});

// Init
refreshPastDayKeys();
if (tracker.isTiming()) {
  startTimerTick();
}
renderToday();
