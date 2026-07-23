import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDeveloperTimingMatrix, evaluateFreshUserStudy } from "../src/lib/ease-evidence.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function verifyHumanEvidenceFiles(study, repoRoot) {
  const errors = [];
  const root = await realpath(repoRoot);
  const physicalFiles = new Set();
  for (const participant of Array.isArray(study?.participants) ? study.participants : []) {
    for (const evidence of Array.isArray(participant?.evidenceRefs) ? participant.evidenceRefs : []) {
      if (typeof evidence?.path !== "string" || evidence.path.length === 0) continue;
      const absolute = path.resolve(root, evidence.path);
      const relative = path.relative(root, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        errors.push(`${participant?.participantId ?? "unknown"}: evidence escapes the repository: ${evidence.path}`);
        continue;
      }
      try {
        if (evidence.path.includes("\\") || evidence.path.startsWith("/") || /^[A-Za-z]:/.test(evidence.path) || evidence.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
          errors.push(`${participant?.participantId ?? "unknown"}: evidence path is not one canonical repository-relative POSIX path: ${evidence.path}`);
          continue;
        }
        const link = await lstat(absolute, { bigint: true });
        if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1n) {
          errors.push(`${participant?.participantId ?? "unknown"}: evidence must be one unaliased regular file: ${evidence.path}`);
          continue;
        }
        const physicalIdentity = `${link.dev}:${link.ino}`;
        if (physicalFiles.has(physicalIdentity)) {
          errors.push(`${participant?.participantId ?? "unknown"}: evidence reuses a physical file: ${evidence.path}`);
          continue;
        }
        physicalFiles.add(physicalIdentity);
        const resolved = await realpath(absolute);
        const resolvedRelative = path.relative(root, resolved);
        if (resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative)) {
          errors.push(`${participant?.participantId ?? "unknown"}: evidence symlink escapes the repository: ${evidence.path}`);
          continue;
        }
        const bytes = await readFile(resolved);
        if (sha256(bytes) !== evidence.sha256) errors.push(`${participant?.participantId ?? "unknown"}: evidence hash mismatch: ${evidence.path}`);
      } catch (error) {
        errors.push(`${participant?.participantId ?? "unknown"}: unable to verify ${evidence.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return errors;
}

const [mode, inputArg, outputArg] = process.argv.slice(2);
if (!mode || !["developer", "humans"].includes(mode)) {
  console.error("usage: node scripts/evaluate-ease-evidence.mjs <developer|humans> [input.json] [output.json]");
  process.exit(2);
}
const input = path.resolve(inputArg ?? (mode === "humans" ? "proof/ease/fresh-users.json" : "proof/ease/developer-timing-runs.json"));
const output = path.resolve(outputArg ?? (mode === "humans" ? "proof/ease/fresh-users-verdict.json" : "proof/ease/developer-timing-verdict.json"));
let value;
let inputBytes;
try {
  inputBytes = await readFile(input);
  value = JSON.parse(inputBytes.toString("utf8"));
} catch (error) {
  console.error(`unable to read ${input}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
let verdict;
if (mode === "humans") {
  const evidenceFileErrors = await verifyHumanEvidenceFiles(value, process.cwd());
  verdict = evaluateFreshUserStudy(value, { evidenceFilesVerified: evidenceFileErrors.length === 0, evidenceFileErrors });
} else {
  verdict = evaluateDeveloperTimingMatrix(Array.isArray(value) ? value : value.runs ?? []);
  verdict.supportingEvidence = [{
    kind: "timing-receipts",
    path: path.relative(process.cwd(), input).replaceAll("\\", "/"),
    sha256: sha256(inputBytes),
  }];
}
await writeFile(output, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.passed ? 0 : 1);
