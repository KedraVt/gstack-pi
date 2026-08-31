// Sprint-beta injection source resolution (GSTACK_PI_SKILL_INJECTION flag).
//
// Contract: default full = the unified sprint-beta SKILL.md per registry id;
// digest is an explicit opt-in legacy mode, with graceful degradation to the
// digest whenever a mapped full file is missing (a missing source never breaks
// a run).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSkillIds,
  getSkillInfo,
  loadSkillDigest,
  loadSkillFull,
  loadSkillSource,
} from "../orchestrator/skills.ts";
import { skillInjectionMode } from "../orchestrator/config.ts";

const KEY = "GSTACK_PI_SKILL_INJECTION";

describe("sprint-beta injection source resolution", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  test("default mode is full (sprint-beta catalog)", () => {
    assert.equal(skillInjectionMode(), "full");
  });

  test("full mode activates via env, case-insensitive; digest otherwise", () => {
    process.env[KEY] = "full";
    assert.equal(skillInjectionMode(), "full");
    process.env[KEY] = "FULL";
    assert.equal(skillInjectionMode(), "full");
    process.env[KEY] = "digest";
    assert.equal(skillInjectionMode(), "digest");
    process.env[KEY] = "nonsense";
    assert.equal(skillInjectionMode(), "full");
  });

  test("every registry id maps to an existing sprint-beta file", () => {
    for (const id of getSkillIds()) {
      const info = getSkillInfo(id)!;
      assert.ok(info.betaPath, `missing sprint-beta mapping for ${id}`);
      assert.ok(
        info.betaPath.includes("sprint-beta"),
        `${id} betaPath outside sprint-beta: ${info.betaPath}`,
      );
    }
  });

  test("digest mode returns the distilled digest (provenance marker)", () => {
    const content = loadSkillSource("gstack-sprint-qa", "digest");
    assert.ok(content, "digest source missing for gstack-sprint-qa");
    assert.match(content, /gstack-sprint-qa/);
  });

  test("full mode returns the sprint-beta unified SKILL.md, not the digest", () => {
    const full = loadSkillSource("gstack-sprint-qa", "full");
    assert.ok(full, "full source missing for gstack-sprint-qa");
    assert.match(full, /name: beta-qa/);
    // Fused skills are clean: no pi-adapter harness preamble.
    assert.doesNotMatch(full, /Pi adapter note/);
    const digest = loadSkillDigest("gstack-sprint-qa")!;
    assert.notEqual(full, digest);
  });

  test("full mode and loadSkillFull agree on the source", () => {
    assert.equal(
      loadSkillSource("gstack-ship", "full"),
      loadSkillFull("gstack-ship"),
    );
    assert.match(loadSkillFull("gstack-ship")!, /name: beta-ship/);
  });

  test("unknown id degrades to null in both modes (never throws)", () => {
    assert.equal(loadSkillFull("no-such-skill"), null);
    assert.equal(loadSkillSource("no-such-skill", "full"), null);
    assert.equal(loadSkillSource("no-such-skill", "digest"), null);
  });
});
