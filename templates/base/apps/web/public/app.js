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
  const conflicted = state.proposal?.status === "conflicted";
  const rejected = state.proposal?.status === "rejected";
  const completed = state.run.status === "completed";
  const openException = state.exceptions?.find((entry) => entry.status === "open");
  const latest = state.artifact.versions.at(-1);
  const scenario = state.presentation?.id ?? "first_arrival";
  const intake = ["first_arrival", "orientation", "input", "validation_error"].includes(scenario);
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
    : `<span>${state.proposal ? `Proposal ${escapeText(state.proposal.status)}.` : "No proposal yet."}</span>`;
  elements.proposal.hidden = intake && !state.proposal;
  elements.exception.hidden = !openException;
  elements.exception.innerHTML = openException ? `<strong>${escapeText(openException.code.replaceAll("_", " "))}</strong><p>${escapeText(openException.message)}</p><small>Preserved artifact v${escapeText(openException.preservedState.artifactVersion ?? "current")}</small>` : "";
  const inspectingReceipt = ["receipt_inspection", "export_share"].includes(scenario) && state.receipt;
  elements["receipt-detail"].hidden = !inspectingReceipt;
  elements["receipt-detail"].innerHTML = inspectingReceipt ? `<strong>${scenario === "export_share" ? "Portable proof bundle" : "Receipt contents"}</strong><dl><dt>Receipt</dt><dd>${escapeText(state.receipt.receiptHash)}</dd><dt>Artifacts</dt><dd>${state.receipt.artifactIds.length}</dd><dt>Proposals</dt><dd>${state.receipt.proposalIds.length}</dd><dt>Events</dt><dd>${state.receipt.eventIds.length}</dd></dl>` : "";
  elements["receipt-actions"].hidden = scenario !== "export_share" || !state.receipt;
  elements["primary-input"].hidden = !intake;
  elements.reset.hidden = intake;
  elements.outcome.setAttribute("aria-invalid", scenario === "validation_error" ? "true" : "false");
  elements["input-help"].textContent = scenario === "validation_error" ? "A concrete outcome is required before work can start." : "Saved locally in this deterministic demonstration.";
  const reviewState = completed
    ? ["VERIFIED RESULT", "Completion evidence", "The accepted artifact and its content-addressed receipt are canonical and ready to inspect."]
    : conflicted
      ? ["CONFLICT CONTAINED", "Resolve version conflict", "A stale proposal was blocked. Continue from the latest canonical artifact without overwriting it."]
      : openException
        ? scenario === "external_wait"
          ? ["WAITING SAFELY", "External reviewer owns the next action", "The last valid artifact is preserved. You can leave and return without losing progress."]
          : ["RECOVERY REQUIRED", "Resume from preserved state", "The failure is contained. Resume only the interrupted step; the canonical artifact remains intact."]
        : pending
          ? ["DECISION REQUIRED", "Review proposed change", "No generated work becomes canonical until you approve this bounded proposal."]
          : rejected
            ? ["DECISION RECORDED", "Prepare a revised proposal", "The rejected change was not applied. The canonical artifact remains intact."]
            : intake
              ? ["NEXT STEP", "Confirm the intended outcome", "Use the primary input to confirm the job before any agent work begins."]
              : ["NEXT STEP", "Prepare a reviewable change", "The canonical artifact stays unchanged until a proposal is ready for review."];
  elements["review-eyebrow"].textContent = reviewState[0];
  elements["review-title"].textContent = reviewState[1];
  elements["review-copy"].textContent = reviewState[2];
  const canPropose = !intake && !pending && !conflicted && !openException && !completed;
  elements.propose.hidden = !canPropose;
  elements.propose.disabled = !canPropose;
  elements.approve.hidden = !pending;
  elements.approve.disabled = !pending;
  elements.reject.hidden = !pending;
  elements.reject.disabled = !pending;
  elements.resume.hidden = !(openException && scenario !== "external_wait");
  elements["resolve-conflict"].hidden = !conflicted;
  const actionState = pending ? "pending" : conflicted ? "conflict" : openException && scenario !== "external_wait" ? "recovery" : canPropose ? "propose" : "none";
  document.body.dataset.actionState = actionState;
  elements["mobile-action"].hidden = actionState === "none";
  elements["mobile-action-title"].textContent = reviewState[1];
  elements["mobile-propose"].hidden = actionState !== "propose";
  elements["mobile-approve"].hidden = actionState !== "pending";
  elements["mobile-reject"].hidden = actionState !== "pending";
  elements["mobile-resume"].hidden = actionState !== "recovery";
  elements["mobile-resolve-conflict"].hidden = actionState !== "conflict";
  elements.completion.hidden = !completed;
  elements["receipt-id"].textContent = state.receipt ? `Receipt ${state.receipt.receiptHash.slice(0, 16)}` : "No receipt yet";
  elements.events.innerHTML = state.events.slice(-8).reverse().map((event) => `<li><strong>${escapeText(event.eventType)}</strong><span>${escapeText(event.occurredAt)}</span></li>`).join("");
}

function escapeText(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
async function act(path, body = {}) { elements.error.hidden = true; try { state = await api(path, { method: "POST", body: JSON.stringify(body) }); render(); } catch (error) { elements.error.textContent = error.message; elements.error.hidden = false; } }
elements.reset.addEventListener("click", () => act("/api/reset"));
elements.propose.addEventListener("click", () => act("/api/propose"));
elements["mobile-propose"].addEventListener("click", () => act("/api/propose"));
elements.approve.addEventListener("click", () => act("/api/decide", { decision: "accepted" }));
elements.reject.addEventListener("click", () => act("/api/decide", { decision: "rejected" }));
elements.resume.addEventListener("click", () => act("/api/recover"));
elements["resolve-conflict"].addEventListener("click", () => act("/api/resolve-conflict"));
elements["mobile-approve"].addEventListener("click", () => act("/api/decide", { decision: "accepted" }));
elements["mobile-reject"].addEventListener("click", () => act("/api/decide", { decision: "rejected" }));
elements["mobile-resume"].addEventListener("click", () => act("/api/recover"));
elements["mobile-resolve-conflict"].addEventListener("click", () => act("/api/resolve-conflict"));
elements["review-tab"].addEventListener("click", () => {
  elements.activity.open = false;
  elements["review-tab"].classList.add("active");
  elements["activity-tab"].classList.remove("active");
  elements["review-tab"].setAttribute("aria-pressed", "true");
  elements["activity-tab"].setAttribute("aria-pressed", "false");
  elements["review-title"].focus({ preventScroll: true });
});
elements["activity-tab"].addEventListener("click", () => {
  elements.activity.open = true;
  elements["activity-tab"].classList.add("active");
  elements["review-tab"].classList.remove("active");
  elements["activity-tab"].setAttribute("aria-pressed", "true");
  elements["review-tab"].setAttribute("aria-pressed", "false");
  elements.activity.scrollIntoView({ behavior: "smooth", block: "nearest" });
  elements.activity.querySelector("summary").focus({ preventScroll: true });
});
elements["copy-share"].addEventListener("click", async () => {
  const summary = `${state.case.title}: artifact v${state.artifact.canonicalVersion}, receipt ${state.receipt?.receiptHash ?? "unavailable"}`;
  try {
    await navigator.clipboard.writeText(summary);
    elements["copy-status"].textContent = "Share summary copied.";
  } catch {
    elements["copy-status"].textContent = summary;
  }
});
elements["primary-input"].addEventListener("submit", (event) => { event.preventDefault(); const outcome = elements.outcome.value.trim(); if (!outcome) { elements.error.textContent = "Add a concrete outcome before continuing."; elements.error.hidden = false; elements.outcome.setAttribute("aria-invalid", "true"); } else { elements.outcome.setAttribute("aria-invalid", "false"); act("/api/confirm", { outcome }); } });
const requestedScenario = new URL(window.location.href).searchParams.get("scenario");
const existingState = await api("/api/state");
state = requestedScenario && existingState.presentation?.id !== requestedScenario
  ? await api("/api/scenario", { method: "POST", body: JSON.stringify({ id: requestedScenario }) })
  : existingState;
render();
