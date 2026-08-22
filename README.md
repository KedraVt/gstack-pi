# gstack-pi

Browser automation + guided workflow orchestrator for the [pi](https://github.com/earendil-works/pi) coding agent.

One extension, two layers:
- **60 native browser tools** — headless Chromium via gstack, ~100ms/command
- **Workflow orchestrator** — `/gstack` command that guides you through develop, investigate, QA, ship, and review pipelines

## What's new (feat/skill-ingestion branch)

- **Deterministic subagents** — specialists (scout/planner/worker/reviewer) are spawned by the orchestrator itself in isolated `pi` processes; delegation no longer depends on the model's discretion. The `subagent` tool remains for ad-hoc use.
- **Interactive plan cycle** — scout explores → you are interviewed (grilling protocol rounds with recommended answers + office-hours judgment + eng-review rigor, ≤5 questions/round) → plan written to `.gstack/plans/<slug>.md` → your approval gate (`/gstack next`) → worker implements from the plan file.
- **Manual decision gates** — `develop.plan` and `investigate.root-cause` pause for user approval before code is touched.
- **Skill ingestion** — distilled methodology digests (~2K tokens) from gstack's SKILL.md files are injected by the workflow itself: full digest to whoever does the work, compact DoD+best-practices gates for verification and repeats.
- **Documentation phases** — optional doc-update phase on `develop` and `ship` (Diataxis coverage map, chained generation for missing docs).
- **`qa-report` workflow** — full QA methodology, report-only, never modifies code.
- **`gstack_start` tool** — programmatic workflow entry point (usable by any agent, including subagents).
- **Fixed**: phase instructions are now delivered with `followUp` streaming behavior — eliminates the "Agent is already processing" error that silently dropped phase handoffs.

## Requirements

- [pi](https://github.com/earendil-works/pi) >= 0.82.0
- For updates only: [Bun](https://bun.sh) >= 1.3.0 + Git Bash (Windows)

## Installation

### 1. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/YOUR_USER/gstack-pi ~/.pi/agent/extensions/gstack-pi
```

Pi auto-discovers extensions in `~/.pi/agent/extensions/`. No settings.json changes needed.

The browse binary is pre-built and included in `runtime/`. The extension works immediately after cloning.

The `source/` submodule (~69MB) contains the gstack repo. It's only needed for updates — you can skip it on first clone with `--no-recurse-submodules` and fetch it later when you want to update.

### 2. Verify

Open pi in any project. Type `/gstack` — you should see the workflow menu.

## Usage

### The `/gstack` command

```
/gstack              # Interactive menu (context-aware, sorted by git state)
/gstack ship         # Start a specific workflow directly
/gstack investigate  # Bug debugging pipeline
```

The menu adapts to your git context:
- Uncommitted changes → "investigate" and "review" float to top
- Ahead of remote → "ship" floats to top
- On main branch → "develop" floats to top

### Workflows

| Workflow | Phases | Use case |
|----------|--------|----------|
| `develop` | understand → explore → **plan (interactive)** → implement → QA → review → ship → docs (opt.) | Full feature cycle |
| `investigate` | reproduce → root-cause (⏸ gate) → fix → verify → regression QA (opt.) | Systematic debugging |
| `qa` | setup → browser test → report → fix (opt.) | Browser-based QA with fixes |
| `qa-report` | setup → browser test → report — **never modifies code** | QA report without fixes |
| `ship` | pre-checks → review → test → push+PR → verify CI → docs (opt.) | Release pipeline |
| `review` | diff analysis → findings → fix (optional) | Code review |
| `quick` | single action picker | One-shot actions |

⏸ = decision phase: the workflow pauses in `awaiting_approval` until you run `/gstack next`.

Each phase runs either in the main agent context (analysis, verification, planning) or is delegated deterministically to a spawned specialist subagent — scout / planner / worker / reviewer (implementation, exploration, heavy testing). The orchestrator injects structured instructions and advances when the model calls `gstack_advance`; it can never bypass a manual gate.

### The interactive plan cycle (`develop`)

1. **understand** — requirements analysis in the main context
2. **explore** — the scout subagent gathers codebase facts (its own context window)
3. **plan** — *you are interviewed*. Using the grilling protocol (design-tree rounds of ≤5 questions, each with a recommended answer), office-hours product judgment, and plan-eng-review rigor, the orchestrator converges on scope with you and writes `.gstack/plans/<slug>.md`
4. ⏸ you read the actual plan file, then `/gstack next`
5. **implement** — worker reads the plan file directly; QA, review, ship and docs follow autonomously

### Skill methodology injection

The workflow decides when skill knowledge applies — the model never has to guess:

- Every mapped phase carries a **distilled digest** (~2K tokens) extracted from the corresponding gstack SKILL.md (`skills-distilled/`)
- Main phases embed the full digest; subagent phases receive it inside their task string while orchestrator instructions carry only the compact **DoD + best-practices gate**
- Repeated deliveries within one run degrade to the DoD gate (~40% skill-token savings)
- Wired skills: investigate, qa, review, ship, office-hours, plan-eng-review, document-release (+generate), grilling. All 23 bundled skills stay manually invocable via `/skill:gstack-*`.

### Automatic routing

The extension monitors your input and suggests workflows when it detects intent:

- "why is login broken" → suggests `investigate`
- "let's ship this" → suggests `ship`
- "build a new dashboard" → suggests `develop`
- "test the site" → suggests `qa`
- "just report the bugs, don't fix" → suggests `qa-report`

Suggestions are advisory — the LLM asks before starting a workflow. Slash commands and short inputs are never intercepted.

### Programmatic start

Any agent — including spawned subagents, which load this extension too — can bootstrap a workflow with the `gstack_start { workflow, goal }` tool.

### Browser tools (60)

All registered as native pi tools, callable by the LLM automatically:

```
gstack_goto, gstack_snapshot, gstack_click, gstack_fill,
gstack_screenshot, gstack_text, gstack_html, gstack_console,
gstack_network, gstack_responsive, gstack_diff, gstack_is,
gstack_cookie_import_browser, gstack_pdf, ...
```

Full list: see `tools.generated.ts` (60 commands from the gstack browse CLI).

### Skills (23)

Cherry-picked gstack skills remain available for direct invocation:

```
/skill:gstack-qa, /skill:gstack-review, /skill:gstack-ship,
/skill:gstack-investigate, /skill:gstack-spec, /skill:gstack-autoplan, ...
```

These coexist with the orchestrator. Use them when you want the raw gstack workflow without the guided pipeline.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GSTACK_BINARY` | Absolute path to the browse binary | Auto-resolved |
| `GSTACK_ROOT` | Root of a gstack installation (alternative binary source) | Not set |
| `GSTACK_REPO` | Path to gstack source (overrides submodule for scripts) | `<extension>/source/` |

### Binary resolution order

The extension searches for the browse binary in this order:

1. `$GSTACK_BINARY` (explicit override)
2. `$GSTACK_ROOT/browse/dist/browse` (standard gstack install)
3. `<extension>/runtime/browse/dist/browse` (built by update.sh)
4. `../../gstack/browse/dist/browse` (dev sibling layout)

On Windows, `.exe` is appended automatically.

## Updating

```bash
# Full update: pull gstack submodule, rebuild binary, sync skills + bin scripts
bash ~/.pi/agent/extensions/gstack-pi/update.sh

# Rebuild without pulling (local patches in source/)
bash ~/.pi/agent/extensions/gstack-pi/update.sh --skip-pull

# Update the submodule to latest upstream manually
cd ~/.pi/agent/extensions/gstack-pi/source && git pull origin main
```

The script also detects new upstream features (skills, tools, bin scripts) not yet included in the extension and prints them:

```
╔══════════════════════════════════════════════════════════╗
║  NEW FEATURES AVAILABLE UPSTREAM — update extension!    ║
╚══════════════════════════════════════════════════════════╝

  [skill] gstack-canary
  [tool]  gstack_handoff
  [bin]   gstack-analytics
```

To include new skills: add them to `SKILLS=` in `update.sh`.
To include new tools: run `bun run scripts/gen-tools.ts`.

## Regenerating tools

When gstack adds new browse commands:

```bash
cd ~/.pi/agent/extensions/gstack-pi
bun run scripts/gen-tools.ts
```

This regenerates `tools.generated.ts` and `lib/commands.generated.ts` from `source/browse/src/commands.ts`.

## Architecture

```
gstack-pi/
├── index.ts                 Entry: registers tools + orchestrator
├── tools.generated.ts       60 browser tool registrations (auto-generated)
├── lib/
│   ├── browse.ts            Binary resolution + subprocess spawn
│   ├── download.ts          Auto-download browse binary from GitHub Releases
│   ├── commands.ts          Allowlist re-export
│   ├── commands.generated.ts  Allowed command set (auto-generated)
│   └── schemas.ts           TypeBox parameter schemas
├── orchestrator/
│   ├── index.ts             Registers /gstack, gstack_advance, gstack_start, input router
│   ├── types.ts             Workflow, Phase, State interfaces
│   ├── state.ts             State machine (persist via pi appendEntry; approval gates)
│   ├── git.ts               Git context detection
│   ├── workflows.ts         7 workflow definitions (data-driven, skill mappings)
│   ├── templates.ts         Phase instruction builders + skill tiering + plan-file protocol
│   ├── executor.ts          Phase execution, deterministic subagent delegation, skip logic
│   ├── skills.ts            Skill registry: digests, DoD gates, paths
│   ├── spawn.ts             Deterministic subagent execution (pi --mode json)
│   ├── config.ts            Feature flags (GSTACK_PI_SKILLS / _DETERMINISTIC / _MANUAL_GATES)
│   ├── command.ts           /gstack command handler (+ /gstack next)
│   └── router.ts            Input intent detection (transform, never block)
├── skills-distilled/        Distilled methodology digests (~2K tokens each) + vendored grilling protocol
├── source/                  Git submodule → garrytan/gstack
├── runtime/                 Built by update.sh (gitignored)
│   ├── browse/dist/         Compiled browse binary + server bundle
│   └── bin/                 9 essential gstack helper scripts
├── skills/                  23 cherry-picked SKILL.md files (manual /skill:gstack-* use)
├── scripts/
│   ├── gen-tools.ts         Regenerate tools from source/ commands
│   └── sync-skills.ts       Re-sync skills with path rewriting
├── test/
│   └── orchestrator.test.ts Unit tests (state machine, gates, workflows, tiering, intents)
├── FUTURE_UPDATES.md        Deliberately deferred features & skill integrations
├── update.sh                Pull submodule + build + deploy + feature detection
└── .gitignore               Excludes runtime/ (built artifacts)
```

### How the orchestrator works

```
/gstack or gstack_start ──┐
                          ├──→ State Machine ──→ Phase Executor ──► main phase:
input router ─────────────┘         ↑                              instructions to LLM
                                    │                                    │
                     manual gate? ──┤                       subagent phase: spawn
                       yes: pause   │                       specialists first, then
                       (/gstack next)│                      prefix their output
                                    │                                    ↓
                      gstack_advance ←──── LLM executes/reviews ←── instructions
```

1. User starts a workflow via `/gstack`, `gstack_start`, or the router suggests one
2. The orchestrator injects phase instructions into the LLM context (`followUp` delivery — never mid-turn)
3. Subagent phases are executed by the orchestrator itself: specialists run in isolated `pi` processes and their output is prefixed for review
4. The LLM calls `gstack_advance` with a summary — this is the only progression mechanism; it must never defer back to the user
5. Auto phases advance immediately; decision phases (`develop.plan`, `investigate.root-cause`) park in `awaiting_approval` until you run `/gstack next`
6. Repeat until all phases complete

State persists across session reloads via pi's `appendEntry` (not sent to LLM context).

### Token overhead

| | Per-session fixed | Per-phase |
|---|---|---|
| Browser tools | ~180 tokens (tool descriptions) | 0 |
| Orchestrator | ~150 tokens (advance/start) | ~600-1000 (instructions) |
| Skill digests | 0 (on disk) | full digest on first delivery (main phases); DoD gate only for subagent-phase verification and repeats (~2K vs ~7K per full skill load) |

## Branches & feature flags

- `main` — pre-upgrade behavior (advisory subagent hints, no skill injection). Switch with `git checkout main` in the extension folder, then restart pi.
- `feat/skill-ingestion` — everything documented here.
- Runtime kill switches (env): `GSTACK_PI_SKILLS=off`, `GSTACK_PI_DETERMINISTIC=off`, `GSTACK_PI_MANUAL_GATES=off`.

Deferred ideas live in `FUTURE_UPDATES.md`.

## Security

- Browse binary spawned with `shell: false` (no shell injection)
- Command allowlist: only the 60 registered commands can execute
- Output capped at 32,000 chars per tool call
- `cookie-import-browser` requires explicit user confirmation
- Input router never blocks (`action: "handled"` is never returned)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "gstack browse binary not found" | Run `update.sh` or set `GSTACK_BINARY` |
| "server-node.mjs not found" (Windows) | Run `bash browse/scripts/build-node-server.sh` in the gstack repo |
| `/gstack` not showing in pi | Ensure the extension is in `~/.pi/agent/extensions/gstack-pi/` with `index.ts` at root |
| Subagent phases fail | Ensure `~/.pi/agent/agents/` has scout.md, planner.md, worker.md, reviewer.md |
| Skills not loading | Pi requires `"skills": ["./skills"]` in a package.json, or project `.pi/settings.json` |

## License

MIT
