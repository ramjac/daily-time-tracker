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
