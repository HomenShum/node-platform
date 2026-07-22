import { existsSync } from "node:fs";
import path from "node:path";

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveNpmCliInvocation(args, {
  env = process.env,
  nodeExecutable = process.execPath,
  pathExists = existsSync,
  platform = process.platform,
} = {}) {
  const candidates = [
    nonempty(env.npm_execpath),
    path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => pathExists(candidate));
  if (npmCli) {
    return {
      args: [npmCli, ...args],
      command: nodeExecutable,
      displayArgs: [...args],
      displayCommand: "npm",
      shell: false,
    };
  }
  if (platform === "win32") {
    throw new Error("unable to locate npm-cli.js; refusing shell-mediated npm execution on Windows");
  }
  return {
    args: [...args],
    command: "npm",
    displayArgs: [...args],
    displayCommand: "npm",
    shell: false,
  };
}
