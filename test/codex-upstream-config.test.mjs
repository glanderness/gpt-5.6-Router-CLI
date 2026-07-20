import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverCodexUpstream, parseCodexConfig } from "../codex-upstream-config.mjs";

test("Codex provider parser reads the routing fields", () => {
  const config = parseCodexConfig(`
model_provider = "beef" # active provider
[model_providers.beef]
name = "Beef API"
base_url = "https://beefapi.com/v1/"
wire_api = "responses"
requires_openai_auth = true
`);
  assert.equal(config.modelProvider, "beef");
  assert.deepEqual(config.providers.get("beef"), {
    name: "Beef API",
    base_url: "https://beefapi.com/v1/",
    wire_api: "responses",
    requires_openai_auth: true,
  });
});

test("provider discovery reuses a custom provider with Codex authentication", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "router-codex-config-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, "config.toml"), `
model_provider = "custom"
[model_providers.custom]
name = "Existing Provider"
base_url = "https://provider.example.com/v1/"
wire_api = "responses"
requires_openai_auth = true
`, "utf8");

  const provider = discoverCodexUpstream({ HOME: home, CODEX_HOME: codexHome }, home);
  assert.equal(provider.providerId, "custom");
  assert.equal(provider.providerName, "Existing Provider");
  assert.equal(provider.baseUrl, "https://provider.example.com/v1");
  assert.equal(provider.requiresOpenAIAuth, true);
});

test("provider discovery reuses env_key without reading its value", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "router-codex-env-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configPath = path.join(home, "config.toml");
  await writeFile(configPath, `
model_provider = "provider_key"
[model_providers.provider_key]
base_url = "https://provider.example.com/v1"
env_key = "EXISTING_PROVIDER_KEY"
wire_api = "responses"
`, "utf8");

  const provider = discoverCodexUpstream({ HOME: home, ROUTER_CODEX_CONFIG: configPath }, home);
  assert.equal(provider.envKey, "EXISTING_PROVIDER_KEY");
  assert.equal(Object.hasOwn(provider, "key"), false);
});

test("a named Codex profile overlays the base provider selection", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "router-codex-profile-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, "config.toml"), `
model_provider = "openai"
[model_providers.team]
base_url = "https://team.example.com/v1"
requires_openai_auth = true
`, "utf8");
  await writeFile(path.join(codexHome, "team.config.toml"), 'model_provider = "team"\n', "utf8");

  const provider = discoverCodexUpstream({
    HOME: home,
    CODEX_HOME: codexHome,
    ROUTER_CODEX_PROFILE: "team",
  }, home);
  assert.equal(provider.providerId, "team");
  assert.equal(provider.baseUrl, "https://team.example.com/v1");
});

test("provider discovery rejects incomplete or incompatible definitions", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "router-codex-invalid-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configPath = path.join(home, "config.toml");

  await writeFile(configPath, 'model_provider = "missing"\n', "utf8");
  assert.throws(
    () => discoverCodexUpstream({ HOME: home, ROUTER_CODEX_CONFIG: configPath }, home),
    /configuration was not found/,
  );

  await writeFile(configPath, `
model_provider = "legacy"
[model_providers.legacy]
base_url = "https://legacy.example.com/v1"
wire_api = "chat"
`, "utf8");
  assert.throws(
    () => discoverCodexUpstream({ HOME: home, ROUTER_CODEX_CONFIG: configPath }, home),
    /requires wire_api="responses"/,
  );
});
