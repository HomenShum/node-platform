import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import {
  addAtlasAsset,
  addAtlasFlow,
  initializeAtlasStore,
  inspectAtlasRecord,
  listAtlasRecords,
  readAtlasRecord,
  validateExperienceAssetDocument,
} from "../src/lib/atlas.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const execFileAsync = promisify(execFile);
const OBSERVED_AT = "2026-07-22T00:00:00.000Z";

function vendoredAssetDraft(overrides = {}) {
  return {
    kind: "primitive",
    title: "Reviewable queue table",
    summary: "A dense approval queue that keeps the reviewer's place across batch decisions.",
    intent: {
      userJob: "let reviewers batch approve without losing their place",
      productStages: ["first_arrival", "populated", "proposal"],
      artifactKinds: ["queue-table"],
      supportedDomains: ["operations"],
      aliases: ["review-queue", "bulk-approve"],
    },
    source: {
      origin: "uiverse",
      reuseMode: "copy",
      upstreamUrl: "https://uiverse.io/components/queue-table?theme=dark#preview",
      observedAt: OBSERVED_AT,
      license: { identifier: "MIT", attributionRequired: false, redistributable: true },
    },
    implementation: {
      framework: "react",
      language: "tsx",
      exports: [{ name: "QueueTable", exportKind: "component" }],
      dependencies: [],
      propSchema: { type: "object" },
      tokenContract: {},
    },
    behavior: {
      states: ["first_arrival", "populated", "proposal"],
      actions: [{ id: "approve-row", effect: "approve", approvalRequired: true }],
      events: ["row-approved"],
      keyboardOperations: [{ keys: "j / k", operation: "move between rows" }],
      mobileStrategy: "responsive",
      visibleUncertainty: true,
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: [],
    ...overrides,
  };
}

function referenceAssetDraft() {
  return {
    kind: "reference",
    title: "Triage inbox capture",
    summary: "A captured third-party triage inbox kept purely as a benchmark reference.",
    intent: {
      userJob: "compare our triage density against a shipped product",
      productStages: ["populated"],
      artifactKinds: ["triage-inbox"],
      supportedDomains: ["operations"],
      aliases: [],
    },
    source: {
      origin: "mobbin",
      reuseMode: "reference",
      upstreamUrl: "https://mobbin.com/screens/triage-inbox",
      observedAt: OBSERVED_AT,
      license: { identifier: "LicenseRef-third-party-capture", attributionRequired: false, redistributable: false },
    },
    implementation: { framework: "none", language: "none", propSchema: {}, tokenContract: {} },
    behavior: {
      states: ["populated"],
      actions: [],
      events: [],
      keyboardOperations: [],
      mobileStrategy: "desktop-only",
      visibleUncertainty: false,
    },
    integration: { requiredPorts: [], caseflowBindings: [], nodeAgentBindings: [] },
    knownLimitations: ["captured from a third-party product; no license permits redistribution"],
  };
}

function flowDraft(surfaceAssetId) {
  const node = (nodeId, productStage, mobileMode, surfaceAssetIds = []) => ({
    nodeId,
    productStage,
    surfaceAssetIds,
    primaryArtifact: "approval queue",
    primaryAction: "review and approve",
    requiredData: ["queue-rows"],
    visibleUncertainty: true,
    mobileMode,
  });
  const edge = (from, to, action, effect, approvalRequired) => ({ from, to, action, effect, approvalRequired });
  return {
    title: "Reviewer batch approval",
    user: { role: "operations reviewer", primaryJob: "clear the approval queue without losing place" },
    nodes: [
      node("arrival", "first_arrival", "review"),
      node("loading", "loading", "review"),
      node("queue", "populated", "primary-artifact", [surfaceAssetId]),
      node("recover", "exception", "review"),
      node("proposal", "proposal", "agent"),
      node("collision", "conflict", "review"),
      node("halted", "failed_safe", "unavailable"),
      node("mobile-review", "mobile", "review"),
      node("done", "completed", "review"),
    ],
    transitions: [
      edge("arrival", "loading", "open", "navigate", false),
      edge("loading", "queue", "load", "read", false),
      edge("queue", "recover", "fail", "read", false),
      edge("recover", "queue", "retry", "read", false),
      edge("queue", "proposal", "draft", "propose", false),
      edge("proposal", "collision", "collide", "read", false),
      edge("collision", "proposal", "resolve", "local-mutate", false),
      edge("proposal", "halted", "halt", "read", false),
      edge("halted", "queue", "restart", "navigate", false),
      edge("proposal", "done", "approve", "approve", true),
      edge("queue", "mobile-review", "open-mobile", "navigate", false),
      edge("mobile-review", "done", "approve-mobile", "approve", true),
    ],
    authority: {
      read: ["reviewer", "agent"],
      propose: ["agent"],
      approve: ["reviewer"],
      prohibited: ["agent approving its own proposal"],
    },
    knownLimitations: [],
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-atlas-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "drafts"), { recursive: true });
  await mkdir(path.join(root, "vendor"), { recursive: true });
  await writeFile(path.join(root, "vendor", "queue-table.tsx"), "export function QueueTable() { return null; }\n", "utf8");
  await writeFile(path.join(root, "vendor", "observation.html"), "<main>queue table observation</main>\n", "utf8");
  await writeFile(path.join(root, "vendor", "capture.html"), "<main>third-party triage inbox capture</main>\n", "utf8");
  const writeDraft = async (name, value) => {
    const relative = path.posix.join("drafts", name);
    await writeFile(path.join(root, "drafts", name), stringifyYaml(value), "utf8");
    return relative;
  };
  return { root, writeDraft };
}

test("Atlas registers a vendored asset and an interaction flow that round-trip through the store", async (t) => {
  const { root, writeDraft } = await fixture(t);
  const initialized = await initializeAtlasStore(root);
  assert.equal(initialized.atlasRoot, ".nodeagent/atlas");

  const draftPath = await writeDraft("queue-table.yaml", vendoredAssetDraft());
  const added = await addAtlasAsset(root, {
    assetFile: draftPath,
    observationFile: "vendor/observation.html",
    vendorFile: "vendor/queue-table.tsx",
  });

  assert.equal(added.duplicate, false);
  assert.match(added.asset.assetId, /^asset_[a-f0-9]{24}$/);
  assert.equal(added.asset.quality.maturity, "extracted");
  assert.equal(added.asset.card.maturity, "extracted");
  assert.equal(added.asset.card.a11y, "unknown");
  assert.equal(added.asset.implementation.files.length, 1);
  assert.equal(added.asset.implementation.files[0].mediaType, "text/plain");
  assert.match(added.asset.implementation.files[0].blobPath, /^\.nodeagent\/evidence\/blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/);
  assert.equal(added.asset.source.vendored.repositoryPath, "vendor/queue-table.tsx");
  assert.equal(added.output, `.nodeagent/atlas/assets/${added.asset.assetId}.json`);

  // The document the store persisted is the document the schema and the hand validator accept.
  assert.deepEqual(await validateSchema("nodekit.experience-asset.v1.schema.json", added.asset, "experience asset"), []);
  assert.deepEqual(validateExperienceAssetDocument(added.asset), []);

  const loaded = await readAtlasRecord(root, added.asset.assetId);
  assert.deepEqual(loaded, added.asset);

  const inspected = await inspectAtlasRecord(root, added.asset.assetId);
  assert.deepEqual(inspected.issues, []);
  assert.equal(inspected.passed, true);
  assert.equal(inspected.snapshotChecks.length, 2);
  assert.ok(inspected.snapshotChecks.every((entry) => entry.passed));

  const flowPath = await writeDraft("review-flow.yaml", flowDraft(added.asset.assetId));
  const flow = await addAtlasFlow(root, { flowFile: flowPath });
  assert.match(flow.flow.flowId, /^flow_[a-f0-9]{24}$/);
  assert.equal(flow.flow.coverage.startNodeId, "arrival");
  assert.deepEqual(flow.flow.coverage.terminalNodeIds, ["done"]);
  assert.deepEqual(flow.flow.coverage.missingStates, []);
  assert.equal(flow.flow.coverage.complete, true);
  assert.equal(flow.flow.card.stateCoverage, "9/9");
  assert.equal(flow.flow.card.approvalGates, 2);
  assert.equal(flow.flow.authority.proofGateMutable, false);
  assert.equal(flow.flow.assetBindings[0].assetHash, added.asset.assetHash);
  assert.deepEqual(await validateSchema("nodekit.interaction-flow.v1.schema.json", flow.flow, "interaction flow"), []);
  assert.deepEqual((await inspectAtlasRecord(root, flow.flow.flowId)).issues, []);

  const listing = await listAtlasRecords(root);
  assert.deepEqual(listing.counts, { assets: 1, flows: 1 });
  assert.equal(listing.assetCards[0].assetId, added.asset.assetId);
  assert.equal(listing.flowCards[0].flowId, flow.flow.flowId);
});

test("Atlas refuses a malformed asset at the schema boundary rather than storing it", async (t) => {
  const { root, writeDraft } = await fixture(t);
  await initializeAtlasStore(root);

  const malformed = vendoredAssetDraft();
  malformed.behavior.mobileStrategy = "desktop";
  const draftPath = await writeDraft("malformed.yaml", malformed);
  await assert.rejects(
    () => addAtlasAsset(root, { assetFile: draftPath, observationFile: "vendor/observation.html", vendorFile: "vendor/queue-table.tsx" }),
    /experience asset validation failed[\s\S]*must be equal to one of the allowed values/,
  );

  const unknownField = vendoredAssetDraft({ maturity: "certified" });
  const unknownPath = await writeDraft("unknown-field.yaml", unknownField);
  await assert.rejects(
    () => addAtlasAsset(root, { assetFile: unknownPath, observationFile: "vendor/observation.html", vendorFile: "vendor/queue-table.tsx" }),
    /atlas asset draft contains unknown fields: maturity/,
  );

  // A draft cannot buy a maturity it did not earn: maturity is derived from verified bytes only.
  const stateGap = vendoredAssetDraft();
  stateGap.behavior.states = ["populated"];
  const stateGapPath = await writeDraft("state-gap.yaml", stateGap);
  await assert.rejects(
    () => addAtlasAsset(root, { assetFile: stateGapPath, observationFile: "vendor/observation.html", vendorFile: "vendor/queue-table.tsx" }),
    /behavior\.states does not cover intent\.productStages/,
  );

  assert.deepEqual((await listAtlasRecords(root)).counts, { assets: 0, flows: 0 });
});

test("a reference-only asset has no code path to vendored bytes and no document that carries them validates", async (t) => {
  const { root, writeDraft } = await fixture(t);
  await initializeAtlasStore(root);
  const draftPath = await writeDraft("capture.yaml", referenceAssetDraft());

  await assert.rejects(
    () => addAtlasAsset(root, {
      assetFile: draftPath,
      observationFile: "vendor/capture.html",
      vendorFile: "vendor/queue-table.tsx",
    }),
    /reference-only assets cannot vendor upstream bytes/,
  );

  const added = await addAtlasAsset(root, { assetFile: draftPath, observationFile: "vendor/capture.html" });
  assert.equal(added.asset.source.reuseMode, "reference");
  assert.equal(added.asset.quality.maturity, "discovered");
  assert.deepEqual(added.asset.implementation.files, []);
  assert.equal(added.asset.source.vendored, undefined);
  assert.equal(added.asset.implementation.entryPoint, undefined);
  assert.equal(added.asset.implementation.framework, "none");

  // Forging the bytes onto the stored document fails the schema lock, not merely the CLI guard.
  const forged = structuredClone(added.asset);
  forged.source.vendored = {
    snapshotId: "evidence_000000000000000000000000",
    sha256: "a".repeat(64),
    byteLength: 42,
    mediaType: "text/plain",
    repositoryPath: "vendor/queue-table.tsx",
  };
  const schemaFindings = await validateSchema("nodekit.experience-asset.v1.schema.json", forged, "experience asset");
  assert.ok(schemaFindings.length > 0, "schema must reject a reference asset carrying vendored bytes");
  assert.ok(validateExperienceAssetDocument(forged).some((entry) => /reference-only asset cannot record vendored bytes/.test(entry)));

  // A draft cannot smuggle the binding in either: source.vendored is not an authorable field.
  const smuggled = referenceAssetDraft();
  smuggled.source.vendored = { sha256: "b".repeat(64) };
  const smuggledPath = await writeDraft("smuggled.yaml", smuggled);
  await assert.rejects(
    () => addAtlasAsset(root, { assetFile: smuggledPath, observationFile: "vendor/capture.html" }),
    /atlas asset draft source contains unknown fields: vendored/,
  );

  // The same lock from the other direction: a captured third-party origin cannot claim a copy mode.
  const capturedCopy = referenceAssetDraft();
  capturedCopy.source.reuseMode = "copy";
  capturedCopy.source.license = { identifier: "MIT", attributionRequired: false, redistributable: true };
  const capturedPath = await writeDraft("captured-copy.yaml", capturedCopy);
  await assert.rejects(
    () => addAtlasAsset(root, { assetFile: capturedPath, observationFile: "vendor/capture.html", vendorFile: "vendor/queue-table.tsx" }),
    /origin mobbin may only be referenced or benchmarked against, never vendored/,
  );
});

test("Atlas is idempotent for unchanged bytes, immutable for changed ones, and refuses escaping paths", async (t) => {
  const { root, writeDraft } = await fixture(t);
  await initializeAtlasStore(root);
  const draftPath = await writeDraft("queue-table.yaml", vendoredAssetDraft());
  const inputs = { assetFile: draftPath, observationFile: "vendor/observation.html", vendorFile: "vendor/queue-table.tsx" };

  const first = await addAtlasAsset(root, inputs);
  assert.equal(first.observationReused, false);

  // A re-add of unchanged bytes is a no-op, not the `duplicate evidence snapshot` throw a naive
  // re-ingest would raise, and not a second record.
  const second = await addAtlasAsset(root, inputs);
  assert.equal(second.duplicate, true);
  assert.equal(second.observationReused, true);
  assert.equal(second.asset.assetId, first.asset.assetId);
  assert.deepEqual((await listAtlasRecords(root)).counts, { assets: 1, flows: 0 });

  const retitled = vendoredAssetDraft({ title: "Reviewable queue table v2" });
  const retitledPath = await writeDraft("queue-table-retitled.yaml", retitled);
  await assert.rejects(
    () => addAtlasAsset(root, { ...inputs, assetFile: retitledPath }),
    /atlas records are immutable; register a new version instead of overwriting/,
  );

  await writeFile(path.join(root, "..", "nodekit-atlas-outside.yaml"), stringifyYaml(vendoredAssetDraft()), "utf8");
  t.after(() => rm(path.join(root, "..", "nodekit-atlas-outside.yaml"), { force: true }));
  await assert.rejects(
    () => addAtlasAsset(root, { ...inputs, assetFile: "../nodekit-atlas-outside.yaml" }),
    /atlas asset draft must stay inside the repository/,
  );
  await assert.rejects(
    () => addAtlasAsset(root, { ...inputs, observationFile: "../nodekit-atlas-outside.yaml" }),
    /must stay inside the repository/,
  );
  await assert.rejects(
    () => addAtlasAsset(root, { ...inputs, vendorFile: "../../etc/passwd" }),
    /must stay inside the repository/,
  );
  await assert.rejects(() => readAtlasRecord(root, "asset_not-a-derived-id"), /atlas record id is invalid/);
});

test("the nodekit atlas CLI prints usage, initializes, and lists with matching exit codes", async (t) => {
  const { root } = await fixture(t);
  const cli = path.resolve("src", "cli.mjs");
  const run = async (...args) => execFileAsync(process.execPath, [cli, ...args]);

  const usage = await run("atlas");
  assert.match(usage.stdout, /nodekit atlas init \[--repo-root <path>\] \[--json\]/);
  assert.match(usage.stdout, /nodekit atlas inspect --id <assetId-or-flowId>/);

  const help = await run("help");
  assert.match(help.stdout, /nodekit atlas add --asset <yaml-file> --observation <path>/);

  const initialized = await run("atlas", "init", "--repo-root", root, "--json");
  assert.equal(JSON.parse(initialized.stdout).atlasRoot, ".nodeagent/atlas");

  const listed = await run("atlas", "list", "--repo-root", root, "--json");
  assert.deepEqual(JSON.parse(listed.stdout).counts, { assets: 0, flows: 0 });

  const text = await run("atlas", "list", "--repo-root", root);
  assert.match(text.stdout, /^LISTED 0 assets, 0 flows; byte identity not re-verified$/m);

  await assert.rejects(
    () => run("atlas", "inspect", "--id", "asset_000000000000000000000000", "--repo-root", root, "--json"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /nodekit: atlas record is not registered/);
      return true;
    },
  );

  await assert.rejects(
    () => run("atlas", "sniff", "--repo-root", root),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /nodekit atlas <sub>/);
      return true;
    },
  );
});
