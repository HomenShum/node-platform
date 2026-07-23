import { spawnSync } from "node:child_process";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const nodekit = path.resolve("node_modules", "@homenshum", "nodekit", "src", "cli.mjs");
for (const [command, args] of [[process.execPath, [nodekit, "compile", "--repo-root", ".", "--check"]], [process.execPath, ["--test"]]]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    await recordFriction("tests_failed", { command, status: result.status }, Date.now() - started);
    throw new Error(`${command} exited ${result.status}`);
  }
}
await recordFriction("tests_passed", { compileHashCurrent: true }, Date.now() - started);
