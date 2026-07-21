const controls = {
  reference: document.querySelector("#reference"),
  receipt: document.querySelector("#receipt"),
  start: document.querySelector("#start"),
  unsafe: document.querySelector("#unsafe"),
};

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "request failed");
  return data;
}

function eventLabel(event) {
  const details = event.details ?? {};
  const suffix = details.taskId ? ` · ${details.taskId}` : details.violation ? ` · ${details.violation}` : "";
  return `${event.type}${suffix}`;
}

function setEnabled(enabled) {
  controls.unsafe.disabled = !enabled;
  controls.reference.disabled = !enabled;
  controls.receipt.classList.toggle("disabled", !enabled);
  controls.receipt.setAttribute("aria-disabled", String(!enabled));
}

function render(session) {
  const status = document.querySelector("#session-status");
  const decision = document.querySelector("#decision");
  const best = document.querySelector("#best-reward");
  const count = document.querySelector("#run-count");
  const events = document.querySelector("#events");
  if (!session) {
    status.textContent = "No replay session loaded.";
    setEnabled(false);
    return;
  }
  status.textContent = `Session ${session.sessionId.slice(0, 8)} · ${session.status}`;
  best.textContent = String(session.best.reward);
  count.textContent = String(session.runs.length);
  const latest = session.runs.at(-1);
  decision.textContent = latest
    ? `${latest.decision.toUpperCase()} · ${latest.taskId} · reward ${latest.result.reward}`
    : "Waiting for a local run";
  events.replaceChildren(...session.events.slice(-6).reverse().map((event) => {
    const item = document.createElement("li");
    item.textContent = eventLabel(event);
    return item;
  }));
  setEnabled(true);
}

async function refresh() {
  const { session } = await request("/api/session");
  render(session);
}

async function mutate(url, payload) {
  try {
    const result = await request(url, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    render(result.session ?? result.session?.session ?? await request("/api/session").then((value) => value.session));
  } catch (error) {
    document.querySelector("#session-status").textContent = `Error: ${error.message}`;
  }
}

controls.start.addEventListener("click", () => mutate("/api/start", { force: true }));
controls.unsafe.addEventListener("click", () => mutate("/api/step", { mode: "unsafe-fixture" }));
controls.reference.addEventListener("click", () => mutate("/api/step", { mode: "protected-reference" }));
refresh().catch((error) => { document.querySelector("#session-status").textContent = `Error: ${error.message}`; });
