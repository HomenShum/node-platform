#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PresentationGateError,
  assertCampaignPresentationGate,
  attachFounderQuestScreenshot,
  buildCampaignDeckSpec,
  buildGenerationReceipt,
  canonicalJson,
  parseSpeakerNotes,
  resolveFinalPresentationMediaProof,
  resolveCampaignEvidence,
  sha256,
} from "../src/lib/presentation-pipeline.mjs";

const EXPECTED_NODESLIDE_COMMIT = "0669be4b1d1fb891ea65e4b30a6a6da90f9e2585";
const CHANGE_ID = "nodekit-proof-campaign-2026-07-20";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const changeRoot = path.join(repositoryRoot, "changes", CHANGE_ID);
const presentationRoot = path.join(changeRoot, "presentation");
const storyRoot = path.join(changeRoot, "story");
const videoReceiptPath = path.join(
  changeRoot,
  "video",
  "proof",
  "founder-quest-video-receipt.json",
);

const SOURCE_PATHS = {
  change: path.join(changeRoot, "change.yaml"),
  claims: path.join(storyRoot, "claims.json"),
  evidence: path.join(storyRoot, "evidence-index.json"),
  limitations: path.join(storyRoot, "limitations.json"),
  slidePlans: path.join(presentationRoot, "slide-design-plans.json"),
  speakerNotes: path.join(presentationRoot, "speaker-notes.md"),
};

function printHelp() {
  console.log(`Generate the evidence-bound NodeKit proof campaign deck.

Usage:
  npm run presentation:nodekit-proof -- [options]

Options:
  --nodeslide-root <path>            Pinned NodeSlide checkout (defaults to the sibling checkout)
  --evidence-root <path>             Base for evidence-index externalPath values
  --founder-quest-screenshot <path>  Optional PNG/JPEG/WebP product screenshot
  --final                            Emit media-bound final artifacts; fail closed on video proof
  --help                             Show this help

Without --final the generator preserves the draft-only output path. Neither mode publishes or deploys.`);
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--final") {
      options.final = true;
      continue;
    }
    const [flag, inline] = value.split("=", 2);
    if (!["--nodeslide-root", "--evidence-root", "--founder-quest-screenshot"].includes(flag)) {
      throw new Error(`Unknown presentation option: ${value}`);
    }
    const next = inline ?? values[index + 1];
    if (!next || (!inline && next.startsWith("--"))) throw new Error(`${flag} requires a value`);
    if (inline === undefined) index += 1;
    if (flag === "--nodeslide-root") options.nodeslideRoot = next;
    if (flag === "--evidence-root") options.evidenceRoot = next;
    if (flag === "--founder-quest-screenshot") options.founderQuestScreenshot = next;
  }
  return options;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function canonicalCheckoutRoot() {
  const commonDirectory = git(repositoryRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return path.dirname(path.resolve(commonDirectory));
}

function defaultNodeSlideRoot() {
  return path.resolve(canonicalCheckoutRoot(), "..", "NodeSlide");
}

function verifyNodeSlideCheckout(nodeslideRoot) {
  const actualCommit = git(nodeslideRoot, ["rev-parse", "HEAD"]);
  if (actualCommit !== EXPECTED_NODESLIDE_COMMIT) {
    throw new Error(
      `NodeSlide source pin mismatch: expected ${EXPECTED_NODESLIDE_COMMIT}, received ${actualCommit}`,
    );
  }
  const trackedChanges = git(nodeslideRoot, ["status", "--porcelain", "--untracked-files=no"]);
  if (trackedChanges) {
    throw new Error("Pinned NodeSlide checkout has tracked changes; refusing an uncommitted source variant.");
  }
  return actualCommit;
}

function rel(target) {
  return path.relative(repositoryRoot, target).replaceAll("\\", "/");
}

function timestampForChange() {
  const match = /(\d{4}-\d{2}-\d{2})$/.exec(CHANGE_ID);
  if (!match) throw new Error(`Change id ${CHANGE_ID} has no deterministic date suffix`);
  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid change date ${match[1]}`);
  return timestamp;
}

async function readInputs() {
  const requireFromNodeKit = createRequire(path.join(repositoryRoot, "package.json"));
  const { parse: parseYaml } = requireFromNodeKit("yaml");
  const entries = await Promise.all(
    Object.entries(SOURCE_PATHS).map(async ([key, target]) => [key, await readFile(target)]),
  );
  const raw = Object.fromEntries(entries);
  return {
    parsed: {
      change: parseYaml(raw.change.toString("utf8")),
      claims: JSON.parse(raw.claims.toString("utf8")),
      evidence: JSON.parse(raw.evidence.toString("utf8")),
      limitations: JSON.parse(raw.limitations.toString("utf8")),
      slidePlans: JSON.parse(raw.slidePlans.toString("utf8")),
      speakerNotes: raw.speakerNotes.toString("utf8"),
    },
    raw,
  };
}

async function loadFounderQuestScreenshot(target) {
  if (!target) return null;
  const absolute = path.resolve(target);
  const extension = path.extname(absolute).toLowerCase();
  const mimeTypes = {
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error("Founder Quest screenshot must be PNG, JPEG, or WebP.");
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new Error(`Founder Quest screenshot is not a file: ${target}`);
  if (metadata.size > 8_000_000) throw new Error("Founder Quest screenshot exceeds the 8 MB draft limit.");
  const bytes = await readFile(absolute);
  return {
    byteSize: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    fileName: path.basename(absolute),
    mimeType,
    sha256: sha256(bytes),
  };
}

async function importNodeSlide(nodeslideRoot) {
  const seedPath = path.join(nodeslideRoot, "convex", "lib", "nodeslideSeed.ts");
  const adapterPath = path.join(
    nodeslideRoot,
    "src",
    "domains",
    "nodeslide",
    "slidelang",
    "localAdapter.ts",
  );
  const [seed, adapter, seedBytes, adapterBytes] = await Promise.all([
    import(`/@fs/${seedPath.replaceAll("\\", "/")}`),
    import(`/@fs/${adapterPath.replaceAll("\\", "/")}`),
    readFile(seedPath),
    readFile(adapterPath),
  ]);
  if (typeof seed.buildBriefNodeSlide !== "function") {
    throw new Error("Pinned NodeSlide does not export buildBriefNodeSlide.");
  }
  if (!adapter.localSlideLangAdapter) {
    throw new Error("Pinned NodeSlide does not export localSlideLangAdapter.");
  }
  return {
    buildBriefNodeSlide: seed.buildBriefNodeSlide,
    localSlideLangAdapter: adapter.localSlideLangAdapter,
    sourceFiles: [
      { path: "convex/lib/nodeslideSeed.ts", sha256: sha256(seedBytes) },
      { path: "src/domains/nodeslide/slidelang/localAdapter.ts", sha256: sha256(adapterBytes) },
    ],
  };
}

function normalizeCoreProperties(value, isoTimestamp) {
  const normalized = isoTimestamp.replace(".000Z", "Z");
  return value
    .replace(
      /(<dcterms:created\b[^>]*>)[^<]*(<\/dcterms:created>)/g,
      `$1${normalized}$2`,
    )
    .replace(
      /(<dcterms:modified\b[^>]*>)[^<]*(<\/dcterms:modified>)/g,
      `$1${normalized}$2`,
    );
}

async function canonicalizeOfficeZip(bytes, JSZip, fixedDate) {
  const source = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const output = new JSZip();
  for (const name of Object.keys(source.files).sort()) {
    const entry = source.files[name];
    if (!entry || entry.dir) continue;
    let content = await entry.async("nodebuffer");
    if (name === "docProps/core.xml") {
      content = Buffer.from(normalizeCoreProperties(content.toString("utf8"), fixedDate.toISOString()));
    } else if (/^ppt\/embeddings\/.*\.xlsx$/i.test(name)) {
      content = await canonicalizeOfficeZip(content, JSZip, fixedDate);
    }
    output.file(name, content, {
      binary: true,
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      createFolders: false,
      date: fixedDate,
    });
  }
  return output.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
    streamFiles: false,
    type: "nodebuffer",
  });
}

async function canonicalizePptx(pptxBytes, nodeslideRoot, timestamp) {
  const requireFromNodeSlide = createRequire(path.join(nodeslideRoot, "package.json"));
  const JSZip = requireFromNodeSlide("jszip");
  return canonicalizeOfficeZip(pptxBytes, JSZip, new Date(timestamp));
}

async function verifyPptx(pptxBytes, nodeslideRoot, expectedSlides, capabilityReports) {
  const requireFromNodeSlide = createRequire(path.join(nodeslideRoot, "package.json"));
  const JSZip = requireFromNodeSlide("jszip");
  const reopened = await JSZip.loadAsync(pptxBytes, { checkCRC32: true });
  const names = Object.keys(reopened.files);
  const required = ["[Content_Types].xml", "ppt/presentation.xml"];
  for (const name of required) {
    if (!reopened.file(name)) throw new Error(`PPTX reopen check is missing ${name}`);
  }
  const slideCount = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  if (slideCount !== expectedSlides) {
    throw new Error(`PPTX reopen check expected ${expectedSlides} slides, received ${slideCount}`);
  }
  const unsupported = capabilityReports.filter(
    (report) => report.pptx !== "native" && report.pptx !== "static_fallback",
  );
  if (unsupported.length > 0) {
    throw new Error(`PPTX export has ${unsupported.length} unsupported elements.`);
  }
  return {
    editableElementCount: capabilityReports.filter((report) => report.pptx === "native").length,
    reopened: true,
    slideCount,
    staticFallbackElementCount: capabilityReports.filter(
      (report) => report.pptx === "static_fallback",
    ).length,
  };
}

function attachSpeakerNotes(snapshot, slidePlans, markdown, releaseMode) {
  const notes = parseSpeakerNotes(markdown);
  for (let index = 0; index < snapshot.slides.length; index += 1) {
    const slide = snapshot.slides[index];
    const planned = slidePlans.slides[index];
    if (!slide || !planned) continue;
    const speakerNote = notes.get(planned.id) ?? planned.job;
    slide.notes = [
      ...(releaseMode === "draft"
        ? ["DRAFT PRESENTATION — external publish readiness is not asserted."]
        : ["MEDIA-BOUND FINAL — publication remains a separate receipt gate."]),
      speakerNote,
      `Evidence IDs: ${(planned.evidenceIds ?? []).join(", ") || "none; planned content only"}.`,
    ].join("\n\n");
  }
}

async function inputReceipts(rawInputs, screenshot, nodeslideRoot, mediaProof) {
  const inputs = Object.entries(SOURCE_PATHS).map(([key, target]) => ({
    byteSize: rawInputs[key].byteLength,
    path: rel(target),
    sha256: sha256(rawInputs[key]),
  }));
  for (const target of [scriptPath, path.join(repositoryRoot, "src", "lib", "presentation-pipeline.mjs")]) {
    const bytes = await readFile(target);
    inputs.push({ byteSize: bytes.byteLength, path: rel(target), sha256: sha256(bytes) });
  }
  if (screenshot) {
    inputs.push({
      byteSize: screenshot.byteSize,
      mediaType: screenshot.mimeType,
      path: `optional-founder-quest-screenshot/${screenshot.fileName}`,
      sha256: screenshot.sha256,
    });
  }
  const packageJson = await readFile(path.join(nodeslideRoot, "package.json"));
  inputs.push({
    byteSize: packageJson.byteLength,
    path: "pinned-nodeslide/package.json",
    sha256: sha256(packageJson),
  });
  if (mediaProof) {
    inputs.push({
      byteSize: mediaProof.receipt.byteSize,
      path: rel(path.join(changeRoot, ...mediaProof.receipt.path.split("/"))),
      sha256: mediaProof.receipt.sha256,
    });
    for (const video of mediaProof.videos) {
      inputs.push({
        byteSize: video.byteSize,
        mediaType: "video/mp4",
        path: rel(path.join(changeRoot, ...video.path.split("/"))),
        sha256: video.sha256,
      });
    }
  }
  return inputs;
}

async function runGenerator(options) {
  const releaseMode = options.final ? "final" : "draft";
  const finalMode = releaseMode === "final";
  const nodeslideRoot = path.resolve(options.nodeslideRoot ?? process.env.NODEKIT_NODESLIDE_ROOT);
  const nodeSlideCommit = verifyNodeSlideCheckout(nodeslideRoot);
  const externalEvidenceRoot = path.resolve(options.evidenceRoot ?? canonicalCheckoutRoot());
  const timestamp = timestampForChange();
  const generatedAt = new Date(timestamp).toISOString();
  const [{ parsed, raw }, founderQuestScreenshot, nodeSlide, mediaProof] = await Promise.all([
    readInputs(),
    loadFounderQuestScreenshot(options.founderQuestScreenshot),
    importNodeSlide(nodeslideRoot),
    finalMode
      ? resolveFinalPresentationMediaProof({
          campaignRoot: changeRoot,
          expectedCampaignId: CHANGE_ID,
          receiptPath: videoReceiptPath,
        })
      : Promise.resolve(null),
  ]);

  const structuralGate = assertCampaignPresentationGate({
    claims: parsed.claims,
    evidenceIndex: parsed.evidence,
    slidePlans: parsed.slidePlans,
  });
  const resolvedEvidence = await resolveCampaignEvidence({
    evidenceIndex: parsed.evidence,
    externalEvidenceRoot,
    repositoryRoot,
    requiredEvidenceIds: structuralGate.requiredEvidenceIds,
  });
  const claimEvidenceGate = assertCampaignPresentationGate({
    availableEvidenceIds: resolvedEvidence.map((entry) => entry.id),
    claims: parsed.claims,
    evidenceIndex: parsed.evidence,
    slidePlans: parsed.slidePlans,
  });

  const deckSpec = buildCampaignDeckSpec({
    change: parsed.change,
    claims: parsed.claims,
    evidenceIndex: parsed.evidence,
    founderQuestScreenshot,
    releaseMode,
    slidePlans: parsed.slidePlans,
  });
  const urls = parsed.evidence.evidence
    .flatMap((entry) => [entry.url, entry.publicRelease])
    .filter((value) => typeof value === "string");
  const brief = {
    audience: parsed.change.audience.join(", "),
    prompt: [
      parsed.change.communicationJob,
      "Every material claim must remain bound to the supplied Change Story evidence.",
      finalMode
        ? "Both walkthrough videos are verified and hash-bound; publication remains a separate receipt gate."
        : "This deck is a draft because video and publication receipts remain separate gates.",
      ...urls,
    ].join("\n"),
    purpose: finalMode
      ? `${parsed.change.communicationJob} Media-ready and not yet published.`
      : `${parsed.change.communicationJob} Draft-only until every artifact and publication gate passes.`,
    successCriteria: [
      ...parsed.change.requiredProof,
      "Bind Founder Quest production copy to E12 and E13",
      "Keep the recursive publication claim in explicit future tense",
      finalMode
        ? "Bind the exact verified video receipt and retain not-published distribution status"
        : "Keep external publish readiness false",
    ],
  };
  const attachments = [
    {
      content: canonicalJson({
        change: parsed.change,
        claims: parsed.claims,
        limitations: parsed.limitations,
      }).trim(),
      format: "json",
      title: "NodeKit governed Change Story",
    },
    {
      content: canonicalJson(parsed.evidence).trim(),
      format: "json",
      title: "NodeKit evidence index",
    },
    {
      content: canonicalJson(parsed.slidePlans).trim(),
      format: "json",
      title: "NodeKit slide design plans",
    },
  ];
  const built = nodeSlide.buildBriefNodeSlide({
    attachments,
    brief,
    deckId: `deck-${CHANGE_ID}-${releaseMode}`,
    now: timestamp,
    plan: parsed.slidePlans.slides.map(
      (slide, index) => `${index + 1}. ${slide.job} Evidence: ${(slide.evidenceIds ?? []).join(", ") || "planned only"}.`,
    ),
    projectId: CHANGE_ID,
    rawSpec: deckSpec,
    themeId: "quiet-precision",
    title: deckSpec.title,
  });
  if (built.spec.slides.length !== parsed.slidePlans.slides.length) {
    throw new PresentationGateError([
      `NodeSlide materialized ${built.spec.slides.length} slides from ${parsed.slidePlans.slides.length} governed plans`,
    ]);
  }
  const snapshot = structuredClone(built.snapshot);
  snapshot.deck.status = finalMode ? "ready" : "draft";
  snapshot.deck.title = deckSpec.title;
  attachFounderQuestScreenshot(snapshot, founderQuestScreenshot);
  for (const element of snapshot.elements) {
    if (element.style?.fontFamily === "Geist Variable") {
      element.style.fontFamily = "Arial";
    }
    if (element.style?.fontFamily === "JetBrains Mono Variable") {
      element.style.fontFamily = "Courier New";
    }
    if (!finalMode && element.role === "footer" && typeof element.content === "string") {
      element.content = `DRAFT · ${element.content}`;
    }
  }
  attachSpeakerNotes(snapshot, parsed.slidePlans, parsed.speakerNotes, releaseMode);

  const validation = nodeSlide.localSlideLangAdapter.validate(snapshot);
  if (!validation.ok || !validation.publishOk) {
    const messages = validation.issues
      .filter((issue) => issue.severity === "error" || issue.severity === "warning")
      .map((issue) => `${issue.severity}:${issue.code}:${issue.message}`);
    throw new PresentationGateError([
      `NodeSlide validation failed (ok=${validation.ok}, publishOk=${validation.publishOk})`,
      ...messages,
    ]);
  }

  const capabilityReports = nodeSlide.localSlideLangAdapter.getCapabilityReports(snapshot);
  const html = nodeSlide.localSlideLangAdapter.renderDeckHtml(snapshot);
  const rawPptx = await nodeSlide.localSlideLangAdapter.buildPptx(snapshot);
  const pptx = await canonicalizePptx(Buffer.from(rawPptx), nodeslideRoot, timestamp);
  const pptxVerification = await verifyPptx(
    pptx,
    nodeslideRoot,
    snapshot.slides.length,
    capabilityReports,
  );

  const exportsRoot = path.join(presentationRoot, "exports");
  const outputPaths = {
    html: path.join(exportsRoot, `${CHANGE_ID}.${releaseMode}.html`),
    pptx: path.join(exportsRoot, `${CHANGE_ID}.${releaseMode}.pptx`),
    receipt: path.join(
      exportsRoot,
      finalMode ? "final-generation-receipt.json" : "generation-receipt.json",
    ),
    snapshot: path.join(
      presentationRoot,
      finalMode ? "deck-snapshot.final.json" : "deck-snapshot.json",
    ),
    spec: path.join(presentationRoot, finalMode ? "deck-spec.final.json" : "deck-spec.json"),
  };
  const artifactBytes = {
    html: Buffer.from(html, "utf8"),
    pptx,
    snapshot: Buffer.from(canonicalJson(snapshot), "utf8"),
    spec: Buffer.from(canonicalJson(built.spec), "utf8"),
  };
  const artifacts = Object.entries(artifactBytes).map(([kind, bytes]) => ({
    byteSize: bytes.byteLength,
    editable: kind === "pptx" ? true : undefined,
    kind,
    path: rel(outputPaths[kind]),
    sha256: sha256(bytes),
    ...(finalMode ? { publicationStatus: "not-published" } : {}),
    status: finalMode ? "ready" : "draft",
  }));
  const inputs = await inputReceipts(raw, founderQuestScreenshot, nodeslideRoot, mediaProof);
  const receipt = buildGenerationReceipt({
    artifacts,
    changeId: CHANGE_ID,
    evidence: resolvedEvidence,
    gate: {
      ...claimEvidenceGate,
      distributionStatus: finalMode ? "not-published" : undefined,
      draftLabeled: !finalMode,
      externalPublishReady: finalMode,
      mediaProofPassed: finalMode ? true : undefined,
      nodeSlideValidationPassed: true,
    },
    generatedAt,
    inputs,
    nodeSlide: {
      commit: nodeSlideCommit,
      mode: nodeSlide.localSlideLangAdapter.mode,
      repository: "NodeSlide pinned local source",
      sourceFiles: nodeSlide.sourceFiles,
      toolchainVersion: snapshot.deck.toolchainVersion,
    },
    pptxVerification,
    releaseMode,
    mediaProof,
    validation: {
      cleanOk: validation.cleanOk,
      id: validation.id,
      issues: validation.issues,
      ok: validation.ok,
      publishOk: validation.publishOk,
      scope: "NodeSlide structural/export validation only; not external publication approval",
    },
  });

  await mkdir(exportsRoot, { recursive: true });
  await Promise.all([
    writeFile(outputPaths.spec, artifactBytes.spec),
    writeFile(outputPaths.snapshot, artifactBytes.snapshot),
    writeFile(outputPaths.html, artifactBytes.html),
    writeFile(outputPaths.pptx, artifactBytes.pptx),
    writeFile(outputPaths.receipt, canonicalJson(receipt)),
  ]);

  console.log(
    canonicalJson({
      artifacts: [
        ...artifacts,
        {
          kind: "receipt",
          path: rel(outputPaths.receipt),
          ...(finalMode ? { publicationStatus: "not-published" } : {}),
          status: finalMode ? "ready" : "draft",
        },
      ],
      distributionStatus: finalMode ? "not-published" : undefined,
      externalPublishReady: finalMode,
      nodeSlideCommit,
      receiptDigest: receipt.receiptDigest,
      status: finalMode ? "ready" : "draft",
      validation: { cleanOk: validation.cleanOk, ok: validation.ok, publishOk: validation.publishOk },
    }).trim(),
  );
}

async function relaunchThroughNodeSlide(options, rawArguments) {
  const nodeslideRoot = path.resolve(options.nodeslideRoot ?? defaultNodeSlideRoot());
  verifyNodeSlideCheckout(nodeslideRoot);
  const runtime = path.join(nodeslideRoot, "node_modules", "vite-node", "vite-node.mjs");
  try {
    await stat(runtime);
  } catch {
    throw new Error(
      `Pinned NodeSlide runtime is not installed at ${runtime}. Run npm install in the pinned NodeSlide checkout.`,
    );
  }
  const result = spawnSync(process.execPath, [runtime, "--root", nodeslideRoot, scriptPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODEKIT_NODESLIDE_ROOT: nodeslideRoot,
      NODEKIT_PRESENTATION_ARGS: JSON.stringify(rawArguments),
      NODEKIT_PRESENTATION_VITE_RUNTIME: "1",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`NodeSlide runtime stopped by signal ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const rawArguments = process.env.NODEKIT_PRESENTATION_VITE_RUNTIME === "1"
  ? JSON.parse(process.env.NODEKIT_PRESENTATION_ARGS ?? "[]")
  : process.argv.slice(2);
const options = parseArguments(rawArguments);

if (options.help) {
  printHelp();
} else if (process.env.NODEKIT_PRESENTATION_VITE_RUNTIME !== "1") {
  await relaunchThroughNodeSlide(options, rawArguments);
} else {
  try {
    await runGenerator(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
