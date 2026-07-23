# NodeKit Builder Gym

Status: **first-class mechanics implemented and fixture-tested; real fresh-agent and human-preference evidence remains open**

Builder Gym is the first application gym inside Harness Gym. It is not another agent platform and
does not run or promote models. It measures whether a bounded change to the builder harness helps a
fixed model complete a fixed protected repository task without making artifact quality, UI quality,
safety, evidence integrity, or efficiency worse.

```text
protected task + fixed model + Harness v0
-> content-addressed NodeTrace trajectory
                         \
                          -> protected Builder Gym evaluator -> provisional verdict
                         /
protected task + fixed model + Harness v1 candidate
-> content-addressed NodeTrace trajectory
```

## NodeTrace trajectory contract

`nodekit.nodetrace-trajectory/v1` is the portable, content-addressed observation. Its address is
`nodetrace:sha256:<hash>`, where the hash is computed over the canonical trajectory body excluding
only the derived `trajectoryId` and `trajectoryHash` fields. Editing any event, identity, artifact,
verdict, metric, or evidence reference changes the address.

Every trajectory carries seven separate verdict dimensions:

1. task completion;
2. artifact quality;
3. UI quality;
4. safety and authority;
5. efficiency, including time, tokens, cost, turns, tools, retries, and repairs;
6. evidence integrity;
7. human preference, including an explicit `not-collected` state.

The contract also binds exact task-set and brief hashes; requested and resolved model identity;
builder, runtime, interaction, tool-surface, context-policy, and skill-stack hashes; the protected
evaluator identity; budgets; changed paths; ordered events; artifacts; proof receipt; and
content-addressed evidence objects.

In v1, trajectory dimension scores and `proofReceiptId` are observations supplied by the
trajectory producer. They are explicitly labeled `trajectory-self-reported`; they are not a
protected evaluator signature. The protected comparison may report whether those observations
meet the frozen local thresholds, but it always records `protectedEvaluationPassed: false` and
cannot authorize a protected real-world claim. A later evaluator-derived/signature contract is
required before that claim can change.

Recording reopens every evidence file, rejects symlinks and repository escapes, recomputes its
SHA-256, and confirms that all verdict evidence hashes are declared. Inspection repeats those
checks rather than trusting a stored success flag.

## Protected evaluator boundary

`nodekit harness init` now initializes Builder Gym under the existing `harness/` tree:

```text
harness/
├── evaluators/builder/protected-evaluator.json
├── gyms/builder/builder-gym.json
├── tasks/{validation,heldout,adversarial}/index.json
├── trajectories/builder/sha256/<trajectory-hash>.json
└── receipts/builder/<verdict-hash>.json
```

The evaluator manifest is hashed independently. The Builder Gym manifest binds that exact hash,
the protected task indexes, score and budget thresholds, candidate write roots, and fixed inputs.
Initialization and every record/evaluation reject overlapping candidate/protected roots.

Before candidate execution, `builder lock` snapshots the baseline trajectory, evaluator hash,
protected task-set hash, byte hash of every protected-root file, fixed inputs, and write boundary.
The caller must retain the emitted lock hash outside candidate authority and pass it back through
`--expected-lock-hash`; a candidate-authored replacement lock fails closed.

A candidate may change only declared builder-harness surfaces. It may not change protected task
indexes, evaluator manifests, thresholds, or Builder Gym configuration. Baseline and candidate
must hold application, task, task set, exact model, budgets, runtime harness, interaction harness,
tool surface, context policy, skill stack, and evaluator identity fixed. Only the builder harness
identity may differ.

`changedPaths` is not accepted as an unsupported agent assertion. Each trajectory binds an
external-orchestrator or trusted-VCS `nodekit.builder-change-set/v1` evidence file; recording
re-hashes and parses that file and requires its paths, revisions, and candidate lock binding to
match the trajectory. Protected-root bytes are re-hashed at evaluation, so omitted paths cannot
hide evaluator or task changes. Repository reads walk every existing ancestor, reject symlinks and
junctions, require the physical target to stay under the repository root, and reject duplicate
physical evidence files.

The evaluator reports each dimension independently. Safety and evidence are not averaged away by
a stronger task score. Efficiency is checked against explicit latency, token, cost, and turn
budgets. Missing human preference stays `unmeasured`; it never becomes synthetic approval.

Every verdict is itself content addressed and always contains:

```json
{
  "measurementAuthority": "trajectory-self-reported",
  "protectedEvaluationPassed": false,
  "realWorldClaimAuthorized": false,
  "promotionAuthorized": false
}
```

Trajectory, lock, and verdict CAS files are created with exclusive filesystem semantics. A
concurrent writer may reuse an existing address only when the complete stored bytes are identical;
pre-created files with different bytes and symlink, junction, or non-regular-file addresses fail
closed.

Fixture success proves the contract and fail-closed mechanics only. It does not prove that Harness
v1 is better than Harness v0 in real use.

## Protected skill-evaluation receipts

The Skill Compiler now uses a stricter authority boundary than the v1 NodeTrace observation. A
candidate cannot submit aggregate `passed`, `successRate`, `protectedEvaluatorUnchanged`, canary,
or proof booleans and have them treated as evidence. Skill benchmarking accepts only:

1. a `nodekit.skill-benchmark-input/v1` that fixes the benchmark, harness, protected evaluator,
   exact resolved model, baseline and candidate skill hashes, task/input hashes, and identical
   repetition counts for both arms;
2. at least three `nodekit.skill-evaluator-receipt/v1` records per arm, each content addressed and
   Ed25519-signed by a key authorized for `skill-benchmark`;
3. task, input, output, and evaluation evidence whose exact bytes are hashed in each per-run
   receipt; and
4. a schema-validated, content-addressed `nodekit.skill-benchmark-verdict/v1` re-derived from those
   receipts by the protected evaluator path.

Receipt verification reopens every direct and transitively referenced evidence file. JSON evidence
may carry nested `evidence` or `evidenceRefs` arrays only as `{ kind, path, sha256, bytes }` objects;
unhashed string references fail closed. Repository escapes, symlink or junction traversal, byte
count drift, file-hash drift, reused run IDs, receipt-path reuse, task substitution, input
substitution, arm mismatch, model drift, evaluator drift, and signature mismatch all fail before a
verdict is accepted.

Canaries use the same signed receipt contract with the separate `skill-canary` purpose and an exact
fresh-context contract. Promotion additionally requires a content-addressed
`nodekit.skill-integrity-receipt/v1` signed by a key authorized for `skill-integrity`. Immediately
before its first write, promotion reopens the benchmark input, every per-run receipt, recursive
evidence, the immutable canary copy, and the independent integrity receipt. A failed re-hash leaves
the current harness version unchanged.

Trusted public keys are supplied out of candidate write authority through the library option or:

```text
NODEKIT_SKILL_EVALUATOR_TRUSTED_KEYS_JSON={
  "protected-evaluator-key": {
    "publicKey": "-----BEGIN PUBLIC KEY-----...",
    "purposes": ["skill-benchmark", "skill-canary"]
  },
  "independent-nodeproof-key": {
    "publicKey": "-----BEGIN PUBLIC KEY-----...",
    "purposes": ["skill-integrity"]
  }
}
```

Private signing keys belong to the protected evaluator or independent proof service and must never
be placed in a candidate workspace. Detached attestations are purpose-scoped, so a benchmark key
cannot sign an integrity receipt unless the trust policy explicitly grants that purpose.

## CLI

```bash
nodekit harness init
nodekit harness builder init
nodekit harness builder status --json

nodekit harness trajectory record --file ./baseline-trajectory.json --json
nodekit harness trajectory inspect --ref nodetrace:sha256:<hash> --json

nodekit harness builder lock --baseline ./baseline-trajectory.json --json
nodekit harness builder evaluate \
  --lock builder-gym-lock:sha256:<hash> \
  --expected-lock-hash <sha256-captured-before-candidate-run> \
  --baseline ./baseline-trajectory.json \
  --candidate ./candidate-trajectory.json \
  --json
nodekit harness builder inspect --ref builder-gym:sha256:<hash> --json
```

`builder lock` is created before candidate execution and freezes the evaluator, protected task
set, baseline trajectory, fixed inputs, and write boundaries. Keep that lock outside candidate
write authority. `builder evaluate` requires it, persists a protected comparison receipt, and
exits nonzero on a regression. A
passing local verdict still requires isolated fresh-agent repetitions, independent human
preference, a fresh-agent canary, and a matching NodeProof receipt before a human can consider the
existing Harness Gym promotion path.

## Public API

The package root exports:

- `sealNodeTraceTrajectory` and `verifyNodeTraceTrajectory`;
- `recordNodeTraceTrajectory` and `inspectNodeTraceTrajectory`;
- `initializeBuilderGym`, `builderGymContext`, and `builderGymStatus`;
- `createBuilderGymLock`, `verifyBuilderGymLock`, `evaluateBuilderGym`,
  `verifyBuilderGymVerdict`, and `inspectBuilderGymVerdict`;
- typed trajectory, dimension, evidence, and verdict contracts.

## Verification coverage

`test/builder-gym.test.mjs` proves:

- idempotent initialization inside Harness Gym;
- all seven verdict dimensions remain separate;
- trajectory and verdict content addresses detect tampering;
- evidence bytes are reopened and re-hashed;
- protected writes, evaluator drift, and fixed-input drift fail closed;
- safety regression cannot be hidden by better task or efficiency scores;
- local fixture results cannot authorize real-world claims or promotion;
- self-authored scores and proof-receipt identifiers remain visibly non-authoritative;
- CAS writes are exclusive, byte-idempotent, and reject prepared or symlink addresses;
- the CLI reads the same Builder Gym state rather than a parallel subsystem;
- self-asserted skill comparisons and canaries are rejected;
- signed per-run baseline and candidate receipts are held to identical fixed task/input repetitions;
- benchmark verdicts are re-derived from protected receipts rather than trusted as stored booleans;
- recursive evidence tampering blocks verification and promotion without changing the active version;
- canary and independent integrity attestations are purpose-scoped to trusted Ed25519 keys.

The deterministic fixtures live in `test/fixtures/builder-gym/`.

## Remaining evidence program

Engineering mechanics are complete. The evidence claim remains deliberately open until the same
frozen task/model/evaluator matrix is run with isolated fresh coding agents, repeated enough to
measure stability, reviewed by independent humans, and closed by NodeProof. Until then:

> Builder Gym exists, but no real-world harness-superiority claim is authorized.
