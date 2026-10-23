import Timeline from "pebble/timeline";
import { handleAppMessage } from "./appMessageHandler.js";

Pebble.addEventListener("appmessage", (e) => {
  handleAppMessage(e, Timeline);
});
