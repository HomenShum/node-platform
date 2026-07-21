import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_FEATURE_PROOF_STUDIO_COMMIT,
  buildRenderCommands,
  durationFrames,
  evaluatePreflight,
  lintCampaignConfig,
  packageCommand,
  validateClaimBinding,
} from "../changes/nodekit-proof-campaign-2026-07-20/video/orchestrate-founder-quest-video.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "..");
const VIDEO_ROOT = join(
  REPOSITORY_ROOT,
  "changes",
  "nodekit-proof-campaign-2026-07-20",
  "video",
);
const CONFIG_PATH = join(VIDEO_ROOT, "founder-quest-walkthrough.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

test("Founder Quest video spec is claim-safe and duration-bounded", () => {
  const result = lintCampaignConfig(config);
  assert.deepEqual(result.errors, []);
  assert.equal(result.passed, true);
  assert.equal(
    config.featureProofStudio.commit,
    EXPECTED_FEATURE_PROOF_STUDIO_COMMIT,
  );
  assert.equal(config.productionProof.hostedChecksPassed, 15);
  assert.equal(config.productionProof.isolatedBrowserContexts, 4);
  assert.equal(config.productionProof.releaseLevel, "production-certified");
  assert.equal(config.productionProof.releaseReady, true);
  assert.equal(config.productionProof.hostedDeploymentCertified, true);
  assert.equal(config.productionProof.artifactManifestHashesVerified, 25);
  assert.equal(config.productionProof.testsPassed, 18);
  assert.equal(config.productionProof.releaseAuditIssues, 0);
  assert.equal(config.productionProof.readOnlySynthetic, true);
  assert.equal(config.productionProof.durableWrites, false);
  assert.equal(config.productionProof.remoteNeo4jWrites, false);

  const vertical = config.profiles.find(
    (profile) => profile.format === "vertical-social",
  );
  const technical = config.profiles.find(
    (profile) => profile.format === "technical-landscape",
  );
  assert.ok(vertical);
  assert.ok(technical);
  assert.equal(vertical.width, 1080);
  assert.equal(vertical.height, 1920);
  assert.ok(durationFrames(vertical) >= 60 * vertical.fps);
  assert.ok(durationFrames(vertical) <= 90 * vertical.fps);
  assert.equal(technical.width, 1920);
  assert.equal(technical.height, 1080);
  assert.ok(durationFrames(technical) >= 120 * technical.fps);
  assert.ok(durationFrames(technical) <= 180 * technical.fps);
});

test("checked-in spec contains no literal, local, or synthetic production URL", () => {
  const source = readFileSync(CONFIG_PATH, "utf8");
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1|\.invalid\b|\.example\b|\.test\b/i);
  assert.match(source, /\{\{PRODUCTION_URL\}\}/);
});

test("walkthrough remains read-only and traverses graph, answer, sources, and proof", () => {
  const selectors = config.profiles.flatMap((profile) =>
    profile.steps.flatMap((step) => [step.sel, step.cursor]).filter(Boolean),
  );
  for (const requiredSelector of [
    "quest:bank-readiness",
    "blocker:missing-ownership-agreement",
    "Why is the bank quest blocked?",
    "[data-query-operation=\"blocker\"]",
    "#answer-card",
    ".answer-sources",
    "[data-query-operation=\"authority\"]",
    "[data-graph-view=\"critical\"]",
    "[data-panel=\"proof\"]",
    "#open-neo4j-plan",
    "#plan-dialog",
    "footer",
  ]) {
    assert.ok(
      selectors.some((selector) => selector.includes(requiredSelector)),
      `missing selector contract: ${requiredSelector}`,
    );
  }
  assert.equal(config.safety.mutationsAllowed, false);
  assert.equal(config.safety.publishingAllowed, false);
  assert.equal(config.safety.deploymentAllowed, false);
  assert.equal(
    config.profiles.some((profile) =>
      profile.steps.some((step) => step.act === "upload"),
    ),
    false,
  );
});

test("Remotion commands call the pinned Feature Proof Studio stage", () => {
  const stageRoot = resolve(REPOSITORY_ROOT, ".tmp", "fps-stage-contract");
  const outputRoot = resolve(REPOSITORY_ROOT, ".tmp", "video-output-contract");
  const commands = buildRenderCommands(config, stageRoot, outputRoot);
  assert.equal(commands.length, 2);
  for (const [index, command] of commands.entries()) {
    assert.equal(command.cwd, stageRoot);
    const commandOffset = process.platform === "win32" ? 4 : 0;
    if (process.platform === "win32") {
      assert.equal(command.command.toLowerCase(), (process.env.ComSpec || "cmd.exe").toLowerCase());
      assert.deepEqual(command.args.slice(0, 4), ["/d", "/s", "/c", "npx.cmd"]);
    } else {
      assert.equal(command.command, "npx");
    }
    assert.equal(command.args[commandOffset], "remotion");
    assert.equal(command.args[commandOffset + 1], "render");
    assert.equal(
      command.args[commandOffset + 2],
      config.featureProofStudio.remotionEntrypoint,
    );
    assert.equal(command.args[commandOffset + 3], config.profiles[index].compositionId);
    assert.match(command.args[commandOffset + 4], new RegExp(`${config.profiles[index].outputFile}$`));
  }

  const rootSource = readFileSync(join(VIDEO_ROOT, "feature-proof-root.jsx"), "utf8");
  assert.match(rootSource, /from "\.\/Walkthrough\.jsx"/);
  assert.match(rootSource, /from "\.\/walkthrough\.data\.js"/);
  assert.match(rootSource, /WT9-FounderQuestVertical/);
  assert.match(rootSource, /WT-FounderQuestTechnical/);
});

test("package commands are executable without direct .cmd spawning on Windows", () => {
  const invocation = packageCommand("npm", ["--version"]);
  if (process.platform === "win32") {
    assert.equal(invocation.command.toLowerCase(), (process.env.ComSpec || "cmd.exe").toLowerCase());
    assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npm.cmd", "--version"]);
  } else {
    assert.deepEqual(invocation, { command: "npm", args: ["--version"] });
  }
});

test("preflight fails closed when deployment, browser, and screenshot proof are absent", (t) => {
  const prefix = join(tmpdir(), "nodekit-video-gate-");
  const temporaryRoot = mkdtempSync(prefix);
  assert.ok(temporaryRoot.startsWith(tmpdir()));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  const campaignRoot = join(temporaryRoot, "campaign");
  const videoRoot = join(campaignRoot, "video");
  const storyRoot = join(campaignRoot, "story");
  mkdirSync(videoRoot, { recursive: true });
  mkdirSync(storyRoot, { recursive: true });
  const isolatedConfigPath = join(videoRoot, "founder-quest-walkthrough.json");
  writeFileSync(isolatedConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    join(storyRoot, "claims.json"),
    JSON.stringify({
      claims: [
        {
          id: "C5_FOUNDER_QUEST_PRODUCT",
          status: "planned",
          evidenceIds: [],
          scope: {},
        },
      ],
    }),
  );
  writeFileSync(join(storyRoot, "evidence-index.json"), "{\"evidence\":[]}");

  const report = evaluatePreflight({
    config,
    configPath: isolatedConfigPath,
    checkRepository: false,
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.errors.some((message) => message.includes("deployment receipt is missing")),
  );
  assert.ok(
    report.errors.some((message) => message.includes("browser proof receipt is missing")),
  );
  assert.ok(
    report.errors.some((message) => message.includes("screenshot manifest is missing")),
  );
  assert.equal(existsSync(join(campaignRoot, config.paths.finalReceipt)), false);
  assert.equal(existsSync(join(campaignRoot, config.paths.outputDirectory)), false);
});

test("planned Founder Quest claim cannot authorize a final capture", () => {
  const digest = "a".repeat(64);
  const deployment = {
    appId: "founder-quest-graph",
    deploymentId: "deployment-identity-contract",
    commit: "b".repeat(40),
    configHash: digest,
    appHash: digest,
  };
  const report = validateClaimBinding({
    config,
    deployment,
    claims: {
      claims: [
        {
          id: "C5_FOUNDER_QUEST_PRODUCT",
          status: "planned",
          evidenceIds: [],
          scope: {},
        },
      ],
    },
    evidenceIndex: { evidence: [] },
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.errors.some((message) =>
      message.includes("must be verified or measured before capture"),
    ),
  );
  assert.ok(report.errors.some((message) => message.includes("has no evidence")));
  assert.ok(
    report.errors.some((message) => message.includes("scope.commit does not match")),
  );
});

test("verified Founder Quest claim is bound to the exact checked-in production proof", () => {
  const deployment = {
    appId: "founder-quest-graph",
    deploymentId: "vercel-production-proof",
    url: "https://founder-quest-graph.vercel.app/",
    commit: config.productionProof.sourceCommit,
    configHash: config.productionProof.configHash,
    appHash: config.productionProof.appHash,
    receiptDigest: config.productionProof.receiptDigest,
  };
  const claim = {
    id: "C5_FOUNDER_QUEST_PRODUCT",
    status: "verified",
    evidenceIds: ["E12_FOUNDER_QUEST_PRODUCTION", "E13_FOUNDER_QUEST_RELEASE"],
    scope: {
      commit: config.productionProof.sourceCommit,
      evidenceCommit: config.productionProof.evidenceCommit,
      configHash: config.productionProof.configHash,
      appHash: config.productionProof.appHash,
      graphRevision: config.productionProof.graphRevision,
      productionUrl: deployment.url,
      productionReceiptDigest: config.productionProof.receiptDigest,
      unifiedReleaseReceiptDigest:
        config.productionProof.unifiedReleaseReceiptDigest,
      releaseLevel: config.productionProof.releaseLevel,
      releaseReady: config.productionProof.releaseReady,
      hostedDeploymentCertified:
        config.productionProof.hostedDeploymentCertified,
      hostedChecksPassed: config.productionProof.hostedChecksPassed,
      isolatedBrowserContexts: config.productionProof.isolatedBrowserContexts,
      artifactManifestHashesVerified:
        config.productionProof.artifactManifestHashesVerified,
      testsPassed: config.productionProof.testsPassed,
      releaseAuditIssues: config.productionProof.releaseAuditIssues,
    },
  };
  const report = validateClaimBinding({
    config,
    deployment,
    claims: { claims: [claim] },
    evidenceIndex: {
      evidence: [
        { id: "E12_FOUNDER_QUEST_PRODUCTION" },
        { id: "E13_FOUNDER_QUEST_RELEASE" },
      ],
    },
  });
  assert.equal(report.passed, true, report.errors.join("\n"));
});
