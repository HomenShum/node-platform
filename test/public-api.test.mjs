import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
});

test("published metadata cannot silently drop attestation exports or command bins", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.exports["./submission-attestation"], {
    types: "./src/submission-attestation.d.mts",
    import: "./src/submission-attestation.mjs",
    default: "./src/submission-attestation.mjs",
  });
  assert.equal(packageJson.bin["nodekit-attestation-sign"], "scripts/sign-submission-attestation.mjs");
  assert.equal(packageJson.bin["nodekit-attestation-verify"], "scripts/verify-submission-attestation.mjs");
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-sign"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-verify"]), true);
});
