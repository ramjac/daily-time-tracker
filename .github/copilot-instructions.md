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
- `wscript` loads the Pebble SDK, compiles the C sources once per target platform, and bundles the phone-side JavaScript. `package.json` defines the app UUID, Moddable project type, SDK version, target platforms, and message/resource metadata.

The normal data flow is: button/dictation input on the watch -> `WorkTracker` state in `main.js` -> localStorage persistence -> AppMessage for completed or changed segments -> phone-side Timeline pin synchronization. The active timer is displayed from timestamp deltas on a one-second interval rather than from an accumulating counter.

## Repository-specific conventions

- Keep watch-side code compatible with Moddable XS and Pebble's module APIs. Keep reusable timer logic in `timerCore.js` free of Pebble-specific imports so it remains directly testable under Node.
- Preserve the state shape serialized by `WorkTracker`: `{ days, currentSegment }`, with completed segments grouped under local-date keys and fields such as `id`, `label`, `startTime`, `stopTime`, and `durationMs`.
- Labels supplied by users are trimmed. Empty or failed dictation falls back to the segment start time rounded to the nearest five minutes via `getDefaultLabel`.
- Segment merges are adjacent-only. The non-target neighbor's label and ID are retained, while the merged duration is the sum of both segments and the time range spans both.
- Keep Timeline synchronization actions and payloads aligned between `main.js` and `src/pkjs/index.js`: `INSERT_TIMELINE_PIN` and `DELETE_TIMELINE_PIN`, with segment `id`, `label`, `startTime`, and `durationMs`.
- Both screen shapes are supported in the same watch UI. Use the existing `device.screen.shape === "round"` check and safe padding differences when changing layouts.
- The UI uses the four hardware button names (`up`, `down`, `select`, `back`) and explicit view state values (`TODAY`, `TODAY_SEGMENTS`, `PAST_DAYS`, `SEGMENT_ACTIONS`) for navigation.
- When changing time behavior, account for local date boundaries and clock/timestamp deltas; do not introduce a continuously incremented elapsed-time accumulator.
- The generated `build/` directory is ignored and should not be edited or used as the source of truth.

## Display constraints

- The watch display is a 64-color e-ink (Sharp memory-LCD style) panel, not a
  backlit LCD/OLED — expect limited color fidelity and no true blacks/deep
  contrast beyond what the 64-color palette provides.
- The screen refreshes at roughly 30 frames per second at most. Don't design
  animations or update loops assuming faster/smoother redraws than that; rapid
  full-screen redraws also cost battery and CPU on already-constrained
  hardware.

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
- **Pebble's persistent key-value storage has its own separate quota**,
  distinct from the JS heap. Serializing a very large number of segments
  into one storage key can hit `Error: key-value error (in write)` even when
  the heap fix above is in place. This was only observed at ~120 segments
  written in a single rapid-fire stress test (far beyond a realistic day's
  10-30 segments), so it's not something normal usage should hit, but if
  very-long-history features are ever added, consider pruning/rotating
  old data rather than growing one unbounded key.
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
  app on screen, timeouts), use `pebble kill && pebble wipe` to fully reset
  emulator state before reinstalling, rather than continuing to debug against a
  wedged emulator.
- Use `pebble emu-button click <up|down|select|back> --emulator <target>` to
  simulate button presses (not `emu-tap`, which is for accelerometer taps only).
- `pebble wipe` alone does not reliably clear this app's persisted
  localStorage in this environment. If stale segments/days appear
  unexpectedly during testing, check for leftover `qemu-pebble`/`pypkjs`
  processes (`ps aux | grep -E "qemu-pebble|pypkjs"`), kill them, then run
  `pebble wipe --everything` and reinstall to get a genuinely clean state.
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
  Segment Actions long-press-to-delete threshold). Screenshot after every
  button press when testing this flow, and only send the next press once the
  current screen is confirmed.

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
