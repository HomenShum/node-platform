# Runnable adoption and differentiated certification

Four defects found by pairing external design proposals against the code they
assumed. Each was root-caused from the failing behaviour, not from a summary of it.
Two of the four were found only because a proposal claimed to need something the
repository already had, and checking that claim exposed the defect underneath.

## 1. Adoption produced a harness that could not run

`adoptProject` wrote `@homenshum/nodekit: file:vendor/nodekit` into the adopted
repository and emitted scripts importing `../vendor/nodekit/src/lib/caseflow.mjs`,
but never called `vendorNodeKitRuntime`. `scaffoldProject` did. A repository adopted
without an explicit `--nodekit-specifier` therefore referenced a directory that was
never created, and could neither install nor run its demo.

The existing adopt test always passed an explicit specifier, so it never exercised
the default path. That is why the defect survived: the test covered the branch that
worked.

Repaired by vendoring the runtime on the adopt path, and covered by a regression
test that adopts with no specifier, asserts the vendored runtime materialises, and
runs the generated demo to a passing receipt with zero install and no key.

## 2. The vendored and published runtime installed cold without a runtime import

`src/lib/schema-validation.mjs` imports `ajv-formats` at runtime. It was declared
only in `devDependencies`, and `vendorNodeKitRuntime` deliberately strips
`devDependencies` when it materialises the runtime. The vendored runtime, and any
published package, therefore installed without a module the runtime imports, and
`compile` failed on a cold install.

Repaired by moving `ajv-formats` to `dependencies`, where a runtime import belongs.

## 3. Archive inspection failed on Windows drive-letter paths

Four independent call sites invoked `tar` on absolute paths. On Windows the `tar`
and `tar.exe` found on PATH resolve to the MSYS GNU tar shipped with Git, which
parses `C:\dir\file.tgz` as the rsh spec `host:path` and fails trying to resolve
`C:` as a remote host. `--force-local` corrects GNU tar but is unsupported by
bsdtar, so a flag is not portable where binary selection is.

Repaired with a single `resolveTarCommand()` that prefers the Windows system
bsdtar and falls back to PATH, replacing four open-coded invocations.

## 4. Browser certification enforced identical review copy

`assertReviewState` in `templates/base/scripts/browser-certify.mjs` threw unless
`#review-eyebrow` and `#review-title` matched the template's literal strings. Every
certified application therefore shipped the same review language, and writing copy
appropriate to the application's own domain was a certification failure.

This inverted `inv:domain-blank-create`. The creation path made no domain decision
for the user, but the gate that judged the result did, by refusing any wording other
than the template's. Combined with the launch skill's instruction to stop aesthetic
expansion at a fixed time budget, the incentive gradient selected for the least
differentiated candidate that preserved template copy verbatim.

Repaired by certifying that the review state is communicated — copy present, and the
correct controls visible or hidden for the state — while leaving the behavioural
contract unchanged. The template retains its default copy; the gate no longer
requires generated applications to keep it.

The proposed repair was to require the copy to *differ* from the template default.
That was rejected: a freshly created application ships the default verbatim and
would fail its own certification. The invariant is that the state is communicated,
not that it is worded differently.

## Known limitations

- The token vocabulary generated applications inherit is a single line of colour
  variables with no spacing, type, radius, elevation, or motion scale. An agent
  extending the interface has no vocabulary to extend it inside the system. That is
  unaddressed here.
- The frontend tournament's `decisive` verdict remains computed from self-asserted
  booleans with no evidence binding. It is not repaired by this change and no claim
  about frontend quality gating should rest on it.
- The four defects were found by inspection and regression tests, not by a fresh
  user or a live consumer. No adoption claim follows from them.
