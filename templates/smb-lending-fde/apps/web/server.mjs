import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertLocalExternalModel, assertLocalMutationHost, isLoopbackHost } from "../../backend/authority/local-only.mjs";
import { loadRuntimePolicy } from "../../backend/authority/runtime-policy.mjs";
import { createFileStore } from "../../backend/filesystem/store.mjs";
import { queryProcessGraph } from "../../agent/process-graph.mjs";
import {
  approveProposal,
  createReceipt,
  intervene,
  listSyntheticCases,
  nextDeterministicProposal,
  runExperiment,
  startSession,
} from "../../agent/experiment-loop.mjs";
import { proposeWithPi } from "../../integrations/pi-ai/provider.mjs";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const publicRoot = path.resolve("apps", "web", "public");
const store = createFileStore(path.resolve(".data", "session.json"));
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
let mutationQueue = Promise.resolve();

function serializeMutation(task) {
  const result = mutationQueue.then(task);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "cache-control": "no-store", "content-type": contentType });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64_000) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const policy = await loadRuntimePolicy();
    return send(response, 200, {
      application: "__APP_NAME__",
      livePiEnabled: isLoopbackHost(host) && process.env.NODEKIT_ENABLE_LOCAL_LIVE_PI === "true",
      maxProposalSeconds: policy.maxProposalSeconds,
      status: "ok",
    });
  }
  if (request.method === "GET" && url.pathname === "/api/session") {
    return send(response, 200, { session: await store.load() });
  }
  if (request.method === "GET" && url.pathname === "/api/cases") {
    return send(response, 200, { cases: listSyntheticCases() });
  }
  if (request.method === "POST") assertLocalMutationHost(host);
  if (request.method === "POST" && url.pathname === "/api/start") {
    const input = await body(request);
    return send(response, 200, {
      session: await serializeMutation(() => startSession(store, { caseId: input.caseId, force: Boolean(input.force) })),
    });
  }
  if (request.method === "POST" && url.pathname === "/api/intervene") {
    const input = await body(request);
    return send(response, 200, { session: await serializeMutation(() => intervene(store, input.instruction)) });
  }
  if (request.method === "POST" && url.pathname === "/api/graph-query") {
    const input = await body(request);
    const session = await store.load();
    if (!session) throw new Error("start a session first");
    return send(response, 200, { answer: queryProcessGraph(session, input.operation) });
  }
  if (request.method === "POST" && url.pathname === "/api/step") {
    const input = await body(request);
    if (!new Set(["live", "replay"]).has(input.mode)) throw new Error("mode must be live or replay");
    return send(response, 200, await serializeMutation(async () => {
      const session = await store.load();
      if (!session) throw new Error("start a session first");
      let proposal;
      if (input.mode === "live") {
        if (input.liveConsent !== true) throw new Error("Explicit external-model consent is required before a live Pi proposal.");
        assertLocalExternalModel(host, process.env.NODEKIT_ENABLE_LOCAL_LIVE_PI);
        const policy = await loadRuntimePolicy();
        if (policy.maxModelCallsPerStep < 1) throw new Error("compiled policy disallows model calls for this step");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), policy.maxProposalMs);
        try {
          proposal = {
            ...(await proposeWithPi(session, { signal: controller.signal })),
            consent: {
              grantedAt: new Date().toISOString(),
              scope: "One bounded document-request proposal over synthetic local case metadata.",
              type: "external-model",
            },
          };
        } finally {
          clearTimeout(timeout);
        }
      } else proposal = nextDeterministicProposal(session);
      return runExperiment(store, proposal);
    }));
  }
  if (request.method === "POST" && url.pathname === "/api/approve") {
    const input = await body(request);
    return send(response, 200, { session: await serializeMutation(() => approveProposal(store, input.proposalId)) });
  }
  if (request.method === "GET" && url.pathname === "/api/receipt") {
    const session = await store.load();
    if (!session) throw new Error("start a session first");
    response.setHeader("content-disposition", `attachment; filename=intervene-${session.sessionId}.json`);
    return send(response, 200, await createReceipt(session));
  }
  return false;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (handled !== false) return;
      return send(response, 404, { error: "not found" });
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (relative.includes("..") || path.isAbsolute(relative)) return send(response, 400, "bad path", "text/plain");
    const file = path.join(publicRoot, relative);
    const content = await readFile(file);
    send(response, 200, content, types[path.extname(file)] ?? "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(response, 404, "not found", "text/plain");
    send(response, 400, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Set PORT to another value and retry.`);
  else console.error(error);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`__APP_TITLE__ running at http://${host}:${port}`));
