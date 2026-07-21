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

function reset() {
  demo = createGuidedDemo();
  current = demo.start();
  return view();
}

function view() {
  const snapshot = demo.runtime.snapshot();
  return {
    artifact: snapshot.artifacts[0],
    case: snapshot.cases[0],
    events: snapshot.events,
    proposal: snapshot.proposals.at(-1) ?? null,
    receipt: snapshot.receipts.at(-1) ?? null,
    run: snapshot.runs[0],
  };
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
  if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200, { application: "__APP_NAME__", status: "ok" });
  if (request.method === "GET" && url.pathname === "/api/state") return send(response, 200, view());
  if (request.method === "POST" && url.pathname === "/api/reset") return send(response, 200, reset());
  if (request.method === "POST" && url.pathname === "/api/propose") {
    if (view().proposal?.status === "pending") throw new Error("review the current proposal first");
    demo.propose({ artifactId: current.artifact.artifactId, runId: current.run.runId });
    return send(response, 200, view());
  }
  if (request.method === "POST" && url.pathname === "/api/decide") {
    const input = await body(request);
    const proposal = view().proposal;
    if (!proposal) throw new Error("create a proposal first");
    demo.decide({ decision: input.decision, proposalId: proposal.proposalId, runId: current.run.runId });
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
