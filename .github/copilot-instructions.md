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
