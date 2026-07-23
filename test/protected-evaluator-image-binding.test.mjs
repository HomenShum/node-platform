import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evaluatorUrl = new URL("../scripts/run-protected-agent-evaluator.mjs", import.meta.url);
const browserLaneUrl = new URL("../scripts/run-protected-browser-lane.mjs", import.meta.url);

function protectedDockerRunBodies(source) {
  return [...source.matchAll(/docker\(\[\s*"run",([\s\S]*?)\],\s*\{\s*timeout:/g)]
    .map((match) => match[1]);
}

test("protected evaluator launches both isolated lanes by immutable image ID", async () => {
  const source = await readFile(evaluatorUrl, "utf8");
  const runs = protectedDockerRunBodies(source);
  const candidate = runs.find((body) => /"--name",\s*candidateName/.test(body));
  const browser = runs.find((body) => /"--name",\s*browserName/.test(body));

  assert.equal(runs.length, 2, "expected exactly the candidate and browser protected docker runs");
  assert.ok(candidate, "candidate protected docker run was not found");
  assert.ok(browser, "browser protected docker run was not found");

  for (const [lane, body] of [["candidate", candidate], ["browser", browser]]) {
    assert.match(body, /\bcontainerImageId\s*,\s*"node"/, `${lane} lane must launch the pre-resolved immutable image ID`);
    assert.doesNotMatch(body, /\bcontainerImage\s*,\s*"node"/, `${lane} lane must not launch a mutable image reference`);
  }
});

test("protected evaluator creates the hidden task only after freezing the candidate and exposes no expected output", async () => {
  const evaluator = await readFile(evaluatorUrl, "utf8");
  const browser = await readFile(browserLaneUrl, "utf8");
  const frozen = evaluator.indexOf("private frozen candidate archive snapshot hash mismatch");
  const hidden = evaluator.indexOf("const protectedTaskInput = validateProtectedTaskInput(createProtectedTaskInput");
  assert.ok(frozen >= 0 && hidden > frozen, "hidden task must be generated after the exact candidate archive is frozen");
  assert.match(evaluator, /hidden protected task input was present in the frozen candidate tree/);
  assert.match(evaluator, /NODEKIT_PROTECTED_TASK_INPUT_FILE=\/output\/protected-task-input\.json/);
  assert.doesNotMatch(evaluator, /NODEKIT_PROTECTED_EXPECTED/);
  assert.doesNotMatch(browser, /NODEKIT_PROTECTED_EXPECTED/);
  assert.match(browser, /const submittedOutcome = JSON\.stringify\(protectedTaskInput\)/);
  assert.match(browser, /protected task-journey reset failed/);
});

test("protected browser, not candidate evidence, owns the decisive 180-shot matrix", async () => {
  const evaluator = await readFile(evaluatorUrl, "utf8");
  const browser = await readFile(browserLaneUrl, "utf8");
  assert.match(browser, /const REQUIRED_STATES = Object\.freeze\(\[/);
  assert.match(browser, /const VIEWPORTS = Object\.freeze\(\[/);
  assert.match(browser, /const THEMES = Object\.freeze\(\["light", "dark"\]\)/);
  assert.match(browser, /REQUIRED_STATES\.length \* VIEWPORTS\.length \* THEMES\.length/);
  assert.match(browser, /nodekit\.protected-browser-screenshot-manifest\/v1/);
  assert.match(browser, /new Set\(screenshots\.map\(\(screenshot\) => screenshot\.pngSha256\)\)\.size === expectedCount/);
  assert.match(evaluator, /const candidateScreenshotMatrix = await verifyScreenshotMatrix/);
  assert.match(evaluator, /candidateScreenshotMatrix\.issues\.map\(\(issue\) => \(\{ \.\.\.issue, severity: "p2" \}\)\)/);
  assert.match(evaluator, /protectedScreenshotMatrix = await verifyProtectedScreenshotMatrix/);
  assert.match(evaluator, /await cp\([\s\S]*?"protected-browser"[\s\S]*?recursive: true/);
  assert.match(evaluator, /screenshotEvidenceRootSha256: protectedScreenshotMatrix\?\.screenshotEvidenceRootSha256/);
  assert.doesNotMatch(evaluator, /screenshotEvidenceRootSha256: candidateScreenshotMatrix/);
});

test("protected browser runs exact Axe 4.12.1 scans for every protected state and binds all browser package trees", async () => {
  const evaluator = await readFile(evaluatorUrl, "utf8");
  const browser = await readFile(browserLaneUrl, "utf8");
  assert.match(browser, /import AxeBuilder from "@axe-core\/playwright"/);
  assert.match(browser, /new AxeBuilder\(\{ page \}\)\.analyze\(\)/);
  assert.match(browser, /engineVersion !== AXE_ENGINE_VERSION/);
  assert.match(browser, /passed: seriousCriticalViolations === 0/);
  assert.match(browser, /const AXE_ENGINE_VERSION = "4\.12\.1"/);
  assert.match(browser, /const AXE_POLICY = "serious-critical-zero"/);
  assert.match(browser, /policy: AXE_POLICY/);
  assert.match(browser, /scans: screenshots\.length/);
  assert.match(browser, /"axe-serious-critical"/);
  assert.match(evaluator, /packageTreeIdentity\(playwrightPackageRoot, "playwright", "1\.61\.1", "\/runner\/node_modules\/playwright"\)/);
  assert.match(evaluator, /packageTreeIdentity\(playwrightCorePackageRoot, "playwright-core", "1\.61\.1", "\/runner\/node_modules\/playwright-core"\)/);
  assert.match(evaluator, /packageTreeIdentity\(axePlaywrightPackageRoot, "@axe-core\/playwright", "4\.12\.1", "\/runner\/node_modules\/@axe-core\/playwright"\)/);
  assert.match(evaluator, /packageTreeIdentity\(axeCorePackageRoot, "axe-core", "4\.12\.1", "\/runner\/node_modules\/axe-core"\)/);
  assert.match(evaluator, /treeSha256: sha256\(JSON\.stringify\(records\)\)/);
  assert.match(evaluator, /browserDependencies/);
});
