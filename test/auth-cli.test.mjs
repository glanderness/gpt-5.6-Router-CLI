import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = path.join(projectDir, "codex-router");

function authStatus(overrides = {}) {
  return spawnSync(command, ["--router-auth-status"], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ROUTER_AUTH_MODE: "auto",
      ROUTER_CODEX_LOGIN_MODE: "chatgpt",
      ROUTER_API_KEY_ENV: "ROUTER_API_KEY",
      ROUTER_API_KEY: "",
      ROUTER_UPSTREAM_BASE: "",
      ...overrides,
    },
  });
}

test("CLI authentication status selects the current Codex login by default", () => {
  const result = authStatus();
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.selectedMode, "openai");
  assert.equal(status.authSource, "codex_login");
  assert.equal(status.providerKeyConfigured, false);
});

test("CLI authentication status selects a third-party key when configured", () => {
  const result = authStatus({
    ROUTER_API_KEY: "provider-key",
    ROUTER_UPSTREAM_BASE: "https://api.example.com/v1",
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.selectedMode, "provider_key");
  assert.equal(status.providerKeyEnv, "ROUTER_API_KEY");
  assert.equal(status.requiresOpenAIAuth, false);
});

test("CLI authentication status reports incomplete provider configuration", () => {
  const result = authStatus({
    ROUTER_AUTH_MODE: "provider_key",
    ROUTER_API_KEY: "provider-key",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ROUTER_UPSTREAM_BASE is required/);
});
