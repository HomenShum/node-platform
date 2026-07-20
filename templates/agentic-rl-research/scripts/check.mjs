import { spawnSync } from "node:child_process";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const nodekit = path.resolve("node_modules", "@homenshum", "nodekit", "src", "cli.mjs");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

try {
  run(process.execPath, [nodekit, "compile", "--repo-root", ".", "--check"]);
  run(process.execPath, ["--test"]);
  await recordFriction("tests_passed", { compileHashCurrent: true }, Date.now() - started);
} catch (error) {
  await recordFriction("tests_failed", { error: error.message }, Date.now() - started);
  throw error;
}
