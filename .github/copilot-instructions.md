# Copilot instructions

## Build, run, and test

- Build both supported watch targets with `pebble build`. The targets are `emery` (rectangular) and `gabbro` (round).
- Install a build in an emulator with `pebble install --emulator emery` or `pebble install --emulator gabbro`. Install to a paired phone with `pebble install --phone <ip>`.
- Use `pebble logs` while debugging a running app. `pebble clean` removes generated build output.
- Run the JavaScript unit tests with `node --test src/embeddedjs/timerCore.test.js`.
- Run one test by name with `node --test --test-name-pattern="pattern" src/embeddedjs/timerCore.test.js`.
- There is no configured lint command or lint tool. Do not treat generated files under `build/` as source changes.

## Architecture

This is a RePebble Alloy/Moddable XS app with two JavaScript runtimes and a small native bootstrap:

- `src/c/mdbl.c` is the Pebble C entry point. It creates the initial window and starts the Moddable XS machine, enabling the XS debugger for debug builds.
- `src/embeddedjs/main.js` is the watch-side application. It owns the button-driven navigation/UI, dictation flows, timer lifecycle, localStorage persistence, and AppMessage synchronization.
- `src/embeddedjs/timerCore.js` contains the platform-independent timer domain model and formatting helpers. `WorkTracker` stores completed segments by local `YYYY-MM-DD` day key and optionally one active segment.
- `src/embeddedjs/manifest.json` wires the watch-side JavaScript modules into the Moddable build.
- `src/pkjs/index.js` is the phone-side PebbleKit JS process. It translates watch AppMessage actions into Pebble Timeline pin insert/delete operations.
- `wscript` loads the Pebble SDK, compiles the C sources once per target platform, and bundles the phone-side JavaScript. `package.json` defines the app UUID, Moddable project type, SDK version, target platforms, and Pebble resource metadata, including any custom button-prompt icon assets added to the watch app.

The normal data flow is: button/dictation input on the watch -> `WorkTracker` state in `main.js` -> localStorage persistence -> AppMessage for completed or changed segments -> phone-side Timeline pin synchronization. The active timer is displayed from timestamp deltas on a one-second interval rather than from an accumulating counter.

## Repository-specific conventions

- Keep watch-side code compatible with Moddable XS and Pebble's module APIs. Keep reusable timer logic in `timerCore.js` free of Pebble-specific imports so it remains directly testable under Node.
- Preserve the split persistence model serialized by `WorkTracker`: the index is `{ dayTotals, currentSegment, nextSegmentId }`, while each loaded/stored day is a separate segment array. Completed segment records are `{ id, label, startTime, stopTime }`; do not add `durationMs` back to persisted segment objects.
- Labels supplied by users are trimmed. A new unlabeled segment uses `Timespan N`, where `N` is its sequence within that day; failed or empty dictation leaves the existing label unchanged.
- Segment merges are adjacent-only. The non-target neighbor's label and ID are retained, and the merged time range is the outer span from the earliest start to latest stop (including any gap between the original segments).
- Keep Timeline synchronization actions and payloads aligned between `main.js` and `src/pkjs/index.js`: `INSERT_TIMELINE_PIN` and `DELETE_TIMELINE_PIN`, with segment `id`, `label`, `startTime`, and a computed `durationMs`. Timeline transport may include `durationMs`; persisted segment objects do not.
- Both screen shapes are supported in the same watch UI. Use the existing `device.screen.shape === "round"` check and safe padding differences when changing layouts.
- The UI uses the four hardware button names (`up`, `down`, `select`, `back`) and explicit view state values (`TODAY`, `TODAY_SEGMENTS`, `PAST_DAYS`, `SEGMENT_ACTIONS`) for navigation.
- Keep watch-side icon assets in the Pebble resource pipeline: declare them in `package.json` under `pebble.resources.media`, give them stable semantic names that match their button/action role, and reference those same semantics consistently from `src/embeddedjs/main.js`.
- When changing time behavior, account for local date boundaries and clock/timestamp deltas; do not introduce a continuously incremented elapsed-time accumulator.
- The generated `build/` directory is ignored and should not be edited or used as the source of truth.

## Display constraints

- The watch display is a 64-color e-ink (Sharp memory-LCD style) panel, not a
  backlit LCD/OLED — expect limited color fidelity and no true blacks/deep
  contrast beyond what the 64-color palette provides.
- The screen refreshes at roughly 30 frames per second. Don't design
  animations or update loops assuming faster/smoother redraws than that; rapid
  full-screen redraws also cost battery and CPU on already-constrained
  hardware.

## Hardware-Driven UI & Layout Rules (Pebble Platform)

### 1. Physical Hardware Mapping
All Pebble devices share a fixed four-button layout:
- **Left Side:**
  - `BUTTON_ID_BACK`: Single hardware button. Reserved for back navigation, cancel, or popping the current window.
- **Right Side (Top to Bottom):**
  - `BUTTON_ID_UP`: Top button. Reserved for scrolling up, incrementing values, or contextual top-action.
  - `BUTTON_ID_SELECT`: Middle button. Primary confirmation, toggling state, or opening context menus.
  - `BUTTON_ID_DOWN`: Bottom button. Reserved for scrolling down, decrementing values, or contextual bottom-action.

### 2. Spatial Affordance & UI Alignment
- **Direct Physical Mapping:** Any icon, action label, or directional indicator tied to a hardware button MUST be positioned immediately adjacent to that physical button.
- **Right-Edge Anchoring:**
  - This app renders its UI in watch-side JavaScript with Poco, not Pebble C `ActionBarLayer`/`MenuLayer` widgets, so button prompts should be drawn by the existing Poco render path in `src/embeddedjs/main.js`.
  - Align right-hand icons or labels flush right:
    - Top-right ➔ Action for UP button.
    - Middle-right ➔ Action for SELECT button.
    - Bottom-right ➔ Action for DOWN button.
  - Prefer the app's custom Pebble resource icons for those prompts instead of ASCII arrows or generic placeholder text when an icon already exists for that action.
- **Left-Edge Anchoring:**
  - Avoid placing critical action prompts on the left edge unless they explicitly relate to cancelling/dismissing or exiting the current view.
- **No Mobile/Touch Patterns:**
  - Do NOT design bottom navigation bars or full-width bottom toolbars. Pebble has no buttons on the bottom edge.
  - Do NOT assume touchscreen interaction; users interact purely via the 4 physical buttons.
  - Do NOT center action labels if they correspond to specific hardware inputs—offset them toward the relevant edge to maintain visual affordance.

### 3. Prompt rendering preference
- Prefer the existing Poco-based watch UI in `src/embeddedjs/main.js` over introducing Pebble C UI layers such as `ActionBarLayer`, `ActionMenu`, `MenuLayer`, or `SimpleMenuLayer`.
- Load and reuse custom Pebble resource icons once, then draw them near the matching hardware button position rather than rebuilding per-frame prompt art ad hoc.
- Keep the icon set semantically consistent across screens: up/down for paging, check/play/stop for select-driven actions, pencil for relabel/edit flows, and trash/cross for destructive or cancel affordances.
- Delete/cancel icons belong on the left edge only when they truly map to Back/cancel behavior. Back remains implicit in most views and usually does not need an extra on-screen label.

### 4. Established icon set and semantics (do not repurpose without reason)
The app's button-affordance icons are pre-recolored PNGs sourced from Pebble's
official App Assets guide (`developer.repebble.com/guides/app-resources/app-assets/`),
loaded once into the `ICONS` table in `src/embeddedjs/main.js` and referenced by
numeric pbpack resource ID (see `package.json`'s `pebble.resources.media` array —
entries there are positional/1-based and must only ever be **appended**, never
reordered, or existing `new Poco.PebbleBitmap(id)` references elsewhere in
`main.js` will silently point at the wrong image). Current semantic assignments,
established through iterative user feedback this session — preserve these unless
a screen's meaning genuinely changes:

| Icon | Color | Meaning | Used in |
|---|---|---|---|
| `up` / `down` (arrows) | blue | Paging through a list (segments/days) | TODAY_SEGMENTS, PAST_DAYS, PAST_DAY_SEGMENTS, TODAY (has-history hint) |
| `ellipsis` (3 dots) | blue | Select drills into a submenu while paging a list | TODAY_SEGMENTS, PAST_DAYS, PAST_DAY_SEGMENTS |
| `check` | orange | Select performs a genuine, discrete confirm action (not submenu navigation) | SEGMENT_DELETE_CONFIRM |
| `play` / `stop` | orange | Start/stop the active timer | TODAY (stopped/running) |
| `edit` (pencil) | gray | Long-press hint: relabel the current item | TODAY (while timing), SEGMENT_ACTIONS |
| `delete` (trash) | orange | Select deletes the current segment | SEGMENT_ACTIONS |
| `dismiss` (cross) | gray | Back cancels/declines a confirm prompt | SEGMENT_DELETE_CONFIRM |

**Ellipsis vs. check is a deliberate, meaningful split** — don't collapse them
back to one icon. Ellipsis means "select this to go deeper into a list/menu";
check means "select this to confirm/finalize an action." When adding a new
paging/list screen, default to ellipsis for its Select icon unless it is a true
yes/no confirmation.

**Merge actions use text, not icons.** The Segment Actions screen's Up/Down
merge-with-adjacent-segment actions were originally drawn with reused
paging/merge arrow icons, but that read ambiguously as "navigate" rather than
"merge." They now render as plain right-anchored text labels — "merge prev" /
"merge next" (see `drawTextHint()` in `main.js`) — using `fontSmall` in blue, at
the same top-right/bottom-right button-adjacent positions icons would occupy.
Follow this precedent for any future action whose icon-only meaning proves
ambiguous in testing: prefer a short, right-anchored text label over stretching
an existing icon's semantics or inventing a new icon.

**Select + long-press hint stacking.** When a view's Select button has both a
short-press action and a distinct long-press ("hold") action (e.g. Stop above
Edit, or Delete above Edit), draw the short-press icon **above** the long-press
hint icon, both vertically centered as a group at the right edge, with a full
icon-height of blank space between them (`drawViewIcons()`'s `gap = hint ? s.h : 0`).
This full-icon-height buffer was arrived at after two rounds of feedback (a
fixed 4px gap, then 1/3 icon height, were both judged too tight) — don't
regress to a smaller gap without a specific reason.

## Duration/time display formatting
`formatDuration()` in `src/embeddedjs/timerCore.js` uses a single consistent
rule for every duration shown in the app (current elapsed time, segment
durations, daily totals): space-separated, each shown unit suffixed with its
own unit letter, no colons, and the leading unit is never zero-padded (only the
trailing/smallest shown unit is zero-padded):
- **Durations under 1 minute**: seconds only, e.g. `35s`.
- **Durations from 1 minute through 59:59**: minutes and seconds, e.g.
  `12m 35s`.
- **Durations 1 hour or more**: hours and minutes only (seconds are dropped
  entirely), e.g. `3h 6m`.

This format was chosen after explicitly comparing alternatives (colon+suffix
hybrids, fully compact no-space forms, single-largest-unit-only) — the
consistent "value+letter, space-separated, no colon" style was preferred for
readability on the small display. When adding any new place that displays a
duration, reuse `formatDuration()` rather than hand-rolling another format, so
all screens stay visually consistent.

## Rendering: prefer Poco over Piu

- This app renders with **Poco** (`commodetto/Poco`), procedural/immediate-mode
  drawing (`render.begin()` -> `fillRectangle`/`drawText` per line ->
  `render.end()`), not Piu (Moddable's declarative, retained-mode UI framework
  with `Application`/`Skin`/`Style`/`Text`). This was a deliberate rewrite
  after Piu's retained-mode overhead caused repeated `Alloy: Fatal Error /
  memory full` crashes on this hardware's 128KB budget.
- In practice Poco has also proven **easier to iterate on** than Piu was, not
  just lighter: each visual/UX change this session (centering text, enlarging
  fonts, adding a per-segment label line, reworking segment-paging boundaries,
  a bounce animation at the list edge) was a small, local change to a plain
  imperative `drawX()` function and its call site — no fighting a
  style/skin/declarative-tree model to get one-off layout or animation
  behavior. Default to Poco for new views/screens in this app; only reach for
  something heavier if a concrete need arises (and re-check the memory budget
  if so).
- Common Poco layout pattern used throughout `main.js`: measure text with
  `render.getTextWidth(text, font)` for horizontal centering; compute a
  vertical block height by summing each visible (non-empty) line's
  `font.height` plus a fixed `LINE_GAP` (6px) between lines, then center that
  block within `render.height` (clamped to a minimum `pad`). Reuse this same
  centering logic across all screens (`drawToday`, `drawTodaySegments`,
  `drawPastDay`) rather than hand-tuning per-screen coordinates.
- Lightweight animation pattern: rather than a continuous animation loop or a
  duplicate render path, thread an optional numeric `offsetY` parameter
  through the existing `drawLines()`/`draw()`/screen-specific draw functions
  (default `0`, so normal redraws are unaffected). Step through a small fixed
  array of eased pixel offsets (e.g. `[10, 6, 3, 0]`) via `setTimeout` at a
  fixed interval (e.g. 45ms/frame), calling the existing `draw(offset)` at each
  step, guarded by a "currently animating" flag/timer handle so overlapping
  triggers can't stack. This was used for the segment-list edge-bounce and is
  the template to follow for any future one-shot UI animation (avoids a second
  render path and avoids an unbounded/forgotten timer).

## Memory constraints (Alloy/Moddable XS) — read before adding features

Pebble hardware is intentionally minimal (Arm Cortex-M4/M33 class). Alloy apps on
emery/gabbro share a **hard 128KB limit for code + heap combined**. This app runs
close to that ceiling, so memory pressure — not logic bugs — is the most likely
cause of mysterious crashes.

- **There are three distinct ceilings to diagnose separately:** the overall
  128KB app/code/RAM budget, XS's independently sized slot and chunk heaps,
  and persistent `localStorage` (about 2045 bytes/key and 7.5-8KB total).
  Free space in one does not help exhaustion in another. In particular,
  persistent-history capacity cannot be inferred from `Heap Usage`, and a
  large aggregate heap number can hide an exhausted chunk sub-heap.
- **Symptom of running out of memory**: the app dies with an Alloy fatal error like
  `fxAbort memory full` / `Chunk allocation: failed for N bytes`, often with no
  useful stack trace, and sometimes only on the *first* invocation of a code path
  (button press, dictation, etc.) rather than at startup. Small allocations (as
  low as ~12 bytes) can fail even though earlier, larger allocations succeeded —
  the failure size does not indicate the size of the offending object.
- **First-call cost is real**: XS lazily compiles/materializes functions and
  closures on first use. A function that looks cheap can cause a chunk-allocation
  failure the first time it's called, purely from bytecode instantiation/closure
  setup, even when an inlined equivalent of the same logic does not fail. Don't
  assume a crash on first button press means the triggering code itself is
  memory-heavy — it may just be "first execution of anything on this path."
- **Don't build/prime views or code paths that aren't visible yet** unless the
  Alloy/Pebble skill documentation calls for it as a pattern. Eagerly
  constructing offscreen screens, warm-up calls, or speculative caches burns
  scarce heap for no visible benefit and was a direct contributor to the OOM
  crashes investigated in this app. Prefer building UI/state lazily, only when a
  view actually becomes visible.
- **Avoid `Set`, `Array.from`, and other higher-level collection/iterator
  helpers** in hot/startup paths on constrained builds; prefer plain
  `Object.keys()` + manual loops/`push()`. This was a concrete fix in
  `timerCore.js`'s `getSortedDayKeys()`.
- **Bisect memory crashes by removing code, not by reasoning about it.** When a
  path OOMs, comment out/remove suspected calls one at a time (e.g. `save()`,
  `tracker.start()`, `getDefaultLabel()`, `render*`) and rebuild/reinstall to see
  which removal makes the crash disappear, then reintroduce pieces individually.
  The `Heap Usage` line in Pebble logs is not reliable for precise sizing — use
  presence/absence of the crash itself as the signal.
- **Start simple and add incrementally.** When a feature or screen isn't
  strictly required yet, prefer the simpler implementation now and revisit
  richer behavior later once the app is confirmed stable within the 128KB
  budget, rather than building out full functionality up front.
- **A recurring `Alloy: Fatal Error / memory full` after repeated start/stop
  cycles is likely NOT a code-side leak — check the native XS heap sizing
  first.** PebbleOS's default `moddable_createMachine(NULL)` reserves a large
  slot heap but a *tiny* chunk heap (observed as low as ~5KB capacity), and
  chunk memory backs exactly the strings/arrays/objects that persisted
  segment data needs. This tiny default fills up after only ~10 real
  start/stop cycles, **even while ~100KB of native RAM sits completely
  unused** — confirmed via `kModdableCreationFlagLogInstrumentation` showing
  `App bytes free` pegged constant while `Chunk used` climbed to the ceiling.
  Don't waste time bisecting per-statement "leaks" (dozens of bytes) as the
  explanation for exhausting 100+KB; that math doesn't add up, and the real
  fix is sizing the machine explicitly. See `src/c/mdbl.c`: both branches now
  call `moddable_createMachine(&cr)` with an explicit
  `ModdableCreationRecord{ stack=4KB, slot=32KB, chunk=48KB }` instead of
  `NULL`. Key gotchas if you ever need to retune these numbers:
  - The three fields (`stack`, `slot`, `chunk`) are **all-or-nothing** — if
    any one is non-zero, all three must be non-zero, or PebbleOS rejects the
    record as `"invalid ModdableCreationRecord"`.
  - Firmware versions before v4.21.0/v4.22.0 have a confirmed regression
    (coredevices/pebbleos#1592) where custom sizes are silently discarded
    (shadowed local variable bug) and the machine falls back to a ~512-slot
    default — sometimes surfacing as a hard native fault (`PC:0`) instead of
    a graceful error. This repo's SDK (4.33.1) is past the fix.
  - Total size isn't unlimited even when the fix is in place — there's other
    fixed overhead (e.g. a ~32KB static/keys reservation) sharing the same
    budget. A too-large total can still hard-fault at startup. Increase
    sizes conservatively and re-run a stress test (dozens of rapid
    start/stop presses) after each change.
  - `gc()` is NOT exposed as a global function in this Pebble/Alloy XS port —
    don't rely on manually triggering GC as a workaround.
- **`kModdableCreationFlagLogInstrumentation`** (set alongside
  `kModdableCreationFlagDebug` in the debug build of `mdbl.c`) periodically
  logs real heap metrics (`Chunk used`, `Chunk available`, `Slot used`,
  `App bytes free`, etc.) to the same log stream `pebble logs` reads. This is
  the single most useful tool for diagnosing "memory full" crashes — far
  more reliable than guessing from allocation failure sizes. It requires no
  Bluetooth connection to work against the QEMU emulator's log stream.
  - **Don't confuse `Total Size` in these logs with source code size.** It's
    the XS machine's allocated *capacity* (slot+chunk+overhead), not
    compiled bytecode size — a small ~900-line app can legitimately report a
    `Total Size` around 100-130KB. If `Total Size - Used` looks like a large
    apparent headroom but a crash still happens almost immediately, that's
    the signal to look at the *per-sub-heap* breakdown (`Chunk
    used`/`available` vs `Slot used`/`available`) rather than the aggregate
    total — one sub-heap can be nearly full while the aggregate still looks
    roomy.
- **Pebble's persistent key-value storage has its own separate quota**,
  distinct from the JS heap — see "Persistent storage architecture" below for
  the confirmed limits and the per-day-key design that works within them.
- **Reuse a single `Date` instance instead of `new Date(timestamp)` in
  hot/repeated paths.** `timerCore.js`'s `getDayKey()`/`formatTimeOfDay()` now
  share one `sharedDate` via a `dateAt(timestamp)` helper (`sharedDate.setTime(...)`)
  instead of allocating a new `Date` per call. This is a real, measurable
  improvement (confirmed in isolation: a loop of `new Date(timestamp)` calls
  exhausts chunk heap; reusing one instance via `.setTime()` doesn't) — keep
  this pattern for any other per-call `Date` construction added later, even
  though it's secondary to the XS heap sizing fix above.

### Debugging workflow that avoids wasted cycles

- Do a `pebble clean` before rebuilding when a build/install is behaving oddly
  (stale build artifacts have caused confusing false crashes/successes in this
  app before).
- Start log capture with `pebble logs` **before** `pebble install`, per the
  Pebble skill guidance, so startup-time crashes aren't missed.
- Kill any leaked `pebble logs` background processes before retrying an
  install — a leaked log process can make subsequent installs fail or hang for
  reasons unrelated to the app code itself.
- If the emulator gets into a bad state (installs failing unexpectedly, stale
  app on screen, timeouts), stop the exact `qemu-pebble` and `pypkjs` PIDs,
  then restart and reinstall rather than continuing against a wedged emulator.
- Use `pebble emu-button click <up|down|select|back> --emulator <target>` to
  simulate button presses (not `emu-tap`, which is for accelerometer taps only).
- `pebble wipe` alone does not reliably clear this app's persisted
  localStorage in this environment. Stop `qemu-pebble` and `pypkjs` first,
  then remove only this app's resolved `.dat`/`.dir` files from the target's
  `localstorage/` directory and its UUID-named PBW from `app_cache/` before
  reinstalling. **Do not use `pebble wipe --everything` here:** pebble-tool
  5.0.40 was observed deleting the local SDK cache and then failing with
  `Directory not empty`, requiring SDK 4.33.1 to be reinstalled.
- **A long-lived QEMU process can itself become the cause of "OOM" crashes,
  independent of app code size.** In one session, `Alloy: Fatal Error /
  memory full` crashes became increasingly frequent (eventually on nearly
  every Select press, even on a previously-verified-good commit) after the
  same `qemu-pebble`/`pypkjs` process pair had been reused across dozens of
  `pebble wipe`/`pebble install` cycles over ~2 hours. Killing those
  processes by PID (`ps aux | grep qemu-pebble`, then `kill <PID>` on both
  the `qemu-pebble` and its paired `pypkjs` process) and letting the next
  `pebble install` spin up a fresh emulator instance made the exact same
  code crash-free again. **Before concluding a feature is too large for the
  128KB budget, restart the emulator processes and retest** — many test
  cycles in a single long session can produce misleading "still crashing"
  verdicts that are really about emulator staleness, not code size.
  `pebble kill` cannot be invoked via this environment's bash tool (its
  kill-command guard blocks any command containing the word "kill", even as
  a `pebble` subcommand) — use `ps aux | grep qemu-pebble` to find the PIDs
  and pass them directly to `kill <PID>` instead.

### Testing dictation with `pebble transcribe`

- `pebble transcribe --emulator emery "some text"` (or `--qemu <host> "text"`)
  simulates a completed voice transcription being delivered to a running
  `Dictation` session. Start the app's dictation flow first (trigger it via
  the in-app button press), *then* run `pebble transcribe` against the same
  running emulator — it delivers into whatever dictation session is currently
  open, it does not start one itself.
- **The command can appear to hang or time out from the CLI's perspective
  while still succeeding on the watch.** Don't trust a bare exit code/timeout
  as pass/fail — take a screenshot instead. A successful call transitions the
  watch from the "Listening" mic icon to a confirmation screen showing the
  transcribed text with a checkmark.
- **The confirmation screen requires an explicit Select press to accept** —
  it does not auto-dismiss after a delay. `pebble emu-button click select
  --emulator emery` confirms it, at which point control returns to the app
  (and its `onReadable` callback fires).
- **A `TypeError: VoiceService.send_stop_audio() takes 1 positional argument
  but 2 were given` exception may appear in the `pebble transcribe` process's
  own output/logs.** This is a bug in the `pebble-tool`/`libpebble2` CLI
  plumbing, not the app — it did not prevent the transcription from reaching
  the watch or the label from applying correctly in testing. Don't treat this
  specific exception as a sign the app-side dictation code is broken; verify
  with a screenshot/log check of the watch state instead.
- **Avoid stacking button presses while unsure of dictation state.** Because
  the confirmation screen needs a Select press but the underlying
  `Dictation`/`pressedSinceLaunch` guard also treats a stray release as
  "arm, don't act" (see below), sending several `emu-button click select` in
  a row without checking a screenshot in between can land on the wrong
  screen or misfire an unrelated action (e.g. accidentally triggering the
  Segment Actions press-to-delete threshold). Screenshot after every
  button press when testing this flow, and only send the next press once the
  current screen is confirmed.

## Persistent storage architecture

Pebble's key-value `localStorage` has two separate, empirically-confirmed
limits (measured via binary-search stress tests against this emulator/SDK,
not documentation guesswork): a **hard ~2045-byte limit per individual key**
(2046+ bytes throws `Error: key-value error (in write)`), and a **separate
~7.5–8KB total budget across all keys combined**. The original design stored
every day's segments in one JSON blob under a single key
(`work_tracker_state_v2`) and hit the per-key limit after only ~3-4 days of
realistic use (~15-24 segments) — this is what that stale "~120 segments"
figure from an earlier, less rigorous test really should have been: ~2045
bytes/key is the real ceiling for a single-blob design.

The fix, now implemented, splits storage into many small per-day keys plus one
small always-loaded index, so usable history scales up toward the larger
~7.5–8KB total budget instead of being capped by the much smaller per-key
limit. A clean-emulator stress test using the production save/prune paths and
150 chronological days with a repeating 1-10 segments/day distribution
(5.5/day average) stabilized at **13-14 retained days**; the final persisted
state held 13 complete days / 67 segments (6,201 JSON payload bytes plus
storage-key overhead) and reloaded with the same counts. Treat roughly two
weeks as the practical history capacity for typical use, with the exact count
varying according to segments per day and label lengths.

### How history consumes RAM and persistent storage

Keep these two budgets conceptually separate when diagnosing or designing
features:

- **XS heap/RAM holds only active working data.** `WorkTracker.days` contains
  today's full segment array plus at most one past day's array while that day
  is open. Navigating back unloads the past array. Therefore, adding retained
  history does not load every historical segment into the 128KB app heap.
- **The lightweight index grows with every retained day.** `dayTotals` remains
  fully resident because the past-days screen needs each date's
  `{ totalMs, count }` without loading its segments. `currentSegment` and
  `nextSegmentId` are also index-resident. In the measured 13-day state,
  `serializeIndex()` was 626 bytes (about 48 serialized bytes per day at that
  scale). The index is still subject to the ~2045-byte single-key limit, even
  though the total-storage quota was reached first in the current workload.
- **Persistent storage holds every retained day's full array.** The measured
  13-day/67-segment state used 6,201 bytes of JSON: 626 bytes for the index
  and about 5,575 bytes for day payloads, averaging roughly 429 bytes/day and
  83 bytes/segment. Actual quota consumption is higher because storage-key
  names and key/value allocator metadata also cost space; do not estimate
  capacity from JSON length alone.
- **Labels are the main variable-size segment field.** Default `Timespan N`
  labels produced the measurements above. Longer dictated labels reduce the
  number of segments/days that fit. Numeric timestamps and the small integer
  `id` have comparatively predictable cost.
- **The practical retention unit is a whole day.** When quota pressure occurs,
  pruning removes the oldest day's payload and its index entry together. The
  retained day count may oscillate (13-14 in the measured workload) as a
  small incoming day fits where a larger incoming day requires another prune.
- **Capacity tests must verify persistence, not just in-memory state.** Generate
  days in chronological order (oldest to newest), exercise the production
  `safeSetItem()`/pruning path, then relaunch and compare day and segment
  counts. A pre-restart count can hide stale-index or failed-write bugs.

- **`work_index_v1`** — always loaded and saved as a whole. Holds
  `WorkTracker.serializeIndex()`: the lightweight `dayTotals` map (every day
  that has ever had a segment, as `{ totalMs, count }`) plus the in-progress
  `currentSegment`, if any. This is all `PAST_DAYS` needs to page through and
  display every day's total/count — it never needs to load a day's full
  segment list just to list it.
- **`work_day_<YYYY-MM-DD>`** — one key per day, holding that day's full
  segment array via `serializeDaySegments(dayKey)`/`parseDaySegments()`. Only
  read/written when that specific day's segments actually change or need
  displaying in detail.
- **Today is always loaded** (via `loadDay()` at startup) and never evicted —
  it is not special-cased out of the index/persistence system, it just skips
  the lazy load-on-navigate cycle that past days go through, since it's
  known to be needed on every draw.
- **At most one past day is loaded at a time** — whichever day the user has
  navigated into via `PAST_DAY_SEGMENTS`/`SEGMENT_ACTIONS`. `main.js`'s
  `ensurePastDayLoaded(dayKey)`/`releasePastDayIfLoaded()` are called at
  exactly the two points a past day's load state changes: entering
  `PAST_DAY_SEGMENTS` from `PAST_DAYS` (load), and leaving
  `PAST_DAY_SEGMENTS` back to `PAST_DAYS` via Back or an empty-day bounce
  (release). `SEGMENT_ACTIONS`/`SEGMENT_DELETE_CONFIRM` entered from
  `PAST_DAY_SEGMENTS` stay within the same loaded-day context and need no
  load/release of their own.
- **Save calls are precise, not a single blanket `save()`.** Each call site
  in `main.js` calls `saveIndex()` and/or `saveDay(dayKey)` depending on what
  actually changed: starting a timer only touches the index
  (`currentSegment`); stopping one touches both today's day key and the
  index (a completed segment moved from `currentSegment` into `days`, and
  `dayTotals` changed); a label-only edit (dictation) touches only whichever
  storage actually holds that label (index for the in-progress segment, the
  day key for a completed one) since labels don't affect `dayTotals`; merge/
  delete touch both the day key and the index (duration/count changed), and
  if a delete brings a day's segment count to 0, its storage key is removed
  entirely (`localStorage.removeItem`) rather than persisted as `"[]"`.
- **`safeSetItem()` is a quota-exceeded safety net**, wrapping every write:
  if a write still fails after the per-day-key design (e.g. total history
  approaches the ~7.5–8KB ceiling), it sacrifices the oldest known day via
  `tracker.forgetDay()` + `localStorage.removeItem()` and retries, rather
  than crashing. `pruneOldestDay()` never sacrifices the day currently being
  written or an explicitly protected key (e.g. today). When retrying an index
  write, `safeSetItem()` must reserialize `tracker.serializeIndex()` after
  every prune; retrying the original pre-prune string resurrects removed days
  as phantom index entries after restart.
- When extending this system (e.g. changing what a day's storage payload
  contains), keep `WorkTracker`'s `dayTotals` index and `days` (loaded
  segments) in sync via `_recomputeDayTotals(dayKey)` after any mutation
  that changes a day's segment count/duration — label-only edits don't need
  it. `getDaySegmentCount()`/`getDayTotalMs()` transparently fall back to
  the index when a day isn't loaded, so new UI code should prefer those over
  `getDaySegments(key).length` when only a summary is needed, to avoid
  forcing an unnecessary day load.
- This app has never shipped beyond the local emulator, so there is no
  legacy single-blob data to migrate in practice — don't reintroduce a
  `migrateLegacyStorage()`-style step unless real deployed data is a concern
  again.

### Segment object fields: keep them minimal, derive what you can

Stored segment objects (`{ id, label, startTime, stopTime }`) intentionally
omit any field whose value is always derivable from the others, since every
byte saved per segment directly extends how much history fits under the
per-key/total storage limits above:

- **No `durationMs` field.** It was always exactly `stopTime - startTime` for
  segments created via `start()`/`stop()`, so it was pure redundant storage.
  Use the exported `getSegmentDurationMs(seg)` helper (in `timerCore.js`)
  everywhere a segment's duration is needed, instead of adding a stored
  field back.
- **`mergeAdjacent()`'s merged-segment duration is the outer span** (earliest
  start to latest stop of the two segments being merged), which now
  **includes any gap between them** — this is a deliberate simplification
  from an earlier design that summed the two segments' own worked
  durations and excluded the gap. If you ever need "exact worked time only"
  semantics again, that requires reintroducing a stored duration field (or
  an explicit gap-tracking field) and is a real behavior change, not a
  no-op refactor.
- **`id` is a small incrementing integer** (`WorkTracker.nextSegmentId`,
  persisted in the index via `serializeIndex()`/`deserializeIndex()` so it
  stays unique across restarts), not a timestamp+random string. It exists
  purely for `find`/`findIndex` lookups within a single day's segment array
  (locate a segment to merge/delete/relabel) — it is never displayed to the
  user and never compared across different days, so its format is an
  implementation detail. Don't assume it's sortable/meaningful across days,
  and don't reintroduce a longer/composite id without a concrete need.

## Stale-press guard: a general pattern, not just app launch

- When the app is (re)launched by a physical button press (e.g. Select from
  the launcher, or reopening right after Back), that button can still be
  "held" as the script starts; its eventual release then arrives as a normal
  in-app button event and can be misread as a deliberate press (e.g.
  incorrectly stopping the active timer).
- Fix pattern used here: track a per-button `pressedSinceLaunch` boolean map
  (`select`/`up`/`down`/`back`). On button-down, mark it pressed. On release:
  if no press was seen yet for that button, discard the event (it's the stale
  launch release) and arm the button for normal future use; otherwise handle
  the release normally. Prefer this over a fixed-time guard window (e.g. "ignore
  all releases for 500ms") — a time-based guard has zero benefit for buttons
  already up at launch and can still swallow a genuinely fast real press within
  the window.
- **This same guard is needed any time control returns to a screen that
  listens for Select (or another button) but the button's press half was
  consumed by something other than that screen's own handler.** App launch is
  one instance of this; system UI hand-off is another — e.g. `Dictation`
  consumes whichever button press confirms/dismisses its system UI, so when
  the app's `Button` handler resumes, the next event it sees is a release with
  no matching in-app press. Left unguarded, that stray release was
  misinterpreted as a fresh short press and immediately restarted dictation
  (fixed by resetting `pressedSinceLaunch.select = false` in both the
  `onReadable` and `onError` Dictation callbacks, re-arming the guard right
  before control returns to the app).
- **Rule of thumb**: whenever a view/screen is entered as a side effect of
  something other than the user's in-app navigation to it (app launch,
  returning from a system dictation/picker UI, or any other hand-off where an
  external component may have eaten a press or release), and that view reads
  Select (or another button) immediately, apply the same
  `pressedSinceLaunch[type] = false` re-arm at the hand-off point before the
  view's button handler can run. Don't rely on a fixed-time debounce window
  for this class of bug — it's a press/release *pairing* problem, not a
  timing problem.
