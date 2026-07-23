import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTarCommand } from "../src/lib/npm-cli-invocation.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EVALUATION_CHECKS = Object.freeze([
  "applicationIdentityBound",
  "artifactDownloadVerified",
  "artifactReloadPersistenceVerified",
  "artifactReopenPersistenceVerified",
  "browserEvidenceBound",
  "candidateArchiveBound",
  "candidateTreeBound",
  "evaluatorBytesBound",
  "guidedInteractionPassed",
  "independentScreenshotCaptured",
  "isolationBound",
  "renderedTaskRelevant",
  "sourceTaskRelevant",
  "taskBytesBound",
  "taskInputBound",
  "taskSetBound",
  "typedArtifactVerified",
  "visualReviewPassed",
]);
const MAX_TRUSTED_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_TASK_BRIEF_BYTES = 1024 * 1024;
const MAX_TASK_SET_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_CANDIDATE_TREE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CANDIDATE_TREE_BYTES = 256 * 1024 * 1024;
const MAX_CANDIDATE_TREE_FILES = 10_000;
const MAX_BROWSER_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_BROWSER_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_PNG_BYTES = 25 * 1024 * 1024;
const MAX_SCREENSHOT_SIDECAR_BYTES = 2 * 1024 * 1024;
const MAX_SCREENSHOT_CLOSURE_BYTES = 1024 * 1024 * 1024;
const MAX_EXPORTED_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_APPLICATION_IDENTITY_BYTES = 1024 * 1024;
const TASK_RUBRICS = Object.freeze({
  "research-map": Object.freeze([
    ["supplied", "immutable", "packet"],
    ["agentic rl", "agentic reinforcement", "reinforcement learning"],
    ["source", "evidence", "citation"],
    ["hash", "map", "compare", "comparison"],
  ]),
  "volunteer-onboarding": Object.freeze([
    ["volunteer"],
    ["onboard", "onboarding"],
    ["application", "applicant", "document"],
    ["review", "completion", "confirmed"],
  ]),
  "launch-presentation": Object.freeze([
    ["launch"],
    ["presentation", "deck", "slide"],
    ["metric", "brief"],
    ["review", "approval", "approve"],
  ]),
});
const TASK_ARTIFACT_TYPES = Object.freeze({
  "launch-presentation": "launch-presentation",
  "research-map": "research-map",
  "volunteer-onboarding": "volunteer-onboarding-record",
});
const PROTECTED_STATES = Object.freeze([
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
]);
const PROTECTED_VIEWPORTS = Object.freeze([
  { id: "desktop", width: 1440, height: 900 }, { id: "wide", width: 1920, height: 1080 },
  { id: "tablet-landscape", width: 1024, height: 768 }, { id: "tablet-portrait", width: 768, height: 1024 },
  { id: "mobile-portrait", width: 390, height: 844 }, { id: "mobile-landscape", width: 844, height: 390 },
]);
const PROTECTED_THEMES = Object.freeze(["light", "dark"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return sha256(canonical(value));
}

async function packageTreeIdentity(directory, expectedName, expectedVersion, destination) {
  const records = [];
  async function walk(current, prefix = "") {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`trusted browser dependency contains a symlink: ${expectedName}/${relative}`);
      if (metadata.isDirectory()) await walk(absolute, relative);
      else if (metadata.isFile()) {
        const bytes = await readFile(absolute);
        records.push({ bytes: bytes.length, path: relative, sha256: sha256(bytes) });
      } else throw new Error(`trusted browser dependency contains a non-file entry: ${expectedName}/${relative}`);
    }
  }
  await walk(directory);
  records.sort((left, right) => left.path.localeCompare(right.path));
  const packageJson = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (packageJson.name !== expectedName || packageJson.version !== expectedVersion || records.length === 0) {
    throw new Error(`trusted browser dependency identity drifted: ${expectedName}@${expectedVersion}`);
  }
  return Object.freeze({ destination, fileCount: records.length, name: expectedName, treeSha256: sha256(JSON.stringify(records)), version: expectedVersion });
}

function selfHash(value, field) {
  const body = { ...value };
  delete body[field];
  return sha256(JSON.stringify(body));
}

function parseArgs(argv) {
  const allowed = new Set([
    "application-hash", "browser-manifest", "candidate-archive", "candidate-archive-sha256",
    "browser-lane-file", "browser-lane-sha256", "candidate-root", "config-hash", "container-image",
    "container-image-id", "evaluator-sha256", "nodekit-commit", "nodekit-source-hash",
    "nodekit-tarball-sha256", "output-root", "post-agent-tree-hash", "run-id", "task-brief-file",
    "task-brief-sha256", "task-id", "task-set-file", "task-set-sha256",
  ]);
  const parsed = Object.create(null);
  for (const raw of argv) {
    if (!raw.startsWith("--") || !raw.includes("=")) throw new Error(`unsupported evaluator argument: ${raw}`);
    const separator = raw.indexOf("=");
    const key = raw.slice(2, separator);
    const value = raw.slice(separator + 1);
    if (!allowed.has(key) || value.length === 0) throw new Error(`unknown or empty evaluator option --${key}`);
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate evaluator option --${key}`);
    parsed[key] = value;
  }
  for (const key of allowed) if (!Object.hasOwn(parsed, key)) throw new Error(`--${key}=<value> is required`);
  return parsed;
}

function requireDigest(value, label, pattern = SHA256) {
  const normalized = String(value).toLowerCase();
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout;
}

async function regularFile(file, label, { maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error(`${label} has an invalid verifier byte limit`);
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic-link file`);
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte verifier limit`);
  }
  const bytes = await readFile(file);
  // A second check closes the lstat/read race if an attacker replaces or grows
  // a previously bounded file after metadata inspection.
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte verifier limit`);
  return bytes;
}

function candidateTreeBudget(candidateRoot, tree) {
  const listing = git(candidateRoot, ["ls-tree", "-rl", "--full-tree", tree]).split(/\r?\n/).filter(Boolean);
  let totalBytes = 0;
  let fileCount = 0;
  for (const line of listing) {
    const match = line.match(/^(\d+)\s+blob\s+[a-f0-9]{40}\s+(\d+)\t(.+)$/);
    if (!match || !new Set(["100644", "100755"]).has(match[1])) {
      throw new Error("candidate tree contains an unsupported archive entry");
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_CANDIDATE_TREE_FILE_BYTES) {
      throw new Error(`candidate archive entry exceeds the ${MAX_CANDIDATE_TREE_FILE_BYTES}-byte verifier limit`);
    }
    totalBytes += size;
    fileCount += 1;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CANDIDATE_TREE_BYTES) {
      throw new Error(`candidate archive closure exceeds ${MAX_CANDIDATE_TREE_BYTES} bytes`);
    }
    if (fileCount > MAX_CANDIDATE_TREE_FILES) {
      throw new Error(`candidate archive closure exceeds ${MAX_CANDIDATE_TREE_FILES} files`);
    }
  }
  return Object.freeze({ fileCount, totalBytes });
}

async function assertOutsideCandidate(candidateRoot, file, label) {
  const [realCandidate, realFile] = await Promise.all([realpath(candidateRoot), realpath(file)]);
  const relative = path.relative(realCandidate, realFile);
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error(`${label} must remain outside the generated candidate repository`);
  }
}

function taskGroups(text, rubric) {
  const normalized = String(text).normalize("NFKC").toLowerCase();
  return rubric.map((alternatives, index) => {
    const matches = alternatives.filter((term) => normalized.includes(term));
    return { alternatives, group: index + 1, matches, passed: matches.length > 0 };
  });
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function objectIdentity(value) {
  if (nonEmptyText(value)) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [value.id, value.name, value.email, value.applicationId, value.volunteerId].some(nonEmptyText));
}

function exact(left, right) {
  return canonical(left) === canonical(right);
}

function createProtectedTaskInput({ candidateArchiveSha256, inputToken, nonce, taskId }) {
  const base = {
    generatedAfterCandidateArchiveSha256: candidateArchiveSha256,
    inputToken,
    nonce,
    schemaVersion: "nodekit.protected-task-input/v1",
    taskId,
  };
  if (taskId === "research-map") {
    const sourceSeeds = [
      ["policy-gradient", "Policy-gradient agents", "Policy-gradient agents optimize a sampled return objective with explicit variance controls."],
      ["world-model", "World-model agents", "World-model agents plan against learned dynamics and must track compounding model error."],
      ["verification", "Verifier-guided agents", "Verifier-guided agents use externally checked outcomes to constrain policy updates."],
    ];
    return {
      ...base,
      question: `How do three supplied Agentic RL approaches differ for challenge ${nonce}?`,
      sources: sourceSeeds.map(([suffix, title, statement], index) => {
        const excerpt = `${statement} Packet nonce: ${nonce}; evidence row: ${index + 1}.`;
        return {
          contentSha256: sha256(excerpt),
          excerpt,
          id: `source_${suffix}_${nonce.slice(-12)}`,
          publishedAtIso: `2025-0${index + 1}-15T00:00:00.000Z`,
          title,
          url: `https://evidence.nodekit.invalid/protected/${nonce}/${suffix}`,
        };
      }),
    };
  }
  if (taskId === "volunteer-onboarding") {
    return {
      ...base,
      documents: [
        { id: `doc_identity_${nonce.slice(-12)}`, reviewStatus: "approved", type: "identity" },
        { id: `doc_conduct_${nonce.slice(-12)}`, reviewStatus: "reviewed", type: "code-of-conduct" },
        { id: `doc_safety_${nonce.slice(-12)}`, reviewStatus: "approved", type: "safety-training" },
      ],
      volunteer: {
        email: `volunteer-${nonce.slice(-12)}@example.invalid`,
        id: `volunteer_${nonce.slice(-16)}`,
        name: `Protected Volunteer ${nonce.slice(-8)}`,
      },
    };
  }
  const metricBase = Number.parseInt(nonce.slice(-6), 16);
  return {
    ...base,
    brief: {
      audience: `Operations leaders evaluating challenge ${nonce.slice(-8)}`,
      positioning: `A proof-carrying workflow for ${nonce}`,
      product: `NodeKit Launch ${nonce.slice(-10)}`,
    },
    metrics: [
      { id: `metric_activation_${nonce.slice(-10)}`, label: "Activation", unit: "%", value: 40 + (metricBase % 41) },
      { id: `metric_time_${nonce.slice(-10)}`, label: "Time to proof", unit: "minutes", value: 5 + (metricBase % 23) },
      { id: `metric_runs_${nonce.slice(-10)}`, label: "Verified runs", unit: "runs", value: 10 + (metricBase % 91) },
    ],
  };
}

function validateProtectedTaskInput(value, { candidateArchiveSha256, inputToken, taskId }) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== "nodekit.protected-task-input/v1" || value.taskId !== taskId
    || value.inputToken !== inputToken || !/^challenge_[a-f0-9]{32,64}$/.test(value.nonce ?? "")
    || value.generatedAfterCandidateArchiveSha256 !== candidateArchiveSha256) throw new Error("protected task input envelope is invalid");
  if (taskId === "research-map") {
    if (!nonEmptyText(value.question) || !value.question.includes(value.nonce) || !Array.isArray(value.sources) || value.sources.length < 2) {
      throw new Error("protected research source packet is incomplete");
    }
    const ids = new Set();
    for (const source of value.sources) {
      if (!nonEmptyText(source?.id) || ids.has(source.id) || !nonEmptyText(source?.title)
        || !nonEmptyText(source?.url) || !source.url.startsWith("https://")
        || !nonEmptyText(source?.publishedAtIso) || !Number.isFinite(Date.parse(source.publishedAtIso))
        || !nonEmptyText(source?.excerpt) || !SHA256.test(source?.contentSha256 ?? "")
        || sha256(source.excerpt) !== source.contentSha256) throw new Error("protected research source packet is invalid");
      ids.add(source.id);
    }
  } else if (taskId === "volunteer-onboarding") {
    if (!value.volunteer || [value.volunteer.id, value.volunteer.name, value.volunteer.email].some((field) => !nonEmptyText(field))
      || !Array.isArray(value.documents) || value.documents.length < 1
      || value.documents.some((document) => !nonEmptyText(document?.id) || !nonEmptyText(document?.type)
        || !["reviewed", "approved"].includes(String(document?.reviewStatus).toLowerCase()))) {
      throw new Error("protected volunteer input is incomplete or cannot confirm onboarding");
    }
  } else if (!value.brief || [value.brief.product, value.brief.audience, value.brief.positioning].some((field) => !nonEmptyText(field))
    || !Array.isArray(value.metrics) || value.metrics.length < 1
    || value.metrics.some((metric) => !nonEmptyText(metric?.id) || !nonEmptyText(metric?.label) || !nonEmptyText(metric?.unit)
      || typeof metric?.value !== "number" || !Number.isFinite(metric.value))) {
    throw new Error("protected launch input is incomplete");
  }
  return value;
}

function validateTaskContent(taskId, protectedInput, content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("canonical task artifact content must be an object");
  if (content.inputToken !== protectedInput.inputToken) throw new Error("canonical artifact did not preserve the exact hidden input token");
  if (taskId === "research-map") {
    const question = content.question ?? content.researchQuestion;
    const sources = content.sources ?? content.references ?? content.citations;
    const comparisons = content.comparisons ?? content.findings;
    if (question !== protectedInput.question) throw new Error("research map did not preserve the exact hidden question");
    if (!Array.isArray(sources) || sources.length !== protectedInput.sources.length) throw new Error("research map source count drifted");
    const sourceIds = new Set();
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const supplied = protectedInput.sources[index];
      if (!source || !["id", "title", "url", "publishedAtIso", "contentSha256", "excerpt"]
        .every((field) => source[field] === supplied[field])) throw new Error("research map did not preserve the immutable source packet exactly");
      if (sourceIds.has(source.id)) throw new Error("research map source IDs are not unique");
      sourceIds.add(source.id);
    }
    if (!Array.isArray(comparisons) || comparisons.length < 1) throw new Error("research map needs at least one comparison");
    const referenced = new Set();
    for (const comparison of comparisons) {
      const refs = comparison?.sourceIds ?? comparison?.sourceRefs ?? comparison?.sources;
      if (!Array.isArray(refs) || refs.length < 1 || refs.some((id) => !sourceIds.has(typeof id === "string" ? id : id?.id))) {
        throw new Error("research map comparison does not reference its declared sources");
      }
      refs.forEach((id) => referenced.add(typeof id === "string" ? id : id?.id));
    }
    if (referenced.size !== sourceIds.size) throw new Error("research map comparisons do not cover every supplied source");
    return { comparisonCount: comparisons.length, questionPresent: true, sourceCount: sources.length };
  }
  if (taskId === "volunteer-onboarding") {
    const identity = content.volunteer ?? content.applicant ?? content.application;
    const documents = content.documents ?? content.documentReviews ?? content.checklist;
    const completion = content.completion ?? content.onboarding;
    if (!objectIdentity(identity) || !exact(identity, protectedInput.volunteer)) throw new Error("volunteer onboarding did not preserve supplied volunteer exactly");
    if (!Array.isArray(documents) || documents.length !== protectedInput.documents.length
      || documents.some((document, index) => !["id", "type", "reviewStatus"]
        .every((field) => document?.[field] === protectedInput.documents[index][field]))) throw new Error("volunteer onboarding did not preserve supplied documents exactly");
    if (String(completion?.status ?? content.completionStatus).toLowerCase() !== "confirmed") {
      throw new Error("volunteer onboarding completion is not confirmed");
    }
    return { completionConfirmed: true, documentCount: documents.length, identityPresent: true };
  }
  const brief = content.brief ?? content.productBrief;
  const metrics = content.metrics ?? content.productMetrics;
  const slides = content.slides ?? content.deck?.slides;
  const review = content.review ?? content.approval;
  const metricValues = Array.isArray(metrics)
    ? metrics.map((entry) => (typeof entry === "number" ? entry : entry?.value))
    : Object.values(metrics ?? {});
  if (!exact(brief, protectedInput.brief)) throw new Error("launch presentation did not preserve exact supplied brief");
  if (!Array.isArray(metrics) || metrics.length !== protectedInput.metrics.length
    || metrics.some((metric, index) => !["id", "label", "value", "unit"]
      .every((field) => metric?.[field] === protectedInput.metrics[index][field]))) throw new Error("launch presentation did not preserve exact supplied metrics");
  if (!metricValues.some((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("launch presentation lacks a numeric metric");
  }
  if (!Array.isArray(slides) || slides.length < 3) throw new Error("launch presentation needs at least three slides");
  const metricIds = new Set(protectedInput.metrics.map((metric) => metric.id));
  const referenced = new Set();
  for (const slide of slides) {
    const refs = slide?.metricIds ?? slide?.metrics;
    if (!nonEmptyText(slide?.title) || !Array.isArray(refs) || refs.length < 1
      || refs.some((id) => !metricIds.has(typeof id === "string" ? id : id?.id))) throw new Error("launch slide is not grounded in supplied metrics");
    refs.forEach((id) => referenced.add(typeof id === "string" ? id : id?.id));
  }
  if (referenced.size !== metricIds.size) throw new Error("launch slides do not cover every supplied metric");
  if (String(review?.status ?? content.reviewStatus).toLowerCase() !== "approved") {
    throw new Error("launch presentation review is not approved");
  }
  return { briefPresent: true, metricCount: metricValues.length, reviewApproved: true, slideCount: slides.length };
}

function validateExportedBundle(bundle, { expectedArtifactType, protectedTaskInput, taskId }) {
  if (bundle?.schemaVersion !== "nodekit.portable-proof-bundle/v1") throw new Error("exported proof bundle schema is invalid");
  if (bundle.receipt?.schemaVersion !== "nodekit.receipt/v2") throw new Error("exported receipt schema is invalid");
  if (bundle.case?.caseId !== bundle.run?.caseId || bundle.run?.runId !== bundle.receipt?.runId) {
    throw new Error("exported case, run, and receipt identities do not match");
  }
  const artifact = bundle.artifact;
  if (artifact?.kind !== expectedArtifactType || !nonEmptyText(artifact.artifactId)
    || !Number.isInteger(artifact.canonicalVersion) || artifact.canonicalVersion < 2) {
    throw new Error("exported artifact type, identity, or canonical version is invalid");
  }
  const canonicalVersion = artifact.versions?.find((entry) => entry.version === artifact.canonicalVersion);
  if (!canonicalVersion || canonicalVersion.contentHash !== contentHash(canonicalVersion.content)) {
    throw new Error("exported canonical artifact content hash is invalid");
  }
  const binding = bundle.receipt.artifactBindings?.find((entry) => entry.artifactId === artifact.artifactId);
  if (!binding || binding.canonicalVersion !== artifact.canonicalVersion || binding.contentHash !== canonicalVersion.contentHash) {
    throw new Error("exported receipt is not bound to the canonical artifact version");
  }
  const { receiptHash, receiptId, ...receiptBody } = bundle.receipt;
  if (!receiptId || receiptHash !== contentHash(receiptBody)) throw new Error("exported receipt hash is invalid");
  return {
    content: canonicalVersion.content,
    domainSummary: validateTaskContent(taskId, protectedTaskInput, canonicalVersion.content),
    marker: {
      artifactId: artifact.artifactId,
      canonicalVersion: artifact.canonicalVersion,
      contentSha256: canonicalVersion.contentHash,
      type: artifact.kind,
    },
  };
}

function sameMarker(left, right) {
  return Boolean(left && right
    && left.artifactId === right.artifactId
    && left.canonicalVersion === right.canonicalVersion
    && left.contentSha256 === right.contentSha256
    && left.type === right.type);
}

async function readCandidateSource(candidateRoot, tree) {
  const listing = git(candidateRoot, ["ls-tree", "-rl", "--full-tree", tree]).split(/\r?\n/).filter(Boolean);
  const accepted = [];
  let total = 0;
  for (const line of listing) {
    const match = line.match(/^(\d+)\s+blob\s+[a-f0-9]{40}\s+(\d+)\t(.+)$/);
    if (!match) throw new Error("candidate tree contains a non-regular or non-canonical entry");
    if (!new Set(["100644", "100755"]).has(match[1])) throw new Error(`candidate tree contains unsupported file mode ${match[1]}`);
    const size = Number(match[2]);
    const file = match[3];
    if (size > 512_000 || total + size > 8_000_000) continue;
    if (/(^|\/)(?:node_modules|vendor|proof|\.git)(?:\/|$)/.test(file) || /(?:^|\/)package-lock\.json$/.test(file)) continue;
    if (!/\.(?:css|html|js|json|jsx|md|mjs|ts|tsx|txt|ya?ml)$/i.test(file)) continue;
    const bytes = git(candidateRoot, ["show", `${tree}:${file}`], { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
    if (Buffer.from(bytes).includes(0)) continue;
    accepted.push({ bytes: Buffer.from(bytes), file });
    total += size;
  }
  return {
    files: accepted.map((entry) => entry.file),
    text: accepted.map((entry) => `\n--- ${entry.file} ---\n${entry.bytes.toString("utf8")}`).join(""),
  };
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    shell: false,
    timeout: options.timeout ?? 60_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout;
}

function dockerJson(args, label) {
  try {
    return JSON.parse(docker(args));
  } catch (error) {
    throw new Error(`${label} could not be inspected: ${error.message}`);
  }
}

function imageIdentity(reference, expectedId) {
  const records = dockerJson(["image", "inspect", reference], "protected evaluator image");
  if (!Array.isArray(records) || records.length !== 1) throw new Error("protected evaluator image inspection was ambiguous");
  const record = records[0];
  if (record.Id !== expectedId) throw new Error(`protected evaluator image drifted: expected ${expectedId}, observed ${record.Id}`);
  return {
    architecture: record.Architecture,
    id: record.Id,
    operatingSystem: record.Os,
    reference,
    repoDigests: [...(record.RepoDigests ?? [])].sort(),
  };
}

function assertContainerSecurity(record, { browser, candidateRoot }) {
  const host = record.HostConfig ?? {};
  const mounts = Array.isArray(record.Mounts) ? record.Mounts : [];
  if (host.ReadonlyRootfs !== true) throw new Error("protected container root filesystem is writable");
  if (!Array.isArray(host.CapDrop) || !host.CapDrop.some((entry) => String(entry).toUpperCase() === "ALL")) {
    throw new Error("protected container did not drop every Linux capability");
  }
  if (!Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes("no-new-privileges:true")) {
    throw new Error("protected container lacks no-new-privileges");
  }
  if (host.PidMode === "host" || host.IpcMode === "host" || host.NetworkMode === "host") {
    throw new Error("protected container shares a host namespace");
  }
  if (host.PortBindings && Object.keys(host.PortBindings).length > 0) throw new Error("protected container publishes a host port");
  if (browser) {
    if (mounts.some((entry) => entry.Destination === "/workspace")) throw new Error("browser evaluator can read the candidate tree");
    if (mounts.some((entry) => entry.Destination !== "/output" && entry.RW === true)) {
      throw new Error("browser evaluator has an unexpected writable host mount");
    }
    if (mounts.filter((entry) => entry.Destination === "/output" && entry.RW === true).length !== 1) {
      throw new Error("browser evaluator lacks its single isolated output mount");
    }
  } else {
    const workspace = mounts.filter((entry) => entry.Destination === "/workspace");
    if (workspace.length !== 1 || workspace[0].Type !== "bind" || workspace[0].RW !== false) {
      throw new Error("candidate source is not one read-only bind mount");
    }
    if (mounts.length !== 1) throw new Error("candidate server can access an unexpected host mount");
    if (candidateRoot && path.basename(String(workspace[0].Source ?? "")) !== path.basename(candidateRoot)) {
      throw new Error("candidate server mount identity does not match the generated repository");
    }
  }
  return mounts.map((entry) => ({
    destination: entry.Destination,
    readOnly: entry.RW === false,
    type: entry.Type,
  })).sort((left, right) => left.destination.localeCompare(right.destination));
}

async function verifyScreenshotMatrix(browserManifestFile, manifest, { manifestBytes = 0 } = {}) {
  const evidenceBase = path.dirname(path.dirname(browserManifestFile));
  const issues = [];
  const records = [];
  const screenshots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (screenshots.length !== 180) {
    issues.push({ code: "screenshot_count", message: `Expected 180 screenshots; observed ${screenshots.length}.`, severity: "p0" });
  }
  let declaredClosureBytes = manifestBytes;
  let byteBudgetPassed = Number.isSafeInteger(manifestBytes)
    && manifestBytes >= 0
    && manifestBytes <= MAX_BROWSER_MANIFEST_BYTES;
  if (!byteBudgetPassed) {
    issues.push({ code: "screenshot_manifest_size", message: "Screenshot manifest exceeds its verifier byte limit.", severity: "p0" });
  }
  for (const screenshot of screenshots) {
    const key = `${screenshot?.state}/${screenshot?.viewportId}/${screenshot?.theme}`;
    for (const [kind, expectedBytes, minimumBytes, maximumBytes] of [
      ["png", screenshot?.pngBytes, 256, MAX_SCREENSHOT_PNG_BYTES],
      ["sidecar", screenshot?.sidecarBytes, 2, MAX_SCREENSHOT_SIDECAR_BYTES],
    ]) {
      if (!Number.isInteger(expectedBytes) || expectedBytes < minimumBytes || expectedBytes > maximumBytes) {
        byteBudgetPassed = false;
        issues.push({ code: "screenshot_byte_limit", message: `${key} has an invalid or oversized ${kind} byte declaration.`, severity: "p0" });
        continue;
      }
      const next = declaredClosureBytes + expectedBytes;
      if (!Number.isSafeInteger(next) || next > MAX_SCREENSHOT_CLOSURE_BYTES) {
        byteBudgetPassed = false;
        issues.push({ code: "screenshot_closure_limit", message: `Screenshot closure exceeds ${MAX_SCREENSHOT_CLOSURE_BYTES} bytes.`, severity: "p0" });
        continue;
      }
      declaredClosureBytes = next;
    }
  }

  const paths = new Set();
  for (const screenshot of screenshots) {
    const key = `${screenshot.state}/${screenshot.viewportId}/${screenshot.theme}`;
    for (const [kind, relativePath, expectedHash, expectedBytes] of [
      ["png", screenshot.path, screenshot.pngSha256, screenshot.pngBytes],
      ["sidecar", screenshot.sidecarPath, screenshot.sidecarSha256, screenshot.sidecarBytes],
    ]) {
      if (typeof relativePath !== "string" || relativePath.includes("\\") || path.posix.normalize(relativePath) !== relativePath) {
        issues.push({ code: "noncanonical_screenshot_path", message: `${key} has a noncanonical ${kind} path.`, severity: "p0" });
        continue;
      }
      if (paths.has(relativePath)) issues.push({ code: "duplicate_screenshot_path", message: `${relativePath} is repeated.`, severity: "p0" });
      paths.add(relativePath);
      const absolute = path.resolve(evidenceBase, ...relativePath.split("/"));
      const containment = path.relative(evidenceBase, absolute);
      if (containment === "" || containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
        issues.push({ code: "screenshot_path_escape", message: `${relativePath} escapes the evidence root.`, severity: "p0" });
        continue;
      }
      try {
        if (!byteBudgetPassed) continue;
        const bytes = await regularFile(absolute, `${kind} evidence`, {
          maxBytes: kind === "png" ? MAX_SCREENSHOT_PNG_BYTES : MAX_SCREENSHOT_SIDECAR_BYTES,
        });
        if (bytes.length !== expectedBytes || sha256(bytes) !== expectedHash) {
          issues.push({ code: "screenshot_hash_mismatch", message: `${relativePath} bytes do not match the manifest.`, severity: "p0" });
        }
      } catch (error) {
        issues.push({ code: "screenshot_missing", message: `${relativePath}: ${error.message}`, severity: "p0" });
      }
    }
    for (const [field, value] of [
      ["consoleErrors", screenshot.consoleErrors],
      ["failedRequests", screenshot.failedRequests],
      ["horizontalOverflowPx", screenshot.horizontalOverflowPx],
    ]) {
      if (value !== 0) issues.push({ code: field, message: `${key} reports ${field}=${value}.`, severity: "p1" });
    }
    if (screenshot.mojibakeDetected !== false) issues.push({ code: "mojibake", message: `${key} reports mojibake.`, severity: "p1" });
    records.push({
      path: screenshot.path,
      pngSha256: screenshot.pngSha256,
      sidecarPath: screenshot.sidecarPath,
      sidecarSha256: screenshot.sidecarSha256,
      state: screenshot.state,
      theme: screenshot.theme,
      viewport: screenshot.viewport,
      viewportId: screenshot.viewportId,
    });
  }
  if (manifest.certified !== true || manifest.passed !== true) {
    issues.push({ code: "browser_not_certified", message: "The candidate browser manifest is not certified.", severity: "p0" });
  }
  if (Array.isArray(manifest.accessibilityViolations) && manifest.accessibilityViolations.length > 0) {
    issues.push({ code: "accessibility", message: `${manifest.accessibilityViolations.length} accessibility violations remain.`, severity: "p1" });
  }
  if (Array.isArray(manifest.consoleErrors) && manifest.consoleErrors.length > 0) {
    issues.push({ code: "global_console", message: `${manifest.consoleErrors.length} console errors remain.`, severity: "p1" });
  }
  if (Array.isArray(manifest.networkFailures) && manifest.networkFailures.length > 0) {
    issues.push({ code: "global_network", message: `${manifest.networkFailures.length} network failures remain.`, severity: "p1" });
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  return { issues, records, screenshotEvidenceRootSha256: sha256(JSON.stringify(records)) };
}

async function verifyProtectedScreenshotMatrix(manifestFile, manifest, expected) {
  const matrix = await verifyScreenshotMatrix(manifestFile, manifest, { manifestBytes: expected.manifestBytes });
  const manifestBody = { ...manifest };
  delete manifestBody.manifestSha256;
  const accessibilityImpacts = ["critical", "serious", "moderate", "minor", "unknown"];
  const accessibilityTotals = Object.fromEntries(accessibilityImpacts.map((impact) => [impact, 0]));
  if (manifest.schemaVersion !== "nodekit.protected-browser-screenshot-manifest/v1"
    || manifest.runId !== expected.runId || manifest.taskId !== expected.taskId
    || manifest.candidateArchiveSha256 !== expected.candidateArchiveSha256
    || manifest.producer?.authority !== "campaign-protected-browser"
    || manifest.producer?.candidateHostAccess !== false
    || manifest.producer?.candidateWriteAccess !== false
    || manifest.producer?.externalNetworkEgress !== false
    || manifest.accessibilityAudit?.engine !== "axe-core"
    || manifest.accessibilityAudit?.engineVersion !== "4.12.1"
    || manifest.accessibilityAudit?.policy !== "serious-critical-zero"
    || manifest.accessibilityAudit?.scans !== 180
    || manifest.accessibilityAudit?.passed !== true
    || manifest.accessibilityAudit?.seriousCriticalViolations !== 0
    || manifest.accessibilityAudit?.violationCounts?.critical !== 0
    || manifest.accessibilityAudit?.violationCounts?.serious !== 0
    || Object.hasOwn(manifest, "accessibilityViolations")
    || !exact(manifest.certificationScope, [
      "rendered-state-coverage", "console-health", "request-health",
      "horizontal-overflow", "mojibake", "axe-serious-critical",
    ])
    || manifest.manifestSha256 !== sha256(JSON.stringify(manifestBody))) {
    throw new Error("protected screenshot manifest provenance or self-hash is invalid");
  }
  if (manifest.screenshotEvidenceRootSha256 !== matrix.screenshotEvidenceRootSha256) {
    throw new Error("protected screenshot manifest root does not match its exact child records");
  }
  const expectedCombinations = new Set(PROTECTED_STATES.flatMap((state) => PROTECTED_VIEWPORTS.flatMap((viewport) => (
    PROTECTED_THEMES.map((theme) => `${state}/${viewport.id}/${theme}`)
  ))));
  const observedCombinations = new Set(manifest.screenshots.map((entry) => `${entry.state}/${entry.viewportId}/${entry.theme}`));
  if (!exact([...observedCombinations].sort(), [...expectedCombinations].sort())
    || !exact(manifest.requiredStates, PROTECTED_STATES)
    || !exact(manifest.coveredStates, PROTECTED_STATES)
    || !exact(manifest.viewports, PROTECTED_VIEWPORTS)
    || !exact(manifest.themes, PROTECTED_THEMES)) {
    throw new Error("protected screenshot manifest does not cover the exact 15-state, six-viewport, two-theme contract");
  }
  if (matrix.issues.length > 0) {
    throw new Error(`protected screenshot matrix failed: ${JSON.stringify(matrix.issues)}`);
  }
  if (new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size !== 180) {
    throw new Error("protected screenshot matrix contains duplicate rendered PNG bytes");
  }
  const evidenceBase = path.dirname(path.dirname(manifestFile));
  for (const screenshot of manifest.screenshots) {
    const sidecarFile = path.resolve(evidenceBase, ...screenshot.sidecarPath.split("/"));
    const sidecar = JSON.parse((await regularFile(sidecarFile, "protected screenshot sidecar", {
      maxBytes: MAX_SCREENSHOT_SIDECAR_BYTES,
    })).toString("utf8"));
    if (sidecar.schemaVersion !== "nodekit.protected-screenshot-proof/v1"
      || sidecar.authority !== "campaign-protected-browser"
      || sidecar.candidateArchiveSha256 !== expected.candidateArchiveSha256
      || sidecar.runId !== expected.runId || sidecar.taskId !== expected.taskId
      || sidecar.state !== screenshot.state || sidecar.theme !== screenshot.theme
      || sidecar.viewportId !== screenshot.viewportId || canonical(sidecar.viewport) !== canonical(screenshot.viewport)
      || sidecar.pngSha256 !== screenshot.pngSha256 || sidecar.consoleErrors !== 0
      || sidecar.failedRequests !== 0 || sidecar.horizontalOverflowPx !== 0 || sidecar.mojibakeDetected !== false
      || sidecar.accessibility?.engine !== "axe-core" || sidecar.accessibility?.engineVersion !== "4.12.1"
      || sidecar.accessibility?.policy !== "serious-critical-zero" || sidecar.accessibility?.passed !== true
      || sidecar.accessibility?.seriousCriticalViolations !== 0
      || sidecar.accessibility?.violationCounts?.critical !== 0 || sidecar.accessibility?.violationCounts?.serious !== 0
      || !Array.isArray(sidecar.accessibility?.violations)
      || sidecar.accessibility.totalViolations !== sidecar.accessibility.violations.length
      || canonical(sidecar.accessibility) !== canonical(screenshot.accessibility)) {
      throw new Error(`protected screenshot sidecar is invalid for ${screenshot.path}`);
    }
    for (const impact of accessibilityImpacts) {
      const count = sidecar.accessibility.violationCounts?.[impact];
      if (!Number.isInteger(count) || count < 0) throw new Error(`protected Axe count is invalid for ${screenshot.path}/${impact}`);
      accessibilityTotals[impact] += count;
    }
  }
  if (canonical(manifest.accessibilityAudit.violationCounts) !== canonical(accessibilityTotals)
    || manifest.accessibilityAudit.totalViolations !== Object.values(accessibilityTotals).reduce((total, count) => total + count, 0)) {
    throw new Error("protected Axe aggregate does not match the exact screenshot sidecars");
  }
  return matrix;
}

const args = parseArgs(process.argv.slice(2));
const evaluatorFile = fileURLToPath(import.meta.url);
const evaluatorSha256 = requireDigest(args["evaluator-sha256"], "evaluator SHA-256");
const browserLaneFile = path.resolve(args["browser-lane-file"]);
const browserLaneSha256 = requireDigest(args["browser-lane-sha256"], "browser lane SHA-256");
const containerImage = args["container-image"];
const containerImageId = String(args["container-image-id"]);
if (!/^sha256:[a-f0-9]{64}$/.test(containerImageId)) throw new Error("container image ID is invalid");
const candidateArchiveSha256 = requireDigest(args["candidate-archive-sha256"], "candidate archive SHA-256");
const nodekitCommit = requireDigest(args["nodekit-commit"], "NodeKit commit", COMMIT);
const nodekitSourceHash = requireDigest(args["nodekit-source-hash"], "NodeKit source hash");
const nodekitTarballSha256 = requireDigest(args["nodekit-tarball-sha256"], "NodeKit tarball SHA-256");
const postAgentTreeHash = requireDigest(args["post-agent-tree-hash"], "post-agent tree hash", COMMIT);
const applicationHash = requireDigest(args["application-hash"], "application hash");
const configHash = requireDigest(args["config-hash"], "config hash");
const taskBriefSha256 = requireDigest(args["task-brief-sha256"], "task brief SHA-256");
const taskSetSha256 = requireDigest(args["task-set-sha256"], "task set SHA-256");
const taskId = args["task-id"];
const runId = args["run-id"];
const candidateRoot = path.resolve(args["candidate-root"]);
const candidateArchiveFile = path.resolve(args["candidate-archive"]);
const browserManifestFile = path.resolve(args["browser-manifest"]);
const taskBriefFile = path.resolve(args["task-brief-file"]);
const taskSetFile = path.resolve(args["task-set-file"]);
const outputRoot = path.resolve(args["output-root"]);
if (!TASK_RUBRICS[taskId] || !TASK_ARTIFACT_TYPES[taskId]) throw new Error(`unsupported protected evaluator task ${taskId}`);
if (sha256(await regularFile(evaluatorFile, "protected evaluator", { maxBytes: MAX_TRUSTED_SCRIPT_BYTES })) !== evaluatorSha256) {
  throw new Error("protected evaluator bytes do not match the campaign hash");
}
for (const [file, label] of [
  [taskBriefFile, "task brief"],
  [taskSetFile, "task set"],
  [evaluatorFile, "protected evaluator"],
  [browserLaneFile, "protected browser lane"],
  [candidateArchiveFile, "candidate archive"],
  [browserManifestFile, "browser manifest"],
]) {
  await assertOutsideCandidate(candidateRoot, file, label);
}
if (sha256(await regularFile(browserLaneFile, "protected browser lane", { maxBytes: MAX_TRUSTED_SCRIPT_BYTES })) !== browserLaneSha256) {
  throw new Error("protected browser lane bytes do not match the campaign hash");
}
const outputParent = path.dirname(outputRoot);
await realpath(outputParent);
const outputRelative = path.relative(await realpath(candidateRoot), await realpath(outputParent));
if (outputRelative === "" || (outputRelative !== ".." && !outputRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(outputRelative))) {
  throw new Error("protected evaluator output must remain outside the generated candidate repository");
}
await mkdir(outputRoot, { recursive: false });

const [taskBriefBytes, taskSetBytes, candidateArchiveBytes, browserManifestBytes] = await Promise.all([
  regularFile(taskBriefFile, "task brief", { maxBytes: MAX_TASK_BRIEF_BYTES }),
  regularFile(taskSetFile, "task set", { maxBytes: MAX_TASK_SET_BYTES }),
  regularFile(candidateArchiveFile, "candidate archive", { maxBytes: MAX_CANDIDATE_ARCHIVE_BYTES }),
  regularFile(browserManifestFile, "browser manifest", { maxBytes: MAX_BROWSER_MANIFEST_BYTES }),
]);
if (sha256(taskBriefBytes) !== taskBriefSha256) throw new Error("protected task brief hash mismatch");
if (sha256(taskSetBytes) !== taskSetSha256) throw new Error("protected task set hash mismatch");
if (sha256(candidateArchiveBytes) !== candidateArchiveSha256) throw new Error("candidate archive hash mismatch");
const taskGoal = taskBriefBytes.toString("utf8");
const taskSet = JSON.parse(taskSetBytes.toString("utf8"));
const task = taskSet?.tasks?.find((entry) => entry?.id === taskId);
if (taskSet?.schemaVersion !== "nodekit.agent-ease-tasks/v1" || task?.goal !== taskGoal) throw new Error("task bytes do not match the protected task set");
const browserManifest = JSON.parse(browserManifestBytes.toString("utf8"));
if (browserManifest.runId !== runId
  || browserManifest.applicationHash !== applicationHash
  || browserManifest.configHash !== configHash
  || browserManifest.nodekitCommit !== nodekitCommit
  || browserManifest.nodekitSourceHash !== nodekitSourceHash
  || browserManifest.nodekitTarballSha256 !== nodekitTarballSha256
  || browserManifest.postAgentTreeHash !== postAgentTreeHash) {
  throw new Error("browser manifest is not bound to the exact protected evaluator inputs");
}

let observedTree;
try {
  git(candidateRoot, ["add", "-A"]);
  git(candidateRoot, ["reset", "HEAD", "--", "proof"]);
  observedTree = git(candidateRoot, ["write-tree"]).trim();
} finally {
  git(candidateRoot, ["reset", "--mixed", "HEAD"]);
}
if (observedTree !== postAgentTreeHash || git(candidateRoot, ["cat-file", "-t", postAgentTreeHash]).trim() !== "tree") {
  throw new Error("working candidate and immutable post-agent tree differ");
}
candidateTreeBudget(candidateRoot, postAgentTreeHash);
const identity = JSON.parse((await regularFile(
  path.join(candidateRoot, ".nodeagent", "application-identity.json"),
  "candidate application identity",
  { maxBytes: MAX_APPLICATION_IDENTITY_BYTES },
)).toString("utf8"));
if (identity.schemaVersion !== "nodeagent.application-identity/v1" || identity.applicationHash !== applicationHash || identity.configHash !== configHash) {
  throw new Error("candidate application identity does not match evaluator inputs");
}

const source = await readCandidateSource(candidateRoot, postAgentTreeHash);
const sourceGroups = taskGroups(source.text, TASK_RUBRICS[taskId]);
const candidateScreenshotMatrix = await verifyScreenshotMatrix(browserManifestFile, browserManifest, {
  manifestBytes: browserManifestBytes.length,
});
const candidateBrowserManifestSha256 = sha256(browserManifestBytes);
// Candidate-produced screenshots remain useful diagnostic evidence, but cannot
// decide certification. Every diagnostic finding is explicitly non-blocking;
// the protected browser lane below independently recaptures the full matrix.
const issues = candidateScreenshotMatrix.issues.map((issue) => ({ ...issue, severity: "p2" }));
let screenshotBytes = null;
let visibleText = "";
let guidedInteractionPassed = false;
let artifactDownloadVerified = false;
let artifactReloadPersistenceVerified = false;
let artifactReopenPersistenceVerified = false;
let taskInputBound = false;
let typedArtifactVerified = false;
let taskArtifactEvidence = null;
let domMetrics = null;
const consoleErrors = [];
const failedRequests = [];
let isolation = null;
let protectedBrowserManifest = null;
let protectedBrowserManifestBytes = null;
let protectedScreenshotMatrix = null;
const evaluatorRepoRoot = path.resolve(path.dirname(evaluatorFile), "..");
const playwrightPackageRoot = path.join(evaluatorRepoRoot, "node_modules", "playwright");
const playwrightCorePackageRoot = path.join(evaluatorRepoRoot, "node_modules", "playwright-core");
const axePlaywrightPackageRoot = path.join(evaluatorRepoRoot, "node_modules", "@axe-core", "playwright");
const axeCorePackageRoot = path.join(evaluatorRepoRoot, "node_modules", "axe-core");
for (const [directory, label] of [
  [playwrightPackageRoot, "trusted Playwright package"],
  [playwrightCorePackageRoot, "trusted Playwright core package"],
  [axePlaywrightPackageRoot, "trusted Axe Playwright package"],
  [axeCorePackageRoot, "trusted Axe core package"],
]) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  await assertOutsideCandidate(candidateRoot, directory, label);
}
const browserDependencies = Object.freeze([
  await packageTreeIdentity(playwrightPackageRoot, "playwright", "1.61.1", "/runner/node_modules/playwright"),
  await packageTreeIdentity(playwrightCorePackageRoot, "playwright-core", "1.61.1", "/runner/node_modules/playwright-core"),
  await packageTreeIdentity(axePlaywrightPackageRoot, "@axe-core/playwright", "4.12.1", "/runner/node_modules/@axe-core/playwright"),
  await packageTreeIdentity(axeCorePackageRoot, "axe-core", "4.12.1", "/runner/node_modules/axe-core"),
]);

// Certification has no host-process fallback. Docker, the exact pre-resolved
// image, the internal network, and both independently inspected containers are
// mandatory. A missing daemon or drifted image terminates the evaluator.
const dockerServer = dockerJson(["version", "--format={{json .Server}}"], "Docker server");
const image = imageIdentity(containerImage, containerImageId);
const isolationSuffix = sha256(`${runId}:${process.pid}:${randomBytes(16).toString("hex")}`).slice(0, 16);
const networkName = `nodekit-protected-${isolationSuffix}`;
const candidateName = `nodekit-candidate-${isolationSuffix}`;
const browserName = `nodekit-browser-${isolationSuffix}`;
const browserScratch = await mkdtemp(path.join(os.tmpdir(), "nodekit-protected-browser-"));
const serverScratch = await mkdtemp(path.join(os.tmpdir(), "nodekit-protected-server-"));
const archiveScratch = await mkdtemp(path.join(os.tmpdir(), "nodekit-protected-archive-"));
const frozenArchiveFile = path.join(archiveScratch, "candidate.tar.gz");
await writeFile(frozenArchiveFile, candidateArchiveBytes, { flag: "wx" });
if (sha256(await regularFile(frozenArchiveFile, "frozen candidate archive", { maxBytes: MAX_CANDIDATE_ARCHIVE_BYTES })) !== candidateArchiveSha256) {
  throw new Error("private frozen candidate archive snapshot hash mismatch");
}
const extracted = spawnSync(resolveTarCommand(), ["-xzf", frozenArchiveFile, "-C", serverScratch], {
  encoding: "utf8",
  shell: false,
  timeout: 30_000,
});
if (extracted.status !== 0 || extracted.error) {
  throw new Error(`immutable candidate archive could not be staged without evidence\n${extracted.stdout ?? ""}\n${extracted.stderr ?? ""}`);
}
const certificationRunId = `cert_${randomBytes(24).toString("hex")}`;
// This nonce-bearing input is intentionally created only after the immutable
// candidate archive and post-agent tree have been independently verified and
// staged. The candidate never receives an expected-output oracle; it sees this
// input only through the same browser submission a user would perform.
const protectedTaskInput = validateProtectedTaskInput(createProtectedTaskInput({
  candidateArchiveSha256,
  inputToken: certificationRunId,
  nonce: `challenge_${randomBytes(24).toString("hex")}`,
  taskId,
}), { candidateArchiveSha256, inputToken: certificationRunId, taskId });
const protectedTaskInputSha256 = sha256(canonical(protectedTaskInput));
for (const hiddenValue of [certificationRunId, protectedTaskInput.nonce, protectedTaskInputSha256]) {
  if (source.text.includes(hiddenValue)) throw new Error("hidden protected task input was present in the frozen candidate tree");
}
await writeFile(
  path.join(browserScratch, "protected-task-input.json"),
  `${JSON.stringify(protectedTaskInput, null, 2)}\n`,
  { flag: "wx" },
);
let networkCreated = false;
let candidateCreated = false;
let browserCreated = false;
try {
  docker(["network", "create", "--driver", "bridge", "--internal", "--label", `dev.nodekit.run=${runId}`, networkName]);
  networkCreated = true;
  docker([
    "run", "--detach", "--name", candidateName,
    "--network", networkName, "--network-alias", "candidate",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--mount", `type=bind,source=${serverScratch},target=/workspace,readonly`,
    "--workdir", "/workspace", "--user", "65532:65532",
    "--env", "CI=1", "--env", "HOST=0.0.0.0", "--env", "NODE_ENV=test",
    "--env", "NO_COLOR=1", "--env", "PORT=4173",
    containerImageId, "node", "apps/web/server.mjs",
  ], { timeout: 60_000 });
  candidateCreated = true;
  const candidateInspect = dockerJson(["container", "inspect", candidateName], "candidate container")[0];
  const candidateMounts = assertContainerSecurity(candidateInspect, { browser: false, candidateRoot: serverScratch });
  docker(["exec", candidateName, "node", "-e",
    "const n=require('node:net').connect({host:'1.1.1.1',port:80});n.setTimeout(2000);n.on('connect',()=>process.exit(91));n.on('error',()=>process.exit(0));n.on('timeout',()=>process.exit(0));"],
  { timeout: 10_000 });

  docker([
    "run", "--name", browserName,
    "--network", networkName,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256", "--memory", "1g", "--cpus", "1", "--shm-size", "512m",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
    "--mount", `type=bind,source=${browserLaneFile},target=/runner/run-protected-browser-lane.mjs,readonly`,
    "--mount", `type=bind,source=${playwrightPackageRoot},target=/runner/node_modules/playwright,readonly`,
    "--mount", `type=bind,source=${playwrightCorePackageRoot},target=/runner/node_modules/playwright-core,readonly`,
    "--mount", `type=bind,source=${axePlaywrightPackageRoot},target=/runner/node_modules/@axe-core/playwright,readonly`,
    "--mount", `type=bind,source=${axeCorePackageRoot},target=/runner/node_modules/axe-core,readonly`,
    "--mount", `type=bind,source=${browserScratch},target=/output`,
    "--workdir", "/runner",
    "--env", "CI=1", "--env", "HOME=/tmp", "--env", "NO_COLOR=1",
    "--env", "NODEKIT_PROTECTED_BASE_URL=http://candidate:4173",
    "--env", `NODEKIT_PROTECTED_RUN_ID=${certificationRunId}`,
    "--env", `NODEKIT_PROTECTED_TASK_ID=${taskId}`,
    "--env", `NODEKIT_PROTECTED_ARTIFACT_TYPE=${TASK_ARTIFACT_TYPES[taskId]}`,
    "--env", "NODEKIT_PROTECTED_TASK_INPUT_FILE=/output/protected-task-input.json",
    "--env", `NODEKIT_PROTECTED_TASK_INPUT_SHA256=${protectedTaskInputSha256}`,
    "--env", "NODEKIT_PROTECTED_OUTPUT_ROOT=/output",
    containerImageId, "node", "/runner/run-protected-browser-lane.mjs",
  ], { timeout: 600_000 });
  browserCreated = true;
  const browserInspect = dockerJson(["container", "inspect", browserName], "browser evaluator container")[0];
  const browserMounts = assertContainerSecurity(browserInspect, { browser: true });
  const networkInspect = dockerJson(["network", "inspect", networkName], "protected internal network")[0];
  if (networkInspect.Internal !== true || networkInspect.Driver !== "bridge") {
    throw new Error("protected evaluator network is not an internal bridge");
  }
  const attachedIds = Object.keys(networkInspect.Containers ?? {});
  if (!attachedIds.includes(candidateInspect.Id) || !attachedIds.includes(browserInspect.Id) || attachedIds.length !== 2) {
    throw new Error("protected internal network does not contain exactly the candidate and browser lanes");
  }
  const browserResultBytes = await regularFile(path.join(browserScratch, "result.json"), "isolated browser result", {
    maxBytes: MAX_BROWSER_RESULT_BYTES,
  });
  const browserResult = JSON.parse(browserResultBytes.toString("utf8"));
  const resultBody = { ...browserResult };
  delete resultBody.resultSha256;
  if (browserResult.schemaVersion !== "nodekit.protected-browser-lane-result/v2"
    || browserResult.runId !== certificationRunId
    || browserResult.taskId !== taskId
    || browserResult.protectedTaskInputSha256 !== protectedTaskInputSha256
    || browserResult.serverHealth?.status !== "ok"
    || browserResult.serverHealth?.candidateCertificationMarkerAbsent !== true
    || browserResult.guidedInteractionPassed !== true
    || browserResult.taskInputBound !== true
    || browserResult.typedArtifactVerified !== true
    || browserResult.artifactDownloadVerified !== true
    || browserResult.artifactReloadPersistenceVerified !== true
    || browserResult.artifactReopenPersistenceVerified !== true
    || browserResult.externalNetworkEgressBlocked !== true
    || browserResult.resultSha256 !== sha256(JSON.stringify(resultBody))) {
    throw new Error("isolated browser result is incomplete or self-hash invalid");
  }
  const protectedBrowserManifestFile = path.join(browserScratch, "protected-browser", "screenshot-manifest.json");
  protectedBrowserManifestBytes = await regularFile(protectedBrowserManifestFile, "protected screenshot manifest", {
    maxBytes: MAX_BROWSER_MANIFEST_BYTES,
  });
  protectedBrowserManifest = JSON.parse(protectedBrowserManifestBytes.toString("utf8"));
  protectedScreenshotMatrix = await verifyProtectedScreenshotMatrix(protectedBrowserManifestFile, protectedBrowserManifest, {
    candidateArchiveSha256,
    manifestBytes: protectedBrowserManifestBytes.length,
    runId: certificationRunId,
    taskId,
  });
  if (browserResult.protectedScreenshotManifestFile !== "protected-browser/screenshot-manifest.json"
    || browserResult.protectedScreenshotManifestSha256 !== sha256(protectedBrowserManifestBytes)
    || browserResult.protectedScreenshotEvidenceRootSha256 !== protectedScreenshotMatrix.screenshotEvidenceRootSha256
    || browserResult.protectedScreenshotCount !== 180) {
    throw new Error("isolated browser result does not bind the trusted protected screenshot matrix");
  }
  await cp(
    path.join(browserScratch, "protected-browser"),
    path.join(outputRoot, "protected-browser"),
    { errorOnExist: true, force: false, recursive: true },
  );
  const exportedArtifactBytes = await regularFile(path.join(browserScratch, "task-artifact.json"), "isolated exported task artifact", {
    maxBytes: MAX_EXPORTED_ARTIFACT_BYTES,
  });
  if (exportedArtifactBytes.length < 32 || exportedArtifactBytes.length > MAX_EXPORTED_ARTIFACT_BYTES) {
    throw new Error("isolated exported task artifact has an invalid byte size");
  }
  const browserArtifact = browserResult.taskArtifactEvidence;
  if (!browserArtifact || browserArtifact.taskId !== taskId
    || browserArtifact.exportFile !== "task-artifact.json"
    || browserArtifact.exportBytes !== exportedArtifactBytes.length
    || browserArtifact.exportSha256 !== sha256(exportedArtifactBytes)
    || browserArtifact.inputTokenSha256 !== sha256(certificationRunId)) {
    throw new Error("isolated browser artifact evidence is incomplete or byte binding failed");
  }
  const exportedBundle = JSON.parse(exportedArtifactBytes.toString("utf8"));
  const independentlyVerified = validateExportedBundle(exportedBundle, {
    expectedArtifactType: TASK_ARTIFACT_TYPES[taskId],
    protectedTaskInput,
    taskId,
  });
  if (Buffer.byteLength(JSON.stringify(independentlyVerified.content), "utf8") > 768 * 1024) {
    throw new Error("canonical task artifact content exceeds the bounded replay payload limit");
  }
  if (!sameMarker(browserArtifact.marker, independentlyVerified.marker)
    || !sameMarker(browserArtifact.reloadMarker, independentlyVerified.marker)
    || !sameMarker(browserArtifact.reopenMarker, independentlyVerified.marker)
    || canonical(browserArtifact.domainSummary) !== canonical(independentlyVerified.domainSummary)) {
    throw new Error("isolated browser marker, persistence, or domain summary does not match the independently parsed artifact");
  }
  screenshotBytes = await regularFile(path.join(browserScratch, "task-relevance.png"), "isolated evaluator screenshot", {
    maxBytes: MAX_SCREENSHOT_PNG_BYTES,
  });
  if (sha256(screenshotBytes) !== browserResult.screenshotSha256) throw new Error("isolated evaluator screenshot hash mismatch");
  await writeFile(path.join(outputRoot, "task-relevance.png"), screenshotBytes, { flag: "wx" });
  visibleText = String(browserResult.visibleText ?? "").normalize("NFKC");
  guidedInteractionPassed = true;
  artifactDownloadVerified = true;
  artifactReloadPersistenceVerified = true;
  artifactReopenPersistenceVerified = true;
  taskInputBound = true;
  typedArtifactVerified = true;
  taskArtifactEvidence = {
    artifactId: independentlyVerified.marker.artifactId,
    artifactType: independentlyVerified.marker.type,
    canonicalContent: independentlyVerified.content,
    canonicalVersion: independentlyVerified.marker.canonicalVersion,
    contentSha256: independentlyVerified.marker.contentSha256,
    domainSummary: independentlyVerified.domainSummary,
    exportBytes: exportedArtifactBytes.length,
    exportFile: "task-artifact.json",
    exportSha256: sha256(exportedArtifactBytes),
    inputToken: certificationRunId,
    inputTokenSha256: sha256(certificationRunId),
    marker: browserArtifact.marker,
    reloadMarker: browserArtifact.reloadMarker,
    reopenMarker: browserArtifact.reopenMarker,
    taskId,
  };
  domMetrics = browserResult.domMetrics;
  consoleErrors.push(...browserResult.consoleErrors);
  failedRequests.push(...browserResult.failedRequests);

  const isolationChecks = {
    browserCannotReadCandidate: !browserMounts.some((entry) => entry.destination === "/workspace"),
    browserEgressBlocked: browserResult.externalNetworkEgressBlocked === true,
    browserReadOnlyRootFilesystem: browserInspect.HostConfig.ReadonlyRootfs === true,
    candidateCertificationOracleAbsent: browserResult.serverHealth.candidateCertificationMarkerAbsent === true,
    candidateEgressBlocked: true,
    candidateHasNoEvidenceMount: candidateMounts.length === 1 && candidateMounts[0].destination === "/workspace",
    candidateReadOnlyRootFilesystem: candidateInspect.HostConfig.ReadonlyRootfs === true,
    candidateSourceReadOnly: candidateMounts[0]?.readOnly === true,
    exactImageBound: candidateInspect.Image === containerImageId && browserInspect.Image === containerImageId,
    hostNamespacesNotShared: candidateInspect.HostConfig.PidMode !== "host" && browserInspect.HostConfig.PidMode !== "host",
    internalNetworkOnly: networkInspect.Internal === true && attachedIds.length === 2,
    noPublishedPorts: Object.keys(candidateInspect.HostConfig.PortBindings ?? {}).length === 0
      && Object.keys(browserInspect.HostConfig.PortBindings ?? {}).length === 0,
    separateEvaluatorContainer: candidateInspect.Id !== browserInspect.Id,
  };
  if (!Object.values(isolationChecks).every(Boolean)) throw new Error("protected evaluator isolation checks did not all pass");
  isolation = {
    browserDependencies,
    browserContainer: {
      containerId: browserInspect.Id,
      mounts: browserMounts,
      readOnlyRootFilesystem: true,
    },
    browserLaneSha256,
    candidateContainer: {
      containerId: candidateInspect.Id,
      mounts: candidateMounts,
      readOnlyRootFilesystem: true,
    },
    checks: isolationChecks,
    docker: {
      apiVersion: dockerServer.ApiVersion,
      architecture: dockerServer.Arch,
      operatingSystem: dockerServer.Os,
      serverVersion: dockerServer.Version,
    },
    image,
    mode: "docker-internal-two-container",
    network: {
      driver: networkInspect.Driver,
      internal: networkInspect.Internal,
      networkId: networkInspect.Id,
    },
    schemaVersion: "nodekit.protected-evaluator-isolation/v1",
  };
  isolation.isolationSha256 = selfHash(isolation, "isolationSha256");
} catch (error) {
  issues.push({ code: "independent_browser_journey", message: error.message, severity: "p0" });
} finally {
  spawnSync("docker", ["container", "rm", "--force", browserName], { encoding: "utf8", shell: false });
  spawnSync("docker", ["container", "rm", "--force", candidateName], { encoding: "utf8", shell: false });
  if (networkCreated) spawnSync("docker", ["network", "rm", networkName], { encoding: "utf8", shell: false });
  await rm(browserScratch, { force: true, recursive: true });
  await rm(serverScratch, { force: true, recursive: true });
  await rm(archiveScratch, { force: true, recursive: true });
}

const visibleGroups = taskGroups(visibleText, TASK_RUBRICS[taskId]);
if (!visibleGroups.every((group) => group.passed)) issues.push({ code: "rendered_task_relevance", message: "First-arrival UI does not satisfy every task-specific relevance group.", severity: "p1" });
if (!sourceGroups.every((group) => group.passed)) issues.push({ code: "source_task_relevance", message: "Immutable candidate source does not satisfy every task-specific relevance group.", severity: "p1" });
if (!guidedInteractionPassed) issues.push({ code: "guided_interaction", message: "Independent guided completion journey did not pass.", severity: "p0" });
if (!taskInputBound) issues.push({ code: "task_input_binding", message: "Canonical artifact does not preserve the protected per-run submitted input.", severity: "p0" });
if (!typedArtifactVerified) issues.push({ code: "typed_artifact", message: "The exact task-specific canonical artifact contract did not verify.", severity: "p0" });
if (!artifactDownloadVerified) issues.push({ code: "artifact_download", message: "A visible export did not yield an independently valid proof-bound artifact.", severity: "p0" });
if (!artifactReloadPersistenceVerified) issues.push({ code: "artifact_reload_persistence", message: "The exact canonical artifact tuple did not survive reload.", severity: "p0" });
if (!artifactReopenPersistenceVerified) issues.push({ code: "artifact_reopen_persistence", message: "The exact canonical artifact tuple did not survive a fresh browser context.", severity: "p0" });
if (consoleErrors.length > 0) issues.push({ code: "independent_console", message: `${consoleErrors.length} independent console errors occurred.`, severity: "p1" });
if (failedRequests.length > 0) issues.push({ code: "independent_network", message: `${failedRequests.length} independent requests failed.`, severity: "p1" });
if (domMetrics && (!domMetrics.hasArtifact || !domMetrics.hasHeading || !domMetrics.hasReview || domMetrics.horizontalOverflowPx !== 0)) {
  issues.push({ code: "independent_layout_contract", message: "Independent DOM layout contract failed.", severity: "p1" });
}
if (!screenshotBytes || screenshotBytes.length < 256 || !screenshotBytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
  issues.push({ code: "independent_screenshot", message: "Independent task screenshot is missing, malformed, or implausibly small.", severity: "p0" });
}
const evaluatorScreenshotSha256 = screenshotBytes ? sha256(screenshotBytes) : null;
const protectedBrowserManifestSha256 = protectedBrowserManifestBytes ? sha256(protectedBrowserManifestBytes) : null;
const issueCounts = Object.fromEntries(["p0", "p1", "p2", "p3"].map((severity) => [severity, issues.filter((issue) => issue.severity === severity).length]));
const visualInventory = {
  applicationHash,
  automatedReview: true,
  browserManifestSha256: protectedBrowserManifestSha256,
  candidateArchiveSha256,
  configHash,
  evaluatorScreenshotSha256,
  generatedAt: new Date().toISOString(),
  humanUsabilityGateSatisfied: false,
  isolation,
  isolationSha256: isolation?.isolationSha256 ?? null,
  issues,
  nodekitCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  openIssueCounts: issueCounts,
  passed: issueCounts.p0 === 0 && issueCounts.p1 === 0,
  postAgentTreeHash,
  producer: {
    authority: "campaign-protected-evaluator",
    candidateEvidenceAccess: false,
    candidateHostAccess: false,
    candidateWriteAccess: false,
    executedAfterCandidateArchive: true,
    externalNetworkEgress: false,
    isolationMode: "docker-internal-two-container",
  },
  runId,
  schemaVersion: "nodekit.visual-review-inventory/v1",
  screenshotCount: protectedScreenshotMatrix?.records.length ?? 0,
  screenshotEvidenceRootSha256: protectedScreenshotMatrix?.screenshotEvidenceRootSha256 ?? null,
  separateFromHumanUsability: true,
  taskId,
};
visualInventory.inventorySha256 = selfHash(visualInventory, "inventorySha256");
const visualInventoryBytes = Buffer.from(`${JSON.stringify(visualInventory, null, 2)}\n`);
await writeFile(path.join(outputRoot, "visual-review-inventory.json"), visualInventoryBytes, { flag: "wx" });

const checks = {
  applicationIdentityBound: true,
  artifactDownloadVerified,
  artifactReloadPersistenceVerified,
  artifactReopenPersistenceVerified,
  browserEvidenceBound: protectedBrowserManifest?.certified === true
    && protectedBrowserManifest?.passed === true
    && protectedBrowserManifestSha256 === sha256(protectedBrowserManifestBytes),
  candidateArchiveBound: sha256(candidateArchiveBytes) === candidateArchiveSha256,
  candidateTreeBound: observedTree === postAgentTreeHash,
  evaluatorBytesBound: sha256(await regularFile(evaluatorFile, "protected evaluator", { maxBytes: MAX_TRUSTED_SCRIPT_BYTES })) === evaluatorSha256,
  guidedInteractionPassed,
  independentScreenshotCaptured: Boolean(evaluatorScreenshotSha256),
  isolationBound: isolation !== null && isolation.isolationSha256 === selfHash(isolation, "isolationSha256"),
  renderedTaskRelevant: visibleGroups.every((group) => group.passed),
  sourceTaskRelevant: sourceGroups.every((group) => group.passed),
  taskBytesBound: sha256(taskBriefBytes) === taskBriefSha256,
  taskInputBound,
  taskSetBound: sha256(taskSetBytes) === taskSetSha256,
  typedArtifactVerified,
  visualReviewPassed: visualInventory.passed,
};
if (Object.keys(checks).sort().join("\n") !== [...EVALUATION_CHECKS].sort().join("\n")) throw new Error("protected evaluator check contract drifted");
const evaluation = {
  applicationHash,
  browserManifestSha256: protectedBrowserManifestSha256,
  candidateBrowserManifestSha256,
  candidateArchiveSha256,
  checks,
  configHash,
  evaluatorScreenshotSha256,
  evaluatorSha256,
  generatedAt: new Date().toISOString(),
  isolation,
  isolationSha256: isolation?.isolationSha256 ?? null,
  nodekitCommit,
  nodekitSourceHash,
  nodekitTarballSha256,
  passed: Object.values(checks).every(Boolean),
  postAgentTreeHash,
  producer: {
    authority: "campaign-protected-evaluator",
    candidateEvidenceAccess: false,
    candidateHostAccess: false,
    candidateWriteAccess: false,
    executedAfterCandidateArchive: true,
    externalNetworkEgress: false,
    isolationMode: "docker-internal-two-container",
  },
  protectedTaskInput,
  protectedTaskInputSha256,
  protectedBrowserManifestFile: "protected-browser/screenshot-manifest.json",
  runId,
  schemaVersion: "nodekit.protected-agent-evaluation/v2",
  sourceFilesInspected: source.files,
  taskArtifactEvidence,
  taskBriefSha256,
  taskId,
  taskRelevance: {
    renderedGroups: visibleGroups,
    renderedTextSha256: sha256(visibleText),
    sourceGroups,
    sourceTextSha256: sha256(source.text),
  },
  taskSetSha256,
  visualReviewInventorySha256: sha256(visualInventoryBytes),
  visualReviewInventorySelfHash: visualInventory.inventorySha256,
  screenshotEvidenceRootSha256: protectedScreenshotMatrix?.screenshotEvidenceRootSha256 ?? null,
};
evaluation.evaluationSha256 = selfHash(evaluation, "evaluationSha256");
await writeFile(path.join(outputRoot, "protected-task-evaluation.json"), `${JSON.stringify(evaluation, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(evaluation, null, 2));
if (!evaluation.passed) process.exitCode = 1;
