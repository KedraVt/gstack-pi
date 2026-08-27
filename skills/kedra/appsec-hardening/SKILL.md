---
name: appsec-hardening
description: Security-first practices for web applications, API security, Threat Modeling, and LLM governance.
---

# AppSec & Hardening Framework

Apply this framework when handling user input, authentication, database storage, file uploads, third-party integrations, or AI/LLM features. **Always cross-reference the `system-design_XX` document** to tailor mitigations to the specific tech stack.

## The Three-Tier Boundary System

### Always Do
* Validate all external input at the system boundary using strict schemas.
* Parameterize all database queries to prevent Injection.
* Encode output to prevent XSS.
* Hash passwords appropriately (e.g., bcrypt/argon2).
* Use httpOnly, secure, sameSite cookies for sessions.

### Never Do
* Commit secrets to version control.
* Trust client-side validation as a security boundary.
* Use `eval()` or similar functions with user-provided data.

## Output Template 1: Security Audit Report (Sprint Execution)

When evaluating generated code during a sprint, you MUST write your report to the shared volume directory: `devops/devsecops/security-review-artifact.md`.
Use this exact format so the Planner can parse your variables for the execution loop:

```markdown
## Security Audit Report
**security-review:** approved | rejected
**problems-security:** [If approved, write "none". If rejected, summarize the vulnerabilities for the developers so they can fix them.]

### Security Vulnerabilities (problems-security details)
- **[File:line]** [Description]
  - *Fix:* [Provide actionable code snippet to mitigate the risk]
```

## Output Template 2: Structured Threat Model (Design Phase)

When requested to evaluate architecture before coding, output your Threat Model to `devops/devsecops/threat-model.md` using this template:

```markdown
## Threat Model: [Feature/Component]

### System Overview & Boundaries
*Based on `system-design_XX`*
- **Boundary**: [From] -> [To] | **Controls**: [Specific mitigations]

### STRIDE Analysis
| Threat | Component | Risk (High/Med/Low) | Attack Scenario | Mitigation (Code/Config) |
|--------|-----------|---------------------|-----------------|--------------------------|
| ...    | ...       | ...                 | ...             | ...                      |
```

## AI & LLM Governance

If the `system-design_XX` indicates LLM usage, apply the OWASP Top 10 for LLMs:
* Treat model output as completely untrusted.
* Do not rely on the system prompt as a security boundary (Prompt Injection).
* Keep secrets and cross-tenant data out of the context window.
