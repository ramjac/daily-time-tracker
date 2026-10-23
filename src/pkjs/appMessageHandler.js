export function handleAppMessage(e, Timeline) {
  if (!e || typeof e !== "object" || !e.payload || typeof e.payload !== "object") {
    return;
  }

  const { action, id, label, startTime, durationMs } = e.payload;

  if (id === undefined || id === null || (typeof id !== "string" && typeof id !== "number")) {
    return;
  }

  const cleanId = String(id).trim();
  if (!cleanId) {
    return;
  }

  if (action === "INSERT_TIMELINE_PIN") {
    if (typeof durationMs !== "number" || !isFinite(durationMs) || durationMs <= 0) {
      return;
    }

    if (startTime === undefined || startTime === null) {
      return;
    }

    const startDate = new Date(startTime);
    if (isNaN(startDate.getTime())) {
      return;
    }

    const pinLabel = typeof label === "string" ? label : (label != null ? String(label) : "");
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

    Timeline.pushPin({
      id: `work-segment-${cleanId}`,
      time: startDate.toISOString(),
      duration: durationMinutes,
      layout: {
        type: "genericPin",
        title: pinLabel,
        subtitle: `${durationMinutes} min logged`,
        tinyIcon: "system://images/TIMELINE_CALENDAR",
        body: "Tracked with Daily Work Tracker."
      }
    }, (status) => console.log(`Pin synced: ${status}`));
  } else if (action === "DELETE_TIMELINE_PIN") {
    Timeline.deletePin(`work-segment-${cleanId}`, (status) => {
      console.log(`Pin deleted: ${status}`);
    });
  }
}
