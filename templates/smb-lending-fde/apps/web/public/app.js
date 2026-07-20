const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let session = null;
let cases = [];
let busy = false;
let capabilities = { livePiEnabled: false, maxProposalSeconds: null };
let graphAnswer = null;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function escapeText(value) { const span = document.createElement("span"); span.textContent = String(value ?? ""); return span.innerHTML; }
function setBusy(value, status = "") {
  busy = value;
  elements["runtime-status"].textContent = status || (session ? `${session.status} · ${session.proposals.length} proposals` : "synthetic local harness ready");
  render();
}
function fail(error) { elements["error-banner"].textContent = error.message; elements["error-banner"].hidden = false; setBusy(false, "action failed"); }
function clearError() { elements["error-banner"].hidden = true; }

function graphState(sessionState) {
  const missing = sessionState.readiness.missingDocumentIds.length > 0;
  const requested = sessionState.readiness.requestedDocumentIds.length > 0;
  return sessionState.graph.nodes.map((node) => ({
    ...node,
    state: node.id === "document-collection" ? (missing ? "blocked" : requested ? "waiting-external" : node.state) : node.state,
  }));
}

function render() {
  const exists = Boolean(session);
  elements["start-button"].textContent = exists ? "Reset synthetic case" : "Load synthetic case";
  elements["case-select"].disabled = busy;
  elements["export-button"].disabled = !exists || busy;
  elements["replay-step"].disabled = !exists || busy;
  elements["live-consent"].disabled = !exists || busy || !capabilities.livePiEnabled;
  elements["live-step"].disabled = !exists || busy || !capabilities.livePiEnabled || !elements["live-consent"].checked;
  elements.intervention.disabled = !exists || busy;
  elements["intervention-form"].querySelector("button").disabled = !exists || busy || !elements.intervention.value.trim();
  if (!exists) return;

  elements["readiness-score"].textContent = `${session.readiness.score}%`;
  elements["missing-count"].textContent = String(session.readiness.missingDocumentIds.length);
  elements["pending-count"].textContent = String(session.proposals.filter((proposal) => proposal.status === "pending_approval").length);
  elements["case-id"].textContent = session.caseId;
  elements["config-hash"].textContent = `config: ${session.configHash.slice(0, 16)}`;
  elements["event-count"].textContent = `${session.events.length} events`;
  elements["live-capability"].textContent = capabilities.livePiEnabled
    ? `Uses the configured OpenRouter model once, within the ${capabilities.maxProposalSeconds}-second compiled policy. It may only propose one missing-document request.`
    : "Local live Pi is disabled by the server. No external model call can start from this lab.";

  elements["quest-list"].innerHTML = graphState(session).map((node) => `
    <li class="quest ${node.state}"><span>${escapeText(node.label)}</span><small>${escapeText(node.state.replaceAll("-", " "))}</small></li>`).join("");
  const highlighted = new Set(graphAnswer?.highlightNodeIds ?? []);
  elements["process-graph"].innerHTML = graphState(session).map((node, index) => `
    <article class="graph-node ${node.state}${highlighted.has(node.id) ? " focused" : ""}"><span class="mono">${String(index + 1).padStart(2, "0")}</span><strong>${escapeText(node.label)}</strong><small>${escapeText(node.state.replaceAll("-", " "))}</small></article>`).join('<span class="graph-arrow" aria-hidden="true">→</span>');
  elements["graph-answer"].innerHTML = graphAnswer
    ? `<strong>${escapeText(graphAnswer.answer)}</strong>${graphAnswer.evidence?.length ? `<small>Evidence: ${graphAnswer.evidence.map((item) => `${escapeText(item.label)} (${escapeText(item.sourceRef?.path ?? "no source")})`).join("; ")}</small>` : ""}`
    : "Choose a question to inspect the bounded local process graph. This is deterministic graph traversal, not a live model answer.";
  elements["document-list"].innerHTML = session.documents.map((document) => `
    <li class="document ${document.status}"><strong>${escapeText(document.label)}</strong><small>${escapeText(document.status)}${document.source ? ` · ${escapeText(document.source)}` : " · no source received"}</small></li>`).join("");

  const pending = session.proposals.find((proposal) => proposal.status === "pending_approval");
  elements["proposal-panel"].innerHTML = pending
    ? `<strong>Review required</strong><p>${escapeText(pending.rationale)}</p><small>Request: ${escapeText(pending.documentId)}</small>${pending.model?.mode === "live" ? `<small>External model: ${escapeText(pending.model.provider)} / ${escapeText(pending.model.id)} | tokens: ${escapeText(pending.usage?.totalTokens ?? "unknown")} | cost: ${escapeText(pending.usage?.costUsd ?? "unknown")}</small>` : "<small>Proposal mode: local deterministic replay</small>"}<button class="button button-dark" id="approve-proposal" ${busy ? "disabled" : ""}>Approve request</button>`
    : "<span>No proposal awaiting review.</span>";
  const approve = document.querySelector("#approve-proposal");
  if (approve) approve.addEventListener("click", () => approveProposal(pending.id));

  elements["activity-list"].innerHTML = session.events.slice(-9).reverse().map((entry) => `
    <li><time>${new Date(entry.at).toLocaleTimeString()}</time><strong>${escapeText(entry.type)}</strong><p>${escapeText(JSON.stringify(entry.details))}</p></li>`).join("");
}

function renderCases() {
  elements["case-select"].innerHTML = cases.map((item) => `<option value="${escapeText(item.caseId)}">${escapeText(item.applicant)} - ${escapeText(item.request)}</option>`).join("");
  if (session) elements["case-select"].value = session.caseId;
}
async function load() {
  const [healthPayload, sessionPayload, casesPayload] = await Promise.all([api("/api/health"), api("/api/session"), api("/api/cases")]);
  capabilities = healthPayload;
  session = sessionPayload.session;
  cases = casesPayload.cases;
  renderCases();
  render();
}
async function start() {
  clearError();
  setBusy(true, "loading synthetic bank file");
  try {
    graphAnswer = null;
    session = (await api("/api/start", {
      method: "POST",
      body: JSON.stringify({ caseId: elements["case-select"].value, force: true }),
    })).session;
    renderCases();
    setBusy(false);
  } catch (error) { fail(error); }
}
async function askGraph(operation) {
  clearError();
  setBusy(true, "querying the local process graph");
  try {
    graphAnswer = (await api("/api/graph-query", { method: "POST", body: JSON.stringify({ operation }) })).answer;
    setBusy(false);
  } catch (error) { fail(error); }
}
async function step(mode) {
  clearError();
  setBusy(true, mode === "live" ? "Pi is proposing one bounded document action" : "finding a safe next action");
  try {
    session = (await api("/api/step", {
      method: "POST",
      body: JSON.stringify({ mode, liveConsent: mode === "live" && elements["live-consent"].checked }),
    })).session;
    setBusy(false);
  } catch (error) { fail(error); }
}
async function approveProposal(proposalId) { clearError(); setBusy(true, "applying human-approved document request"); try { session = (await api("/api/approve", { method: "POST", body: JSON.stringify({ proposalId }) })).session; setBusy(false); } catch (error) { fail(error); } }

elements["start-button"].addEventListener("click", start);
elements["replay-step"].addEventListener("click", () => step("replay"));
elements["live-step"].addEventListener("click", () => step("live"));
for (const button of document.querySelectorAll("[data-graph-operation]")) {
  button.addEventListener("click", () => askGraph(button.dataset.graphOperation));
}
elements["live-consent"].addEventListener("change", render);
elements.intervention.addEventListener("input", () => { elements["character-count"].textContent = `${elements.intervention.value.length} / 280`; render(); });
elements["intervention-form"].addEventListener("submit", async (event) => {
  event.preventDefault(); clearError(); setBusy(true, "recording deployment constraint");
  try { session = (await api("/api/intervene", { method: "POST", body: JSON.stringify({ instruction: elements.intervention.value }) })).session; elements.intervention.value = ""; elements["character-count"].textContent = "0 / 280"; setBusy(false); } catch (error) { fail(error); }
});
elements["export-button"].addEventListener("click", () => { window.location.href = "/api/receipt"; });
load().catch(fail);
