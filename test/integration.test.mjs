import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Router test server did not become ready");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function waitForLog(logs, predicate) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Timed out waiting for log: ${JSON.stringify(logs)}`)), 1500);
    const check = () => {
      const found = logs.find(predicate);
      if (found) { clearTimeout(deadline); resolve(found); } else setTimeout(check, 10);
    };
    check();
  });
}

test("router keeps forwarding intact and logs confirmed upstream response details", async (t) => {
  const receivedRequests = [];
  const upstream = http.createServer(async (request, response) => {
    const body = await readJson(request);
    receivedRequests.push(body);
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        `data: ${JSON.stringify({ type: "response.created", response: { id: "resp-stream", model: body.model, reasoning: body.reasoning } })}`,
        "",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-stream", model: body.model, reasoning: body.reasoning, usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"));
      return;
    }
    const payload = body.input === "no model"
      ? { id: "resp-unknown", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } }
      : { id: "resp-json", model: body.model, reasoning: body.reasoning, usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  const upstreamPort = await listen(upstream);
  const reserved = http.createServer();
  const routerPort = await listen(reserved);
  await new Promise((resolve) => reserved.close(resolve));
  const child = spawn(process.execPath, [path.join(projectDir, "server.mjs")], { cwd: projectDir, env: { ...process.env, ROUTER_PORT: String(routerPort), ROUTER_UPSTREAM_BASE: `http://127.0.0.1:${upstreamPort}/v1` }, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => chunk.trim().split("\n").filter(Boolean).forEach((line) => { try { logs.push(JSON.parse(line)); } catch { /* startup diagnostics */ } }));
  t.after(async () => { child.kill("SIGTERM"); await new Promise((resolve) => upstream.close(resolve)); });
  await waitForHealth(routerPort);

  const simple = await fetch(`http://127.0.0.1:${routerPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "client-1" }, body: JSON.stringify({ model: "gpt-5.6-router", input: "帮我润色标题" }) });
  assert.equal((await simple.json()).model, "gpt-5.6-luna");
  const jsonLog = await waitForLog(logs, (entry) => entry.event === "response_completed" && entry.upstream_response_id === "resp-json");
  assert.equal(jsonLog.requested_model, "gpt-5.6-router");
  assert.equal(jsonLog.selected_model, "gpt-5.6-luna");
  assert.equal(jsonLog.requested_reasoning_effort, null);
  assert.equal(jsonLog.selected_reasoning_effort, "low");
  assert.equal(jsonLog.upstream_reported_model, "gpt-5.6-luna");
  assert.equal(jsonLog.upstream_reported_reasoning_effort, "low");
  assert.deepEqual(jsonLog.usage, { input_tokens: 5, output_tokens: 3, total_tokens: 8 });
  assert.equal(jsonLog.client_request_id, "client-1");

  const passthrough = await fetch(`http://127.0.0.1:${routerPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-terra", input: "普通任务", reasoning: { effort: "high" } }) });
  assert.equal((await passthrough.json()).model, "gpt-5.6-terra");

  const unknown = await fetch(`http://127.0.0.1:${routerPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-router", input: "no model" }) });
  assert.equal((await unknown.json()).id, "resp-unknown");
  const unknownLog = await waitForLog(logs, (entry) => entry.event === "response_completed" && entry.upstream_response_id === "resp-unknown");
  assert.equal(unknownLog.upstream_reported_model, null);
  assert.deepEqual(unknownLog.usage, { input_tokens: 2, output_tokens: 1, total_tokens: 3 });

  const stream = await fetch(`http://127.0.0.1:${routerPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-router", input: "请做一份 BTC 未来走势预测和投资分析研究报告", stream: true }) });
  const streamText = await stream.text();
  assert.match(streamText, /gpt-5\.6-sol/);
  assert.match(streamText, /\[DONE\]/);
  const streamLog = await waitForLog(logs, (entry) => entry.event === "response_completed" && entry.upstream_response_id === "resp-stream");
  assert.equal(streamLog.selected_model, "gpt-5.6-sol");
  assert.equal(streamLog.selected_reasoning_effort, "high");
  assert.equal(streamLog.upstream_reported_model, "gpt-5.6-sol");
  assert.equal(streamLog.upstream_reported_reasoning_effort, "high");
  assert.deepEqual(streamLog.usage, { input_tokens: 11, output_tokens: 7, total_tokens: 18 });
  assert.equal(streamLog.stream_normal_end, true);
  assert.equal(streamLog.stream_protocol_complete, true);
  assert.deepEqual(receivedRequests.map((entry) => entry.model), ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-terra", "gpt-5.6-sol"]);
  assert.equal(receivedRequests[0].reasoning.effort, "low");
  assert.equal(receivedRequests[1].reasoning.effort, "high");
  assert.equal(receivedRequests[2].reasoning.effort, "medium");
  assert.equal(receivedRequests[3].reasoning.effort, "high");
});
