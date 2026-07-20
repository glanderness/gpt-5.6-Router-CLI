import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveAuthConfig } from "./auth-config.mjs";
import { discoverCodexUpstream } from "./codex-upstream-config.mjs";

function detectCodexLoginMode(environment) {
  const explicit = String(environment.ROUTER_CODEX_LOGIN_MODE || "").trim().toLowerCase();
  if (explicit) return explicit;

  const candidates = [];
  if (environment.CODEX_BIN) candidates.push(environment.CODEX_BIN);
  candidates.push("codex");
  const appBinary = "/Applications/ChatGPT.app/Contents/Resources/codex";
  if (existsSync(appBinary)) candidates.push(appBinary);

  for (const command of [...new Set(candidates)]) {
    const result = spawnSync(command, ["login", "status"], {
      encoding: "utf8",
      env: environment,
      timeout: 5000,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (output.includes("Logged in using ChatGPT")) return "chatgpt";
    if (output.includes("Logged in using an API key")) return "api_key";
  }
  return "unknown";
}

function printShell(config) {
  const fields = {
    requested_mode: config.requestedMode,
    selected_mode: config.selectedMode,
    auth_source: config.authSource,
    codex_login_mode: config.codexLoginMode,
    requires_openai_auth: String(config.requiresOpenAIAuth),
    provider_key_env: config.providerKeyEnv,
    provider_key_configured: String(config.providerKeyConfigured),
    upstream_configured: String(config.upstreamConfigured),
    upstream_base: config.upstreamBase,
  };
  for (const [key, value] of Object.entries(fields)) console.log(`${key}=${value}`);
}

try {
  const environment = {
    ...process.env,
    ROUTER_CODEX_LOGIN_MODE: detectCodexLoginMode(process.env),
  };
  const codexUpstream = discoverCodexUpstream(environment, environment.ROUTER_CODEX_CWD || process.cwd());
  const config = resolveAuthConfig(environment, codexUpstream);
  if (process.argv.includes("--require-ready") && config.selectedMode === "openai" && config.codexLoginMode === "unknown") {
    throw new Error("Codex authentication is not ready. Finish the native Codex setup and confirm that 'codex' works before installing GPT5.6-Router.");
  }
  if (process.argv.includes("--shell")) printShell(config);
  else console.log(JSON.stringify(config));
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
