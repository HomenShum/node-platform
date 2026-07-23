# Fresh-human usability study operator

Status: **collection tooling implemented and tested; 0/5 real current-candidate participants collected.**

This workflow makes the five-person NodeKit ease study recordable without inventing a person,
consent decision, timer, answer, screenshot, recording, or result. It does not run the study for
you and it cannot turn an agent simulation into human evidence.

## Fixed protocol

- Freeze one distributable NodeKit candidate first.
- Recruit exactly five people who have not used the candidate.
- Obtain explicit consent before creating a session. Obtain a separate yes/no decision for a
  screen recording. A recording is optional; a completion PNG and session log are mandatory.
- Do not enter names, email addresses, demographic data, free-form notes, or raw consent text into
  the operator. It creates a random anonymous ID such as `participant_4fa62c7e27da18be`.
- After consent, show only: **“Use this app to complete the job shown on screen.”**
- Record events at the moment they occur. Do not reconstruct times afterward.
- Ask the Single Ease Question only after the journey ends. Record the observed outcome booleans
  exactly, including failures and assistance.
- Keep every attempt for the exact candidate. The assembler refuses to select five from a larger or
  smaller matching set.

The preregistered pass thresholds remain: exactly five people, at least four unassisted
completions, median first meaningful action at most 30 seconds, median journey at most 180 seconds,
median SEQ at least 6/7, at least four people able to explain the outcome and locate the final
artifact and unresolved issues, and zero P0/P1 failures.

## Start

Use the exact frozen-candidate manifest. Do not use a mutable or earlier `latest` manifest.

```powershell
npm run ease:human-study -- start `
  --candidate-manifest proof/ease/latest/manifest.json `
  --consent yes `
  --recording-consent no `
  --fresh yes `
  --consent-version nodekit-human-study-consent/v1
```

The command refuses to start without explicit `yes` consent, an explicit recording choice, a fresh
participant, and a valid immutable commit/source hash. It stores no participant PII.

## Record the live observation

Record exactly one first-action result and one journey end. `first-action-not-reached` honestly
represents a participant who never makes a meaningful action; it does not invent a fast time.

```powershell
npm run ease:human-study -- mark --participant-id <id> --event first-action
# Or, never both:
npm run ease:human-study -- mark --participant-id <id> --event first-action-not-reached

npm run ease:human-study -- mark --participant-id <id> --event wrong-turn
npm run ease:human-study -- mark --participant-id <id> --event help-request
npm run ease:human-study -- mark --participant-id <id> --event p0-p1-failure
npm run ease:human-study -- mark --participant-id <id> --event journey-ended
```

If the observation is paused and later continued, record the resumption rather than replacing the
original start:

```powershell
npm run ease:human-study -- resume --participant-id <id>
```

Every command appends an event with wall-clock time, OS monotonic nanoseconds, sequence number,
previous-event digest, and event digest. A clock rollback, broken chain, duplicate milestone, event
after finalization, or concurrent operator lock fails closed.

## Import exact evidence bytes

Export or capture a PNG that shows the participant’s completed or terminal state, then import the
actual file. Text renamed to `.png`, malformed PNG chunks, and invalid CRCs are rejected.

```powershell
npm run ease:human-study -- evidence `
  --participant-id <id> `
  --kind screenshot `
  --label completion `
  --file C:\study-capture\completion.png
```

Only when the participant separately consented to recording:

```powershell
npm run ease:human-study -- evidence `
  --participant-id <id> `
  --kind recording `
  --label full-session `
  --file C:\study-capture\session.webm
```

The source path is never stored. NodeKit copies the bytes under
`proof/ease/humans/<anonymous-id>/evidence/`, names the copy with its digest prefix, and records the
full SHA-256 and byte count. Re-importing the identical file is idempotent. Evidence is never
overwritten.

## Finalize

```powershell
npm run ease:human-study -- finalize `
  --participant-id <id> `
  --completed yes `
  --assisted no `
  --can-explain-outcome yes `
  --located-final-artifact yes `
  --located-unresolved-issues yes `
  --seq 7
```

Finalization derives durations from the append-only monotonic events, counts wrong turns/help/P0-P1
events, writes `session-log.json`, and writes the existing evaluator-compatible `participant.json`.
It can safely resume a partially materialized finalization, but it never changes prior bytes or
answers. A second finalization with different answers is rejected.

Inspect current state at any time:

```powershell
npm run ease:human-study -- status --participant-id <id>
```

## Assemble and independently evaluate

After all five exact-candidate attempts are finalized:

```powershell
npm run ease:human-study -- assemble `
  --candidate-manifest proof/ease/latest/manifest.json `
  --output proof/ease/fresh-users.json

npm run ease:evaluate-humans -- proof/ease/fresh-users.json proof/ease/fresh-users-verdict.json
```

The assembler reopens every matching session, recomputes the event chain and derived participant
record, hashes every screenshot/recording/session log, rejects symlink escapes, requires globally
unique paths and bytes, and writes the study file with exclusive-create semantics. The independent
evaluator then reopens those same files. Neither command supplies external reviewer attestation or
publication approval.

## File contract

```text
proof/ease/humans/<anonymous-id>/
├── session-meta.json     # candidate identity and consent choices; no PII
├── events.jsonl          # append-only hash-chained observation events
├── evidence/
│   ├── screenshot-completion-<digest>.png
│   └── recording-full-session-<digest>.webm   # optional
├── session-log.json      # derived exact timers, event chain, evidence inventory
└── participant.json      # input fragment for the existing human evaluator
```

Strict schemas:

- `schemas/nodekit.human-study-session-meta.v1.schema.json`
- `schemas/nodekit.human-study-event.v1.schema.json`
- `schemas/nodekit.human-study-session-log.v1.schema.json`
- `schemas/nodekit.fresh-user-study.v1.schema.json`

## Authority boundary

Passing deterministic tests proves only that the collector is fail-closed. It does not prove that a
real participant consented or that NodeKit is easy. The five sessions, exact screenshots, optional
recordings, and answers must come from five actual people observing the same frozen candidate. Until
that external work exists and is independently attested, the correct status remains:

> **EASE_NOT_CERTIFIED — DO NOT SUBMIT**

