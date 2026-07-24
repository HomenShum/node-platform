import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { materializeBuildPacket } from "../src/lib/opportunity-compiler.mjs";
import { compileFrontendPlan, initializeFrontendHarness } from "../src/lib/frontend-specialist.mjs";

const SALON = JSON.parse(
  await readFile(new URL("./fixtures/builder-journey/salon.opportunity-contract.json", import.meta.url), "utf8"),
);

// Scenario: a salon owner has an approved, read-only OpportunityContract. The Build stage must be
// able to pick it up as a real file and plan against it without re-deciding scope. This proves the
// Decide -> Build seam end to end: compile -> write packet -> the frontend planner accepts it and
// carries the protected decisions and the read-only authority forward.
test("the salon OpportunityContract materializes into a build packet the frontend planner accepts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-build-packet-"));
  await mkdir(path.join(root, "harness"), { recursive: true });
  await initializeFrontendHarness(root);

  const { packetPath, atlasQueryPath, productDesignContract, atlasQuery } = await materializeBuildPacket({
    repoRoot: root,
    opportunity: SALON,
    packetName: "salon",
  });

  // The packet on disk is exactly the compiled contract, with the decided fields carried and the
  // protected decisions pinned to their owning authorities.
  const onDisk = parseYaml(await readFile(path.join(root, packetPath), "utf8"));
  assert.equal(onDisk.product.targetUser, SALON.user);
  assert.equal(onDisk.product.primaryArtifact, SALON.primaryArtifact);
  assert.equal(onDisk.protectedDecisions.dataAuthority, "nodekit");
  assert.equal(onDisk.protectedDecisions.finalVerdict, "nodeproof");
  assert.deepEqual(onDisk, productDesignContract);

  // Every prohibited authority survived into the interface anti-patterns.
  assert.ok(onDisk.avoid.includes("prohibited:write_to_any_accounting_ledger"));
  assert.ok(onDisk.avoid.includes("prohibited:move_or_transfer_money"));

  // The Atlas reuse query beside the packet stays read-only for a read-only wedge.
  const atlasOnDisk = JSON.parse(await readFile(path.join(root, atlasQueryPath), "utf8"));
  assert.equal(atlasOnDisk.readOnly, true);
  assert.deepEqual(atlasOnDisk, atlasQuery);

  // The frontend Build stage accepts the compiled packet and carries the boundary forward:
  // the planner does not get to re-decide the user, the job, or the final verdict authority.
  const { plan } = await compileFrontendPlan(root, packetPath);
  assert.equal(plan.protectedContract.primaryUser, SALON.user);
  assert.equal(plan.protectedContract.primaryJob, SALON.primaryJob);
  assert.equal(plan.protectedContract.protectedDecisions.permissionBoundaries, "nodekit");
  assert.equal(plan.finalVerdictAuthority, "nodeproof");
  assert.equal(plan.deploymentAuthorized, false);
});

test("materializeBuildPacket refuses a packet name that could escape the packet directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-build-packet-"));
  await assert.rejects(
    () => materializeBuildPacket({ repoRoot: root, opportunity: SALON, packetName: "../escape" }),
    /kebab slug/,
  );
});
