/**
 * Skill ingestion for the workflow orchestrator.
 *
 * The orchestrator (not the model) decides when skill knowledge is needed and
 * injects a distilled methodology digest directly into phase instructions or
 * subagent task strings. The agent never has to know whether a skill should
 * be loaded — the workflow manages it.
 *
 * Digests live in <extensionRoot>/skills-distilled/<skillId>.md (~1.5-3K tokens
 * each), extracted from the full SKILL.md files in <extensionRoot>/skills/.
 * Full skills remain available for on-demand deep consultation via read.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = resolveExtensionRoot(here);
export const DISTILLED_DIR = join(EXTENSION_ROOT, "skills-distilled");
export const SKILLS_DIR = join(EXTENSION_ROOT, "skills");

function resolveExtensionRoot(from: string): string {
  // __dirname is <root>/orchestrator → root is one level up.
  return join(from, "..");
}

export interface SkillInfo {
  id: string;
  /** One-line description of what the skill contributes to a phase. */
  summary: string;
  /** Absolute path of the distilled digest (skills-distilled/<id>.md). */
  distilledPath: string;
  /** Absolute path of the full upstream SKILL.md (skills/<id>/SKILL.md). */
  fullPath: string;
}

const REGISTRY: Record<string, Omit<SkillInfo, "distilledPath" | "fullPath">> = {
  "gstack-investigate": {
    id: "gstack-investigate",
    summary: "Systematic debugging: Iron Law (no fixes without root cause), hypothesis testing, structured debug report",
  },
  "gstack-review": {
    id: "gstack-review",
    summary: "Pre-landing review: scope drift detection, severity-classified findings, completeness gaps",
  },
  "gstack-qa": {
    id: "gstack-qa",
    summary: "Browser QA: test like a real user, severity-classified bug reports, evidence screenshots",
  },
  "gstack-ship": {
    id: "gstack-ship",
    summary: "Release pipeline: pre-flight checks, test gates, atomic commits, PR discipline",
  },
};

export function getSkillIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getSkillInfo(id: string): SkillInfo | null {
  const entry = REGISTRY[id];
  if (!entry) return null;
  return {
    ...entry,
    distilledPath: join(DISTILLED_DIR, `${id}.md`),
    fullPath: join(SKILLS_DIR, id, "SKILL.md"),
  };
}

/**
 * Load the distilled methodology digest for a skill.
 * Returns null on any failure so callers can degrade gracefully to the
 * generic phase instructions (a missing digest must never break a run).
 */
export function loadSkillDigest(id: string): string | null {
  const info = getSkillInfo(id);
  if (!info) return null;
  try {
    if (!existsSync(info.distilledPath)) return null;
    const content = readFileSync(info.distilledPath, "utf-8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** Compact index of all bundled skills, for optional deep consultation by the agent. */
export function buildSkillIndex(): string {
  const lines: string[] = ["Available gstack skills (read the full SKILL.md only if you need depth beyond your current instructions):"];
  for (const id of getSkillIds()) {
    const info = getSkillInfo(id)!;
    lines.push(`- ${id}: ${info.summary} (full doc: ${info.fullPath})`);
  }
  return lines.join("\n");
}
