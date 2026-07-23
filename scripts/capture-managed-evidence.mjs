#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  finalizeManagedEvidenceCampaign,
  getManagedEvidenceCampaign,
  importManagedEvidence,
  linkManagedBrowserManifest,
  recordManagedEvidenceCleanup,
  recordManagedEvidencePhase,
  recordManagedEvidenceResource,
  resumeManagedEvidenceCampaign,
  startManagedEvidenceCampaign,
} from "../src/lib/managed-evidence-capture.mjs";

function parseArguments(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    if (token === "--help") {
      options.set("help", ["yes"]);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals >= 0 ? equals : undefined);
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!key || typeof value !== "string" || value.length === 0 || value.startsWith("--")) throw new Error(`${token} requires a value`);
    const values = options.get(key) ?? [];
    values.push(value);
    options.set(key, values);
  }
  return { positionals, options };
}

function one(options, key, { required = false } = {}) {
  const values = options.get(key) ?? [];
  if (values.length > 1) throw new Error(`--${key} may be provided only once`);
  if (required && values.length !== 1) throw new Error(`--${key} is required`);
  return values[0];
}

function yesNo(options, key, { required = false } = {}) {
  const value = one(options, key, { required });
  if (value === undefined) return undefined;
  if (value === "yes") return true;
  if (value === "no") return false;
  throw new Error(`--${key} must be yes or no`);
}

function rejectUnknownOptions(options, allowed) {
  const accepted = new Set(["help", "repo-root", ...allowed]);
  const unknown = [...options.keys()].filter((key) => !accepted.has(key));
  if (unknown.length > 0) throw new Error(`unknown option(s): ${unknown.map((key) => `--${key}`).join(", ")}`);
}

const GATE_DIRECTORIES = Object.freeze({
  previewDeployment: "preview",
  managedSupabasePortability: "managed-supabase",
  threeConvexConsumers: "convex-consumer",
});

function samePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function campaignLocator(options, repoRoot) {
  const campaignPath = one(options, "campaign", { required: true });
  const absolute = path.resolve(repoRoot, campaignPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--campaign must remain inside --repo-root");
  const checkpoint = JSON.parse(await readFile(absolute, "utf8"));
  const gateDirectory = GATE_DIRECTORIES[checkpoint.gate];
  if (!gateDirectory) throw new Error("--campaign does not identify a supported managed evidence gate");
  const expected = path.join(
    repoRoot,
    "proof",
    "managed-evidence",
    gateDirectory,
    String(checkpoint.candidate?.nodekitCommit ?? ""),
    String(checkpoint.campaignId ?? ""),
    "campaign.json",
  );
  if (!samePath(absolute, expected)) throw new Error("--campaign must be the canonical campaign.json returned by start");
  return {
    repoRoot,
    campaignId: checkpoint.campaignId,
    gate: checkpoint.gate,
    candidateCommit: checkpoint.candidate?.nodekitCommit,
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function managedEvidenceCaptureHelp() {
  return `Usage: nodekit-evidence-capture <command> [options]

Start a fail-closed, resumable external-evidence campaign:
  nodekit-evidence-capture start \\
    --gate previewDeployment \\
    --candidate-proof proof/package-install-verdict.json \\
    --require-env VERCEL_TOKEN \\
    --require-env CONVEX_DEPLOY_KEY

Consumer campaigns additionally require a clean, immutable consumer revision:
  nodekit-evidence-capture start \\
    --gate threeConvexConsumers \\
    --candidate-proof proof/package-install-verdict.json \\
    --consumer-id noderoom \\
    --consumer-root D:\\src\\noderoom \\
    --consumer-commit <40-char-commit> \\
    --require-env CONVEX_DEPLOY_KEY

Resume and time the real operator work:
  nodekit-evidence-capture resume --campaign <campaign.json>
  nodekit-evidence-capture phase --campaign <campaign.json> --action start --phase deploy
  nodekit-evidence-capture phase --campaign <campaign.json> --action complete --phase deploy --outcome succeeded

Record isolated managed resources (the tool never creates or deletes them):
  nodekit-evidence-capture resource --campaign <campaign.json> --kind frontend-preview --provider vercel --resource-id <id> --environment preview --isolated yes --url https://preview.example.test

Import measured evidence and bind the complete rendered-browser closure:
  nodekit-evidence-capture evidence --campaign <campaign.json> --kind browser-proof --file C:\\proof\\browser-proof.json
  nodekit-evidence-capture browser --campaign <campaign.json> --manifest proof/preview/browser/screenshot-manifest.json --application-commit <40-char-commit>

Record one provider cleanup receipt per managed resource:
  nodekit-evidence-capture cleanup --campaign <campaign.json> --resource-kind frontend-preview --provider-receipt C:\\proof\\vercel-cleanup.json

Inspect or close the capture ledger for independent review:
  nodekit-evidence-capture status --campaign <campaign.json>
  nodekit-evidence-capture finalize --campaign <campaign.json>

Safety:
  This command never deploys, publishes, submits, signs, or marks a submission gate passed.
  Credential values are checked only in the process environment and are never written or printed.
`;
}

export async function runManagedEvidenceCapture(argv, { environment = process.env } = {}) {
  const { positionals, options } = parseArguments(argv);
  const command = positionals[0];
  if (!command || command === "help" || options.has("help")) return { help: managedEvidenceCaptureHelp() };
  if (positionals.length !== 1) throw new Error("provide exactly one command; use --help for usage");
  const repoRoot = path.resolve(one(options, "repo-root") ?? process.cwd());
  if (command === "start") {
    rejectUnknownOptions(options, ["gate", "candidate-proof", "require-env", "consumer-id", "consumer-root", "consumer-commit"]);
    return startManagedEvidenceCampaign({
      repoRoot,
      gate: one(options, "gate", { required: true }),
      candidateProof: one(options, "candidate-proof", { required: true }),
      requiredEnvironmentVariables: options.get("require-env") ?? [],
      environment,
      consumerId: one(options, "consumer-id"),
      consumerRoot: one(options, "consumer-root"),
      consumerCommit: one(options, "consumer-commit"),
    });
  }
  const perCommandOptions = {
    status: [],
    resume: [],
    phase: ["action", "phase", "outcome"],
    resource: ["kind", "provider", "resource-id", "environment", "isolated", "url"],
    evidence: ["kind", "file"],
    browser: ["manifest", "application-commit"],
    cleanup: ["resource-kind", "provider-receipt"],
    finalize: [],
  };
  if (!Object.hasOwn(perCommandOptions, command)) throw new Error(`unknown command: ${command}`);
  rejectUnknownOptions(options, ["campaign", ...perCommandOptions[command]]);
  const locator = await campaignLocator(options, repoRoot);
  if (command === "status") return getManagedEvidenceCampaign(locator);
  if (command === "resume") return resumeManagedEvidenceCampaign(locator);
  if (command === "phase") {
    return recordManagedEvidencePhase({
      ...locator,
      action: one(options, "action", { required: true }),
      phase: one(options, "phase", { required: true }),
      outcome: one(options, "outcome"),
    });
  }
  if (command === "resource") {
    return recordManagedEvidenceResource({
      ...locator,
      kind: one(options, "kind", { required: true }),
      provider: one(options, "provider", { required: true }),
      resourceId: one(options, "resource-id", { required: true }),
      environment: one(options, "environment", { required: true }),
      isolated: yesNo(options, "isolated", { required: true }),
      url: one(options, "url"),
    });
  }
  if (command === "evidence") {
    return importManagedEvidence({
      ...locator,
      kind: one(options, "kind", { required: true }),
      sourceFile: one(options, "file", { required: true }),
      environment,
    });
  }
  if (command === "browser") {
    return linkManagedBrowserManifest({
      ...locator,
      manifestPath: one(options, "manifest", { required: true }),
      applicationCommit: one(options, "application-commit", { required: true }),
    });
  }
  if (command === "cleanup") {
    return recordManagedEvidenceCleanup({
      ...locator,
      resourceKind: one(options, "resource-kind", { required: true }),
      providerReceiptFile: one(options, "provider-receipt", { required: true }),
      environment,
    });
  }
  if (command === "finalize") return finalizeManagedEvidenceCampaign(locator);
  throw new Error(`unhandled command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagedEvidenceCapture(process.argv.slice(2)).then((result) => {
    if (result?.help) process.stdout.write(result.help);
    else print(result);
  }).catch((error) => {
    process.stderr.write(`MANAGED_EVIDENCE_CAPTURE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
