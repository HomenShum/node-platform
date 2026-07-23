import { existsSync } from "node:fs";
import path from "node:path";

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve a tar binary that can read a Windows drive-letter path.
 *
 * Git-Bash/MSYS place a GNU tar earlier on PATH than the Windows system one, and
 * GNU tar parses `C:\dir\file.tgz` as the rsh spec `host:path`, failing with
 * "Cannot connect to C: resolve failed". Windows 10 1803+ ships bsdtar at
 * System32, which handles drive letters natively. `--force-local` would fix GNU
 * tar but is unsupported by bsdtar, so selecting the right binary is portable
 * where a flag is not. Falls back to PATH lookup when the system binary is absent.
 */
export function resolveTarCommand({
  env = process.env,
  pathExists = existsSync,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return "tar";
  const systemTar = path.join(nonempty(env.SystemRoot) ?? "C:\\Windows", "System32", "tar.exe");
  return pathExists(systemTar) ? systemTar : "tar";
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
