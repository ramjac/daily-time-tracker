import Timeline from "pebble/timeline";

Pebble.addEventListener("appmessage", (e) => {
  const { action, id, label, startTime, durationMs } = e.payload;

  if (action === "INSERT_TIMELINE_PIN") {
    Timeline.pushPin({
      id: `work-segment-${id}`,
      time: new Date(startTime).toISOString(),
      duration: Math.max(1, Math.round(durationMs / 60000)),
      layout: {
        type: "genericPin",
        title: label,
        subtitle: `${Math.round(durationMs / 60000)} min logged`,
        tinyIcon: "system://images/TIMELINE_CALENDAR",
        body: "Tracked with Daily Work Tracker."
      }
    }, (status) => console.log(`Pin synced: ${status}`));
  } else if (action === "DELETE_TIMELINE_PIN") {
    Timeline.deletePin(`work-segment-${id}`, (status) => {
      console.log(`Pin deleted: ${status}`);
    });
  }
});
