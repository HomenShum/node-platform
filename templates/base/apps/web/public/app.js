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
  elements["case-name"].textContent = state.case.title;
  elements["status-label"].textContent = state.run.status.replaceAll("_", " ");
  elements["next-owner"].textContent = state.run.nextActionOwner;
  elements["current-action"].textContent = state.run.nextAction;
  elements["artifact-version"].textContent = `v${state.artifact.canonicalVersion}`;
  elements["artifact-body"].innerHTML = `<p>${escapeText(latest.content.summary ?? JSON.stringify(latest.content))}</p><small>Canonical hash ${latest.contentHash.slice(0, 16)}</small>`;
  elements.progress.innerHTML = state.run.stages.map((stage) => `<div class="step ${stage.status}"><i></i><span>${escapeText(stage.label)}</span></div>`).join("");
  elements.proposal.innerHTML = pending
    ? `<strong>Proposed change</strong><p>${escapeText(state.proposal.patch.summary)}</p><small>Based on artifact v${state.proposal.baseVersion}</small>`
    : `<span>${state.proposal ? `Proposal ${escapeText(state.proposal.status)}.` : "Nothing pending."}</span>`;
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
state = await api("/api/state");
render();
