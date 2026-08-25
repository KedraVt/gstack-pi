<!-- provenance: .agents-clean/skills/pipeline-sre/SKILL.md · distilled 2026-08-24 · trimmed: multi-agent shared-volume output templates (devops/devsecops/*), docker-manager cross-references & Dockerfile audit/build-report templates, system-design_XX tool-selection preamble, agent-role handoff boilerplate -->
# Skill: gstack-sprint-pipeline (distilled for workflow phases)

CONDITIONAL — applies only when authoring or modifying CI/CD configs (.github/workflows, gitlab-ci.yml, etc.).

## Quality gate pipeline (no gate skipped)
Order jobs fail-fast so cheap checks kill the run first:
Lint → Type Check → Unit Tests → Build → Integration → Security Audit (SAST/SCA). Fast tests before slow tests; shift left.

## Hardening checklist
- **Least privilege**: minimal token scopes per job (e.g. `permissions:` block); no org-wide PATs.
- **Pin versions**: actions by full commit SHA, tools/deps via lockfile — never floating tags like `@main`.
- **Secrets**: platform vault / secrets manager only; never inline in YAML, env dumps, or logs. CI never holds production secrets.
- **Reproducibility**: committed lockfiles, pinned base images, deterministic cache keys; immutable infrastructure.
- **Rollback story**: every deployment must be instantly reversible — wire automated rollback/revert into the pipeline, not a manual runbook.
- Progressive delivery where appropriate: feature flags, canary deployments.
- SBOM generation + image signing if applicable.

## Static hygiene
- `.gitignore` covers build dirs and `.env`; scan staged changes (`git diff --staged`) for leaked secrets before push.
