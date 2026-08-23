import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGstackTools } from "./tools.generated";
import { resolveBinary } from "./lib/browse";
import { isBinaryInstalled, downloadBinary, getBinaryPath } from "./lib/download";
import { initOrchestrator } from "./orchestrator/index";

export default function (pi: ExtensionAPI) {
  const bin = resolveBinary();

  if ("error" in bin && !isBinaryInstalled()) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("gstack-pi: downloading browse binary...", "info");
      const result = await downloadBinary((msg) => ctx.ui.notify(`gstack-pi: ${msg}`, "info"));
      if ("error" in result) {
        ctx.ui.notify(`gstack-pi: ${result.error} — browse tools unavailable`, "warning");
      } else {
        ctx.ui.notify(`gstack-pi: binary ready at ${result.path}`, "info");
      }
    });
  } else if ("error" in bin) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(`gstack-pi warning: ${bin.error}`, "warning");
    });
  }

  registerGstackTools(pi);
  initOrchestrator(pi);
}
