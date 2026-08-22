# Skill: gstack-qa (distilled for workflow phases)

Browser QA methodology: Test → Fix → Verify. Applies to qa / regression-qa phases.

## Role

Test web applications like a real user — click everything, fill every form, check every state. Use the native gstack browser tools (`gstack_goto`, `gstack_snapshot`, `gstack_click`, `gstack_fill`, `gstack_screenshot`, `gstack_console`, ...) — never raw curl for UI behavior.

## Setup

1. Determine target URL (ask the user in your final report if unknown; try dev-server defaults first). If on a feature branch, prioritize testing the changed flows.
2. Check for a clean-enough working tree; note pre-existing state before making changes.
3. Detect the project's test framework (`jest.config.*`, `vitest.config.*`, `playwright.config.*`, `pytest.ini`, test/ dirs). If a framework exists, read 2-3 existing tests to learn conventions. If none exists, note it and rely on browser evidence.

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
3. Add a regression test when the project has test infrastructure.

## Report format

```
QA REPORT
URL tested:     [url]
Flows covered:  [list]
Bugs found:     N total (C critical / H high / M medium / L low)
Fixed:          [list with commit refs + re-verification status]
Not fixed:      [list with severity + reason]
Evidence:       [screenshot paths]
Verdict:        PASS | PASS_WITH_ISSUES | FAIL
```

## Hard rules

- Never report a bug without repro steps + evidence.
- Never mark a fix verified without re-running the failing interaction in the browser.
- Do not fix anything outside the tested scope without flagging it as scope creep.
