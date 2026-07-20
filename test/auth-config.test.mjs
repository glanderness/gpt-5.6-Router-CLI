import test from "node:test";
import assert from "node:assert/strict";
import { CHATGPT_CODEX_BASE_URL, OPENAI_API_BASE_URL, resolveAuthConfig } from "../auth-config.mjs";

test("auto authentication uses the current Codex login by default", () => {
  const config = resolveAuthConfig({ ROUTER_CODEX_LOGIN_MODE: "chatgpt" });
  assert.equal(config.selectedMode, "openai");
  assert.equal(config.requiresOpenAIAuth, true);
  assert.equal(config.authSource, "codex_login");
  assert.equal(config.upstreamBase, CHATGPT_CODEX_BASE_URL);
  assert.equal(config.upstreamConfigured, false);
});

test("an OpenAI API key login uses the official API upstream by default", () => {
  const config = resolveAuthConfig({ ROUTER_CODEX_LOGIN_MODE: "api_key" });
  assert.equal(config.selectedMode, "openai");
  assert.equal(config.codexLoginMode, "api_key");
  assert.equal(config.upstreamBase, OPENAI_API_BASE_URL);
});

test("auto authentication selects a configured provider key", () => {
  const config = resolveAuthConfig({
    ROUTER_API_KEY: "provider-key",
    ROUTER_UPSTREAM_BASE: "https://api.example.com/v1/",
  });
  assert.equal(config.selectedMode, "provider_key");
  assert.equal(config.requiresOpenAIAuth, false);
  assert.equal(config.providerKeyEnv, "ROUTER_API_KEY");
  assert.equal(config.upstreamBase, "https://api.example.com/v1");
});

test("a custom provider key environment variable is supported", () => {
  const config = resolveAuthConfig({
    ROUTER_API_KEY_ENV: "EXAMPLE_PROVIDER_KEY",
    EXAMPLE_PROVIDER_KEY: "provider-key",
    ROUTER_UPSTREAM_BASE: "https://api.example.com/v1",
  });
  assert.equal(config.selectedMode, "provider_key");
  assert.equal(config.providerKeyEnv, "EXAMPLE_PROVIDER_KEY");
});

test("openai mode ignores a separately configured provider key", () => {
  const config = resolveAuthConfig({
    ROUTER_AUTH_MODE: "openai",
    ROUTER_API_KEY: "provider-key",
  });
  assert.equal(config.selectedMode, "openai");
  assert.equal(config.requiresOpenAIAuth, true);
  assert.equal(config.upstreamBase, CHATGPT_CODEX_BASE_URL);
});

test("provider key mode requires both a key and an upstream URL", () => {
  assert.throws(
    () => resolveAuthConfig({ ROUTER_AUTH_MODE: "provider_key" }),
    /ROUTER_API_KEY is required/,
  );
  assert.throws(
    () => resolveAuthConfig({ ROUTER_AUTH_MODE: "provider_key", ROUTER_API_KEY: "provider-key" }),
    /ROUTER_UPSTREAM_BASE is required/,
  );
});

test("authentication configuration validates mode, environment name, and URL", () => {
  assert.throws(() => resolveAuthConfig({ ROUTER_AUTH_MODE: "unknown" }), /ROUTER_AUTH_MODE/);
  assert.throws(() => resolveAuthConfig({ ROUTER_API_KEY_ENV: "INVALID-NAME" }), /ROUTER_API_KEY_ENV/);
  assert.throws(() => resolveAuthConfig({ ROUTER_UPSTREAM_BASE: "file:///tmp/provider" }), /ROUTER_UPSTREAM_BASE/);
});
