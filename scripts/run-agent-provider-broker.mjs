import http from "node:http";
import { Readable } from "node:stream";

const provider = process.env.NODEKIT_BROKER_PROVIDER;
const apiKey = process.env.NODEKIT_BROKER_API_KEY;
const listenHost = process.env.NODEKIT_BROKER_LISTEN_HOST ?? "0.0.0.0";
const listenPort = Number(process.env.NODEKIT_BROKER_LISTEN_PORT ?? 8080);
const maxRequests = Number(process.env.NODEKIT_BROKER_MAX_REQUESTS ?? 128);
const maxRequestBytes = Number(process.env.NODEKIT_BROKER_MAX_REQUEST_BYTES ?? 16 * 1024 * 1024);
const maxResponseBytes = Number(process.env.NODEKIT_BROKER_MAX_RESPONSE_BYTES ?? 32 * 1024 * 1024);
const maxOutputTokens = Number(process.env.NODEKIT_BROKER_MAX_OUTPUT_TOKENS ?? 32_768);
const upstreamTimeoutMs = Number(process.env.NODEKIT_BROKER_UPSTREAM_TIMEOUT_MS ?? 180_000);
const allowedModel = String(process.env.NODEKIT_BROKER_ALLOWED_MODEL ?? "").trim();
const expiresAt = process.env.NODEKIT_BROKER_EXPIRES_AT;
const expiresAtMs = Date.parse(expiresAt ?? "");

if (!new Set(["openai", "anthropic"]).has(provider)) throw new Error("NODEKIT_BROKER_PROVIDER must be openai or anthropic");
if (typeof apiKey !== "string" || apiKey.length < 20) throw new Error("NODEKIT_BROKER_API_KEY must contain one protected provider credential");
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error("invalid broker listen port");
if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1_000) throw new Error("invalid broker request budget");
if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 64 * 1024 * 1024) throw new Error("invalid broker request size budget");
if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64 * 1024 * 1024) throw new Error("invalid broker response size budget");
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 65_536) throw new Error("invalid broker output-token budget");
if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 1_000 || upstreamTimeoutMs > 300_000) throw new Error("invalid broker upstream timeout");
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(allowedModel)) throw new Error("NODEKIT_BROKER_ALLOWED_MODEL must pin one exact model ID");
if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) throw new Error("NODEKIT_BROKER_EXPIRES_AT must be a future timestamp");

const upstreamOrigin = provider === "openai" ? "https://api.openai.com" : "https://api.anthropic.com";
let requestCount = 0;

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function permittedRoute(method, url) {
  if (method === "GET") return /^\/v1\/models(?:[/?]|$)/.test(url);
  if (method !== "POST") return false;
  return provider === "openai" ? url === "/v1/responses" : url === "/v1/messages";
}

function normalizeRequestBody(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("provider request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("provider request body must be one JSON object");
  }
  if (value.model !== allowedModel) {
    throw new Error(`provider request model must equal the campaign-pinned model ${allowedModel}`);
  }
  const tokenField = provider === "openai" ? "max_output_tokens" : "max_tokens";
  if (value[tokenField] !== undefined
    && (!Number.isInteger(value[tokenField]) || value[tokenField] < 1 || value[tokenField] > maxOutputTokens)) {
    throw new Error(`${tokenField} exceeds the protected broker budget`);
  }
  value[tokenField] ??= maxOutputTokens;
  return Buffer.from(JSON.stringify(value), "utf8");
}

const server = http.createServer(async (request, response) => {
  if (Date.now() >= expiresAtMs) {
    sendJson(response, 401, { error: "provider broker credential expired" });
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { expiresAt: new Date(expiresAtMs).toISOString(), provider, status: "ok" });
    return;
  }
  if (!permittedRoute(request.method, request.url ?? "")) {
    sendJson(response, 403, { error: "provider broker route denied" });
    return;
  }
  const placeholderIdentityValid = provider === "openai"
    ? request.headers.authorization === "Bearer broker-managed" && request.headers["x-api-key"] === undefined
    : request.headers["x-api-key"] === "broker-managed" && request.headers.authorization === undefined;
  if (!placeholderIdentityValid
    || request.headers["openai-organization"]
    || request.headers["openai-project"]) {
    sendJson(response, 403, { error: "provider identity headers must use only the protected broker placeholder" });
    return;
  }
  requestCount += 1;
  if (requestCount > maxRequests) {
    sendJson(response, 429, { error: "provider broker request budget exhausted" });
    return;
  }
  let timeout;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > maxRequestBytes) throw new Error("request body exceeded broker limit");
      chunks.push(chunk);
    }
    const requestBody = request.method === "POST" ? normalizeRequestBody(Buffer.concat(chunks)) : undefined;
    const headers = {
      accept: request.headers.accept ?? "application/json",
      "content-type": request.headers["content-type"] ?? "application/json",
      "user-agent": "nodekit-protected-provider-broker/1",
    };
    if (provider === "openai") {
      headers.authorization = `Bearer ${apiKey}`;
      if (request.headers["openai-beta"]) headers["openai-beta"] = request.headers["openai-beta"];
    } else {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = request.headers["anthropic-version"] ?? "2023-06-01";
      if (request.headers["anthropic-beta"]) headers["anthropic-beta"] = request.headers["anthropic-beta"];
    }
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(new Error("provider upstream timed out")), upstreamTimeoutMs);
    const upstream = await fetch(new URL(request.url, upstreamOrigin), {
      body: requestBody,
      headers,
      method: request.method,
      redirect: "error",
      signal: controller.signal,
    });
    const responseHeaders = {};
    for (const name of ["content-type", "openai-request-id", "request-id", "retry-after", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    if (upstream.body) {
      let responseBytes = 0;
      for await (const chunk of Readable.fromWeb(upstream.body)) {
        responseBytes += chunk.length;
        if (responseBytes > maxResponseBytes) {
          controller.abort(new Error("provider response exceeded broker limit"));
          throw new Error("provider response exceeded broker limit");
        }
        response.write(chunk);
      }
    }
    response.end();
  } catch (error) {
    if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
    else sendJson(response, 502, { error: error instanceof Error ? error.message : "provider broker failed" });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

server.listen(listenPort, listenHost);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
