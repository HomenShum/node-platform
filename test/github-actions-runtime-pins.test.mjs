import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const expectedPins = {
  checkout: {
    sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1",
  },
  "setup-node": {
    sha: "820762786026740c76f36085b0efc47a31fe5020",
    version: "v7.0.0",
  },
};

test("GitHub workflows pin Node 24 actions by immutable release commit", () => {
  const workflowDirectory = join(process.cwd(), ".github", "workflows");
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(workflowDirectory, name));

  for (const file of workflowFiles) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const action = Object.keys(expectedPins).find((name) => line.includes(`actions/${name}@`));
      if (!action) continue;

      const pin = expectedPins[action];
      assert.ok(
        line.trim().includes(`uses: actions/${action}@${pin.sha} # ${pin.version}`),
        `${file}:${index + 1} must use the approved immutable ${action} pin`,
      );
    }
  }
});
