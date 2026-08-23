/**
 * Static type-safety gate.
 *
 * The 2026-08-23 field incident (pi exiting with "ReferenceError:
 * livenessThresholdMs is not defined" thrown from a setInterval callback)
 * was invisible to `bun build` (bundlers don't type-check) and to the unit
 * suite (nothing executed the real spawn path). `tsc --noEmit` catches
 * exactly this class of bug (TS2304 "Cannot find name") at development time.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as path from "node:path";

describe("static type safety gate", () => {
  test("tsc --noEmit reports no errors", () => {
    const cwd = path.resolve(process.cwd());
    try {
      execSync("bunx tsc --noEmit", { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
    } catch (err: any) {
      const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
      assert.fail(`TypeScript check failed:\n${String(out).slice(0, 4000)}`);
    }
  });
});
