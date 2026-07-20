import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEVANT_PROVIDER_FIELDS = new Set([
  "name",
  "base_url",
  "env_key",
  "requires_openai_auth",
  "wire_api",
]);

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote || character);
      continue;
    }
    if (character === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function splitOutsideQuotes(value, separator) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote || character);
      continue;
    }
    if (character === separator && !quote) return index;
  }
  return -1;
}

function parseDottedKey(value) {
  const parts = [];
  let remaining = value.trim();
  while (remaining) {
    const index = splitOutsideQuotes(remaining, ".");
    const rawPart = (index === -1 ? remaining : remaining.slice(0, index)).trim();
    if (!rawPart) throw new Error(`Unsupported empty TOML key in ${value}.`);
    parts.push(parseStringOrBare(rawPart));
    if (index === -1) break;
    remaining = remaining.slice(index + 1);
  }
  return parts;
}

function parseStringOrBare(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Unsupported quoted TOML value: ${trimmed}`);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  throw new Error(`Unsupported TOML key or string: ${trimmed}`);
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return parseStringOrBare(trimmed);
}

export function parseCodexConfig(source, sourcePath = "config.toml") {
  const parsed = { modelProvider: null, providers: new Map() };
  let section = [];

  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[[")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = parseDottedKey(line.slice(1, -1));
      continue;
    }

    const equalsIndex = splitOutsideQuotes(line, "=");
    if (equalsIndex === -1) continue;
    const key = parseDottedKey(line.slice(0, equalsIndex));
    const field = key.join(".");

    if (section.length === 0 && field === "model_provider") {
      parsed.modelProvider = parseScalar(line.slice(equalsIndex + 1));
      continue;
    }

    if (section.length === 2 && section[0] === "model_providers" && RELEVANT_PROVIDER_FIELDS.has(field)) {
      const providerId = section[1];
      const provider = parsed.providers.get(providerId) || {};
      provider[field] = parseScalar(line.slice(equalsIndex + 1));
      parsed.providers.set(providerId, provider);
    }
  }

  if (parsed.modelProvider !== null && typeof parsed.modelProvider !== "string") {
    throw new Error(`model_provider in ${sourcePath} must be a string.`);
  }
  return parsed;
}

function mergeConfig(target, next) {
  if (next.modelProvider !== null) target.modelProvider = next.modelProvider;
  for (const [providerId, fields] of next.providers) {
    target.providers.set(providerId, { ...(target.providers.get(providerId) || {}), ...fields });
  }
}

function findProjectConfig(startDirectory) {
  let directory = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(directory, ".codex", "config.toml");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function normalizeProfile(value) {
  const profile = String(value || "").trim();
  if (!profile) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(profile)) {
    throw new Error("The Codex profile name contains unsupported characters.");
  }
  return profile;
}

export function loadCodexConfig(environment = process.env, cwd = process.cwd()) {
  const codexHome = environment.CODEX_HOME
    ? path.resolve(environment.CODEX_HOME)
    : path.join(environment.HOME || os.homedir(), ".codex");
  const baseConfigPath = environment.ROUTER_CODEX_CONFIG
    ? path.resolve(environment.ROUTER_CODEX_CONFIG)
    : path.join(codexHome, "config.toml");
  const profile = normalizeProfile(environment.ROUTER_CODEX_PROFILE);
  const candidatePaths = [baseConfigPath];
  const projectConfigPath = findProjectConfig(cwd);
  if (projectConfigPath && projectConfigPath !== baseConfigPath) candidatePaths.push(projectConfigPath);
  if (profile) candidatePaths.push(path.join(codexHome, `${profile}.config.toml`));

  const merged = { modelProvider: null, providers: new Map(), sourcePaths: [] };
  for (const configPath of [...new Set(candidatePaths)]) {
    if (!existsSync(configPath)) continue;
    const source = readFileSync(configPath, "utf8");
    mergeConfig(merged, parseCodexConfig(source, configPath));
    merged.sourcePaths.push(configPath);
  }
  return merged;
}

function normalizeBaseUrl(value, providerId) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`Codex provider "${providerId}" does not define base_url.`);
  if (/[\r\n]/.test(raw)) throw new Error(`Codex provider "${providerId}" must use a single-line base_url.`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Codex provider "${providerId}" has an invalid base_url.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Codex provider "${providerId}" must use an http or https base_url.`);
  }
  return raw.replace(/\/$/, "");
}

export function discoverCodexUpstream(environment = process.env, cwd = process.cwd()) {
  const config = loadCodexConfig(environment, cwd);
  const providerId = String(config.modelProvider || "openai").trim();
  const provider = config.providers.get(providerId);

  if (!provider && providerId === "openai") {
    return {
      providerId,
      providerName: "OpenAI",
      providerKind: "official",
      baseUrl: null,
      envKey: null,
      requiresOpenAIAuth: true,
      wireApi: "responses",
      configSourcePaths: config.sourcePaths,
    };
  }
  if (!provider) {
    throw new Error(`Codex selects model_provider "${providerId}", but its [model_providers.${providerId}] configuration was not found.`);
  }

  const wireApi = String(provider.wire_api || "responses").trim().toLowerCase();
  if (wireApi !== "responses") {
    throw new Error(`Codex provider "${providerId}" uses wire_api="${wireApi}"; GPT5.6-Router currently requires wire_api="responses".`);
  }

  const envKey = provider.env_key ? String(provider.env_key).trim() : null;
  if (envKey && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
    throw new Error(`Codex provider "${providerId}" has an invalid env_key.`);
  }

  return {
    providerId,
    providerName: String(provider.name || providerId),
    providerKind: "custom",
    baseUrl: normalizeBaseUrl(provider.base_url, providerId),
    envKey,
    requiresOpenAIAuth: provider.requires_openai_auth === true,
    wireApi,
    configSourcePaths: config.sourcePaths,
  };
}
