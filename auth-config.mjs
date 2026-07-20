export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

const AUTH_MODE_ALIASES = new Map([
  ["auto", "auto"],
  ["openai", "openai"],
  ["chatgpt", "openai"],
  ["provider_key", "provider_key"],
  ["api_key", "provider_key"],
  ["third_party", "provider_key"],
  ["none", "none"],
]);

function normalizeAuthMode(value) {
  const requested = String(value || "auto").trim().toLowerCase();
  const normalized = AUTH_MODE_ALIASES.get(requested);
  if (!normalized) {
    throw new Error("ROUTER_AUTH_MODE must be auto, openai, provider_key, or none.");
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
  if (/[\r\n]/.test(raw)) {
    throw new Error("ROUTER_UPSTREAM_BASE must be a single-line URL.");
  }
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

export function resolveAuthConfig(environment = process.env, codexUpstream = null) {
  const requestedMode = normalizeAuthMode(environment.ROUTER_AUTH_MODE);
  const codexLoginMode = normalizeCodexLoginMode(environment.ROUTER_CODEX_LOGIN_MODE);
  const providerKeyEnv = normalizeProviderKeyEnv(environment.ROUTER_API_KEY_ENV);
  const providerKeyConfigured = String(environment[providerKeyEnv] || "").trim().length > 0;
  let selectedMode = requestedMode;
  let selectedProviderKeyEnv = providerKeyEnv;
  let authSource = "router_override";

  if (requestedMode === "auto" && providerKeyConfigured) {
    selectedMode = "provider_key";
    authSource = "router_environment";
  } else if (requestedMode === "auto" && codexUpstream?.providerKind === "custom") {
    if (codexUpstream.requiresOpenAIAuth) {
      selectedMode = "openai";
      authSource = "codex_login";
    } else if (codexUpstream.envKey) {
      selectedMode = "provider_key";
      selectedProviderKeyEnv = codexUpstream.envKey;
      authSource = "codex_provider_environment";
    } else {
      selectedMode = "none";
      authSource = "codex_provider_no_auth";
    }
  } else if (requestedMode === "auto") {
    selectedMode = "openai";
    authSource = "codex_login";
  }

  const selectedProviderKeyConfigured = String(environment[selectedProviderKeyEnv] || "").trim().length > 0;

  if (selectedMode === "provider_key" && !selectedProviderKeyConfigured) {
    throw new Error(`${selectedProviderKeyEnv} is required by the selected Codex provider but is not available in this shell.`);
  }

  const configuredUpstreamBase = normalizeUpstreamBase(environment.ROUTER_UPSTREAM_BASE);
  const defaultOpenAIUpstream = codexLoginMode === "api_key"
    ? OPENAI_API_BASE_URL
    : CHATGPT_CODEX_BASE_URL;
  const discoveredUpstreamBase = normalizeUpstreamBase(codexUpstream?.baseUrl);
  const upstreamBase = configuredUpstreamBase || discoveredUpstreamBase || defaultOpenAIUpstream;

  if (selectedMode === "provider_key" && !configuredUpstreamBase && !discoveredUpstreamBase) {
    throw new Error("ROUTER_UPSTREAM_BASE is required when provider_key authentication is selected without a configured Codex provider.");
  }

  return {
    requestedMode,
    selectedMode,
    authSource,
    codexLoginMode,
    requiresOpenAIAuth: selectedMode === "openai",
    providerKeyEnv: selectedProviderKeyEnv,
    providerKeyConfigured: selectedProviderKeyConfigured,
    upstreamConfigured: Boolean(configuredUpstreamBase || discoveredUpstreamBase),
    upstreamBase,
    codexProviderId: codexUpstream?.providerId || "openai",
    codexProviderName: codexUpstream?.providerName || "OpenAI",
    codexProviderKind: codexUpstream?.providerKind || "official",
    configSourcePaths: codexUpstream?.configSourcePaths || [],
  };
}
