import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tool as approveProposalTool } from "../tools/approve-proposal.mjs";
import { tool as inspectFileTool } from "../tools/inspect-lending-file.mjs";
import { tool as proposeDocumentRequestTool } from "../tools/propose-document-request.mjs";
import { validator as documentRequestIsMissing } from "../validators/document-request-is-missing.mjs";
import { validator as humanAuthorityBoundary } from "../validators/human-authority-boundary.mjs";
import { validator as receiptIsSecretFree } from "../validators/receipt-is-secret-free.mjs";
import { validator as syntheticDataOnly } from "../validators/synthetic-data-only.mjs";
import { stableDigest } from "./stable-digest.mjs";

const DEFAULT_PACK_PATH = fileURLToPath(new URL("../../packs/primary/pack.yaml", import.meta.url));
const TOOLS = Object.freeze([
  inspectFileTool,
  proposeDocumentRequestTool,
  approveProposalTool,
]);
const VALIDATORS = Object.freeze([
  syntheticDataOnly,
  humanAuthorityBoundary,
  documentRequestIsMissing,
  receiptIsSecretFree,
]);
const TOOL_BY_ID = new Map(TOOLS.map((definition) => [definition.id, definition]));
const VALIDATOR_BY_ID = new Map(VALIDATORS.map((definition) => [definition.id, definition]));
const PROPOSAL_VALIDATOR_IDS = Object.freeze([
  "synthetic-data-only",
  "human-authority-boundary",
  "document-request-is-missing",
]);

function fail(message) {
  throw new Error(`SMB lending pack registry integrity failure: ${message}`);
}

function parseListField(yaml, field) {
  const lines = String(yaml).split(/\r?\n/);
  const values = [];
  let active = false;
  for (const line of lines) {
    if (new RegExp(`^${field}:\\s*$`).test(line)) {
      active = true;
      continue;
    }
    if (!active) continue;
    const entry = line.match(/^\s{2,}-\s+([^#\s]+)\s*$/);
    if (entry) {
      values.push(entry[1]);
      continue;
    }
    if (/^\S/.test(line) && !line.startsWith("#")) active = false;
  }
  return values;
}

function assertExactIds(kind, declared, actual) {
  const declaredSet = new Set(declared);
  if (declared.length !== declaredSet.size) fail(`${kind} contains duplicate declarations`);
  const missingConcreteModule = declared.filter((id) => !actual.has(id));
  const undeclaredConcreteModule = [...actual.keys()].filter((id) => !declaredSet.has(id));
  if (missingConcreteModule.length || undeclaredConcreteModule.length) {
    fail(`${kind} declaration/module mismatch (missing modules: ${missingConcreteModule.join(", ") || "none"}; undeclared modules: ${undeclaredConcreteModule.join(", ") || "none"})`);
  }
}

function assertModuleDefinitions() {
  for (const tool of TOOLS) {
    if (!tool?.id || typeof tool.execute !== "function") fail(`tool module ${tool?.id ?? "unknown"} is invalid`);
  }
  for (const validator of VALIDATORS) {
    if (!validator?.id || typeof validator.validate !== "function") fail(`validator module ${validator?.id ?? "unknown"} is invalid`);
  }
}

/**
 * Validate the pack's authored YAML list against the concrete local modules.
 * It intentionally fails closed rather than silently ignoring a pack declaration.
 */
export function assertSmbLendingPackRegistry({ packPath = DEFAULT_PACK_PATH } = {}) {
  assertModuleDefinitions();
  const yaml = readFileSync(path.resolve(packPath), "utf8");
  const id = yaml.match(/^id:\s*([^\s#]+)\s*$/m)?.[1];
  const version = yaml.match(/^version:\s*([^\s#]+)\s*$/m)?.[1];
  if (id !== "smb-lending-deployment") fail(`expected pack id smb-lending-deployment, received ${id ?? "missing"}`);
  if (!version) fail("pack version is missing");

  const declaredTools = parseListField(yaml, "tools");
  const declaredValidators = parseListField(yaml, "validators");
  assertExactIds("tools", declaredTools, TOOL_BY_ID);
  assertExactIds("validators", declaredValidators, VALIDATOR_BY_ID);
  return Object.freeze({
    id,
    packPath: path.resolve(packPath),
    toolIds: [...declaredTools],
    validatorIds: [...declaredValidators],
    version,
  });
}

function registryEvidence(registry, phase, execution) {
  return {
    packId: registry.id,
    packVersion: registry.version,
    phase,
    ...execution,
  };
}

async function executeTool(registry, toolId, context, phase) {
  if (!registry.toolIds.includes(toolId)) fail(`attempted to execute undeclared tool ${toolId}`);
  const tool = TOOL_BY_ID.get(toolId);
  if (!tool) fail(`tool ${toolId} has no concrete module`);
  const output = await tool.execute(context);
  return registryEvidence(registry, phase, {
    outputHash: stableDigest(output),
    toolId: tool.id,
    toolVersion: tool.version,
  });
}

async function executeValidator(registry, validatorId, context, phase) {
  if (!registry.validatorIds.includes(validatorId)) fail(`attempted to execute undeclared validator ${validatorId}`);
  const validator = VALIDATOR_BY_ID.get(validatorId);
  if (!validator) fail(`validator ${validatorId} has no concrete module`);
  const output = await validator.validate(context);
  if (!output || typeof output.passed !== "boolean") fail(`validator ${validatorId} did not return a boolean verdict`);
  return registryEvidence(registry, phase, {
    message: String(output.message ?? ""),
    outputHash: stableDigest(output),
    passed: output.passed,
    validatorId: validator.id,
    validatorVersion: validator.version,
  });
}

async function runValidators(registry, validatorIds, context, phase) {
  const results = [];
  for (const validatorId of validatorIds) results.push(await executeValidator(registry, validatorId, context, phase));
  return {
    passed: results.every((result) => result.passed),
    results,
  };
}

export async function prepareDocumentRequestThroughRegistry(session, proposal, options = {}) {
  const registry = assertSmbLendingPackRegistry(options);
  const inspection = await executeTool(registry, "lending.inspect-file", { session }, "proposal");
  const normalized = await proposeDocumentRequestTool.execute({ proposal, session });
  const proposalTool = registryEvidence(registry, "proposal", {
    outputHash: stableDigest(normalized),
    toolId: proposeDocumentRequestTool.id,
    toolVersion: proposeDocumentRequestTool.version,
  });
  const validation = await runValidators(registry, PROPOSAL_VALIDATOR_IDS, { proposal: normalized, session }, "proposal");
  return {
    normalized,
    registry,
    toolExecutions: [inspection, proposalTool],
    validation,
  };
}

export async function approveProposalThroughRegistry(session, proposal, options = {}) {
  const registry = assertSmbLendingPackRegistry(options);
  const validation = await runValidators(registry, PROPOSAL_VALIDATOR_IDS, { proposal, session }, "approval");
  if (!validation.passed) {
    return { applied: null, registry, toolExecutions: [], validation };
  }
  const applied = await approveProposalTool.execute({ proposal, session });
  const approvalTool = registryEvidence(registry, "approval", {
    outputHash: stableDigest(applied),
    toolId: approveProposalTool.id,
    toolVersion: approveProposalTool.version,
  });
  return { applied, registry, toolExecutions: [approvalTool], validation };
}

export async function validateReceiptThroughRegistry(receipt, options = {}) {
  const registry = assertSmbLendingPackRegistry(options);
  const validation = await runValidators(registry, ["receipt-is-secret-free"], { receipt }, "receipt");
  return { registry, validation };
}

export function packRegistrySummary(session, options = {}) {
  const registry = assertSmbLendingPackRegistry(options);
  const events = Array.isArray(session?.events) ? session.events : [];
  return {
    id: registry.id,
    toolExecutions: events
      .filter((entry) => entry.type === "tool.executed")
      .map((entry) => entry.details),
    toolIds: registry.toolIds,
    validatorIds: registry.validatorIds,
    validatorRuns: events
      .filter((entry) => entry.type === "validator.completed")
      .map((entry) => entry.details),
    version: registry.version,
  };
}
