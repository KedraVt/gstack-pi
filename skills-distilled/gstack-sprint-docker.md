<!-- provenance: .agents-clean/skills/docker-manager/SKILL.md · distilled 2026-08-24 · trimmed: shared-volume worktrees, project-specific sandbox invariant numbering, host-path specifics -->
# Skill: gstack-sprint-docker (distilled for workflow phases)

CONDITIONAL — applies only when the repo ships Dockerfile/compose. Never introduce Docker into a project that does not use it.

## Dockerfile audit (every image)
- **Multi-stage builds**: builder stage compiles; slim runtime stage copies artifacts only.
- **Dependency-layer caching**: copy lockfiles/manifests first, install deps, then copy source — code edits must not invalidate dependency layers.
- **Pinned base images**: exact versioned tags only, never `latest`.
- **Non-root runtime**: dedicated app user created and selected via `USER` in the production stage.
- **Healthchecks**: `HEALTHCHECK` (or compose `healthcheck`) hitting a real endpoint.
- **No secrets in image layers**: never `ENV API_KEY=…`; inject at runtime from env/`.env` excluded from git and build context. Secrets in any layer persist even if deleted later.
- **Minimal context**: `.dockerignore` covering deps, `.git`, `.env*`, build output, tests, logs.
- Exec-form `CMD` so signals propagate (graceful shutdown).

## Compose orchestration
- Services resolve by service name on the internal network; publish ports to host only for local debugging (bind `127.0.0.1:`); omit host ports in production.
- Order with `depends_on.condition: service_healthy`; named volumes for persistent data; bind mounts only for dev hot-reload.
- Harden services where feasible: `cap_drop: [ALL]`, `read_only: true` plus tmpfs `/tmp`.

## Untrusted execution (sandbox) — non-negotiable when containers run generated/untrusted code
Spawn with all of: `--network none`; `--read-only` rootfs plus small noexec tmpfs; `--user` non-root (UID ≥ 1000); hard ceilings `--memory`, `--cpus`, `--pids-limit`; `--rm` with absolute stop-timeout; `--cap-drop=ALL`; no secrets/host env injected; minimal purpose-built worker image. Never mount the Docker socket into sandboxes, never `--privileged`/`--cap-add`. Track container id and start time, poll state, force-stop past deadline, capture logs before removal, strip host paths from logs, and run a background reaper for orphans matching the name prefix.

## Verification
Build exits 0; health status reports healthy; prove isolation empirically: network probe under `--network none` fails, write under `--read-only` fails, `id` shows uid ≥ 1000, memory limit set in inspect. Report build result, security verdict, per-check evidence, remediation commands for rejections.
