import assert from "node:assert/strict";
import test from "node:test";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";

test("Windows npm invocation preserves path-with-spaces arguments without a shell", () => {
  const npmCli = "D:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const nodeExecutable = "D:\\Program Files\\nodejs\\node.exe";
  const tarball = "D:\\VSCode Projects\\node-platform\\proof\\candidate.tgz";
  const invocation = resolveNpmCliInvocation(["install", tarball, "--ignore-scripts"], {
    env: { npm_execpath: npmCli },
    nodeExecutable,
    pathExists: (candidate) => candidate === npmCli,
    platform: "win32",
  });
  assert.equal(invocation.command, nodeExecutable);
  assert.deepEqual(invocation.args, [npmCli, "install", tarball, "--ignore-scripts"]);
  assert.equal(invocation.shell, false);
  assert.equal(invocation.displayCommand, "npm");
});

test("Windows npm invocation fails closed instead of falling back to shell parsing", () => {
  assert.throws(() => resolveNpmCliInvocation(["install", "D:\\A B\\candidate.tgz"], {
    env: {},
    nodeExecutable: "D:\\node\\node.exe",
    pathExists: () => false,
    platform: "win32",
  }), /refusing shell-mediated npm execution/);
});

test("POSIX npm invocation has a shell-free binary fallback", () => {
  const invocation = resolveNpmCliInvocation(["--version"], {
    env: {},
    nodeExecutable: "/usr/bin/node",
    pathExists: () => false,
    platform: "linux",
  });
  assert.deepEqual(invocation, {
    args: ["--version"],
    command: "npm",
    displayArgs: ["--version"],
    displayCommand: "npm",
    shell: false,
  });
});
