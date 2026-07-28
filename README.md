# gstack-pi

Browser automation + guided workflow orchestrator for the [pi](https://github.com/earendil-works/pi) coding agent.

One extension, two layers:
- **60 native browser tools** — headless Chromium via gstack, ~100ms/command
- **Workflow orchestrator** — `/gstack` command that guides you through develop, investigate, QA, ship, and review pipelines

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
| `develop` | understand → plan → implement → QA → review → ship | Full feature cycle |
| `investigate` | reproduce → root-cause → fix → verify → QA (optional) | Systematic debugging |
| `qa` | setup → browser test → report → fix (optional) | Browser-based QA |
| `ship` | pre-checks → review → test → push+PR → verify CI | Release pipeline |
| `review` | diff analysis → findings → fix (optional) | Code review |
| `quick` | single action picker | One-shot actions |

Each phase runs either in the main agent context (analysis, verification) or delegates to a subagent (implementation, heavy testing). The orchestrator injects structured instructions and advances automatically when you call `gstack_advance`.

### Automatic routing

The extension monitors your input and suggests workflows when it detects intent:

- "why is login broken" → suggests `investigate`
- "let's ship this" → suggests `ship`
- "build a new dashboard" → suggests `develop`
- "test the site" → suggests `qa`

Suggestions are advisory — the LLM asks before starting a workflow. Slash commands and short inputs are never intercepted.

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
│   ├── commands.ts          Allowlist re-export
│   ├── commands.generated.ts  Allowed command set (auto-generated)
│   └── schemas.ts           TypeBox parameter schemas
├── orchestrator/
│   ├── index.ts             Registers /gstack, gstack_advance, input router
│   ├── types.ts             Workflow, Phase, State interfaces
│   ├── state.ts             State machine (persist via pi appendEntry)
│   ├── git.ts               Git context detection
│   ├── workflows.ts         6 workflow definitions (data-driven)
│   ├── templates.ts         Phase instruction builders
│   ├── executor.ts          Phase execution + skip logic
│   ├── command.ts           /gstack command handler
│   └── router.ts            Input intent detection (transform, never block)
├── source/                  Git submodule → garrytan/gstack
├── runtime/                 Built by update.sh (gitignored)
│   ├── browse/dist/         Compiled browse binary + server bundle
│   └── bin/                 9 essential gstack helper scripts
├── skills/                  23 cherry-picked SKILL.md files
├── scripts/
│   ├── gen-tools.ts         Regenerate tools from source/ commands
│   └── sync-skills.ts       Re-sync skills with path rewriting
├── test/
│   └── orchestrator.test.ts Unit tests (state machine, workflows, intents)
├── update.sh                Pull submodule + build + deploy + feature detection
└── .gitignore               Excludes runtime/ (built artifacts)
```

### How the orchestrator works

```
/gstack (command)  ──┐
                     ├──→ State Machine ──→ Phase Executor ──→ sendUserMessage()
input router ────────┘         ↑                                    │
                               │                                    ↓
                     gstack_advance ←──── LLM executes phase ←── instructions
```

1. User starts a workflow via `/gstack` or the router suggests one
2. The orchestrator injects phase instructions into the LLM context
3. The LLM executes (using browser tools, subagents, bash, etc.)
4. The LLM calls `gstack_advance` with a summary
5. The state machine advances to the next phase
6. Repeat until all phases complete

State persists across session reloads via pi's `appendEntry` (not sent to LLM context).

### Token overhead

| | Per-session fixed | Per-phase |
|---|---|---|
| Browser tools | ~180 tokens (tool descriptions) | 0 |
| Orchestrator | ~150 tokens (gstack_advance) | ~600-1000 (instructions) |
| Skills (if loaded) | ~7300 tokens each | 0 |

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
