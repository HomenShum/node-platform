import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { evaluateSubmissionManifest, requiredSubmissionGates } from "../src/lib/submission-gate.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("submission gate requires all evidence, hashes, and explicit approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  const bytes = Buffer.from("verified\n");
  await writeFile(path.join(root, "proof", "evidence.txt"), bytes);
  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit: "a".repeat(40),
    gates: requiredSubmissionGates.map((id) => ({ id, passed: true, evidence: [{ path: "proof/evidence.txt", sha256: digest(bytes) }] })),
  };
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  assert.equal((await evaluateSubmissionManifest(root)).submissionReady, true);
  manifest.gates.at(-1).passed = false;
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const blocked = await evaluateSubmissionManifest(root);
  assert.equal(blocked.submissionReady, false);
  assert.match(blocked.errors.join("\n"), /publicationApproval: not passed/);
});
