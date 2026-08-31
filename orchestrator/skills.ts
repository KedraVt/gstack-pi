/**
 * Skill ingestion for the workflow orchestrator.
 *
 * The orchestrator (not the model) decides when skill knowledge is needed:
 *  - main-execution phases get the FULL distilled digest injected;
 *  - subagent phases get the full digest inside the specialist's task string,
 *    while orchestrator instructions carry only the compact DoD gate
 *    (definition of done + best practices) needed to verify their output;
 *  - repeat deliveries within one workflow run degrade to the DoD gate too.
 *
 * Digests live in <extensionRoot>/skills-distilled/<skillId>.md. Vendored
 * protocols (e.g. grilling) have no upstream SKILL.md — their distilled file
 * IS the source.
 *
 * SOURCE RESOLUTION (sprint-beta catalog): with GSTACK_PI_SKILL_INJECTION=full
 * the injected methodology comes instead from the unified sprint-beta catalog
 * (skills/sprint-beta/<file>, mapped per-registry-id via betaFile) so agents
 * absorb the complete deduplicated skill. Default digest is today-identical;
 * full mode degrades to the digest when a mapped file is missing so a run
 * never breaks on a missing source.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillInjectionMode } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = join(here, "..");
export const DISTILLED_DIR = join(EXTENSION_ROOT, "skills-distilled");
export const SKILLS_DIR = join(EXTENSION_ROOT, "skills");
export const SPRINT_BETA_DIR = join(SKILLS_DIR, "sprint-beta");

export interface SkillInfo {
  id: string;
  /** One-line description of what the skill contributes to a phase. */
  summary: string;
  /** Definition of Done + best practices — the compact verification gate. */
  dod: string;
  /** Absolute path of the distilled digest (skills-distilled/<id>.md). */
  distilledPath: string;
  /** Absolute path of the full upstream SKILL.md, or null for vendored skills. */
  fullPath: string | null;
  /**
   * Absolute path of the unified sprint-beta SKILL.md (full-injection source),
   * or null when the id has no catalog mapping / the file is missing.
   */
  betaPath: string | null;
}

interface RegistryEntry {
  summary: string;
  dod: string;
  /** Directory relative to skills/, omitted for vendored protocols.
   *  Upstream gstack skills live under skills/gstack/<id>/; .agents-clean
   *  raw sources (skills/kedra/) are manual-invocation only and are never
   *  referenced from the registry. */
  upstreamDir?: string;
  /** File relative to skills/sprint-beta/ — the unified full-injection source
   *  (GSTACK_PI_SKILL_INJECTION=full). Every registry id maps to the catalog. */
  betaFile?: string;
}

const REGISTRY: Record<string, RegistryEntry> = {
  "gstack-investigate": {
    betaFile: "beta-debugging/SKILL.md",
    summary: "Systematic debugging: Iron Law (no fixes without root cause), hypothesis testing, structured debug report",
    dod: "DoD: DEBUG REPORT block (Symptom / Root cause / Fix with file:line / Evidence / Regression test / Status DONE|DONE_WITH_CONCERNS|BLOCKED). BP: no fix without reproduced root cause; stop after 3 failed hypotheses; never claim a fix works without re-running the reproduction.",
  },
  "gstack-review": {
    betaFile: "beta-code-review/SKILL.md",
    summary: "Pre-landing review: scope drift detection, severity-classified findings, completeness gaps",
    dod: "DoD: Scope Check line (CLEAN/DRIFT DETECTED/REQUIREMENTS MISSING) + findings categorized CRITICAL/HIGH/MEDIUM/LOW with file:line + concrete failure scenario + final verdict APPROVE|APPROVE_WITH_FIXES|REQUEST_CHANGES. BP: never approve with open CRITICALs; no finding without a scenario.",
  },
  "gstack-qa": {
    betaFile: "beta-qa/SKILL.md",
    summary: "Browser QA: test like a real user, severity-classified bug reports, evidence screenshots",
    dod: "DoD: QA REPORT block (URL, flows covered, bug counts by severity, fixed/not-fixed lists, regression tests, evidence paths, verdict PASS|PASS_WITH_ISSUES|FAIL). BP: no bug without repro steps + screenshot evidence; re-verify every fix in the browser; report-only mode never commits.",
  },
  "gstack-ship": {
    betaFile: "beta-ship/SKILL.md",
    summary: "Release pipeline: pre-flight checks, test gates, TODOS.md management, atomic commits, PR discipline",
    dod: "DoD: SHIP REPORT block (branch, commit count, test counts, coverage gaps→fixed/flagged, TODOS.md updated, PR url, CI status, SHIPPED|BLOCKED_reason). BP: atomic bisectable commits, never git add -A, never commit broken tests, TODOS.md reconciled, no force-push to shared branches.",
  },
  "gstack-office-hours": {
    betaFile: "gstack-office-hours/SKILL.md",
    summary: "Product judgment for planning: premise-challenge, specificity, wedge thinking, scope ambition",
    dod: "DoD: problem stated in user terms before solutions; every assumption surfaced and either confirmed or corrected by the user; converged scope is narrow enough to ship. BP: take positions, push vague answers, interest ≠ demand, status quo is the competitor.",
  },
  "gstack-plan-eng-review": {
    betaFile: "gstack-plan-eng-review/SKILL.md",
    summary: "Engineering rigor for plans: blast radius, hidden assumptions, edge cases, test strategy",
    dod: "DoD: plan file contains Goal / NOT-in-scope / Architecture / Files-to-change / Edge-cases & risks / Test strategy / Open questions (near-zero). BP: boring technology by default, explicit over clever, complexity gate at 8+ files, right-sized diff.",
  },
  "gstack-document-release": {
    betaFile: "gstack-document-release/SKILL.md",
    summary: "Post-ship docs: Diataxis coverage map, factual updates from the diff, stale-reference sweep",
    dod: "DoD: DOC REPORT block (files reviewed, updated, generated, remaining gaps, DONE|DONE_WITH_GAPS) + docs committed atomically. BP: never regenerate CHANGELOG content — targeted edits only; stop only for risky narrative changes.",
  },
  "gstack-document-generate": {
    betaFile: "gstack-document-generate/SKILL.md",
    summary: "Author missing documentation: codebase archaeology first, Diataxis partitioning, reference-first writing",
    dod: "DoD: concept map produced before writing; reference docs written before tutorials/how-tos; every sample runnable or verbatim from repo. BP: research the whole feature surface first; document only behavior that exists.",
  },
  "grilling": {
    betaFile: "grilling/SKILL.md",
    summary: "Interview protocol: design-tree rounds over the frontier, recommended answers, facts-vs-decisions split",
    dod: "DoD: rounds end only when the frontier is empty (nothing silently assumed); every question carried a recommended answer; facts looked up, decisions asked. BP: batch the frontier per round; wait for answers before recomputing.",
    // vendored protocol — no upstream SKILL.md
  },
  "gstack-fix-strategy": {
    betaFile: "gstack-fix-strategy/SKILL.md",
    summary: "Minimal-fix strategy for a CONFIRMED root cause: validation-first, minimal diff, regression test per fix",
    dod: "DoD: `VALIDATED: <mechanism @ file:line>` first line, then exact files to change + regression risks; `REFUTED: <reason>` first line if the cause does not hold. BP: no fix without a validated mechanism confirmed against code; minimal diff only; every fix ships a regression test that fails before and passes after.",
    // vendored digest derived from the investigate methodology's Phase 4 — no upstream SKILL.md
  },

  // --- sprint workflow digests (provenance: .agents-clean, staged 2026-08-24) ---
  "gstack-sprint-capability": {
    betaFile: "product-capability/SKILL.md",
    summary: "User-story writing + story→engineering-constraints translation: boolean-checkable invariants, explicit trust boundaries, non-goals",
    dod: "DoD: user-story_XX.md states goal/actor/outcome with falsifiable acceptance criteria; product-capability_XX.md lists invariants as boolean conditions, enumerated trust boundaries, non-goals. BP: constraints testable, no vague adjectives, every boundary named.",
  },
  "gstack-sprint-system-design": {
    betaFile: "system-design/SKILL.md",
    summary: "DDD system design: binding ubiquitous-language glossary, aggregates with boolean invariants, context mapping, contract immutability",
    dod: "DoD: system-design_XX.md contains a Ubiquitous Language glossary table (BINDING for all dev agents), domains with data flows, aggregates+invariants as boolean conditions, unhappy-path error payloads. BP: contracts immutable once consumers exist; storage advisory (SQLite prototype / PostgreSQL concurrent production).",
  },
  "gstack-sprint-adr": {
    betaFile: "adr/SKILL.md",
    summary: "Architecture decision records: decision/context/consequences format, append-only sprint log",
    dod: "DoD: each ADR records Decision / Context / Consequences + status; only significant architectural changes; ADR-log_XX.md append-only, never rewritten. BP: one record per decision; note rejected alternatives when they were real.",
  },
  "gstack-sprint-tasks": {
    betaFile: "tasks/SKILL.md",
    summary: "Atomic task backlog: inputs/payloads/constraints/unhappy-paths/falsifiable success conditions, role-assigned with dependencies",
    dod: "DoD: tasks_XX.md entries atomic (one verifiable outcome each) specifying inputs, constraints, unhappy paths, falsifiable success condition, owning role, dependencies. BP: 'build the backend' is not a task; every success condition externally checkable.",
  },
  "gstack-sprint-tdd": {
    betaFile: "test-driven-development/SKILL.md",
    summary: "Test-first discipline: red-green-refactor, AAA structure, prove-it bug reproduction, anti-pattern avoidance",
    dod: "DoD: failing test precedes production code; AAA structure; bug fixes start from a demonstrably failing test; ≥80% coverage on new code paths. BP: no production code without a red test; strip debug artifacts before claiming green.",
  },
  "gstack-sprint-verification": {
    betaFile: "verification-before-completion/SKILL.md",
    summary: "Iron Law: completion claims require fresh verification evidence — run it now, read the output, cite it",
    dod: "DoD: every completion claim cites command output produced during the current report; no 'should work' language; re-run after any late change. BP: evidence before claims, applied universally (code/tests/docs).",
  },
  "gstack-sprint-appsec": {
    betaFile: "beta-security/SKILL.md",
    summary: "AppSec review: STRIDE-lite threat model over new trust boundaries, secrets hygiene, injection prevention, actionable remediations",
    dod: "DoD: each finding names the abused boundary, failure mode, blast radius, and a copy-paste-ready fix; zero hardcoded secrets; parameterized queries; validated inputs at every boundary. BP: no finding without a fix.",
  },
  "gstack-sprint-docker": {
    betaFile: "docker-manager/SKILL.md",
    summary: "Conditional Docker audit: multi-stage builds, pinned bases, non-root runtime, resource limits, network isolation",
    dod: "DoD: conditional — applies ONLY when repo ships Dockerfile/compose; multi-stage build, pinned base images, non-root runtime, resource limits, healthchecks, no secrets in layers. BP: never introduce Docker into a project that does not use it.",
  },
  "gstack-sprint-qa": {
    betaFile: "beta-qa/SKILL.md",
    summary: "QA triage GREEN/RED/ORANGE, Testability Blockers, Save-Point git pattern, evidence-first reporting",
    dod: "DoD: qa-artifact carries `## STATUS == GREEN|RED|ORANGE` (+ status frontmatter); ORANGE requires a Testability Blockers section listing missing selectors; every RED finding has repro steps + evidence; QA holds no commit authority. BP: commit only after verified GREEN; never destructive git operations; branch-per-task.",
  },
  "gstack-sprint-pipeline": {
    betaFile: "pipeline-sre/SKILL.md",
    summary: "Conditional CI/CD authoring audit: least privilege, pinned versions, vault secrets, reproducible builds, rollback story",
    dod: "DoD: conditional — applies ONLY when authoring/modifying CI configs; least-privilege tokens, pinned action/tool versions, platform-vault secrets (never inline), fail-fast ordering, documented rollback. BP: reproducible builds over snowflake runners.",
  },
};

export function getSkillIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getSkillInfo(id: string): SkillInfo | null {
  const entry = REGISTRY[id];
  if (!entry) return null;
  // gstack skills are nested under skills/gstack/<id>/ (kedra/gstack split).
  // Registry ids without a bundled SKILL.md (sprint digests, fix-strategy)
  // resolve to a non-existent path and degrade to fullPath: null as before.
  const upstreamDir = entry.upstreamDir ?? (id.startsWith("gstack-") ? `gstack/${id}` : undefined);
  const fullPath = upstreamDir ? join(SKILLS_DIR, upstreamDir, "SKILL.md") : null;
  const betaPath = entry.betaFile ? join(SPRINT_BETA_DIR, entry.betaFile) : null;
  return {
    id,
    summary: entry.summary,
    dod: entry.dod,
    distilledPath: join(DISTILLED_DIR, `${id}.md`),
    fullPath: fullPath && existsSync(fullPath) ? fullPath : null,
    betaPath: betaPath && existsSync(betaPath) ? betaPath : null,
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

/**
 * Load the FULL unified skill from the sprint-beta catalog (full injection).
 * Returns null when the id has no catalog mapping or the file is missing —
 * callers degrade gracefully, never break a run.
 */
export function loadSkillFull(id: string): string | null {
  const info = getSkillInfo(id);
  if (!info?.betaPath) return null;
  try {
    if (!existsSync(info.betaPath)) return null;
    const content = readFileSync(info.betaPath, "utf-8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Mode-aware methodology source (GSTACK_PI_SKILL_INJECTION):
 *  - digest → the distilled digest (default, today-identical);
 *  - full → the sprint-beta unified SKILL.md, falling back to the digest
 *    whenever the mapped file is missing. A missing source must never
 *    break a run.
 */
export function loadSkillSource(id: string, mode: SkillInjectionMode): string | null {
  if (mode === "full") {
    const full = loadSkillFull(id);
    if (full) return full;
  }
  return loadSkillDigest(id);
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
