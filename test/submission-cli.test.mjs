import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-cli-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  git(root, ["add", "candidate.txt"]);
  git(root, ["commit", "-m", "candidate"]);
  return root;
}

test("submission preparation accepts explicit named options", async () => {
  const root = await createRepository();
  const output = "proof/named-options-manifest.json";
  const result = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "prepare-submission.mjs"),
    "--candidate", "HEAD",
    "--repo-root", root,
    "--output", output,
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.candidateCommit, git(root, ["rev-parse", "HEAD"]));
  assert.equal(summary.outputPath, output);
  assert.equal(summary.submissionReady, false);
  const manifest = JSON.parse(await readFile(path.join(root, output), "utf8"));
  assert.equal(manifest.candidateCommit, summary.candidateCommit);
  assert.equal(manifest.gates.length, 8);
});

test("submission scripts fail clearly on unknown options", () => {
  for (const script of ["prepare-submission.mjs", "evaluate-submission.mjs"]) {
    const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", script), "--wat"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown option --wat/);
  }
});
