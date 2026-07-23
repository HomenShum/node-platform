import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ENGINEERING_HEALTH_CHECKS,
  createEngineeringHealthVerdict,
  parseLocalCandidateArguments,
  parseTemplatePackageJson,
  validateEngineeringIssueInventory,
} from "../scripts/run-local-candidate-gate.mjs";
import {
  parseLocalDistributionArguments,
  verifyBrowserContractReceipt,
} from "../scripts/run-local-distribution-gate.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const candidateCommit = "a".repeat(40);
const nodekitSourceHash = "b".repeat(64);

test("candidate gate exposes exactly the ten decisive local engineering checks", () => {
  assert.deepEqual(ENGINEERING_HEALTH_CHECKS.map((entry) => entry.id), [
    "repositoryTests",
    "componentTests",
    "publicTypecheck",
    "componentTypecheck",
    "componentBuild",
    "packageAudit",
    "registry",
    "ecosystem",
    "evolution",
    "distributionClean",
  ]);
  assert.throws(() => parseLocalCandidateArguments([]), /--candidate is required/);
  const preflight = parseLocalCandidateArguments(["--preflight"]);
  assert.equal(preflight.preflight, true);
  assert.equal(preflight.candidateCommit, undefined);
  assert.equal(preflight.sourceHash, undefined);
  assert.equal(preflight.timeoutMs, undefined);
  assert.throws(() => parseLocalDistributionArguments([]), /--candidate is required/);
});

test("engineering issue input is strict about open lowercase P0/P1 blockers", () => {
  assert.deepEqual(validateEngineeringIssueInventory({
    schemaVersion: "nodekit.engineering-issue-input/v1",
    issues: [],
  }), { errors: [], passed: true, unresolvedP0: 0, unresolvedP1: 0 });
  const blocked = validateEngineeringIssueInventory({
    schemaVersion: "nodekit.engineering-issue-input/v1",
    issues: [{ id: "p0", severity: "p0", source: "audit", status: "open" }],
  });
  assert.equal(blocked.passed, true);
  assert.equal(blocked.unresolvedP0, 1);
  assert.equal(blocked.unresolvedP1, 0);
  assert.equal(validateEngineeringIssueInventory({
    schemaVersion: "nodekit.engineering-issue-input/v1",
    issues: [{ id: "bad", severity: "P0", source: "audit", status: "unresolved" }],
  }).passed, false);
});

test("candidate prove composes schema-valid decisive receipts without claiming certification", async () => {
  const completedAt = "2026-07-22T12:00:00.000Z";
  const commands = ENGINEERING_HEALTH_CHECKS.map((entry, index) => ({
    id: entry.id,
    path: `proof/engineering/checks/${String(index + 1).padStart(2, "0")}-${entry.id}.json`,
    sha256: String(index + 1).padStart(64, "0"),
  }));
  const issueInventory = {
    path: "proof/engineering/issue-inventory.json",
    sha256: "c".repeat(64),
    p0: 0,
    p1: 0,
  };
  const releaseCandidate = {
    nodekitCommit: candidateCommit,
    nodekitSourceHash,
    nodekitTarballSha256: "d".repeat(64),
    packageName: "@homenshum/nodekit",
    packageVersion: "0.2.1",
  };
  const verdict = createEngineeringHealthVerdict({
    candidateCommit,
    commands,
    completedAt,
    issueInventory,
    nodekitSourceHash,
    releaseCandidate,
  });
  assert.equal(verdict.passed, true);
  assert.equal(Object.hasOwn(verdict, "externalCertificationPerformed"), false);
  assert.deepEqual(await validateSchema("nodekit.engineering-health-verdict.v1.schema.json", verdict, "engineering verdict"), []);

  const inventory = {
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash,
    generatedAt: completedAt,
    counts: { p0: 0, p1: 0 },
    issues: [],
  };
  assert.deepEqual(await validateSchema("nodekit.engineering-issue-inventory.v1.schema.json", inventory, "issue inventory"), []);
  for (const entry of ENGINEERING_HEALTH_CHECKS) {
    const receipt = {
      schemaVersion: "nodekit.engineering-check-receipt/v1",
      candidateCommit,
      nodekitSourceHash,
      checkId: entry.id,
      command: entry.command,
      exitCode: 0,
      startedAt: completedAt,
      completedAt,
    };
    assert.deepEqual(await validateSchema("nodekit.engineering-check-receipt.v1.schema.json", receipt, `${entry.id} receipt`), []);
  }
});

test("browser-contract readiness requires every structural assertion and a certification disclaimer", () => {
  const valid = {
    schemaVersion: "nodekit.browser-contract/v1",
    passed: true,
    note: "Structural live HTTP and source-DOM contract only. This is not rendered-browser certification.",
    assertions: {
      artifactPrimary: true,
      currentActionVisible: true,
      mobileContractPresent: true,
      proposalBoundaryVisible: true,
      semanticLandmarks: true,
    },
  };
  assert.deepEqual(verifyBrowserContractReceipt(valid), { errors: [], passed: true });
  const invalid = structuredClone(valid);
  invalid.assertions.mobileContractPresent = false;
  invalid.note = "passed";
  const result = verifyBrowserContractReceipt(invalid);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /disclaim rendered-browser certification/);
  assert.match(result.errors.join("\n"), /mobileContractPresent/);
});

test("package metadata exposes preflight and exact proof commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["candidate:check"], "node scripts/run-local-candidate-gate.mjs --preflight");
  assert.equal(packageJson.scripts["candidate:prove"], "node scripts/run-local-candidate-gate.mjs");
  assert.equal(packageJson.scripts["candidate:distribution"], "node scripts/run-local-distribution-gate.mjs");
});

test("candidate preflight materializes the intentionally non-JSON template dependency placeholder", async () => {
  const template = await readFile(new URL("../templates/base/package.json", import.meta.url), "utf8");
  const parsed = parseTemplatePackageJson(template);
  assert.equal(parsed.dependencies["@homenshum/nodekit"], "file:vendor/nodekit.tgz");
  assert.throws(
    () => parseTemplatePackageJson(template.replace("__NODEKIT_SPECIFIER_JSON__", '"not-the-nodekit-tarball"')),
    /does not bind the NodeKit dependency placeholder exactly once/,
  );
});
