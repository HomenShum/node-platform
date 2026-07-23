import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileOpportunityToBuild } from "../src/lib/opportunity-compiler.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

async function salonOpportunity() {
  const url = new URL("./fixtures/builder-journey/salon.opportunity-contract.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("the salon OpportunityContract compiles into a product-design contract the tournament can consume", async () => {
  const opportunity = await salonOpportunity();
  const { productDesignContract } = compileOpportunityToBuild(opportunity);
  const findings = await validateSchema("nodekit.product-design-contract.v1.schema.json", productDesignContract, "compiled product contract");
  assert.deepEqual(findings, [], `compiled contract must validate: ${findings.join("; ")}`);
});

test("the OpportunityContract's decisions are carried into the product contract and marked protected", async () => {
  const opportunity = await salonOpportunity();
  const { productDesignContract } = compileOpportunityToBuild(opportunity);
  // Decisions are carried, not re-invented.
  assert.equal(productDesignContract.product.targetUser, opportunity.user);
  assert.equal(productDesignContract.product.primaryJob, opportunity.primaryJob);
  assert.equal(productDesignContract.product.primaryArtifact, opportunity.primaryArtifact);
  // And they are protected: the coding agent cannot re-decide them while coding.
  assert.equal(productDesignContract.protectedDecisions.primaryUser, "nodekit");
  assert.equal(productDesignContract.protectedDecisions.dataAuthority, "nodekit");
  assert.equal(productDesignContract.protectedDecisions.permissionBoundaries, "nodekit");
  assert.equal(productDesignContract.protectedDecisions.finalVerdict, "nodeproof");
});

test("prohibited authorities become anti-patterns the interface may not present", async () => {
  const opportunity = await salonOpportunity();
  const { productDesignContract } = compileOpportunityToBuild(opportunity);
  // Every prohibited authority is carried into avoid so the build cannot silently violate it.
  assert.equal(
    productDesignContract.avoid.includes("prohibited:write_to_any_accounting_ledger"),
    true,
    "the write-to-ledger prohibition must survive into the contract's avoid list",
  );
  assert.equal(productDesignContract.avoid.includes("prohibited:move_or_transfer_money"), true);
  // The standard NodeKit anti-patterns are still present.
  assert.equal(productDesignContract.avoid.includes("generic_kpi_dashboard"), true);
});

test("a read-only wedge produces a read-only Atlas query carrying the wedge terms", async () => {
  const opportunity = await salonOpportunity();
  const { atlasQuery } = compileOpportunityToBuild(opportunity);
  assert.equal(atlasQuery.readOnly, true);
  assert.match(atlasQuery.terms, /salon|profit|brief/i);
  assert.equal(atlasQuery.fromWedge, opportunity.wedge);
});
