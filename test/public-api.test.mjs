import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CASEFLOW_SCHEMA_VERSIONS,
  createMemoryCaseflow,
  normalizePortableValue,
  PORTABLE_VALUE_LIMITS,
  runCaseflowConformance,
  runtimeProfiles,
} from "@homenshum/nodekit/caseflow";
import {
  normalizePortableValue as normalizePortableValueFromRoot,
  PORTABLE_VALUE_LIMITS as PORTABLE_VALUE_LIMITS_FROM_ROOT,
} from "@homenshum/nodekit";
import { createPostgresCaseflow } from "@homenshum/nodekit/adapters/postgres";
import {
  SUBMISSION_ATTESTATION_SCHEMA_VERSION,
  canonicalizeAttestationPayload,
} from "@homenshum/nodekit/submission-attestation";
import {
  CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
  prepareExactConsumerPackage,
} from "@homenshum/nodekit/consumer-package-preparation";
import {
  MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION,
  startManagedEvidenceCampaign,
} from "@homenshum/nodekit/managed-evidence-capture";
import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymStatus,
} from "@homenshum/nodekit/builder-gym";
import {
  computeSkillEvidenceClosure,
  sealSkillPromotionApproval,
  verifySkillBenchmarkVerdict,
  verifySkillPromotionApproval,
} from "@homenshum/nodekit/skill-evaluation";

test("published Caseflow entry point exposes the supported portable contract", async () => {
  assert.equal(CASEFLOW_SCHEMA_VERSIONS.case, "nodekit.case/v1");
  assert.equal(PORTABLE_VALUE_LIMITS.maxArrayItems, 8192);
  assert.deepEqual(normalizePortableValue({ value: -0 }), { value: 0 });
  assert.equal(PORTABLE_VALUE_LIMITS_FROM_ROOT, PORTABLE_VALUE_LIMITS);
  assert.deepEqual(normalizePortableValueFromRoot({ value: -0 }), { value: 0 });
  assert.equal(runtimeProfiles.memory.optimisticConcurrency, true);
  const verdict = await runCaseflowConformance(() => createMemoryCaseflow());
  assert.equal(verdict.passed, true);
  assert.equal(verdict.assertions.staleProposalFailedClosed, true);
  assert.equal(verdict.assertions.contentAddressedReceipt, true);
  assert.equal(typeof createPostgresCaseflow, "function");
  assert.equal(SUBMISSION_ATTESTATION_SCHEMA_VERSION, "nodekit.detached-attestation/v1");
  assert.equal(canonicalizeAttestationPayload({ gate: "public-api" }), '{"gate":"public-api"}');
  assert.equal(CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION, "nodekit.consumer-package-provenance/v1");
  assert.equal(typeof prepareExactConsumerPackage, "function");
  assert.equal(MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION, "nodekit.managed-evidence-campaign/v1");
  assert.equal(typeof startManagedEvidenceCampaign, "function");
  assert.equal(NODETRACE_VERDICT_DIMENSIONS.length, 7);
  assert.equal(typeof builderGymStatus, "function");
  assert.equal(typeof computeSkillEvidenceClosure, "function");
  assert.equal(typeof sealSkillPromotionApproval, "function");
  assert.equal(typeof verifySkillPromotionApproval, "function");
  assert.equal(typeof verifySkillBenchmarkVerdict, "function");
});

test("published metadata cannot silently drop attestation and evidence-finalization surfaces", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/HomenShum/node-platform.git",
  });
  assert.equal(packageJson.homepage, "https://github.com/HomenShum/node-platform#readme");
  assert.deepEqual(packageJson.bugs, { url: "https://github.com/HomenShum/node-platform/issues" });
  assert.equal(packageJson.author, "Homen Shum");
  assert.equal(packageJson.keywords.includes("agent-applications"), true);
  assert.deepEqual(packageJson.exports["./submission-attestation"], {
    types: "./src/submission-attestation.d.mts",
    import: "./src/submission-attestation.mjs",
    default: "./src/submission-attestation.mjs",
  });
  assert.equal(packageJson.bin["nodekit-attestation-sign"], "scripts/sign-submission-attestation.mjs");
  assert.equal(packageJson.bin["nodekit-attestation-verify"], "scripts/verify-submission-attestation.mjs");
  assert.deepEqual(packageJson.exports["./submission-evidence-finalizer"], {
    types: "./src/submission-evidence-finalizer.d.mts",
    import: "./src/submission-evidence-finalizer.mjs",
    default: "./src/submission-evidence-finalizer.mjs",
  });
  assert.equal(packageJson.bin["nodekit-evidence-finalize"], "scripts/finalize-submission-evidence.mjs");
  assert.deepEqual(packageJson.exports["./consumer-package-preparation"], {
    types: "./src/consumer-package-preparation.d.mts",
    import: "./src/consumer-package-preparation.mjs",
    default: "./src/consumer-package-preparation.mjs",
  });
  assert.deepEqual(packageJson.exports["./managed-evidence-capture"], {
    types: "./src/managed-evidence-capture.d.mts",
    import: "./src/managed-evidence-capture.mjs",
    default: "./src/managed-evidence-capture.mjs",
  });
  assert.deepEqual(packageJson.exports["./builder-gym"], {
    types: "./src/builder-gym.d.mts",
    import: "./src/builder-gym.mjs",
    default: "./src/builder-gym.mjs",
  });
  assert.deepEqual(packageJson.exports["./skill-evaluation"], {
    types: "./src/skill-evaluation.d.mts",
    import: "./src/skill-evaluation.mjs",
    default: "./src/skill-evaluation.mjs",
  });
  assert.equal(packageJson.bin["nodekit-consumer-prepare"], "scripts/prepare-consumer-package.mjs");
  assert.equal(packageJson.bin["nodekit-evidence-capture"], "scripts/capture-managed-evidence.mjs");
  assert.equal(packageJson.bin["nodekit-human-study"], "scripts/capture-human-study.mjs");
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-sign"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-verify"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-evidence-finalize"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-consumer-prepare"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-evidence-capture"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-human-study"]), true);
});

test("every relative README link resolves to a packed package path", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const packedRoots = ["package.json", ...(packageJson.files ?? [])]
    .map((entry) => String(entry).replace(/^\.\//, "").replace(/\/$/, ""));
  const broken = [];
  for (const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const href = match[1].trim();
    if (/^(?:[a-z]+:|#)/iu.test(href)) continue;
    const target = href.split(/[?#]/u, 1)[0].replace(/^\.\//u, "");
    const packed = packedRoots.some((root) => target === root || target.startsWith(`${root}/`));
    if (!packed) broken.push(target);
  }
  assert.deepEqual(broken, []);
});

test("public package bins expose usable help without credentials or writes", () => {
  for (const [script, marker] of [
    ["../scripts/finalize-submission-evidence.mjs", "nodekit-evidence-finalize"],
    ["../scripts/prepare-consumer-package.mjs", "nodekit-consumer-prepare"],
    ["../scripts/capture-managed-evidence.mjs", "nodekit-evidence-capture"],
    ["../scripts/capture-human-study.mjs", "nodekit-human-study"],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), "--help"], {
      encoding: "utf8",
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, new RegExp(marker));
  }
});

test("EaseProof documents the qualifying campaign entrypoint rather than incomplete manual trials", async () => {
  const easeProof = await readFile(new URL("../docs/EASE_PROOF.md", import.meta.url), "utf8");
  assert.match(easeProof, /npm run ease:run-agent-matrix --/);
  assert.match(easeProof, /--lower-cost-evidence=<official-pricing-evidence\.json>/);
  assert.doesNotMatch(easeProof, /npm run acceptance:agent --/);
});
