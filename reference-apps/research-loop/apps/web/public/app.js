const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let session = null;
let busy = false;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function metric(value) { return Number.isFinite(value) ? value.toFixed(4) : "—"; }
function escapeText(value) { const span = document.createElement("span"); span.textContent = String(value ?? ""); return span.innerHTML; }
function setBusy(value, status = "") {
  busy = value;
  elements["runtime-status"].textContent = status || (session ? `${session.status} · ${session.experiments.length} experiments` : "local harness ready");
  render();
}
function fail(error) { elements["error-banner"].textContent = error.message; elements["error-banner"].hidden = false; setBusy(false, "action failed"); }
function clearError() { elements["error-banner"].hidden = true; }

function render() {
  const exists = Boolean(session);
  elements["start-button"].textContent = exists ? "Reset clean session" : "Start clean session";
  elements["export-button"].disabled = !exists || busy;
  elements["replay-step"].disabled = !exists || busy;
  elements["live-step"].disabled = !exists || busy;
  elements.intervention.disabled = !exists || busy;
  elements["intervention-form"].querySelector("button").disabled = !exists || busy || !elements.intervention.value.trim();
  if (!exists) return;

  elements["baseline-metric"].textContent = metric(session.baseline.heldoutBitsPerCharacter);
  elements["best-metric"].textContent = metric(session.best.heldoutBitsPerCharacter);
  const improvement = session.baseline.heldoutBitsPerCharacter - session.best.heldoutBitsPerCharacter;
  elements["delta-metric"].textContent = improvement > 0 ? `−${improvement.toFixed(4)}` : "0.0000";
  elements["session-id"].textContent = session.sessionId;
  elements["config-hash"].textContent = `config: ${session.configHash.slice(0, 16)}`;
  elements["event-count"].textContent = `${session.events.length} events`;
  elements["latest-intervention"].innerHTML = session.intervention
    ? `<strong>Direction v${session.intervention.version}</strong><br>${escapeText(session.intervention.instruction)}`
    : "<span>No intervention yet.</span>";

  elements["experiment-rows"].innerHTML = session.experiments.length ? session.experiments.map((experiment, index) => `
    <tr>
      <td class="mono">${String(index + 1).padStart(2, "0")}</td>
      <td>${escapeText(experiment.hypothesis)}${experiment.intervention ? `<br><small>↳ v${experiment.intervention.version}: ${escapeText(experiment.intervention.instruction)}</small>` : ""}</td>
      <td class="mono">order ${experiment.candidate.order}<br>α ${experiment.candidate.alpha}</td>
      <td class="mono">${metric(experiment.result.heldoutBitsPerCharacter)}</td>
      <td class="mono">${experiment.delta > 0 ? "+" : ""}${experiment.delta.toFixed(4)}</td>
      <td><span class="decision ${experiment.decision}">${experiment.decision}</span></td>
    </tr>`).join("") : '<tr class="empty-row"><td colspan="6">Baseline established. Run the first experiment.</td></tr>';
  elements["activity-list"].innerHTML = session.events.slice(-9).reverse().map((entry) => `
    <li><time>${new Date(entry.at).toLocaleTimeString()}</time><strong>${escapeText(entry.type)}</strong><p>${escapeText(JSON.stringify(entry.details))}</p></li>`).join("");
}

async function load() { const payload = await api("/api/session"); session = payload.session; render(); }
async function start() { clearError(); setBusy(true, "establishing baseline"); try { session = (await api("/api/start", { method: "POST", body: JSON.stringify({ force: Boolean(session) }) })).session; setBusy(false); } catch (error) { fail(error); } }
async function step(mode) { clearError(); setBusy(true, mode === "live" ? "Pi is proposing one experiment" : "replaying bounded proposal"); try { session = (await api("/api/step", { method: "POST", body: JSON.stringify({ mode }) })).session; setBusy(false); } catch (error) { fail(error); } }

elements["start-button"].addEventListener("click", start);
elements["replay-step"].addEventListener("click", () => step("replay"));
elements["live-step"].addEventListener("click", () => step("live"));
elements.intervention.addEventListener("input", () => { elements["character-count"].textContent = `${elements.intervention.value.length} / 280`; render(); });
elements["intervention-form"].addEventListener("submit", async (event) => {
  event.preventDefault(); clearError(); setBusy(true, "recording human direction");
  try { session = (await api("/api/intervene", { method: "POST", body: JSON.stringify({ instruction: elements.intervention.value }) })).session; elements.intervention.value = ""; elements["character-count"].textContent = "0 / 280"; setBusy(false); } catch (error) { fail(error); }
});
elements["export-button"].addEventListener("click", () => { window.location.href = "/api/receipt"; });
load().catch(fail);
