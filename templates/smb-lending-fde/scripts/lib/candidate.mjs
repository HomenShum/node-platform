import { execFileSync } from "node:child_process";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function requireCleanCandidate(cwd = process.cwd()) {
  const commit = git(["rev-parse", "HEAD"], cwd);
  const dirty = git(["status", "--porcelain"], cwd);
  if (dirty) throw new Error("gate receipts require a committed, clean candidate worktree");
  return { commit, dirty: false };
}
