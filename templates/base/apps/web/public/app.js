const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let state;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function render() {
  const pending = state.proposal?.status === "pending";
  const latest = state.artifact.versions.at(-1);
  const scenario = state.presentation?.id ?? "first_arrival";
  document.body.dataset.scenario = scenario;
  document.querySelector(".status").dataset.status = state.run.status;
  elements["state-kind"].textContent = String(state.presentation?.kind ?? "status").replaceAll("_", " ");
  elements["state-title"].textContent = state.presentation?.title ?? "Case status";
  elements["state-message"].textContent = state.presentation?.message ?? "The case state is available.";
  elements["state-banner"].dataset.kind = state.presentation?.kind ?? "status";
  elements["case-name"].textContent = state.case.title;
  elements["status-label"].textContent = state.run.status.replaceAll("_", " ");
  elements["next-owner"].textContent = state.run.nextActionOwner;
  elements["current-action"].textContent = state.run.nextAction;
  elements["artifact-version"].textContent = `v${state.artifact.canonicalVersion}`;
  elements["artifact-body"].innerHTML = `<p>${escapeText(latest.content.summary ?? JSON.stringify(latest.content))}</p><small>Canonical hash ${latest.contentHash.slice(0, 16)}</small>`;
  elements.progress.innerHTML = state.run.stages.map((stage) => `<div class="step ${stage.status}"><i></i><span>${escapeText(stage.label)}</span></div>`).join("");
  elements.proposal.innerHTML = pending
    ? `<strong>Proposed change</strong><p>${escapeText(state.proposal.patch.summary)}</p><small>Based on artifact v${state.proposal.baseVersion} · ${escapeText(state.proposal.rationale)}</small>`
    : `<span>${state.proposal ? `Proposal ${escapeText(state.proposal.status)}.` : "Nothing pending."}</span>`;
  const openException = state.exceptions?.find((entry) => entry.status === "open");
  elements.exception.hidden = !openException;
  elements.exception.innerHTML = openException ? `<strong>${escapeText(openException.code.replaceAll("_", " "))}</strong><p>${escapeText(openException.message)}</p><small>Preserved artifact v${escapeText(openException.preservedState.artifactVersion ?? "current")}</small>` : "";
  const inspectingReceipt = ["receipt_inspection", "export_share"].includes(scenario) && state.receipt;
  elements["receipt-detail"].hidden = !inspectingReceipt;
  elements["receipt-detail"].innerHTML = inspectingReceipt ? `<strong>${scenario === "export_share" ? "Portable proof bundle" : "Receipt contents"}</strong><dl><dt>Receipt</dt><dd>${escapeText(state.receipt.receiptHash)}</dd><dt>Artifacts</dt><dd>${state.receipt.artifactIds.length}</dd><dt>Proposals</dt><dd>${state.receipt.proposalIds.length}</dd><dt>Events</dt><dd>${state.receipt.eventIds.length}</dd></dl>` : "";
  elements["primary-input"].hidden = !["first_arrival", "orientation", "input", "validation_error"].includes(scenario);
  elements.reset.hidden = ["first_arrival", "orientation", "input", "validation_error"].includes(scenario);
  elements.outcome.setAttribute("aria-invalid", scenario === "validation_error" ? "true" : "false");
  elements["input-help"].textContent = scenario === "validation_error" ? "A concrete outcome is required before work can start." : "Saved locally in this deterministic demonstration.";
  elements.propose.disabled = pending || state.run.status === "completed";
  elements.approve.disabled = !pending;
  elements.reject.disabled = !pending;
  elements.completion.hidden = state.run.status !== "completed";
  elements["receipt-id"].textContent = state.receipt ? `Receipt ${state.receipt.receiptHash.slice(0, 16)}` : "No receipt yet";
  elements.events.innerHTML = state.events.slice(-8).reverse().map((event) => `<li><strong>${escapeText(event.eventType)}</strong><span>${escapeText(event.occurredAt)}</span></li>`).join("");
}

function escapeText(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
async function act(path, body = {}) { elements.error.hidden = true; try { state = await api(path, { method: "POST", body: JSON.stringify(body) }); render(); } catch (error) { elements.error.textContent = error.message; elements.error.hidden = false; } }
elements.reset.addEventListener("click", () => act("/api/reset"));
elements.propose.addEventListener("click", () => act("/api/propose"));
elements.approve.addEventListener("click", () => act("/api/decide", { decision: "accepted" }));
elements.reject.addEventListener("click", () => act("/api/decide", { decision: "rejected" }));
elements["primary-input"].addEventListener("submit", (event) => { event.preventDefault(); if (!elements.outcome.value.trim()) { elements.error.textContent = "Add a concrete outcome before continuing."; elements.error.hidden = false; elements.outcome.setAttribute("aria-invalid", "true"); } else { elements.error.hidden = true; elements.outcome.setAttribute("aria-invalid", "false"); } });
const requestedScenario = new URL(window.location.href).searchParams.get("scenario");
const existingState = await api("/api/state");
state = requestedScenario && existingState.presentation?.id !== requestedScenario
  ? await api("/api/scenario", { method: "POST", body: JSON.stringify({ id: requestedScenario }) })
  : existingState;
render();
