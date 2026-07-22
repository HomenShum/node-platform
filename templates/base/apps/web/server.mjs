import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGuidedDemo } from "../../agent/workflow.mjs";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const publicRoot = path.resolve("apps", "web", "public");
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
let demo;
let current;
let presentation;

function reset() {
  demo = createGuidedDemo();
  current = demo.start();
  presentation = {
    id: "first_arrival",
    kind: "orientation",
    message: "Confirm the outcome before the run begins.",
    title: "Ready for your direction",
  };
  return view();
}

function view() {
  const snapshot = demo.runtime.snapshot();
  return {
    artifact: snapshot.artifacts[0],
    approvals: snapshot.approvals,
    case: snapshot.cases[0],
    events: snapshot.events,
    exceptions: snapshot.exceptions,
    presentation,
    proposal: snapshot.proposals.at(-1) ?? null,
    receipt: snapshot.receipts.at(-1) ?? null,
    run: snapshot.runs[0],
  };
}

function setPresentation(id, kind, title, message) {
  presentation = { id, kind, message, title };
}

function prepareProposal() {
  return demo.propose({ artifactId: current.artifact.artifactId, runId: current.run.runId });
}

function loadScenario(id) {
  reset();
  if (id === "first_arrival") return view();
  if (id === "orientation") {
    setPresentation(id, "orientation", "One clear job", "Review the intended outcome, required inputs, and completion promise.");
  } else if (id === "input") {
    setPresentation(id, "input", "Describe the outcome", "The case will not start until its required outcome is present.");
  } else if (id === "validation_error") {
    setPresentation(id, "error", "Outcome required", "Add a concrete outcome so the system can create a bounded case.");
  } else if (id === "running") {
    demo.runtime.enterStage({ runId: current.run.runId, stageId: "working", nextAction: "Prepare the bounded proposal", nextActionOwner: "agent" });
    setPresentation(id, "running", "Work is in progress", "The canonical artifact remains unchanged while the agent prepares a proposal.");
  } else if (id === "partial_result") {
    demo.runtime.enterStage({ runId: current.run.runId, stageId: "working", nextAction: "Validate the partial result", nextActionOwner: "system" });
    setPresentation(id, "partial", "Partial result preserved", "A checkpoint is visible, but it is not yet a proposal or canonical output.");
  } else if (id === "external_wait") {
    demo.runtime.raiseException({ runId: current.run.runId, code: "external_review_wait", message: "Waiting for the external reviewer.", preservedState: { artifactVersion: 1 } });
    setPresentation(id, "waiting", "Waiting on an external reviewer", "The last valid artifact is preserved. No action is required from you yet.");
  } else if (id === "proposal_pending" || id === "approval") {
    prepareProposal();
    setPresentation(id, "review", id === "approval" ? "Your approval is required" : "Proposal ready for review", "Compare the bounded change with the canonical artifact before deciding.");
  } else if (id === "conflict") {
    const winner = demo.runtime.createProposal({ artifactId: current.artifact.artifactId, baseVersion: 1, patch: { summary: "A newer approved result.", status: "accepted" }, rationale: "Create the newer canonical version." });
    const stale = demo.runtime.createProposal({ artifactId: current.artifact.artifactId, baseVersion: 1, patch: { summary: "A stale competing result.", status: "proposed" }, rationale: "Exercise stale-write protection." });
    demo.runtime.decideProposal({ proposalId: winner.proposalId, decision: "accepted" });
    demo.runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" });
    demo.runtime.enterStage({ runId: current.run.runId, stageId: "review", nextAction: "Resolve the version conflict", nextActionOwner: "user" });
    setPresentation(id, "conflict", "Conflict contained", "The stale proposal was not applied. Canonical version 2 remains intact.");
  } else if (id === "recoverable_failure") {
    demo.runtime.raiseException({ runId: current.run.runId, code: "source_unavailable", message: "A required source could not be reached.", preservedState: { artifactVersion: 1 } });
    setPresentation(id, "failure", "Failed safely", "The last valid artifact is preserved. Retry the unavailable source or continue with a warning.");
  } else if (id === "reload_resume") {
    prepareProposal();
    setPresentation(id, "resume", "Run resumed after reload", "The pending proposal and next action survived reload without restarting the case.");
  } else if (["completed_receipt", "receipt_inspection", "export_share"].includes(id)) {
    const proposal = prepareProposal();
    demo.decide({ decision: "accepted", proposalId: proposal.proposalId, runId: current.run.runId });
    const copy = id === "receipt_inspection"
      ? ["Receipt inspection", "Review the bound artifact, proposal, event, and receipt identifiers."]
      : id === "export_share"
        ? ["Ready to export and share", "The canonical artifact and its content-addressed receipt travel together."]
        : ["Completion verified", "The canonical artifact and content-addressed receipt are ready."];
    setPresentation(id, id === "completed_receipt" ? "complete" : id, copy[0], copy[1]);
  } else {
    throw new Error(`unknown browser scenario: ${id}`);
  }
  return view();
}

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "cache-control": "no-store", "content-type": contentType });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200, {
    application: "__APP_NAME__",
    certificationRunId: process.env.NODEKIT_BROWSER_RUN_ID ?? null,
    serverPid: process.pid,
    status: "ok",
  });
  if (request.method === "GET" && url.pathname === "/api/state") return send(response, 200, view());
  if (request.method === "POST" && url.pathname === "/api/reset") return send(response, 200, reset());
  if (request.method === "POST" && url.pathname === "/api/scenario") {
    const input = await body(request);
    return send(response, 200, loadScenario(input.id));
  }
  if (request.method === "POST" && url.pathname === "/api/propose") {
    if (view().proposal?.status === "pending") throw new Error("review the current proposal first");
    prepareProposal();
    setPresentation("proposal_pending", "review", "Proposal ready for review", "Compare the bounded change with the canonical artifact before deciding.");
    return send(response, 200, view());
  }
  if (request.method === "POST" && url.pathname === "/api/decide") {
    const input = await body(request);
    const proposal = view().proposal;
    if (!proposal) throw new Error("create a proposal first");
    demo.decide({ decision: input.decision, proposalId: proposal.proposalId, runId: current.run.runId });
    if (input.decision === "accepted") setPresentation("completed_receipt", "complete", "Completion verified", "The canonical artifact and content-addressed receipt are ready.");
    return send(response, 200, view());
  }
  return false;
}

reset();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? host}`);
    if (url.pathname.startsWith("/api/")) {
      if (await api(request, response, url) !== false) return;
      return send(response, 404, { error: "not found" });
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (relative.includes("..") || path.isAbsolute(relative)) return send(response, 400, "bad path", "text/plain");
    const file = path.join(publicRoot, relative);
    send(response, 200, await readFile(file), types[path.extname(file)] ?? "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(response, 404, "not found", "text/plain");
    send(response, 400, { error: error.message });
  }
});
server.listen(port, host, () => console.log(`__APP_TITLE__ running at http://${host}:${port}`));
