# Skill: gstack-qa (distilled for workflow phases)

Browser QA methodology: Test → Fix → Verify. Applies to qa / regression-qa phases.

## Role

Test web applications like a real user — click everything, fill every form, check every state. Use the native gstack browser tools (`gstack_goto`, `gstack_snapshot`, `gstack_click`, `gstack_fill`, `gstack_screenshot`, `gstack_console`, ...) — never raw curl for UI behavior.

## Setup

1. Determine target URL (ask the user in your final report if unknown; try dev-server defaults first). If on a feature branch, prioritize testing the changed flows.
2. Check for a clean-enough working tree; note pre-existing state before making changes.
3. **Test-framework bootstrap**: detect the project's test framework (`jest.config.*`, `vitest.config.*`, `playwright.config.*`, `.rspec`, `pytest.ini`, `phpunit.xml`, test/ dirs). If a framework exists, read 2-3 existing tests to learn conventions (naming, imports, assertion style, setup). If a runtime exists but no framework, note it in the report — do not scaffold a framework unilaterally. If no runtime is detectable at all, say so and rely on browser evidence.

## Test pass (Standard tier)

Walk the primary user flows end to end:
- Navigation, forms (valid + invalid input), buttons, links
- Console errors on every page visited (`gstack_console`)
- Failed network requests (`gstack_network`)
- Responsive layout at mobile + desktop viewports (`gstack_responsive`)

Capture evidence: screenshot per finding and per major flow (`gstack_screenshot`). A bug without repro steps or evidence did not happen.

## Bug classification

```
CRITICAL — flow broken, data loss, security issue
HIGH      — major feature misbehaves in realistic use
MEDIUM    — degraded UX, wrong validation, console errors
LOW       — cosmetic, minor polish
```

Tier policy: fix CRITICAL + HIGH always; MEDIUM when time allows (standard); LOW only if asked.

## Fix loop

1. Fix in source code with **atomic commits** (one logical fix per commit).
2. Re-verify each fix in the browser before moving to the next.
3. **Regression tests — bounded rule**: one regression test per CRITICAL or HIGH fix, following the project's existing test conventions. Skip when no framework exists (say so in the report). Never let test generation balloon beyond the fixes found.

## Report-only variant

In REPORT-ONLY mode: run the full test pass and classification exactly as above, but do NOT fix anything and do NOT commit. The report is the entire deliverable; add a `Recommended fix` line per bug instead.

## Report format

```
QA REPORT
URL tested:     [url]
Flows covered:  [list]
Bugs found:     N total (C critical / H high / M medium / L low)
Fixed:          [list with commit refs + re-verification status]
Not fixed:      [list with severity + reason]
Regression:     [tests added, or "n/a (no framework)" / "n/a (report-only)"]
Evidence:       [screenshot paths]
Verdict:        PASS | PASS_WITH_ISSUES | FAIL
```

## Hard rules

- Never report a bug without repro steps + evidence.
- Never mark a fix verified without re-running the failing interaction in the browser.
- Do not fix anything outside the tested scope without flagging it as scope creep.
