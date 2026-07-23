import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  finalizeManagedEvidenceCampaign,
  getManagedEvidenceCampaign,
  importManagedEvidence,
  linkManagedBrowserManifest,
  recordManagedEvidenceCleanup,
  recordManagedEvidencePhase,
  recordManagedEvidenceResource,
  resumeManagedEvidenceCampaign,
  startManagedEvidenceCampaign,
  verifyManagedEvidenceCandidate,
} from "../src/lib/managed-evidence-capture.mjs";
import { createSchemaAjv } from "../src/lib/schema-validation.mjs";
import { runManagedEvidenceCapture } from "../scripts/capture-managed-evidence.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { transitiveSubmissionEvidence } from "../src/lib/submission-gate.mjs";
import {
  exactSubmissionVerdicts,
  submissionEvidenceFixtureBytes,
  submissionEvidenceFixtureClosure,
} from "./submission-fixtures.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function write(root, relative, bytes) {
  const absolute = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return absolute;
}

async function candidateFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-managed-evidence-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  git(root, ["config", "user.email", "nodekit@example.invalid"]);
  await write(root, "package.json", `${JSON.stringify({
    name: "@homenshum/nodekit",
    version: "0.2.1",
    type: "module",
    files: ["README.md"],
  }, null, 2)}\n`);
  await write(root, "README.md", "# Candidate\n");
  git(root, ["add", "package.json", "README.md"]);
  git(root, ["commit", "-m", "candidate"]);
  const candidateCommit = git(root, ["rev-parse", "HEAD"]);
  const sourceHash = await computeNodeKitSourceHash(root);
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).packageInstallProof;
  for (const reference of transitiveSubmissionEvidence("packageInstallProof", verdict)) {
    await write(root, reference.path, submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash));
  }
  await write(root, "proof/package-install-verdict.json", `${JSON.stringify(verdict, null, 2)}\n`);
  return {
    root,
    candidateCommit,
    sourceHash,
    verdict,
    candidateProof: "proof/package-install-verdict.json",
    locator(result) {
      return { repoRoot: root, gate: result.gate, campaignId: result.campaignId, candidateCommit };
    },
  };
}

async function previewBrowserFixture(current, origin = "https://preview.nodekit.test") {
  const manifestPath = "proof/preview/browser/screenshot-manifest.json";
  const initialBytes = submissionEvidenceFixtureBytes(manifestPath, current.candidateCommit, current.sourceHash);
  const manifest = JSON.parse(initialBytes.toString("utf8"));
  const closure = submissionEvidenceFixtureClosure(manifestPath, current.candidateCommit, current.sourceHash);
  for (const child of closure) {
    let bytes = submissionEvidenceFixtureBytes(child.path, current.candidateCommit, current.sourceHash);
    const screenshot = manifest.screenshots.find((entry) => `${manifestPath.slice(0, -"browser/screenshot-manifest.json".length)}${entry.sidecarPath}` === child.path);
    if (screenshot) {
      const sidecar = JSON.parse(bytes.toString("utf8"));
      sidecar.pageUrl = `${origin}/?scenario=${sidecar.state}`;
      bytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
      screenshot.pageUrl = sidecar.pageUrl;
      screenshot.sidecarBytes = bytes.length;
      screenshot.sidecarSha256 = digest(bytes);
    }
    await write(current.root, child.path, bytes);
  }
  delete manifest.manifestSha256;
  manifest.manifestSha256 = digest(Buffer.from(JSON.stringify(manifest)));
  await write(current.root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, applicationCommit: manifest.generatedCandidateCommit };
}

async function evidenceFile(root, name, body = {}) {
  return write(root, `operator-input/${name}.json`, `${JSON.stringify({ schemaVersion: `test.${name}/v1`, ...body }, null, 2)}\n`);
}

test("candidate verification reopens the complete package proof and exact archive", async (t) => {
  const current = await candidateFixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const verified = await verifyManagedEvidenceCandidate({ repoRoot: current.root, candidateProof: current.candidateProof });
  assert.equal(verified.candidate.nodekitCommit, current.candidateCommit);
  assert.equal(verified.candidate.nodekitSourceHash, current.sourceHash);
  assert.equal(verified.candidate.tarball.sha256, current.verdict.tarballSha256);
  await writeFile(path.join(current.root, "README.md"), "drift\n");
  await assert.rejects(
    () => verifyManagedEvidenceCandidate({ repoRoot: current.root, candidateProof: current.candidateProof }),
    /source hash differs/u,
  );
});

test("credential preflight records names only and the campaign is resumable", async (t) => {
  const current = await candidateFixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  await assert.rejects(
    () => startManagedEvidenceCampaign({
      repoRoot: current.root,
      gate: "previewDeployment",
      candidateProof: current.candidateProof,
      requiredEnvironmentVariables: ["VERCEL_TOKEN"],
      environment: {},
    }),
    /missing environment variables: VERCEL_TOKEN/u,
  );
  const secret = "not-written-super-secret";
  const started = await startManagedEvidenceCampaign({
    repoRoot: current.root,
    gate: "previewDeployment",
    candidateProof: current.candidateProof,
    requiredEnvironmentVariables: ["VERCEL_TOKEN", "CONVEX_DEPLOY_KEY"],
    environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
  });
  const locator = current.locator(started);
  const canonicalCheckpoint = path.join(current.root, ...started.campaignPath.split("/"));
  const pointer = await write(current.root, "operator-input/campaign-pointer.json", await readFile(canonicalCheckpoint));
  await assert.rejects(
    () => runManagedEvidenceCapture(["status", "--repo-root", current.root, "--campaign", pointer]),
    /canonical campaign\.json returned by start/u,
  );
  await resumeManagedEvidenceCampaign(locator);
  await recordManagedEvidencePhase({ ...locator, action: "start", phase: "deploy" });
  await recordManagedEvidencePhase({ ...locator, action: "complete", phase: "deploy", outcome: "failed" });
  const campaign = await getManagedEvidenceCampaign(locator);
  const directory = path.dirname(path.join(current.root, ...started.campaignPath.split("/")));
  for (const file of ["campaign-meta.json", "events.jsonl", "campaign.json"]) {
    assert.doesNotMatch(await readFile(path.join(directory, file), "utf8"), new RegExp(secret, "u"));
  }
  assert.deepEqual(campaign.credentialPreflight.requiredEnvironmentVariables, ["CONVEX_DEPLOY_KEY", "VERCEL_TOKEN"]);
  assert.equal(campaign.phaseAttempts[0].outcome, "failed");
  assert.equal(campaign.phaseAttempts[0].timerSource, "monotonic");
  assert.equal(campaign.submissionGateSatisfied, false);
  const supportingPath = current.verdict.supportingEvidence[0].path;
  await writeFile(path.join(current.root, ...supportingPath.split("/")), "tampered supporting evidence\n");
  await assert.rejects(
    () => getManagedEvidenceCampaign(locator),
    /evidence|digest|hash|sha-?256|bytes|changed|mismatch/iu,
  );
});

test("capture CLI rejects unknown flags before doing work", async () => {
  await assert.rejects(
    () => runManagedEvidenceCapture(["start", "--unexpected", "value"]),
    /unknown option\(s\): --unexpected/u,
  );
});

test("managed-service evidence may repeat a public endpoint but never a secret or secret derivative", async (t) => {
  const current = await candidateFixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const serviceUrl = "https://project-ref.supabase.co";
  const serviceRoleKey = "service-role-secret-value";
  const started = await startManagedEvidenceCampaign({
    repoRoot: current.root,
    gate: "managedSupabasePortability",
    candidateProof: current.candidateProof,
    requiredEnvironmentVariables: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    environment: { SUPABASE_URL: serviceUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
  });
  const locator = current.locator(started);
  const publicReceipt = await evidenceFile(current.root, "managed-service", { endpoint: serviceUrl, provisioned: true });
  await assert.rejects(
    () => importManagedEvidence({
      ...locator,
      kind: "managed-service-receipt",
      sourceFile: publicReceipt,
      environment: {},
    }),
    /missing environment variables: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL/u,
  );
  const imported = await importManagedEvidence({
    ...locator,
    kind: "managed-service-receipt",
    sourceFile: publicReceipt,
    environment: { SUPABASE_URL: serviceUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
  });
  assert.equal(imported.kind, "managed-service-receipt");
  const leaking = await evidenceFile(current.root, "auth-secret-leak", { observed: serviceRoleKey });
  await assert.rejects(
    () => importManagedEvidence({
      ...locator,
      kind: "auth-rls-report",
      sourceFile: leaking,
      environment: { SUPABASE_URL: serviceUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
    }),
    /contains the value of credential SUPABASE_SERVICE_ROLE_KEY/u,
  );
  const derivedSecret = await evidenceFile(current.root, "auth-secret-derivative", { accessTokenHash: "a".repeat(64) });
  await assert.rejects(
    () => importManagedEvidence({
      ...locator,
      kind: "auth-rls-report",
      sourceFile: derivedSecret,
      environment: { SUPABASE_URL: serviceUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
    }),
    /non-redacted secret-like field/u,
  );
});

test("preview capture binds isolated resources, exact screenshots, timers, evidence, and cleanup without attesting", async (t) => {
  const current = await candidateFixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const secret = "preview-secret-never-persist";
  const started = await startManagedEvidenceCampaign({
    repoRoot: current.root,
    gate: "previewDeployment",
    candidateProof: current.candidateProof,
    requiredEnvironmentVariables: ["VERCEL_TOKEN", "CONVEX_DEPLOY_KEY"],
    environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
  });
  const locator = current.locator(started);
  for (const phase of ["deploy", "health", "browser", "export-reopen", "cleanup"]) {
    await recordManagedEvidencePhase({ ...locator, action: "start", phase });
    await recordManagedEvidencePhase({ ...locator, action: "complete", phase, outcome: "succeeded" });
  }
  await recordManagedEvidenceResource({
    ...locator,
    kind: "frontend-preview",
    provider: "vercel",
    resourceId: "preview_frontend_123",
    environment: "preview",
    isolated: true,
    url: "https://preview.nodekit.test",
  });
  await recordManagedEvidenceResource({
    ...locator,
    kind: "backend-preview",
    provider: "convex",
    resourceId: "preview_backend_123",
    environment: "preview",
    isolated: true,
  });
  for (const kind of ["browser-proof", "exported-artifact", "reopen-score", "deployment-receipt"]) {
    await importManagedEvidence({
      ...locator,
      kind,
      sourceFile: await evidenceFile(current.root, kind, { measured: true }),
      environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
    });
  }
  const browser = await previewBrowserFixture(current);
  const linked = await linkManagedBrowserManifest({ ...locator, ...browser });
  assert.equal(linked.screenshotCount, 180);
  assert.equal(linked.closureCount, 366);
  const cleanupReceipts = new Map();
  for (const resourceKind of ["frontend-preview", "backend-preview"]) {
    const providerReceiptFile = await evidenceFile(current.root, `${resourceKind}-cleanup`, { resourceKind, removed: true });
    cleanupReceipts.set(resourceKind, providerReceiptFile);
    await recordManagedEvidenceCleanup({
      ...locator,
      resourceKind,
      providerReceiptFile,
      environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
    });
  }
  const retry = await recordManagedEvidenceCleanup({
    ...locator,
    resourceKind: "frontend-preview",
    providerReceiptFile: cleanupReceipts.get("frontend-preview"),
    environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
  });
  assert.equal(retry.allResourcesCleaned, true);
  assert.equal(retry.aggregateCleanupReceipt.kind, "cleanup-receipt");
  const differentCleanupReceipt = await evidenceFile(current.root, "different-cleanup", { removed: false });
  await assert.rejects(
    () => recordManagedEvidenceCleanup({
      ...locator,
      resourceKind: "frontend-preview",
      providerReceiptFile: differentCleanupReceipt,
      environment: { VERCEL_TOKEN: secret, CONVEX_DEPLOY_KEY: `${secret}-convex` },
    }),
    /does not match the previously recorded provider receipt/u,
  );
  const before = await getManagedEvidenceCampaign(locator);
  assert.equal(before.readiness.ready, true);
  assert.equal(before.resources.every((entry) => entry.cleanup?.sha256), true);
  assert.equal(before.screenshotManifest.deploymentOrigin, "https://preview.nodekit.test");
  const finalized = await finalizeManagedEvidenceCampaign(locator);
  assert.equal(finalized.status, "ready-for-independent-review");
  assert.equal(finalized.externalAttestationRequired, true);
  assert.equal(finalized.submissionGateSatisfied, false);
  const finalizedRetry = await finalizeManagedEvidenceCampaign(locator);
  assert.equal(finalizedRetry.receiptPath, finalized.receiptPath);
  assert.equal(finalizedRetry.receiptSha256, finalized.receiptSha256);
  const receipt = JSON.parse(await readFile(path.join(current.root, ...finalized.receiptPath.split("/")), "utf8"));
  assert.equal(receipt.publicationPerformed, false);
  assert.equal(receipt.deploymentPerformedByCaptureTool, false);
  assert.equal(receipt.evidence.some((entry) => entry.kind === "cleanup-receipt"), true);
  const schema = JSON.parse(await readFile(new URL("../schemas/nodekit.managed-evidence-campaign.v1.schema.json", import.meta.url), "utf8"));
  const validate = createSchemaAjv().compile(schema);
  assert.equal(validate(await getManagedEvidenceCampaign(locator)), true, JSON.stringify(validate.errors));
});

test("browser linkage rejects local screenshots and evidence import rejects credential leakage", async (t) => {
  const current = await candidateFixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const secret = "leak-check-secret";
  const started = await startManagedEvidenceCampaign({
    repoRoot: current.root,
    gate: "previewDeployment",
    candidateProof: current.candidateProof,
    requiredEnvironmentVariables: ["VERCEL_TOKEN"],
    environment: { VERCEL_TOKEN: secret },
  });
  const locator = current.locator(started);
  await recordManagedEvidenceResource({
    ...locator,
    kind: "frontend-preview",
    provider: "vercel",
    resourceId: "preview_frontend_local_reject",
    environment: "preview",
    isolated: true,
    url: "https://preview.nodekit.test",
  });
  const manifestPath = "proof/preview/browser/screenshot-manifest.json";
  const manifest = JSON.parse(submissionEvidenceFixtureBytes(manifestPath, current.candidateCommit, current.sourceHash));
  await write(current.root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(
    () => linkManagedBrowserManifest({ ...locator, manifestPath, applicationCommit: manifest.generatedCandidateCommit }),
    /isolated HTTPS frontend origin/u,
  );
  const leaking = await evidenceFile(current.root, "leaking", { token: secret });
  await assert.rejects(
    () => importManagedEvidence({ ...locator, kind: "browser-proof", sourceFile: leaking, environment: { VERCEL_TOKEN: secret } }),
    /credential VERCEL_TOKEN|secret-like/u,
  );
});
