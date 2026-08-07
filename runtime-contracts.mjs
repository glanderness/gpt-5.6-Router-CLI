import { createHash } from "node:crypto";

const telemetryState = { fingerprint: null, epoch: 0 };
const SERVICE_TIERS = new Set(["default", "priority", "flex", "unspecified"]);
const POSTURES = new Set(["cost", "balanced", "latency"]);

function boundedString(value, fallback = "unspecified") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= 128 ? normalized : fallback;
}

function boundedInteger(value, fallback = 0, maximum = 1_000_000) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) return fallback;
  return Math.min(normalized, maximum);
}

function boundedRatio(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.min(normalized, 1);
}

export function normalizeRoutingIntent(value = {}) {
  const requestedTier = boundedString(value.service_tier);
  return {
    model_class: boundedString(value.model_class, "auto"),
    service_tier: SERVICE_TIERS.has(requestedTier) ? requestedTier : "unspecified",
    cost_latency_posture: POSTURES.has(value.cost_latency_posture)
      ? value.cost_latency_posture
      : "balanced",
    fallback_allowed: value.fallback_allowed !== false,
  };
}

export function normalizeContextLineage(value = {}) {
  return {
    agent_path: boundedString(value.agent_path, "root"),
    context_window_count: boundedInteger(value.context_window_count),
    compaction_count: boundedInteger(value.compaction_count),
    lineage_reset_count: boundedInteger(value.lineage_reset_count),
    inherited_context_events: boundedInteger(value.inherited_context_events),
    context_pressure_peak: boundedRatio(value.context_pressure_peak),
  };
}

export function telemetryConfigEpoch(config = {}) {
  const stableConfig = {
    provider: boundedString(config.provider, "none"),
    mode: boundedString(config.mode, "disabled"),
    version: boundedString(config.version, "0"),
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(stableConfig))
    .digest("hex");
  if (telemetryState.fingerprint !== fingerprint) {
    telemetryState.fingerprint = fingerprint;
    telemetryState.epoch += 1;
  }
  return telemetryState.epoch;
}

export function assertSafeUpstreamPath(pathname) {
  const raw = String(pathname || "");
  if (!raw.startsWith("/")) throw new Error("UPSTREAM_PATH_INVALID");
  if (raw.includes("\\") || /%(?![0-9a-fA-F]{2})/u.test(raw)) {
    throw new Error("UPSTREAM_PATH_INVALID");
  }
  const lowered = raw.toLowerCase();
  if (["%2f", "%5c", "%2e", "%25"].some(marker => lowered.includes(marker))) {
    throw new Error("UPSTREAM_PATH_INVALID");
  }
  const decoded = decodeURIComponent(raw);
  if (
    decoded.includes("\\")
    || decoded.split("/").some(part => part === "." || part === "..")
  ) {
    throw new Error("UPSTREAM_PATH_INVALID");
  }
  return raw;
}

export function telemetryConfigFromEnv(env = process.env) {
  return {
    provider: env.ROUTER_TELEMETRY_PROVIDER,
    mode: env.ROUTER_TELEMETRY_MODE,
    version: env.ROUTER_TELEMETRY_CONFIG_EPOCH,
  };
}

