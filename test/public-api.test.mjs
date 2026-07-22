import assert from "node:assert/strict";
import test from "node:test";
import {
  CASEFLOW_SCHEMA_VERSIONS,
  createMemoryCaseflow,
  runCaseflowConformance,
  runtimeProfiles,
} from "@homenshum/nodekit/caseflow";
import { createPostgresCaseflow } from "@homenshum/nodekit/adapters/postgres";

test("published Caseflow entry point exposes the supported portable contract", async () => {
  assert.equal(CASEFLOW_SCHEMA_VERSIONS.case, "nodekit.case/v1");
  assert.equal(runtimeProfiles.memory.optimisticConcurrency, true);
  const verdict = await runCaseflowConformance(() => createMemoryCaseflow());
  assert.equal(verdict.passed, true);
  assert.equal(verdict.assertions.staleProposalFailedClosed, true);
  assert.equal(verdict.assertions.contentAddressedReceipt, true);
  assert.equal(typeof createPostgresCaseflow, "function");
});
