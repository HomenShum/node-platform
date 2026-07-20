import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadRuntimePolicy(repoRoot = process.cwd()) {
  const resolved = JSON.parse(await readFile(path.join(repoRoot, ".nodeagent", "resolved-definition.json"), "utf8"));
  const maxProposalSeconds = Number(resolved.policies?.maxProposalSeconds);
  const maxModelCallsPerStep = Number(resolved.policies?.maxModelCallsPerStep);
  if (!Number.isFinite(maxProposalSeconds) || maxProposalSeconds <= 0) {
    throw new Error("compiled NodeKit policy must define a positive maxProposalSeconds");
  }
  if (!Number.isInteger(maxModelCallsPerStep) || maxModelCallsPerStep < 0) {
    throw new Error("compiled NodeKit policy must define a non-negative integer maxModelCallsPerStep");
  }
  return {
    configHash: resolved.configHash,
    maxModelCallsPerStep,
    maxProposalMs: maxProposalSeconds * 1_000,
    maxProposalSeconds,
  };
}
