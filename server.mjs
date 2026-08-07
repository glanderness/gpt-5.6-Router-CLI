import crypto from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { resolveAuthConfig } from "./auth-config.mjs";
import { discoverCodexUpstream } from "./codex-upstream-config.mjs";
import { MODEL_AUTO, routeRequest } from "./router.mjs";
import {
  assertSafeUpstreamPath,
  telemetryConfigEpoch,
  telemetryConfigFromEnv,
} from "./runtime-contracts.mjs";

const configuredHost = process.env.ROUTER_HOST || "127.0.0.1";
const host = configuredHost === "localhost" ? "127.0.0.1" : configuredHost;
const port = Number(process.env.ROUTER_PORT || 8788);
const serverScriptPath = fileURLToPath(import.meta.url);
let authConfig = null;
let upstreamBase = null;
let upstreamConfigurationError = null;
try {
  authConfig = resolveAuthConfig(
    process.env,
    discoverCodexUpstream(process.env, process.env.ROUTER_CODEX_CWD || process.cwd()),
  );
  upstreamBase = authConfig.upstreamBase;
} catch (error) {
  upstreamConfigurationError = error?.message || String(error);
}
const logRequests = process.env.ROUTER_LOG_REQUESTS === "1";
const logTaskPreview = process.env.ROUTER_LOG_TASK_PREVIEW === "1";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function log(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}

function routerModelFrom(source = {}) {
  return { ...source, id: MODEL_AUTO, slug: MODEL_AUTO, display_name: "GPT5.6-Router", name: "GPT5.6-Router", description: "GPT5.6-Router automatically selects Luna, Terra, or Sol based on task complexity.", object: source.object || "model", owned_by: source.owned_by || "local-router" };
}

function appendRouterModel(payload) {
  if (Array.isArray(payload)) {
    if (payload.some((item) => item?.id === MODEL_AUTO || item?.slug === MODEL_AUTO)) return payload;
    const source = payload.find((item) => item?.id === "gpt-5.6-sol" || item?.slug === "gpt-5.6-sol");
    return [routerModelFrom(source), ...payload];
  }
  if (Array.isArray(payload?.data)) {
    if (payload.data.some((item) => item?.id === MODEL_AUTO || item?.slug === MODEL_AUTO)) return payload;
    const source = payload.data.find((item) => item?.id === "gpt-5.6-sol" || item?.slug === "gpt-5.6-sol");
    return { ...payload, data: [routerModelFrom(source), ...payload.data] };
  }
  return payload;
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function upstreamUrl(pathname) {
  assertSafeUpstreamPath(pathname);
  return `${upstreamBase}${pathname.replace(/^\/v1(?=\/|$)/, "")}`;
}

function forwardedHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (value == null || normalizedKey === "host" || normalizedKey === "content-length" || HOP_BY_HOP_HEADERS.has(normalizedKey)) continue;
    result[key] = value;
  }
  return result;
}

function responseHeaders(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey !== "content-length" && normalizedKey !== "content-encoding" && !HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      result[key] = value;
    }
  }
  return result;
}

function errorCauseDetails(error) {
  const cause = error?.cause;
  return {
    error_cause_code: typeof cause?.code === "string" ? cause.code : null,
    error_cause_message: typeof cause?.message === "string" ? cause.message : null,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function safeString(value) {
  return typeof value === "string" && value.length <= 256 ? value : null;
}

function correlationFrom(request, body) {
  const headers = request.headers;
  return {
    request_id: crypto.randomUUID(),
    client_request_id: safeString(headers["x-request-id"]) || safeString(headers["x-correlation-id"]),
    session_id: safeString(headers["x-session-id"]) || safeString(body?.session_id) || safeString(body?.conversation_id),
    turn_id: safeString(headers["x-turn-id"]) || safeString(body?.previous_response_id),
  };
}

function responseDetails(payload) {
  const response = payload?.response && typeof payload.response === "object" ? payload.response : payload;
  return {
    upstream_reported_model: typeof response?.model === "string" ? response.model : null,
    upstream_reported_reasoning_effort: typeof response?.reasoning?.effort === "string"
      ? response.reasoning.effort
      : (typeof response?.reasoning_effort === "string" ? response.reasoning_effort : null),
    upstream_response_id: typeof response?.id === "string" ? response.id : null,
    usage: response?.usage && typeof response.usage === "object" ? response.usage : null,
    observed_execution: {
      model: typeof response?.model === "string" ? response.model : null,
      reasoning_effort: typeof response?.reasoning?.effort === "string"
        ? response.reasoning.effort
        : (typeof response?.reasoning_effort === "string" ? response.reasoning_effort : null),
    },
  };
}

function parseSseChunk(state, text) {
  state.buffer += text;
  const messages = state.buffer.split(/\r?\n\r?\n/);
  state.buffer = messages.pop() || "";
  for (const message of messages) {
    const data = message.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") { state.saw_done = true; continue; }
    try {
      const payload = JSON.parse(data);
      const event = payload?.type || "";
      if (event === "response.completed" || event === "response.done" || payload?.response) state.saw_completion_event = true;
      const details = responseDetails(payload);
      if (details.upstream_reported_model !== null) {
        state.details.upstream_reported_model = details.upstream_reported_model;
        state.details.observed_execution.model = details.upstream_reported_model;
      }
      if (details.upstream_reported_reasoning_effort !== null) {
        state.details.upstream_reported_reasoning_effort = details.upstream_reported_reasoning_effort;
        state.details.observed_execution.reasoning_effort = details.upstream_reported_reasoning_effort;
      }
      if (details.upstream_response_id !== null) state.details.upstream_response_id = details.upstream_response_id;
      if (details.usage !== null) state.details.usage = details.usage;
    } catch { state.parse_errors += 1; }
  }
}

async function forwardSse(upstreamResponse, response, record, startedAt) {
  const decoder = new TextDecoder();
  const reader = upstreamResponse.body.getReader();
  const state = { buffer: "", saw_done: false, saw_completion_event: false, parse_errors: 0, details: responseDetails({}) };
  let firstByteMs = null;
  let clientDisconnected = false;
  const onClose = () => { if (!response.writableEnded) clientDisconnected = true; };
  response.once("close", onClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs === null) firstByteMs = Date.now() - startedAt;
      parseSseChunk(state, decoder.decode(value, { stream: true }));
      if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once("drain", resolve));
      if (clientDisconnected) { await reader.cancel(); break; }
    }
    parseSseChunk(state, decoder.decode());
    if (!response.writableEnded) response.end();
    log("response_completed", { ...record, ...state.details, upstream_status: upstreamResponse.status, total_duration_ms: Date.now() - startedAt, first_byte_ms: firstByteMs, stream: true, stream_normal_end: !clientDisconnected, stream_protocol_complete: state.saw_done || state.saw_completion_event, sse_parse_errors: state.parse_errors, error_type: clientDisconnected ? "client_disconnected" : null });
  } catch (error) {
    if (!response.writableEnded) response.end();
    log("response_failed", { ...record, upstream_status: upstreamResponse.status, total_duration_ms: Date.now() - startedAt, first_byte_ms: firstByteMs, stream: true, stream_normal_end: false, error_type: clientDisconnected ? "client_disconnected" : "stream_forward_error", error_message: error?.message || String(error), ...errorCauseDetails(error) });
  } finally { response.removeListener("close", onClose); }
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  let record = null;
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (logRequests) log("request_received", { method: request.method, path: url.pathname });
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "gpt5.6-router",
        scriptPath: serverScriptPath,
        processId: process.pid,
        authMode: authConfig?.selectedMode || null,
        authSource: authConfig?.authSource || null,
        codexLoginMode: authConfig?.codexLoginMode || null,
        upstreamBase,
        upstreamConfigured: Boolean(upstreamBase),
        configurationError: upstreamConfigurationError,
      });
    }
    if (request.method === "POST" && url.pathname === "/router/decision") {
      const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      return sendJson(response, 200, routeRequest({ ...payload, model: MODEL_AUTO, input: payload.input || "" }).decision);
    }

    if (!upstreamBase) {
      return sendJson(response, 503, { error: { type: "router_configuration_error", message: upstreamConfigurationError } });
    }

    const raw = await readBody(request);
    let parsed = null;
    let outgoingBody = raw;
    if (request.method === "POST" && url.pathname === "/v1/responses" && raw.length) {
      parsed = JSON.parse(raw.toString("utf8"));
      const routed = routeRequest(parsed);
      outgoingBody = Buffer.from(JSON.stringify(routed.body));
      const requestedReasoningEffort = typeof parsed?.reasoning?.effort === "string"
        ? parsed.reasoning.effort
        : (typeof parsed?.reasoning_effort === "string" ? parsed.reasoning_effort : null);
      record = {
        ...correlationFrom(request, parsed),
        method: request.method,
        path: url.pathname,
        requested_model: typeof parsed.model === "string" ? parsed.model : null,
        selected_model: routed.decision?.selectedModel || (typeof parsed.model === "string" ? parsed.model : null),
        requested_reasoning_effort: requestedReasoningEffort,
        selected_reasoning_effort: routed.decision?.reasoningEffort || requestedReasoningEffort,
        routing_mode: routed.decision?.mode || "passthrough",
        routing_classified_mode: routed.decision?.classifiedMode || null,
        routing_score: routed.decision?.score ?? null,
        routing_confidence: routed.decision?.confidence ?? null,
        routing_classification_path: routed.decision?.classificationPath || null,
        routing_luna_eligibility: routed.decision?.lunaEligibility || null,
        routing_ambiguity_fallback: routed.decision?.ambiguityFallback ?? false,
        routing_capability_fallback: routed.decision?.capabilityFallback ?? false,
        routing_version: routed.decision?.classificationVersion || null,
        routing_intent: routed.decision?.routingIntent || null,
        routing_resolution: routed.decision?.routingResolution || null,
        context_lineage: routed.decision?.contextLineage || null,
        telemetry_config_epoch: telemetryConfigEpoch(telemetryConfigFromEnv()),
      };
      log("request_started", record);
      if (routed.decision) {
        log("routing_decision", {
          ...record,
          routing_reason: routed.decision.reason,
          routing_signals: routed.decision.signals,
          routing_signal_details: routed.decision.signalDetails,
          routing_classification_path: routed.decision.classificationPath,
          routing_luna_eligibility: routed.decision.lunaEligibility,
          routing_features: routed.decision.features,
          routing_minimum_mode: routed.decision.minimumMode,
          routing_policy_reason: routed.decision.policyReason,
          routing_required_capabilities: routed.decision.requiredCapabilities,
          routing_candidate_models: routed.decision.candidateModels,
          routing_excluded_candidates: routed.decision.excludedCandidates,
          ...(logTaskPreview ? { task_preview: routed.decision.preview } : {}),
        });
      }
    }

    const upstreamResponse = await fetch(upstreamUrl(url.pathname + url.search), { method: request.method, headers: forwardedHeaders(request.headers), body: ["GET", "HEAD"].includes(request.method) ? undefined : outgoingBody, redirect: "manual" });
    // For non-streaming replies, fetch resolves when upstream response headers are available.
    // It is the closest portable first-byte timing available without buffering the client reply.
    const upstreamHeadersMs = Date.now() - startedAt;
    if (request.method === "GET" && url.pathname === "/v1/models" && upstreamResponse.ok && (upstreamResponse.headers.get("content-type") || "").includes("application/json")) {
      response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
      return response.end(JSON.stringify(appendRouterModel(await upstreamResponse.json())));
    }
    response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
    if (record && (parsed?.stream === true || (upstreamResponse.headers.get("content-type") || "").includes("text/event-stream"))) return forwardSse(upstreamResponse, response, record, startedAt);
    if (record) {
      const bytes = upstreamResponse.body ? Buffer.from(await upstreamResponse.arrayBuffer()) : Buffer.alloc(0);
      let details = responseDetails({});
      try { details = responseDetails(JSON.parse(bytes.toString("utf8"))); } catch { /* non-JSON upstream replies are still forwarded unchanged */ }
      response.end(bytes);
      log("response_completed", { ...record, ...details, upstream_status: upstreamResponse.status, total_duration_ms: Date.now() - startedAt, first_byte_ms: upstreamHeadersMs, stream: false, stream_normal_end: true, error_type: upstreamResponse.ok ? null : "upstream_http_error" });
      return;
    }
    if (!upstreamResponse.body) return response.end();
    Readable.fromWeb(upstreamResponse.body).pipe(response);
  } catch (error) {
    log("response_failed", { ...(record || {}), upstream_status: null, total_duration_ms: Date.now() - startedAt, stream: false, stream_normal_end: false, error_type: error instanceof SyntaxError ? "invalid_request_json" : "upstream_request_error", error_message: error?.message || String(error), ...errorCauseDetails(error) });
    if (!response.headersSent) sendJson(response, 502, { error: { message: "Local router request failed" } }); else response.end();
  }
});

server.listen(port, host, () => log("server_started", {
  host,
  port,
  script_path: serverScriptPath,
  auth_mode: authConfig?.selectedMode || null,
  auth_source: authConfig?.authSource || null,
  codex_login_mode: authConfig?.codexLoginMode || null,
  upstream_base: upstreamBase,
  upstream_configured: Boolean(upstreamBase),
  configuration_error: upstreamConfigurationError,
}));
