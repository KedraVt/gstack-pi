import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGstackTools } from "./tools.generated";
import { resolveBinary } from "./lib/browse";
import { initOrchestrator } from "./orchestrator/index";

export default function (pi: ExtensionAPI) {
  const bin = resolveBinary();
  if ("error" in bin) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(`gstack-pi warning: ${bin.error}`, "warn");
    });
  }

  registerGstackTools(pi);
  initOrchestrator(pi);
}
