/**
 * index.ts — Extension entry point (PLAN §7).
 *
 * Responsibilities:
 *   1. Warn (don't fail loading) if gstack binary is missing at startup
 *      (Conv-A: looks for GSTACK_BINARY or GSTACK_ROOT).
 *   2. Register all 60 generated tools via registerGstackTools(pi).
 *   3. Defer background resource lifecycle to lazy daemon start inside CLI.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGstackTools } from "./tools.generated";
import { resolveBinary } from "./lib/browse";

export default function (pi: ExtensionAPI) {
  // Validate binary presence at load time (warn, don't crash)
  const bin = resolveBinary();
  if ("error" in bin) {
    pi.on("session_start", async (_event, ctx) => {
      // One-shot user notification in TUI/RPC modes
      ctx.ui.notify(`gstack-pi warning: ${bin.error}`, "warn");
    });
  }

  // Register all 60 custom tools
  registerGstackTools(pi);
}
