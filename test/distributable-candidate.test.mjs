import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "../src/lib/distributable-candidate.mjs";

test("distributable candidate pathspec includes packaged Evolution Ledger files", () => {
  const paths = distributablePathspecs({ files: ["dist", "src", "evolution", "README.md"] });
  assert.deepEqual(paths, ["package.json", "dist", "src", "evolution", "README.md"]);
});

test("dirty distributable evolution files fail the shared package and PostgreSQL candidate gate", () => {
  const dirty = parseGitStatusPorcelainZ(Buffer.from(
    " M evolution/events/evt-release.json\0?? evolution/evidence/evd-release.json\0",
    "utf8",
  ));
  assert.deepEqual(dirty, [
    "evolution/events/evt-release.json",
    "evolution/evidence/evd-release.json",
  ]);
  assert.throws(
    () => assertCleanDistributablePaths(dirty, "PostgreSQL conformance"),
    /PostgreSQL conformance requires a clean distributable candidate; dirty paths: evolution\/events\/evt-release\.json, evolution\/evidence\/evd-release\.json/,
  );
});

test("shared porcelain parser preserves both rename paths", () => {
  const dirty = parseGitStatusPorcelainZ(Buffer.from("R  evolution/events/new.json\0evolution/events/old.json\0", "utf8"));
  assert.deepEqual(dirty, ["evolution/events/new.json", "evolution/events/old.json"]);
});
