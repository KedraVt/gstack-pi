# gstack-pi

gstack browser tools and workflow skills for the [pi coding agent harness](https://github.com/earendil-works/pi-coding-agent).

Exposes gstack's headless/headed browser as 60 native pi tools (e.g. `gstack_goto`, `gstack_snapshot`, `gstack_click`, `gstack_screenshot`) and a curated suite of 23 advanced workflow skills (e.g. `/skill:office-hours`, `/skill:review`, `/skill:qa`, `/skill:scrape`).

Instead of utilizing network overhead or the MCP protocol (which is often too token-heavy for complex browser interactions), `gstack-pi` adopts a "native" approach. It limits textual results (like the DOM structure or accessibility tree) to a maximum of 32,000 characters. If a page exceeds this limit, the extension intelligently truncates the output and provides contextual hints to the LLM to explore selectors incrementally, saving crucial space in the context window.

Furthermore, it uses an "Adaptive Vendoring" mechanism for the 23 skills: during the build phase, the extension dynamically rewrites the bash preambles of these skills to precisely interface with your local gstack clone (via the `$GSTACK_ROOT` environment variable). The agent will leverage the OS shell to seamlessly launch complex helper scripts and design tools without breaking.

### Detailed Architecture and Functionality
This package acts as a sophisticated bridge between the Pi AI agent and the gstack browser ecosystem. It solves the classic problem of browser integration for AI agents without relying on heavy protocols like MCP. 
By compiling 60 individual CLI commands into native Pi tools, the agent gains atomic control over navigation, DOM inspection, and visual QA. The extension's core logic (`lib/browse.ts`) robustly manages subprocesses, ensures graceful timeouts, and parses output natively.
Additionally, the 23 vendored skills aren't just static text: they are fully executable bash routines that are dynamically "re-linked" to your system's gstack installation, allowing Pi to perform complex operations like running the Chromium engine, capturing ARIA trees, or evaluating visual designs.

---

## 1. Requirements

To use the 60 tools and 23 advanced skills, you need:

1. **A clone of gstack** on your disk.

2. **Set the `GSTACK_ROOT` environment variable** pointing to the cloned folder.
   This single variable is used by both the 60 Pi tools (to locate the compiled `browse/dist/browse` binary) and the 23 workflow skills (to find helper scripts, config, and the design engine).

   **Linux / macOS** — add to `~/.bashrc`, `~/.zshrc`, or equivalent:
   ```bash
   export GSTACK_ROOT="/absolute/path/to/gstack"
   ```

   **Windows (PowerShell)** — run once to set permanently:
   ```powershell
   [Environment]::SetEnvironmentVariable("GSTACK_ROOT", "C:\path\to\gstack", "User")
   ```
   Then **restart your terminal** (and Pi, if running) so the new variable is picked up.

   > **Why is this needed?** Without `GSTACK_ROOT`, the extension falls back to a relative path guess (`../gstack/` next to the `gstack-pi` folder). This only works if the two repos are siblings on disk. Setting the variable explicitly is more reliable and works regardless of where you install the extension.

3. **Install [Bun](https://bun.sh)** (required for the build step only; the compiled binary runs stand-alone at runtime).

   Check if Bun is already installed:
   ```bash
   bun --version
   ```
   If not, install it:
   - **macOS / Linux:**
     ```bash
     curl -fsSL https://bun.sh/install | bash
     ```
   - **Windows (PowerShell):**
     ```powershell
     irm bun.sh/install.ps1 | iex
     ```
   After installing, restart your terminal so `bun` is on PATH.

4. **Build the clone** (downloads Chromium and compiles the browse binary):
   ```bash
   cd $GSTACK_ROOT    # or cd C:\path\to\gstack on Windows
   bun install
   bun run build
   ```
   This produces `browse/dist/browse` (or `browse.exe` on Windows) and `browse/dist/server-node.mjs`.
   If the build succeeds but you later see `server-node.mjs not found`, re-run `bun run build`.

*(Note: advanced skills like `office-hours` and `design-review` also require the `design` executable. The global `bun run build` command handles all workspaces in the monorepo.)*

---

## 2. Installation

### Install from npm (Catalog)
If installing from the public npm registry:
```bash
pi install npm:@kedra/gstack-pi
```
> **⚠️ IMPORTANT CAVEAT:** npm only downloads the TypeScript extension and the workflow skills. **It does not include the Chromium browser binary.** You MUST still clone the original `gstack` repository on your machine, build it, and set the `GSTACK_ROOT` environment variable (see [Requirements](#1-requirements)). Without it, the tools will load but fail at runtime.

### Global Installation (From Local Source)
To make the tools and the 23 workflow skills permanently accessible across all your system's projects from a local checkout:
```bash
pi install /absolute/path/to/pi-extensions/gstack-pi
```
Pi will automatically install any dependencies (like `typebox`) and register the package in your global settings.

### Project-Local Installation
To install the extension locally for a single project without affecting the global environment, use the `-l` (local) flag from within your project directory:
```bash
pi install -l /absolute/path/to/pi-extensions/gstack-pi
```
This creates a `.pi/settings.json` file in your project that safely references the extension. 
> **Do not** manually copy the extension folder into a `.pi/extensions/` directory. Manual copying bypasses Pi's package manager, which causes the 23 workflow skills to be completely ignored and creates critical naming conflicts if a global package is also present.

### Development Mode (Local/On-the-fly Testing)
If you are modifying the extension's source code or want to test it in a single session without saving it to settings, load it temporarily:
```bash
pi -e /absolute/path/to/pi-extensions/gstack-pi
```
*(Tip: While the chat session is active, you can type `/reload` to instantly re-sync the extension and apply any code changes).*

---

## 3. Included Tools (60)
All tools are prefixed with `gstack_` to avoid namespace collisions. Notable tools:
- **Navigation:** `gstack_goto`, `gstack_back`, `gstack_forward`, `gstack_reload`, `gstack_load_html`
- **Visuals:** `gstack_screenshot`, `gstack_pdf`, `gstack_responsive`, `gstack_prettyscreenshot`, `gstack_diff`
- **Inspection:** `gstack_snapshot` (ARIA tree with `@e` refs), `gstack_js` (inline JS), `gstack_eval` (JS script from file), `gstack_css`, `gstack_attrs`, `gstack_is`, `gstack_inspect`, `gstack_ux_audit`
- **Interaction:** `gstack_click`, `gstack_fill`, `gstack_select`, `gstack_hover`, `gstack_type`, `gstack_press`, `gstack_scroll`, `gstack_wait`, `gstack_upload`, `gstack_style`, `gstack_cleanup`
- **Cookies/Headers:** `gstack_cookie`, `gstack_cookie_import`, `gstack_cookie_import_browser` (credential picker)
- **Extractions:** `gstack_download`, `gstack_scrape`, `gstack_archive` (MHTML)
- **Metas/Tabs:** `gstack_tabs`, `gstack_tab`, `gstack_newtab`, `gstack_closetab`, `gstack_frame`, `gstack_state`, `gstack_skill` (custom browser-skills), `gstack_handoff` (takeover visible Chrome), `gstack_resume` (return control to AI)

---

## 4. Included Workflow Skills (23)
Invokable via `/skill:<name>`. These skills are translated during sync to route execution into your `$GSTACK_ROOT` checkout dynamically.

### Plan & Review
- `office-hours` — Architecture review and consulting.
- `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `plan-devex-review` — Stakeholder-targeted PR/design validation.
- `autoplan` — Sprint planning automation.
- `spec` — Technical specification drafting.
- `review` — Code safety, SQL-injection, and LLM-boundary PR reviewer.
- `investigate` — Root cause analysis and debugging workflow.

### QA & Browsing
- `qa`, `qa-only` — Automated test generation and dogfooding.
- `design-review` — Visual regression checks and CSS audits (requires building `design` in the clone).
- `scrape` — Bulk asset extraction.
- `skillify` — Browser-automation scripts codifier.

### Security
- `cso` — Application security auditing and threat modeling.

### Memory & Release
- `ship` — Release coordination.
- `document-release`, `document-generate` — Artifact generation.
- `learn` — Agent local context retention.
- `retro` — Project post-mortems.
- `context-save`, `context-restore` — Session state backup/restoration.

---

## 5. Security Gates
- **Cookie Import:** `gstack_cookie_import_browser` is gated by a TUI confirmation pop-up. The tool cannot execute silently without user permission.
- **Strict Allowlist:** Subprocesses are locked to the filtered allowance list. Arbitrary daemon commands are rejected before spawning.
- **No Network Exposure:** CDPs, tunnels (`pair-agent`), and daemon lifecycle commands (`stop`/`restart`) are blocked by design.

---

## 6. Development
If you change the commands or flags in the gstack repository:
1. **Regenerate Pi tools:**
   ```bash
   cd gstack-pi
   node --experimental-strip-types scripts/gen-tools.ts
   ```
2. **Re-sync workflow skills:**
   ```bash
   cd gstack-pi
   node --experimental-strip-types scripts/sync-skills.ts
   ```
3. Run smoke tests:
   ```bash
   node --experimental-strip-types test/smoke.ts
   ```

---

## 7. Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `gstack browse binary not found` | `GSTACK_ROOT` not set, or binary not compiled | Set `GSTACK_ROOT` (see [Requirements](#1-requirements)), then run `bun run build` inside the gstack clone |
| `server-node.mjs not found` | Build incomplete (common on Windows) | Run `cd $GSTACK_ROOT && bun run build` again |
| `export: not recognized` (Windows) | Using bash syntax in PowerShell | Use `[Environment]::SetEnvironmentVariable(...)` instead (see [Requirements](#1-requirements)) |
| Extension loads but tools return exit 127 | `GSTACK_ROOT` was set *after* Pi started | Restart Pi so it picks up the new environment variable |
| `bun: command not found` | Bun not installed or not on PATH | Install Bun (see [Requirements](#1-requirements)), then restart your terminal |
