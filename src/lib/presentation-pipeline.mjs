import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CLAIM_STATUSES = new Set([
  "verified",
  "measured",
  "observed",
  "user_asserted",
  "planned",
]);

const PRESENTATION_RELEASE_MODES = new Set(["draft", "final"]);
const VIDEO_PROOF_SCHEMA_VERSION = "nodekit.video-proof-receipt/v1";
const REQUIRED_FINAL_VIDEOS = new Map([
  ["FounderQuestVertical", "video/output/nodekit-founder-quest-vertical.mp4"],
  ["FounderQuestTechnical", "video/output/nodekit-founder-quest-technical.mp4"],
]);

const FUTURE_LANGUAGE =
  /\b(?:planned|proposal|proposed|future|will|would|could|intended|target|once|after|before|until|next milestone)\b/i;

const UNSUPPORTED_PLANNED_ASSERTIONS = [
  /\b(?:has|have|had)\s+(?:already\s+)?(?:been\s+)?(?:built|created|deployed|launched|published|shipped|released|completed|passed|proved|proven|generated|exported|directed|delivered|implemented|validated|verified)\b/i,
  /\b(?:was|were)\s+(?:already\s+)?(?:built|created|deployed|launched|published|shipped|released|completed|passed|proved|proven|generated|exported|directed|delivered|implemented|validated|verified)\b/i,
  /\b(?:provides|provided|uses|used|maps|mapped|shows|showed|explains|explained|passed|shipped|launched|published|completed|proved|proven|generated|exported|directed|delivered|implemented|validated|verified)\b/i,
];

export class PresentationGateError extends Error {
  constructor(issues) {
    super(`NodeKit presentation gate failed:\n- ${issues.join("\n- ")}`);
    this.name = "PresentationGateError";
    this.issues = [...issues];
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(target) {
  return sha256(await readFile(target));
}

function assertReleaseMode(releaseMode) {
  if (!PRESENTATION_RELEASE_MODES.has(releaseMode)) {
    throw new PresentationGateError([
      `presentation release mode must be draft or final, received ${String(releaseMode)}`,
    ]);
  }
}

function normalizedRelativePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

/**
 * Resolve and re-hash the verified Founder Quest video receipt used by final
 * presentation mode. The receipt is necessary but not sufficient: the current
 * MP4 bytes must still match every bound hash and byte count.
 */
export async function resolveFinalPresentationMediaProof({
  campaignRoot,
  expectedCampaignId,
  receiptPath,
}) {
  const issues = [];
  const absoluteCampaignRoot = path.resolve(campaignRoot);
  const absoluteReceiptPath = path.resolve(receiptPath);
  let receiptBytes;
  let receipt;

  try {
    receiptBytes = await readFile(absoluteReceiptPath);
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch (error) {
    throw new PresentationGateError([
      `final presentation video receipt is unavailable or invalid JSON: ${error.message}`,
    ]);
  }

  if (receipt?.schemaVersion !== VIDEO_PROOF_SCHEMA_VERSION) {
    issues.push(
      `video receipt schema must be ${VIDEO_PROOF_SCHEMA_VERSION}, received ${String(receipt?.schemaVersion)}`,
    );
  }
  if (receipt?.status !== "verified") {
    issues.push(`video receipt status must be verified, received ${String(receipt?.status)}`);
  }
  if (receipt?.campaignId !== expectedCampaignId) {
    issues.push(
      `video receipt campaign id must be ${expectedCampaignId}, received ${String(receipt?.campaignId)}`,
    );
  }

  const videos = Array.isArray(receipt?.videos) ? receipt.videos : [];
  if (videos.length !== REQUIRED_FINAL_VIDEOS.size) {
    issues.push(
      `video receipt must bind exactly ${REQUIRED_FINAL_VIDEOS.size} final videos, received ${videos.length}`,
    );
  }
  const profileIds = videos.map((video) => video?.profileId).filter(Boolean);
  if (new Set(profileIds).size !== profileIds.length) {
    issues.push("video receipt contains duplicate profile ids");
  }

  const resolvedVideos = [];
  for (const [profileId, expectedPath] of REQUIRED_FINAL_VIDEOS) {
    const video = videos.find((candidate) => candidate?.profileId === profileId);
    if (!video) {
      issues.push(`video receipt is missing required profile ${profileId}`);
      continue;
    }
    const declaredPath = normalizedRelativePath(video.path);
    if (declaredPath !== expectedPath) {
      issues.push(
        `video ${profileId} path must be ${expectedPath}, received ${declaredPath || "<missing>"}`,
      );
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(String(video.sha256 ?? ""))) {
      issues.push(`video ${profileId} has no valid sha256`);
      continue;
    }

    const absoluteVideoPath = path.resolve(absoluteCampaignRoot, ...declaredPath.split("/"));
    const relativeFromCampaign = path.relative(absoluteCampaignRoot, absoluteVideoPath);
    if (
      relativeFromCampaign.startsWith(`..${path.sep}`) ||
      relativeFromCampaign === ".." ||
      path.isAbsolute(relativeFromCampaign)
    ) {
      issues.push(`video ${profileId} resolves outside the campaign root`);
      continue;
    }

    try {
      const metadata = await stat(absoluteVideoPath);
      if (!metadata.isFile()) throw new Error("not a file");
      const actualSha256 = await sha256File(absoluteVideoPath);
      if (actualSha256.toLowerCase() !== video.sha256.toLowerCase()) {
        issues.push(
          `video ${profileId} hash mismatch: expected ${video.sha256}, received ${actualSha256}`,
        );
      }
      if (metadata.size !== video.bytes) {
        issues.push(
          `video ${profileId} byte count mismatch: expected ${String(video.bytes)}, received ${metadata.size}`,
        );
      }
      resolvedVideos.push({
        byteSize: metadata.size,
        compositionId: video.compositionId,
        durationSeconds: video.durationSeconds,
        height: video.height,
        path: declaredPath,
        profileId,
        sha256: actualSha256,
        width: video.width,
      });
    } catch (error) {
      issues.push(`video ${profileId} is unavailable at ${declaredPath}: ${error.message}`);
    }
  }

  if (issues.length > 0) throw new PresentationGateError([...new Set(issues)].sort());

  return {
    campaignId: receipt.campaignId,
    receipt: {
      byteSize: receiptBytes.byteLength,
      path: normalizedRelativePath(path.relative(absoluteCampaignRoot, absoluteReceiptPath)),
      schemaVersion: receipt.schemaVersion,
      sha256: sha256(receiptBytes),
      status: receipt.status,
      verifiedAt: receipt.verifiedAt,
    },
    videos: resolvedVideos.sort((left, right) => left.profileId.localeCompare(right.profileId)),
  };
}

function nonEmptyArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry) : [];
}

function duplicateIds(records) {
  const seen = new Set();
  const duplicates = new Set();
  for (const record of records) {
    if (!record || typeof record.id !== "string" || !record.id) continue;
    if (seen.has(record.id)) duplicates.add(record.id);
    seen.add(record.id);
  }
  return [...duplicates].sort();
}

function plannedSlideLanguage(slide) {
  return [
    slide.takeaway,
    slide.body,
    ...(Array.isArray(slide.bullets) ? slide.bullets : []),
  ]
    .filter((entry) => typeof entry === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUnsupportedPlannedAssertion(value) {
  return UNSUPPORTED_PLANNED_ASSERTIONS.some((pattern) => pattern.test(value));
}

/**
 * Enforce the Change Story claim/evidence boundary before any NodeSlide API is called.
 * Passing `availableEvidenceIds` upgrades the structural check into a filesystem-backed gate.
 */
export function assertCampaignPresentationGate({
  claims: claimsDocument,
  evidenceIndex,
  slidePlans,
  availableEvidenceIds,
}) {
  const issues = [];
  const claims = Array.isArray(claimsDocument?.claims) ? claimsDocument.claims : [];
  const evidence = Array.isArray(evidenceIndex?.evidence) ? evidenceIndex.evidence : [];
  const slides = Array.isArray(slidePlans?.slides) ? slidePlans.slides : [];

  if (claims.length === 0) issues.push("claim ledger has no claims");
  if (evidence.length === 0) issues.push("evidence index has no evidence records");
  if (slides.length === 0) issues.push("slide plan has no slides");

  for (const duplicate of duplicateIds(claims)) issues.push(`duplicate claim id ${duplicate}`);
  for (const duplicate of duplicateIds(evidence)) issues.push(`duplicate evidence id ${duplicate}`);
  for (const duplicate of duplicateIds(slides)) issues.push(`duplicate slide id ${duplicate}`);

  const claimsById = new Map(claims.map((claim) => [claim?.id, claim]));
  const evidenceById = new Map(evidence.map((entry) => [entry?.id, entry]));
  const requiredEvidenceIds = new Set();
  const plannedClaimIds = new Set();
  const claimBindings = [];

  for (const claim of claims) {
    if (!claim || typeof claim.id !== "string" || !claim.id) {
      issues.push("claim record is missing a stable id");
      continue;
    }
    if (!CLAIM_STATUSES.has(claim.status)) {
      issues.push(`claim ${claim.id} has unsupported status ${String(claim.status)}`);
      continue;
    }
    const claimEvidenceIds = nonEmptyArray(claim.evidenceIds);
    if (claim.status !== "planned" && claimEvidenceIds.length === 0) {
      issues.push(`material claim ${claim.id} has no evidence ids`);
    }
    for (const evidenceId of claimEvidenceIds) {
      if (!evidenceById.has(evidenceId)) {
        issues.push(`claim ${claim.id} references missing evidence ${evidenceId}`);
      }
      if (claim.status !== "planned") requiredEvidenceIds.add(evidenceId);
    }
  }

  for (const slide of slides) {
    if (!slide || typeof slide.id !== "string" || !slide.id) {
      issues.push("slide plan record is missing a stable id");
      continue;
    }
    const slideEvidenceIds = nonEmptyArray(slide.evidenceIds);
    const slideEvidenceSet = new Set(slideEvidenceIds);
    for (const evidenceId of slideEvidenceIds) {
      if (!evidenceById.has(evidenceId)) {
        issues.push(`slide ${slide.id} references missing evidence ${evidenceId}`);
      }
      requiredEvidenceIds.add(evidenceId);
    }

    for (const claimId of nonEmptyArray(slide.claimIds)) {
      const claim = claimsById.get(claimId);
      if (!claim) {
        issues.push(`slide ${slide.id} references missing claim ${claimId}`);
        continue;
      }
      const claimEvidenceIds = nonEmptyArray(claim.evidenceIds);
      claimBindings.push({
        claimId,
        evidenceIds: [...claimEvidenceIds].sort(),
        slideId: slide.id,
        status: claim.status,
      });

      if (claim.status === "planned") {
        plannedClaimIds.add(claimId);
        const language = plannedSlideLanguage(slide);
        if (!FUTURE_LANGUAGE.test(language)) {
          issues.push(`planned claim ${claimId} on slide ${slide.id} lacks explicit future/planned language`);
        }
        if (hasUnsupportedPlannedAssertion(language)) {
          issues.push(`planned claim ${claimId} on slide ${slide.id} is asserted as already real`);
        }
        continue;
      }

      for (const evidenceId of claimEvidenceIds) {
        if (!slideEvidenceSet.has(evidenceId)) {
          issues.push(`slide ${slide.id} omits required evidence ${evidenceId} for claim ${claimId}`);
        }
      }
    }
  }

  if (availableEvidenceIds !== undefined && availableEvidenceIds !== null) {
    const available = new Set(availableEvidenceIds);
    for (const evidenceId of [...requiredEvidenceIds].sort()) {
      if (!available.has(evidenceId)) issues.push(`required evidence ${evidenceId} is unavailable`);
    }
  }

  if (issues.length > 0) throw new PresentationGateError([...new Set(issues)].sort());

  return {
    claimBindings: claimBindings.sort(
      (left, right) => left.slideId.localeCompare(right.slideId) || left.claimId.localeCompare(right.claimId),
    ),
    passed: true,
    plannedClaimIds: [...plannedClaimIds].sort(),
    requiredEvidenceIds: [...requiredEvidenceIds].sort(),
  };
}

function assertHttps(value, label, issues) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("not https");
  } catch {
    issues.push(`${label} is not a valid HTTPS URL`);
  }
}

async function resolveEvidenceFile({
  entry,
  field,
  base,
  expectedHashField,
  issues,
}) {
  const locator = entry[field];
  if (typeof locator !== "string" || !locator) return null;
  const absolute = path.resolve(base, locator);
  try {
    const metadata = await stat(absolute);
    if (!metadata.isFile()) throw new Error("not a file");
    const actualSha256 = await sha256File(absolute);
    const expectedSha256 = entry[expectedHashField];
    if (
      typeof expectedSha256 === "string" &&
      expectedSha256.toLowerCase() !== actualSha256.toLowerCase()
    ) {
      issues.push(
        `evidence ${entry.id} ${field} hash mismatch: expected ${expectedSha256}, received ${actualSha256}`,
      );
    }
    return {
      byteSize: metadata.size,
      field,
      locator: locator.replaceAll("\\", "/"),
      sha256: actualSha256,
    };
  } catch (error) {
    issues.push(`evidence ${entry.id} ${field} is unavailable at ${locator}: ${error.message}`);
    return null;
  }
}

/** Resolve all evidence required by the claim/slide gate without doing mutable or network work. */
export async function resolveCampaignEvidence({
  evidenceIndex,
  requiredEvidenceIds,
  repositoryRoot,
  externalEvidenceRoot,
}) {
  const evidence = Array.isArray(evidenceIndex?.evidence) ? evidenceIndex.evidence : [];
  const evidenceById = new Map(evidence.map((entry) => [entry?.id, entry]));
  const issues = [];
  const resolved = [];

  for (const evidenceId of [...new Set(requiredEvidenceIds)].sort()) {
    const entry = evidenceById.get(evidenceId);
    if (!entry) {
      issues.push(`required evidence ${evidenceId} is absent from the evidence index`);
      continue;
    }
    const files = [];
    const local = await resolveEvidenceFile({
      entry,
      field: "path",
      base: repositoryRoot,
      expectedHashField: "sha256",
      issues,
    });
    if (local) files.push(local);
    const external = await resolveEvidenceFile({
      entry,
      field: "externalPath",
      base: externalEvidenceRoot,
      expectedHashField: "sha256",
      issues,
    });
    if (external) files.push(external);
    const receipt = await resolveEvidenceFile({
      entry,
      field: "receiptPath",
      base: externalEvidenceRoot,
      expectedHashField: "receiptSha256",
      issues,
    });
    if (receipt) files.push(receipt);

    const urls = [];
    for (const field of ["url", "publicRelease"]) {
      if (typeof entry[field] !== "string" || !entry[field]) continue;
      assertHttps(entry[field], `evidence ${entry.id} ${field}`, issues);
      urls.push({ field, url: entry[field] });
    }
    if (files.length === 0 && urls.length === 0) {
      issues.push(`evidence ${entry.id} has no resolvable file or declared HTTPS source`);
    }
    resolved.push({
      files: files.sort((left, right) => left.field.localeCompare(right.field)),
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      urls: urls.sort((left, right) => left.field.localeCompare(right.field)),
    });
  }

  if (issues.length > 0) throw new PresentationGateError([...new Set(issues)].sort());
  return resolved.sort((left, right) => left.id.localeCompare(right.id));
}

function clip(value, maximum) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const candidate = normalized.slice(0, maximum - 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, Math.max(boundary, Math.floor(maximum * 0.7))).trim()}…`;
}

function contextualBody(change, slide) {
  if (slide.narrativeRole === "stakes") {
    return clip([change.previousState?.[0], change.userPain?.[0]].filter(Boolean).join(" "), 340);
  }
  if (slide.narrativeRole === "synthesis") {
    return clip([change.decision?.[0], change.decision?.[2]].filter(Boolean).join(" "), 340);
  }
  if (slide.narrativeRole === "action") {
    return clip(`Next milestone: ${change.nextMilestone ?? slide.job}`, 340);
  }
  return clip(`${slide.job} ${slide.dominantVisual}`, 340);
}

function fallbackBullets(change, slide, claims, releaseMode) {
  const claimLimitations = claims.flatMap((claim) => nonEmptyArray(claim.limitations));
  if (claimLimitations.length > 0) return claimLimitations;
  if (slide.narrativeRole === "stakes") {
    return [...(change.userPain ?? []), ...(change.previousState ?? [])];
  }
  if (slide.narrativeRole === "synthesis") return change.decision ?? [];
  if (slide.narrativeRole === "action") {
    return [
      "Inspect the source release",
      "Bring one bounded consequential workflow",
      "Require receipts before accepting the pitch",
    ];
  }
  return [
    slide.audienceQuestion,
    slide.job,
    releaseMode === "final"
      ? "Publication remains a separate receipt gate"
      : "No external publish readiness is asserted",
  ];
}

/** Materialize the deterministic NodeSlide raw spec from the governed story inputs. */
export function buildCampaignDeckSpec({
  change,
  claims: claimsDocument,
  evidenceIndex,
  slidePlans,
  founderQuestScreenshot,
  releaseMode = "draft",
}) {
  assertReleaseMode(releaseMode);
  const finalMode = releaseMode === "final";
  const claimsById = new Map((claimsDocument.claims ?? []).map((claim) => [claim.id, claim]));
  const evidenceById = new Map((evidenceIndex.evidence ?? []).map((entry) => [entry.id, entry]));
  const slides = slidePlans.slides.map((slide, index) => {
    const boundClaims = nonEmptyArray(slide.claimIds).map((id) => claimsById.get(id)).filter(Boolean);
    const planned = boundClaims.some((claim) => claim.status === "planned");
    const body = typeof slide.body === "string" && slide.body.trim()
      ? clip(slide.body, 240)
      : planned
        ? clip(
            finalMode
              ? `Planned only. ${slide.takeaway} Publication remains unverified until public URL receipts exist.`
              : `Planned only. ${slide.takeaway} This draft does not assert hosted or fresh-user proof.`,
            240,
          )
      : boundClaims.length > 0
        ? clip(boundClaims.map((claim) => claim.text).join(" "), 240)
        : contextualBody(change, slide);
    const evidenceBullets = nonEmptyArray(slide.evidenceIds).flatMap((id) => {
      const entry = evidenceById.get(id);
      return entry ? [`${id} · ${entry.scope ?? entry.kind}`] : [];
    });
    const bullets = (Array.isArray(slide.bullets) && slide.bullets.length > 0
      ? slide.bullets
      : evidenceBullets.length > 0
        ? evidenceBullets
        : fallbackBullets(change, slide, boundClaims, releaseMode)
    )
      .map((entry) => clip(entry, 72))
      .filter(Boolean)
      .slice(0, 3);
    while (bullets.length < 3) {
      bullets.push(
        [
          "Evidence stays bound to the exact source",
          "Limitations remain visible",
          finalMode
            ? "Publication remains a separate receipt gate"
            : "External publish readiness remains false",
        ][bullets.length],
      );
    }

    const plannedSlide = {
      body,
      bullets,
      headline: clip(slide.takeaway, 180),
      section: `${String(slide.narrativeRole ?? "story").replaceAll("-", " ")} / ${String(index + 1).padStart(2, "0")}`,
      title: clip(slide.audienceQuestion ?? slide.takeaway, 80),
      ...(slide.metric?.value ? { metric: clip(slide.metric.value, 24) } : {}),
      ...(slide.metric?.label ? { metricLabel: clip(slide.metric.label, 100) } : {}),
      ...(slide.chart
        ? {
            chart: {
              labels: [...slide.chart.labels],
              values: [...slide.chart.values],
              ...(slide.chart.unit ? { unit: slide.chart.unit } : {}),
            },
          }
        : {}),
      ...(slide.formula
        ? {
            formula: {
              description: slide.formula.description,
              display: slide.formula.display,
              expression: slide.formula.expression,
              syntax: "plain",
              variables: [],
            },
          }
        : {}),
    };
    if (slide.id === "S6") {
      const founderQuestClaim = boundClaims.find(
        (claim) => claim.id === "C5_FOUNDER_QUEST_PRODUCT",
      );
      const founderQuestVerified = ["verified", "measured"].includes(
        founderQuestClaim?.status,
      );
      plannedSlide.image = {
        altText: founderQuestVerified
          ? "Founder Quest verified read-only production product view"
          : "Founder Quest product view, draft placeholder",
        caption: founderQuestScreenshot
          ? founderQuestVerified
            ? "Production screenshot; verified scope remains synthetic and read-only."
            : "Draft screenshot; hosted-revision and fresh-user proof remain required."
          : founderQuestVerified
            ? "Verified production proof; product screenshot not embedded."
            : "Draft placeholder; hosted screenshot not supplied.",
        credit: founderQuestVerified
          ? "Synthetic read-only production"
          : "Synthetic draft",
      };
    }
    return plannedSlide;
  });

  return {
    narrative: [
      slidePlans.communicationJob,
      change.decision?.[0],
      finalMode
        ? "Verified product and media artifacts remain distinct from pending publication claims."
        : "Verified product slices remain distinct from pending artifact and publication claims.",
      change.honestLimitations?.[0],
      change.nextMilestone,
    ]
      .filter(Boolean)
      .map((entry) => clip(entry, 180)),
    slides,
    title: finalMode ? change.title : `DRAFT — ${change.title}`,
  };
}

/**
 * NodeSlide deliberately bounds authored media URLs. Campaign screenshots are
 * already byte-bounded and hash-bound inputs, so attach the complete data URL to
 * the materialized snapshot after the authored spec has been safely coerced.
 */
export function attachFounderQuestScreenshot(snapshot, screenshot) {
  if (!screenshot) return null;
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(screenshot.dataUrl)) {
    throw new PresentationGateError(["Founder Quest screenshot is not a supported embedded raster image"]);
  }
  const slide = snapshot?.slides?.[5];
  const elementIds = new Set(slide?.elementOrder ?? []);
  const imageElement = snapshot?.elements?.find(
    (element) => elementIds.has(element.id) && element.kind === "image",
  );
  if (!imageElement) {
    throw new PresentationGateError(["Founder Quest slide has no materialized image element"]);
  }
  imageElement.imageUrl = screenshot.dataUrl;
  imageElement.image = {
    ...(imageElement.image ?? {}),
    placeholder: false,
  };
  imageElement.altText = "Founder Quest verified read-only production product view";
  imageElement.exportCapabilities = [
    "web_native",
    "pptx_static_fallback",
    "google_importable",
  ];
  return imageElement.id;
}

export function parseSpeakerNotes(markdown) {
  const notes = new Map();
  let currentId = null;
  let lines = [];
  const flush = () => {
    if (currentId) notes.set(currentId, lines.join("\n").trim());
    lines = [];
  };
  for (const line of String(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^##\s+(S\d+)\b/.exec(line);
    if (heading) {
      flush();
      currentId = heading[1];
      continue;
    }
    if (currentId) lines.push(line);
  }
  flush();
  return notes;
}

function sortRecords(records, key) {
  return [...records].map(canonicalize).sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

/** Build a deterministic draft or media-bound final presentation receipt. */
export function buildGenerationReceipt({
  artifacts,
  changeId,
  evidence,
  gate,
  generatedAt,
  inputs,
  nodeSlide,
  pptxVerification,
  releaseMode = "draft",
  mediaProof,
  validation,
}) {
  assertReleaseMode(releaseMode);
  const finalMode = releaseMode === "final";
  if (finalMode && (!mediaProof?.receipt?.sha256 || mediaProof?.videos?.length !== 2)) {
    throw new PresentationGateError([
      "final presentation receipt requires a verified receipt hash and exactly two re-hashed videos",
    ]);
  }
  const normalizedArtifacts = sortRecords(artifacts, "path");
  const normalizedInputs = sortRecords(inputs, "path");
  const normalizedEvidence = sortRecords(evidence, "id");
  const identity = {
    artifactHashes: Object.fromEntries(normalizedArtifacts.map((artifact) => [artifact.path, artifact.sha256])),
    changeId,
    inputHashes: Object.fromEntries(normalizedInputs.map((input) => [input.path, input.sha256])),
    nodeSlideCommit: nodeSlide.commit,
    ...(finalMode
      ? {
          mediaReceiptHash: mediaProof.receipt.sha256,
          videoHashes: Object.fromEntries(
            mediaProof.videos.map((video) => [video.profileId, video.sha256]),
          ),
        }
      : {}),
  };
  const receipt = {
    artifacts: normalizedArtifacts,
    changeId,
    evidence: normalizedEvidence,
    ...(finalMode ? { distribution: { status: "not-published" } } : {}),
    externalPublishReady: finalMode,
    gate: canonicalize(gate),
    generatedAt,
    generationIdentity: sha256(canonicalJson(identity)),
    inputs: normalizedInputs,
    ...(finalMode ? { mediaProof: canonicalize(mediaProof) } : {}),
    nodeSlide: canonicalize(nodeSlide),
    pptxVerification: canonicalize(pptxVerification),
    schemaVersion: "nodekit.nodeslide-generation-receipt/v1",
    status: finalMode ? "ready" : "draft",
    validation: canonicalize(validation),
  };
  return {
    ...receipt,
    receiptDigest: sha256(canonicalJson(receipt)),
  };
}
