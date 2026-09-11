#include <pebble.h>

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

#ifdef PBL_DEBUG
  // Built with `pebble build --debug`: enable the xsbug JavaScript debugger,
  // plus the same enlarged heap sizing used in release builds below.
  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = 4 * 1024,
    .slot = 32 * 1024,
    .chunk = 48 * 1024,
    .flags = kModdableCreationFlagDebug | kModdableCreationFlagLogInstrumentation,
  };
  moddable_createMachine(&cr);
#else
  // Custom XS heap sizing. PebbleOS's default Alloy machine reserves a
  // large slot heap (~21KB used capacity) but a tiny chunk heap (~5-9KB) -
  // chunk memory backs strings/arrays/objects, which is exactly what
  // WorkTracker's persisted day/segment data needs. The stock default
  // chunk pool fills up after only ~9-10 real start/stop cycles even
  // though ~100KB of native RAM sits completely unused nearby, because
  // moddable_createMachine(NULL) doesn't grow into it. All three fields
  // below must be non-zero together or PebbleOS rejects the record as
  // invalid (confirmed via coredevices/pebbleos#1592, fixed for override
  // requests in firmware v4.21.0+). Rebalanced toward chunk since slot
  // was previously the most oversupplied and chunk the scarcest resource.
  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = 4 * 1024,
    .slot = 32 * 1024,
    .chunk = 48 * 1024,
  };
  moddable_createMachine(&cr);
#endif

  window_destroy(w);
}
