export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

const AUTH_MODE_ALIASES = new Map([
  ["auto", "auto"],
  ["openai", "openai"],
  ["chatgpt", "openai"],
  ["provider_key", "provider_key"],
  ["api_key", "provider_key"],
  ["third_party", "provider_key"],
]);

function normalizeAuthMode(value) {
  const requested = String(value || "auto").trim().toLowerCase();
  const normalized = AUTH_MODE_ALIASES.get(requested);
  if (!normalized) {
    throw new Error("ROUTER_AUTH_MODE must be auto, openai, or provider_key.");
  }
  return normalized;
}

function normalizeProviderKeyEnv(value) {
  const name = String(value || "ROUTER_API_KEY").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("ROUTER_API_KEY_ENV must be a valid environment variable name.");
  }
  return name;
}

function normalizeUpstreamBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ROUTER_UPSTREAM_BASE must be a valid http or https URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("ROUTER_UPSTREAM_BASE must be a valid http or https URL.");
  }
  return raw.replace(/\/$/, "");
}

function normalizeCodexLoginMode(value) {
  const mode = String(value || "unknown").trim().toLowerCase();
  if (!["chatgpt", "api_key", "unknown"].includes(mode)) {
    throw new Error("ROUTER_CODEX_LOGIN_MODE must be chatgpt, api_key, or unknown.");
  }
  return mode;
}

export function resolveAuthConfig(environment = process.env) {
  const requestedMode = normalizeAuthMode(environment.ROUTER_AUTH_MODE);
  const codexLoginMode = normalizeCodexLoginMode(environment.ROUTER_CODEX_LOGIN_MODE);
  const providerKeyEnv = normalizeProviderKeyEnv(environment.ROUTER_API_KEY_ENV);
  const providerKeyConfigured = String(environment[providerKeyEnv] || "").trim().length > 0;
  const selectedMode = requestedMode === "auto"
    ? (providerKeyConfigured ? "provider_key" : "openai")
    : requestedMode;

  if (selectedMode === "provider_key" && !providerKeyConfigured) {
    throw new Error(`${providerKeyEnv} is required when provider_key authentication is selected.`);
  }

  const configuredUpstreamBase = normalizeUpstreamBase(environment.ROUTER_UPSTREAM_BASE);
  if (selectedMode === "provider_key" && !configuredUpstreamBase) {
    throw new Error("ROUTER_UPSTREAM_BASE is required when provider_key authentication is selected.");
  }

  const defaultOpenAIUpstream = codexLoginMode === "api_key"
    ? OPENAI_API_BASE_URL
    : CHATGPT_CODEX_BASE_URL;

  return {
    requestedMode,
    selectedMode,
    authSource: selectedMode === "provider_key" ? "provider_environment" : "codex_login",
    codexLoginMode,
    requiresOpenAIAuth: selectedMode === "openai",
    providerKeyEnv,
    providerKeyConfigured,
    upstreamConfigured: Boolean(configuredUpstreamBase),
    upstreamBase: configuredUpstreamBase || defaultOpenAIUpstream,
  };
}
