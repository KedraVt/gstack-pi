# gstack-pi — EFFICIENCY PLAN v3: "Injection Correctness"

> **Stato:** APPROVATO, NON ANCRA IMPLEMENTATO. Branch di lavoro: `feat/skill-ingestion`.
> **Executore:** questo documento è autocontenuto. Seguire i passi nell'ordine, senza deviazioni di design.
> **Regola ferrea:** TUTTI i fix vanno implementati PRIMA di qualsiasi test live. Ogni passo = 1 commit atomico, suite sempre verde.

---

## 0. Contesto e diagnosi

### 0.1 Evidenza dalla sessione reale del 2026-08-22 (ciclo investigate)

| Fase | Durata | Problema osservato |
|---|---|---|
| reproduce | 4,5 min | drift: diagnosi completa prodotta in fase di solo-reproduzione |
| root-cause | **80 min** | catena scout→planner rieseguita interamente nonostante la causa fosse già nota |
| gate | — | approvazione richiesta su diagnosi ridondante/pre-conclusa |
| fix | 18 min | ok ma con prefill gonfio |
| regression-qa | 20 min (timeout) | processo ucciso a metà frase, output mascherato da "completed", QA rifatto dal main (+10 min) |

### 0.2 Causa radice (confermata): ERRORI DI INIEZIONE sui subagent

- **E1 — Digest completo in OGNI step di catena.** `buildTaskSkills()` (orchestrator/templates.ts) applica il digest di fase identico a ogni step: nella catena root-cause sia scout CHE planner ricevono l'intera metodologia, anche se il planner ne usa solo la fix-strategy.
- **E2 — `{previous}` passa l'output INTERO** (cap 12K caratteri, executor.ts ~righe 177-219): prefill enorme su ogni turno del ricevente, e il suo system prompt lo invita comunque a riverificare i file → turni duplicati.
- **E3 — Nessuna stop condition / ordine sbagliato nei task**: la metodologia arriva PRIMA dell'obiettivo → il modello segue il metodo invece di raggiungere il deliverable → esplosione di turni (scout "Medium" = 20-40 tool call). Tempo totale = `turni × latenza-per-turno`; la dimensione del repo è irrilevante.
- **E4 — Catene fisse ignare dei risultati precedenti**: se reproduce ha già confermato la causa, la catena completa gira comunque (80 min per riscoprire l'ovvio).
- **E5 — Timeout unico a muro (20 min) senza liveness**: QA sana e processo bloccato sono indistinguibili fino al kill; l'output troncato veniva scambiato per completo.

### 0.3 Non-negoziable
Il meccanismo di spawn NON si tocca: `spawn.ts` produce già processi byte-identici all'estensione subagent (`pi --mode json -p --no-session --model --tools --append-system-prompt`). Il costo per chiamata non è il problema. Si corregge COSA viene iniettato e COME la catena viene orchestrata.

---

## 1. Regole per l'agente executore

1. Lavora su `feat/skill-ingestion` in `C:\Users\Mattia\.pi\agent\extensions\gstack-pi`. Un commit per passo. MAI mescolare passi.
2. Dopo OGNI passo: `bun test test/orchestrator.test.ts` → tutti verdi (partono da 54, crescono). Poi bundle check: `bun build orchestrator/index.ts --target node --outdir .tmp-check` (eliminare `.tmp-check` dopo).
3. Ogni logica decisionale va in moduli puri con unit test (`skip.ts`, `handoff.ts`, `waves.ts`). `executor.ts`/`spawn.ts` orchestrano soltanto.
4. Ambiente Windows/PowerShell; warning git LF/CRLF innocui.
5. Se un anchor-text citato non matcha esattamente (il codice evolve), trova l'equivalente più vicino, adatta al minimo, documenta la deviazione nel commit message.
6. Le definizioni agente vivono FUORI dal repo: `C:\Users\Mattia\.pi\agent\agents\{scout,planner,worker,reviewer}.md`. Ogni modifica a quei file va SPECCHIATA in `AGENTS_NOTES.md` dentro il repo.

---

## STEP 1 — Contratti di task deliverable-first [corregge E3]

**File:** `orchestrator/templates.ts`

### 1a. Riscrivere ogni voce del record `tasks` in `buildAgentTask()` con ordine fisso a 4 blocchi

```text
## DELIVERABLE
<falsificabile: guardando l'output si dice sì/no>

## STOP CONDITION
<Ferma quando: <condizione>. Ulteriore esplorazione è spreco.>

## CONTEXT
{goal} | branch {branch} | fasi precedenti (compressi) | {previous}

## METHODOLOGY
[skill blocks con prefisso di classe — vedi 1b]
```

Contenuti minimi per fase (adattare la prosa, mantenere la sostanza):

| fase.id | DELIVERABLE | STOP CONDITION |
|---|---|---|
| explore | file+linee rilevanti, pattern architetturali, vincoli, test infra | elementi coperti per il goal |
| reproduce | trigger deterministico del bug + sintomi vs attesi + marker `CONFIRMED ROOT CAUSE: ... \| files: ...` oppure `none` (vedi STEP 4) | bug riprodotto E causa verificata su codice (≤3 letture mirate), o riproduzione affidabile senza causa |
| implement | codice secondo `{plan_file}`, deviazioni giustificate, test girati | piano implementato, test verdi |
| qa | per ogni flow legato al goal: pass/fail + screenshot + severity CRITICAL/HIGH/MEDIUM/LOW + riga `COVERAGE: <flow testati>` | flow richiesti coperti OPPURE 2 passate senza nuovi finding (i flow del deliverable sono SEMPRE obbligatori) |
| review | findings con severity + file:line + scope-check + verdetto APPROVE/REQUEST_CHANGES | analisi completa del diff |
| ship | push, PR URL, TODOS.md aggiornato, commit atomici verificati | checklist completata |
| fix | fix minimali applicate, test verdi, regressione per CRITICAL/HIGH | tutti i finding indirizzati |
| test | comandi identificati + pass/fail + dettagli fallimenti | suite completata |
| push-pr | PR URL + CI status | PR creata |
| diff | files changed, +/-, sintesi per area | analisi completa |

### 1b. Classi skill e prefissi

Mappa in templates.ts:
`gstack-qa, gstack-review, gstack-investigate, grilling, gstack-document-generate → "format-critical"`;
`gstack-ship, gstack-office-hours, gstack-plan-eng-review, gstack-document-release → "support"`.

In `buildTaskSkills()` prefisso per blocco digest:
- format-critical: `"This methodology's output format IS part of the deliverable: severity categories, gates and report structures are MANDATORY."`
- support: `"Apply the parts useful to the deliverable; nothing more."`

**Test nuovi:** ogni task delegato contiene `DELIVERABLE` e `STOP CONDITION`; prefisso forte/debole corretto per classe.

**Commit:** `fix(injection): deliverable-first task contracts with explicit stop conditions [E3]`

---

## STEP 2 — Protocollo HANDOFF + estrattore [corregge E2]

### 2a. Contratto di output nei task
Aggiungere a OGNI template (dopo METHODOLOGY):

```text
## OUTPUT CONTRACT
1. "## REPORT" — il report completo nel formato del tuo ruolo.
2. "## HANDOFF" (obbligatorio, ≤300 parole, per il prossimo specialista):
   - VERIFIED FACTS: solo fatti confermati, ognuno con evidenza `claim @ file:line`
   - DECISIONS: scelte fatte e perché (una riga ciascuna)
   - OPEN QUESTIONS: ciò che resta aperto (o "none")
   - DO NOT REDO: cosa il prossimo NON deve rifare
```

### 2b. Nuovo modulo `orchestrator/handoff.ts` (puro)

```ts
export type HandoffLevel = "full" | "partial" | "raw" | "fallback";
export function extractHandoff(output: string): { text: string; level: HandoffLevel };
```

Regole in ordine:
1. output assente/vuoto → `{ text: "(previous step failed)", level: "raw" }`
2. output ≤ 6000 caratteri → intero, `"raw"` (comprimerlo è inutile)
3. ultima sezione `## HANDOFF` presente, contiene `VERIFIED FACTS`, ≤ 4000 char → quella, `"full"`
4. sezione presente ma incompleta/malformata e ≤ 4000 char → quella, `"partial"`
5. altrimenti → ultimi 12000 char tagliati al fine paragrafo, `"fallback"`

### 2c. `executor.ts`
Sostituire il blocco `PREVIOUS_CAP` (righe ~183-188) con `extractHandoff()`. Il livello va nel delegation summary:
`### Subagent: <name> — completed (Ns · N tool calls · N turns · Ns/turn · handoff: <level>)`

### 2d. Direttive nei file agente (HOME, fuori repo) + specchio
In `~/.pi/agent/agents/planner.md` aggiungere dopo il paragrafo cooperazione:
`"You receive VERIFIED FACTS from a prior specialist. Do NOT re-verify systematically. Re-read a file ONLY if a claim is load-bearing for a decision you must make."`
In `worker.md`: `"Trust the HANDOFF section of the task as verified context; re-check only load-bearing claims."`
Riportare entrambe le righe in `AGENTS_NOTES.md` (nuovo file in repo root) con path dei file home.

**Test nuovi (handoff.ts):** livello full / partial / raw≤6K / fallback>12K / output vuoto; invariante: testo mai >4000 quando full.

**Commit:** `fix(injection): structured HANDOFF protocol with bounded extraction [E2]`

---

## STEP 3 — Skill selettiva per chain-step [corregge E1]

### 3a. `orchestrator/types.ts`
Il tipo dei chain step (dentro `WorkflowPhase["chain"]`) guadagna campo opzionale:
`skills?: string[]` — default: eredita `phase.skills` (retrocompatibile).

### 3b. `orchestrator/workflows.ts` — annotazioni
Per OGNI catena presente nel file, annotare gli step:
- `root-cause` (investigate): scout → skills `["gstack-investigate"]`; planner → skills `[]` (riceverà l'excerpt fix-strategy inline, vedi 3d)
- tutte le altre catene: lasciare senza override salvo evidenza contraria; documentare la scelta in commento

### 3c. `orchestrator/templates.ts`
Firma: `buildTaskSkills(phase, task, skillsOverride?: string[])`.
In `buildDeterministicPlan()` e `buildSubagentInstructions()` passare `step.skills ?? phase.skills`.

### 3d. Excerpt fix-strategy dal digest (fonte unica)
In `skills-distilled/gstack-investigate.md` avvolgere la sezione fix-strategy esistente tra marker letterali:
`<!-- fix-strategy:start -->` ... `<!-- fix-strategy:end -->`
In `skills.ts`: `export function getDigestExcerpt(id: string, name: string): string | null` (ritorna il contenuto tra i marker, null se assenti).
Nel task planner di root-cause: se excerpt disponibile, appenderlo come `## Fix strategy principles (excerpt from gstack-investigate)`.

**Test nuovi:** per ogni catena: lo step con override `[]` NON contiene l'header `## Skill methodology:` pieno ma contiene l'excerpt; lo step scout lo contiene; getDigestExcerpt gestisce marker mancanti.

**Commit:** `fix(injection): role-scoped skill injection for chain steps [E1]`

---

## STEP 4 — Skip strutturale con refutation path [corregge E4]

### 4a. Marker machine-readable
I template `reproduce` e `fix` richiedono già (STEP 1) la riga finale:
```
CONFIRMED ROOT CAUSE: <causa sintetica> | files: <f1, f2>
```
con istruzione esplicita: *"scrivi questa riga SOLO se hai verificato la causa contro il codice; altrimenti scrivi `CONFIRMED ROOT CAUSE: none`"*.

### 4b. Nuovo modulo `orchestrator/skip.ts` (puro)
```ts
export interface RootCauseMarker { cause: string; files: string[] }
export function parseRootCauseMarker(summary: string | undefined): RootCauseMarker | null;
// regex multilinea /^CONFIRMED ROOT CAUSE:\s*(.+?)\s*\|\s*files:\s*(.+)$/im
// "none" / assente / malformata → null. files splittati su virgola, trimmed.
```

### 4c. `buildDeterministicPlan()` — collasso condizionale
Se `phase.id === "root-cause"` E `parseRootCauseMarker(ctx.state.results["reproduce"]?.summary) !== null`:
piano ridotto a UNO step `{ agent: "planner", task: validateStrategyTask(marker) }`, dove validateStrategyTask:
```
DELIVERABLE: fix strategy validata.
Lo specialist precedente ha CONFERMATO questa causa: "<cause>" (files: <files>).
1. Verificala rapidamente contro il codice (≤5 letture mirate ai file citati).
2. Se confermata: producila come "VALIDATED: <meccanismo @ file:line>" + fix strategy completa.
3. Se smentita: produci "REFUTED: <motivo>" come PRIMA riga dell'output.
STOP CONDITION: causa validata o refutata.
```

### 4d. `executor.ts` — reopen path obbligatorio
Dopo uno step validate-only di root-cause: se l'output contiene una riga che inizia con `REFUTED:` → ricostruire ed eseguire la CATENA COMPLETA originale (scout→planner), anteponendo allo scout: `"NOTA: l'ipotesi '<cause>' è stata CONFUTATA perché: <motivo>. Non ripercorrerla."`. Registrare nel summary: `root-cause: validated | refuted→full-reinvestigation`.
Caso QA analogo: se summary fase `test` = 0 failure, saltare step fix-loop della qa workflow (stessa infrastruttura skip.ts, funzione `allTestsPassed(summary)`).

**Test nuovi:** parse ok/none/malformata; piano root-cause collassato a 1 step col marker; piano integro senza marker; flag REFUTED→rebuild rilevato; allTestsPassed true/false/malformed.

**Commit:** `feat(orchestration): structural skip with mandatory refutation path [E4]`

---

## STEP 5 — Timeout adattivi + liveness + onde parallele [corregge E5]

### 5a. `orchestrator/config.ts` — timeout per classe
Nuove chiavi env con default:
`GSTACK_PI_TIMEOUT_EXPLORE=480`, `GSTACK_PI_TIMEOUT_WORK=1500`, `GSTACK_PI_TIMEOUT_VERIFY=900` (secondi).
`export function subagentTimeoutFor(phaseId: string): number` con mappa:
explore/scout→EXPLORE; implement/qa/fix→WORK; review/test/verify/push-pr/ship/document→VERIFY; fallback = `GSTACK_PI_SUBAGENT_TIMEOUT` (2000).
`spawn.ts`: usare `subagentTimeoutFor` al posto del valore globale.

### 5b. Liveness observe-only
In `spawn.ts` esiste già un poll a 1 Hz: aggiungere tracking del gap tra eventi JSON. Se gap > `GSTACK_PI_LIVENESS_SEC` (default 240):
- NON terminare il processo
- loggare una sola volta per run: `[liveness-observe] would abort '<agent>' after <gap>s of silence (last event: <tipo>)`
Flag disattivabile: `GSTACK_PI_LIVENESS_SEC=off`. L'ATTIVAZIONE del kill vero è VIETATA in questo piano: richiede dati da almeno 2 run reali (vedi §Validazione).

### 5c. Onde parallele limitate
- `types.ts`: chain step guadagna `after?: number[]` (indici di dipendenza) e `exclusive?: boolean`.
- Nuovo modulo puro `orchestrator/waves.ts`: `export function buildWaves(steps): number[][]` — topologico; senza `after` = ondate sequenziali (comportamento attuale); `exclusive` occupa da solo la sua ondata.
- Annotazioni workflows.ts: nella qa workflow, step `test` e step diff-analysis → paralleli (`after: []`, stesso wave); in ship, coverage-audit ∥ changelog-check. Catene scout→planner restano sequenziali.
- `executor.ts`: eseguire onda per onda con `Promise.all`, concorrenza massima `GSTACK_PI_MAX_PARALLEL` (default 2). Merge dei risultati nell'ordine dichiarato. Ramo fallito: retry-once dopo 30s, poi demozione a coda sequenziale dopo gli altri step dell'onda. Status label composita: `test ∥ diff-analysis · Ns`.
- Regola di sicurezza: step che fanno git-write non vanno MAI parallelizzati (`exclusive: true`).

**Test nuovi:** buildWaves (sequenziale default, con deps, exclusive); mapping timeout per classe; config override env; liveness produce log e non termina.

**Commit:** `feat(orchestration): adaptive timeouts, liveness observation, bounded parallel waves [E5]`

---

## STEP 6 — Documentazione

1. `README.md`: nuova sezione "Injection & efficiency" — contratti di task, protocollo HANDOFF, marker CONFIRMED/REFUTED, timeout per classe, variabili env nuove complete.
2. `FUTURE_UPDATES.md`: spostare/aggiornare — attivazione kill della liveness (post-dati), estensione onde parallele ad altre catene, rollout skip a develop.plan se emerge drift analogo.
3. `AGENTS_NOTES.md`: stato completo richiesto dei file home (già creato allo STEP 2d).

**Commit:** `docs: injection correctness behavior and configuration`

---

## VALIDAZIONE (solo DOPO tutti gli STEP 1-6 committati)

1. `bun test test/orchestrator.test.ts` — tutti verdi (attesi ≥75 test)
2. Bundle: `bun build orchestrator/index.ts --target node --outdir .tmp-check` pulito; rimuovere `.tmp-check`
3. Ricaricare pi ed eseguire UN ciclo `/gstack investigate` reale su repo di prova
4. Criteri di accettazione (leggibili dai delegation summary):
   - root-cause col marker presente: piano a 1 step, durata < 10 min
   - handoff level visibile nel summary (full/partial/raw/fallback) per ogni step
   - nessun task delegato senza DELIVERABLE/STOP CONDITION
   - planner di root-cause SENZA digest pieno, CON excerpt
   - zero kill da timeout su fasi WORK (se capita: registrare fase+durata, NON alzare i timeout senza evidenza)
   - log liveness-observe presenti o assenti coerentemente (nessun kill)
5. Confronto esplicito con baseline della sessione 2026-08-22 (~150 min macchina): target ≤ 60 min sullo stesso scenario
6. Riportare i numeri raccolti: serviranno a decidere l'eventuale attivazione della liveness kill (fuori dallo scope di questo piano)

## ROLLBACK

Ogni STEP è un commit atomico con test propri: `git revert <sha>` ripristina il comportamento precedente senza toccare gli altri. I flag esistenti (`GSTACK_PI_SKILLS/DETERMINISTIC/MANUAL_GATES`) continuano a disabilitare interi sottosistemi.




