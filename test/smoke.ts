/**
 * test/smoke.ts — Smoke test for gstack-pi (PLAN §13).
 *
 * Runs a single basic check:
 *   1. Resolve binary. If missing (no build / env set), skip test gracefully.
 *   2. Run `goto https://example.com` -> code 0.
 *   3. Run `url` -> check match /example\.com/.
 */
import { test } from "node:test";
import assert from "node:assert";
import { resolveBinary, runBrowse } from "../lib/browse.ts";

test("gstack CLI integration smoke test", async () => {
  const bin = resolveBinary();
  if ("error" in bin) {
    console.log(`Skipping smoke test: ${bin.error}`);
    return;
  }

  console.log(`Running smoke test against binary: ${bin.path}`);

  // Test 1: Navigation
  const r1 = await runBrowse("goto", ["https://example.com"], {});
  assert.strictEqual(
    r1.code,
    0,
    `goto command failed with exit ${r1.code}. Stderr: ${r1.stderr}`,
  );

  // Test 2: URL retrieval
  const r2 = await runBrowse("url", [], {});
  assert.strictEqual(
    r2.code,
    0,
    `url command failed with exit ${r2.code}. Stderr: ${r2.stderr}`,
  );
  assert.match(
    r2.stdout,
    /example\.com/,
    `Expected stdout to contain 'example.com', got: "${r2.stdout}"`,
  );

  console.log("Smoke test passed successfully!");
});
