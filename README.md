# Pebble Daily Work Tracker

A workday time-tracking application for Pebble OS, written in JavaScript targeting the **RePebble Alloy** runtime (ECMA-419 / Moddable XS). Built with cross-platform support for both rectangular (**Emery**) and round (**Gabbro / Pebble Time Round 2**) displays.

The app functions as a segmented stopwatch tailored for workdays. Time segments are tracked against a cumulative daily total, tagged using native voice dictation or 5-minute time rounding, and synchronized directly to the Pebble Timeline as calendar pins.

---

## Hardware & Runtime Compatibility

| Feature | Emery (Rectangular) | Gabbro (Round 2) |
|---|---|---|
| **Resolution** | 200 × 228 | 180 × 180 (circular mask) |
| **Piu Layout** | Standard 10px outer margins | Safe-boundary centered padding (28px) |
| **Input** | Standard 4-button hardware | Standard 4-button hardware |
| **Voice Input** | Native Dictation API | Native Dictation API |
| **Sync** | AppMessage to PKJS -> Timeline API | AppMessage to PKJS -> Timeline API |

---

## Core Features

- **Daily Running Total:** Continuous tally of all segments logged during the calendar day.
- **Voice Dictation Segment Tagging:** Dictation launches immediately when starting a timer to capture tasks, tickets, or client billing codes.
- **5-Minute Fallback Rounding:** If dictation is dismissed or encounters an error, the segment label automatically defaults to the start time rounded to the nearest 5-minute interval (e.g., `9:25 AM`).
- **Segment Management:**
  - Page chronologically through segments recorded today.
  - Dictate a new label to rename any segment after the fact.
  - Merge adjacent segments (retaining the adjoining segment's label).
- **Timeline Pin Synchronization:** Segments push through the companion phone layer (`pkjs`) to insert, update, or prune native Pebble Timeline pins.
- **Low-Power Engine:** No sub-second polling loops or drift-prone accumulators. Uses delta timestamp checks (`Date.now() - startTime`) on a 1-second interval while active, completely sleeping when stopped.

---

## Navigation Model

The root dashboard always opens on **Today**:
