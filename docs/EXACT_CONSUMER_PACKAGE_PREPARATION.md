# Exact consumer package preparation

NodeRoom, NodeSlide, and NodeVideo must consume the same verified NodeKit archive. They must not each invent a copy script, hand-written lock file, or weaker interpretation of package identity.

`scripts/prepare-consumer-package.mjs` is the shared, fail-closed preparation tool. It performs no deployment, no commit, no signing, and no authenticated-adoption attestation.

## Required guarantees

Before proposing any write, the tool verifies all of the following:

- the supplied NodeKit commit is a full commit and is the exact `HEAD` of the supplied NodeKit worktree;
- every distributable NodeKit source path is clean;
- the supplied source hash equals a fresh hash of those committed distributable bytes;
- the `.tgz` is a regular file and passes NodeKit's non-extracting npm archive verifier;
- package name, package version, tarball SHA-256, and SHA-512 SRI are all exact;
- the source worktree package name and version match the archive;
- a fresh `npm pack --ignore-scripts` runs only inside a disposable byte-for-byte copy of the candidate's clean, tracked distribution source, with no Git metadata or link back to the source checkout, and produces the same canonical file-manifest hash, package name, version, file count, and unpacked byte count as the supplied archive;
- package lifecycle behavior cannot write into the authoritative NodeKit checkout because npm never receives that checkout as its working directory;
- the NodeKit commit, source hash, clean status, and tracked distributable file set remain exact after independent packing;
- the consumer is a clean Git worktree;
- the consumer `package.json` is tracked and Git-clean against `HEAD` (so normal cross-platform Git line-ending filters remain supported);
- vendor, manifest, and package paths are contained, distinct, and do not traverse symlinks.

The resulting canonical manifest binds:

```text
NodeKit commit + source hash + package identity + tar SHA-256 + SRI
        ↓
consumer base commit + committed package.json bytes
        ↓
exact vendored path + exact file: dependency specifier
```

It also permanently records:

```json
{
  "classification": "package_preparation_only",
  "claims": {
    "authenticatedAdoption": false,
    "convexTestAuthenticatedAdoption": false,
    "deploymentPerformed": false,
    "threeConsumerGateSatisfied": false
  }
}
```

A local `convex-test` pass is valuable engineering evidence. It is not an authenticated, deployed NodeRoom, NodeSlide, or NodeVideo adoption and must never be reported as one.

## Dry-run first

Every identity input is required. The command is read-only unless `--apply` is present.

```powershell
node scripts/prepare-consumer-package.mjs `
  --archive D:\proof\nodekit-0.2.1.tgz `
  --nodekit-root D:\src\node-platform `
  --consumer-root D:\src\noderoom `
  --consumer-commit <consumer-base-commit> `
  --candidate <nodekit-commit> `
  --source-hash <nodekit-source-sha256> `
  --package-name @homenshum/nodekit `
  --package-version 0.2.1 `
  --tarball-sha256 <tarball-sha256> `
  --integrity sha512-<base64-digest> `
  --update-dependency
```

The JSON result describes the exact planned writes. Dry-run does not create a vendor directory, change `package.json`, or write the provenance manifest.

The independently generated `.tgz` does not need the same compressed bytes. Gzip metadata and tar ordering can differ without changing a package. NodeKit therefore compares the complete canonical unpacked file manifest and its aggregate identity, while the supplied archive remains bound separately by its exact SHA-256 and SRI. The authoritative checkout is verified against the requested commit and source hash before and after the disposable source copy is created. The copy is independently hashed before npm runs and deleted after packing, whether packing passes or fails.

## Apply exact bytes

After reviewing the dry-run result, repeat the same command with `--apply`:

```powershell
node scripts/prepare-consumer-package.mjs <same exact arguments> --update-dependency --apply
```

Default outputs are:

```text
vendor/nodekit.tgz
nodekit.consumer-package.json
```

`package.json` changes only when `--update-dependency` is explicit. The package must already declare `@homenshum/nodekit` exactly once in `dependencies`, `devDependencies`, `optionalDependencies`, or `peerDependencies`; the tool refuses to guess between missing or duplicate declarations. The resolved value is `file:vendor/nodekit.tgz` for the default paths.

Writes are verified byte-for-byte. If any write fails, completed writes are restored to their prior state. The provenance manifest is written last, so it cannot act as a misleading completion marker for an incomplete operation.

Immediately before an apply, the tool reopens the consumer plan inputs. Consumer `HEAD`, full worktree cleanliness, tracked `package.json` bytes, and the presence, mode, and bytes of existing vendor/manifest outputs must still equal the values observed while planning. Each output is compared again immediately before its write. Concurrent user work therefore stops the operation instead of being absorbed into or overwritten by a stale plan.

## Consumer proof still required

Preparation is only the start of the real consumer gate. Each consumer must subsequently:

1. inspect the staged diff and commit the exact package and provenance manifest;
2. install from the vendored `.tgz` without a workspace or source-tree fallback;
3. run package-surface, TypeScript, runtime, CAS, stale-write, human-preservation, retry, cancellation, rollback, receipt, and browser checks;
4. deploy the exact consumer commit through its authorized environment;
5. collect authenticated live-flow evidence and exact screenshots;
6. obtain the required purpose-scoped independent attestation.

Only the submission evaluator can decide that the three-consumer gate is satisfied. This preparation tool intentionally has no option capable of making that claim.

## Library use

Automation can import the same implementation directly:

```js
import { prepareExactConsumerPackage } from "@homenshum/nodekit/consumer-package-preparation";

const plan = await prepareExactConsumerPackage({
  archivePath,
  candidateCommit,
  consumerRoot,
  expectedConsumerCommit,
  expectedIntegrity,
  expectedName: "@homenshum/nodekit",
  expectedTarballSha256,
  expectedVersion: "0.2.1",
  nodekitRoot,
  sourceHash,
  updateDependency: true,
  apply: false,
});
```

Keep `apply: false` for inspection. Set it to `true` only after the same exact plan has been reviewed.
