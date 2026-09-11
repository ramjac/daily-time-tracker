# daily-time-tracker

A workday time-tracking app for Pebble, written in embedded JavaScript
targeting the **RePebble Alloy** runtime (Moddable XS), with a small C
bootstrap. It works like a labeled stopwatch: start/stop a timer to record
"segments" of your day, optionally label them by voice dictation, page back
through today's segments or past days, and sync segments to the phone's
Pebble Timeline as calendar pins.

Built with cross-platform support for both rectangular (**Emery** / Pebble
Time 2) and round (**Gabbro** / Pebble Time Round 2) displays.

---

## Building & running

```sh
pebble build                          # build for all targetPlatforms
pebble install --emulator emery       # install on the emery emulator (rectangular)
pebble install --emulator gabbro      # install on the gabbro emulator (round)
pebble install --phone <ip>           # install to a paired phone
```

## Target platforms

Alloy targets the modern Pebble hardware: **emery** (Pebble Time 2) and
**gabbro** (Pebble Round 2). Other platforms are currently not supported.

## Project layout

```
src/c/mdbl.c                   C glue that boots the Moddable XS machine
src/embeddedjs/main.js         Watch-side app: navigation, drawing, dictation, persistence
src/embeddedjs/timerCore.js    Platform-independent timer/segment domain model (unit tested)
src/embeddedjs/manifest.json   Moddable manifest (wires JS modules into the build)
src/pkjs/index.js              PebbleKit JS (phone-side): Timeline pin sync
package.json                   Project metadata (UUID, platforms, message keys, resources)
wscript                        Build rules — usually no need to edit
```

## Testing

Unit tests cover the platform-independent domain model in `timerCore.js`
(segment start/stop, merging, day-key/label formatting, DST edge cases):

```sh
node --test src/embeddedjs/timerCore.test.js
node --test --test-name-pattern="pattern" src/embeddedjs/timerCore.test.js  # run one test by name
```

There is no automated test for the on-watch UI/navigation code in
`main.js` — verify those changes manually in the emulator (see below).

---

## Manually testing in the emulator

This app is heavily button- and voice-driven, so most changes need a manual
pass in the QEMU emulator rather than (or in addition to) the unit tests.

### Basic install/log loop

Start log capture **before** installing, so startup-time output/crashes
aren't missed:

```sh
pebble logs --emulator emery > pebble-logs.txt 2>&1 &
pebble install --emulator emery
```

Kill that background `pebble logs` process (find it with
`ps aux | grep "pebble logs"` and `kill <PID>`) when you're done, rather than
leaving it running — a leaked log process can make later installs hang or
write into a stale file.

If the emulator gets into a bad state (stale app on screen, installs timing
out, an old crash dialog on screen), reset it before continuing to debug:

```sh
pebble kill && pebble wipe
pebble install --emulator emery
```

### Simulating button presses

```sh
pebble emu-button click select --emulator emery
pebble emu-button click up --emulator emery
pebble emu-button click down --emulator emery
pebble emu-button click back --emulator emery

# Hold a button for a duration (ms) - use this to trigger the app's
# long-press actions (dictation), which fire at 600ms:
pebble emu-button click select --duration 700 --emulator emery
```

Do **not** use `pebble emu-tap` for this app — that simulates an
accelerometer tap, not a button press, and this app has no tap gestures.

### Taking screenshots

Screenshots are the most reliable way to confirm what state the app landed
in — log output alone often isn't enough for UI/navigation bugs:

```sh
pebble screenshot --no-open --emulator emery /tmp/ss.png
```
Then view the PNG with an image viewer/editor tool. `pebble screenshot`
does not create output directories itself — make sure the target directory
already exists.

### Simulating voice dictation

Dictation is triggered by a **long press (600ms) of Select**: from the
**Today** view while a timer is running (labels the currently-running
segment), or from the **Segment Actions** menu for any already-recorded
segment (today's segments or a past day's segments). A short press of
Select never triggers dictation in this app — it's reserved for
start/stop/confirm actions.

1. Trigger dictation in-app first (e.g.
   `pebble emu-button click select --duration 700 --emulator emery` while a
   timer is running), *then* deliver the transcribed text:
   ```sh
   pebble transcribe --emulator emery "Client meeting"
   ```
   `pebble transcribe` delivers into whichever dictation session is
   currently open on the watch — it does not start one itself.
2. The watch moves from the "Listening" mic screen to a confirmation
   screen showing the transcribed text. Confirm it with:
   ```sh
   pebble emu-button click select --emulator emery
   ```
   The confirmation screen does not auto-dismiss; a Select press is
   required.
3. Take a screenshot after each step above rather than trusting the CLI's
   exit code/timing — `pebble transcribe` can appear to hang or print an
   unrelated `VoiceService.send_stop_audio()` `TypeError` in its own output
   while still succeeding on the watch. A screenshot is the ground truth.

### Navigating the app

From the **Today** view (the app's home screen, showing the running/stopped
timer):
- **Select** (short press): start or stop the timer.
- **Select** (long press, 600ms): label the currently-running segment by
  dictation (only available while timing).
- **Up**: go to today's recorded segments (only if at least one exists;
  otherwise a bounce animation plays and nothing navigates).
- **Down**: go to past days' history (only if any past day has segments;
  otherwise bounces).
- **Back**: exit the app.

From a segments list (today's segments, or a past day's segments):
- **Up/Down**: page through segments chronologically; paging past either
  end returns to the parent view (Today or Past Days) with a slide
  transition, or bounces at a real list boundary.
- **Select** (short press): open the **Segment Actions** menu for the
  currently shown segment.
- **Back**: return to the parent view.

From the **Segment Actions** menu:
- **Up/Down**: cycle between available actions (merge/delete/etc.).
- **Select** (short press): confirm the highlighted action — for delete,
  this opens a **delete confirmation** submenu (Back to cancel, Select to
  confirm) rather than deleting immediately.
- **Select** (long press): dictate a new label for this segment.
- **Back**: return to the segments list this menu was opened from.

## Documentation

Full SDK docs and tutorials: <https://developer.repebble.com>

Debugging notes specific to this app (memory-budget pitfalls, the
stale-button-press guard pattern, dictation-testing quirks, etc.) live in
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).
