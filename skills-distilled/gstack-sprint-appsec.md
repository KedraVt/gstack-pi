<!-- provenance: .agents-clean/skills/appsec-hardening/SKILL.md · distilled 2026-08-24 · trimmed: system-design_XX doc cross-refs, shared-volume artifact paths (devops/devsecops/*), Planner execution-loop variable names, full OWASP LLM Top-10 walkthrough -->
# Skill: gstack-sprint-appsec (distilled for workflow phases)

Security review checklist for code produced during Implement Fix / Verify Fix phases. Apply when touching user input, auth, DB storage, uploads, third-party integrations, or LLM features.

## Review Checklist

### 1. Threat model (STRIDE-lite over NEW trust boundaries)
For each boundary introduced or crossed by the change (client→API, service→service, app→DB, app→LLM):
| Threat | Component | Risk | Attack Scenario | Mitigation |
|--------|-----------|------|-----------------|------------|
| Spoofing / Tampering / Repudiation / Info disclosure / DoS / Elevation | ... | H/M/L | one line | concrete control |

Skip rows that don't apply; never skip the boundary scan itself.

### 2. Secrets hygiene
- [ ] Zero hardcoded creds, tokens, connection strings in diff
- [ ] Env validation at startup: required vars checked once, fail fast on missing
- [ ] No secrets in logs or error messages

### 3. Injection prevention
- [ ] All DB queries parameterized (no string-built SQL)
- [ ] Output encoded when rendering user data (XSS)
- [ ] No `eval()`/equivalent on user-provided data
- [ ] Shell/paths built from user input? sanitize or avoid

### 4. Authn / Authz
- [ ] New endpoints/mutations check authentication AND authorization server-side
- [ ] Client-side validation treated as UX only, never a security boundary
- [ ] Sessions: httpOnly, secure, sameSite cookies; passwords bcrypt/argon2

### 5. Secure error handling
- [ ] Errors return generic messages to clients; stack traces/internal details stay in server logs
- [ ] Failures don't leak whether a resource exists (user enumeration)

## Actionable-Remediation Rule
No finding without a copy-paste-ready fix. Every issue reported as:
- **[File:line]** description
  - *Fix:* exact code/config snippet

Verdict per phase: `approved` only when zero unresolved findings; otherwise `rejected` with the fix list above.
