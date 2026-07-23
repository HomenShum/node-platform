import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const workflowRoot = path.resolve(".github/workflows");

function steps(workflow, jobId) {
  return workflow.jobs?.[jobId]?.steps ?? [];
}

test("every GitHub Action dependency is pinned to an immutable commit", async () => {
  const files = (await readdir(workflowRoot)).filter((file) => /\.ya?ml$/.test(file));
  for (const file of files) {
    const workflow = YAML.parse(await readFile(path.join(workflowRoot, file), "utf8"));
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.uses !== "string") continue;
        assert.match(step.uses, /@[a-f0-9]{40}$/, `${file}/${jobId} does not pin ${step.uses}`);
      }
    }
  }
});

test("EaseProof pairs one cold run with the current warm run before emitting a verdict", async () => {
  const workflow = YAML.parse(await readFile(path.join(workflowRoot, "ease-proof.yml"), "utf8"));
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.cache_class.options, ["cold", "warm"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.paired_cold_run_id.type, "string");
  assert.deepEqual(workflow.jobs["developer-ease"].strategy.matrix.os, ["windows-latest", "ubuntu-latest", "macos-latest"]);
  assert.deepEqual(workflow.jobs["developer-ease"].strategy.matrix.package_manager, ["npm", "pnpm"]);
  assert.match(workflow.jobs["developer-ease"].strategy.matrix.trial, /\[1,2,3,4,5\]/);
  assert.equal(workflow.jobs["aggregate-developer-evidence"].needs, "developer-ease");

  const aggregateSteps = steps(workflow, "aggregate-developer-evidence");
  const downloads = aggregateSteps.filter((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(downloads.length, 2);
  assert.equal(downloads[0].with["run-id"], "${{ inputs.paired_cold_run_id }}");
  assert.equal(downloads[1].with["run-id"], "${{ github.run_id }}");
  assert.ok(downloads.every((step) => step.with.pattern === "developer-timing-*" && step.with["merge-multiple"] === false));

  const aggregate = aggregateSteps.find((step) => step.name === "Build the fail-closed 60-run verdict")?.run ?? "";
  assert.match(aggregate, /proof\/ease\/developer-timing-runs\.json/);
  assert.match(aggregate, /proof\/ease\/developer-timing-verdict\.json/);
  assert.match(aggregate, /--cold-run-id=\$\{\{ inputs\.paired_cold_run_id \}\}/);
  assert.match(aggregate, /--warm-run-id=\$\{\{ github\.run_id \}\}/);
  assert.match(aggregate, /--expected-commit=\$\{\{ github\.sha \}\}/);
});

test("quality runs both public boundaries and the exact-candidate gate", async () => {
  const workflow = YAML.parse(await readFile(path.join(workflowRoot, "quality.yml"), "utf8"));
  const testCommands = steps(workflow, "test").map((step) => step.run).filter(Boolean);
  assert.ok(testCommands.includes("npm run typecheck:public"));
  assert.ok(testCommands.includes("npm run typecheck:component"));
  assert.ok(testCommands.includes("npm test"));
  const candidate = workflow.jobs["exact-candidate"];
  assert.equal(candidate.needs, "test");
  assert.match(candidate.if, /refs\/heads\/main/);
  assert.ok(steps(workflow, "exact-candidate").some((step) => step.run === "npm run acceptance:factory"));
});
