import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeUpstreamPath,
  normalizeContextLineage,
  normalizeRoutingIntent,
  telemetryConfigEpoch,
} from "../runtime-contracts.mjs";
import { MODEL_AUTO, routeRequest } from "../router.mjs";

test("routing intent is advisory and execution remains separately resolved", () => {
  const routed = routeRequest({
    model: MODEL_AUTO,
    input: "普通任务",
    routing_intent: {
      model_class: "cost-conscious",
      service_tier: "priority",
      cost_latency_posture: "latency",
      fallback_allowed: false,
    },
    context_lineage: {
      agent_path: "root/worker",
      context_window_id: "never-export",
      context_window_count: 2,
      compaction_count: 1,
      context_pressure_peak: 2,
    },
  });

  assert.equal(routed.decision.routingIntent.service_tier, "priority");
  assert.equal(routed.decision.routingIntent.fallback_allowed, false);
  assert.equal(routed.decision.routingResolution.model, routed.body.model);
  assert.equal(routed.decision.contextLineage.context_window_count, 2);
  assert.equal(Object.hasOwn(routed.decision.contextLineage, "context_window_id"), false);
  assert.equal(Object.hasOwn(routed.body, "routing_intent"), false);
  assert.equal(Object.hasOwn(routed.body, "context_lineage"), false);
});

test("telemetry epochs rotate on configuration changes without exporting config", () => {
  const first = telemetryConfigEpoch({ provider: "otlp", mode: "enabled", version: "one" });
  const replay = telemetryConfigEpoch({ provider: "otlp", mode: "enabled", version: "one" });
  const changed = telemetryConfigEpoch({ provider: "otlp", mode: "enabled", version: "two" });
  assert.equal(replay, first);
  assert.ok(changed > first);
});

test("upstream path authorization rejects parser-differential encodings", () => {
  for (const path of [
    "/v1/responses",
    "/v1/models?limit=10",
  ]) assert.equal(assertSafeUpstreamPath(path), path);
  for (const path of [
    "/v1/../secret",
    "/v1/%2e%2e/secret",
    "/v1/%2fsecret",
    "/v1/%25secret",
    "/v1/%ZZ",
    "/v1\\secret",
  ]) {
    assert.throws(() => assertSafeUpstreamPath(path), /UPSTREAM_PATH_INVALID/);
  }
  assert.deepEqual(
    normalizeContextLineage({ context_window_id: "drop", context_pressure_peak: 3 }),
    {
      agent_path: "root",
      context_window_count: 0,
      compaction_count: 0,
      lineage_reset_count: 0,
      inherited_context_events: 0,
      context_pressure_peak: 1,
    },
  );
  assert.deepEqual(
    normalizeRoutingIntent({ fallback_allowed: false, cost_latency_posture: "invalid" }),
    {
      model_class: "auto",
      service_tier: "unspecified",
      cost_latency_posture: "balanced",
      fallback_allowed: false,
    },
  );
});
