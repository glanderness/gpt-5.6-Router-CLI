import test from "node:test";
import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createTestApp(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gpt-router-auth-launch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "models"));
  for (const file of ["codex-router", "auth-config.mjs", "auth-config-cli.mjs"]) {
    await copyFile(path.join(projectDir, file), path.join(directory, file));
  }
  await copyFile(
    path.join(projectDir, "models", "router-models.json"),
    path.join(directory, "models", "router-models.json"),
  );
  await chmod(path.join(directory, "codex-router"), 0o755);

  const service = path.join(directory, "router-service.sh");
  await writeFile(service, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(service, 0o755);

  const codex = path.join(directory, "fake-codex");
  await writeFile(codex, [
    "#!/bin/sh",
    "if [ \"${1:-}\" = login ] && [ \"${2:-}\" = status ]; then",
    "  if [ \"${FAKE_CODEX_LOGIN_MODE:-chatgpt}\" = api_key ]; then",
    "    echo 'Logged in using an API key'",
    "  else",
    "    echo 'Logged in using ChatGPT'",
    "  fi",
    "  exit 0",
    "fi",
    "printf '%s\\n' \"$@\" >\"$CAPTURE_FILE\"",
    "",
  ].join("\n"), "utf8");
  await chmod(codex, 0o755);
  return { directory, codex };
}

function runRouter(directory, captureFile, environment = {}) {
  return spawnSync(path.join(directory, "codex-router"), ["exec", "test"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, CAPTURE_FILE: captureFile, ...environment },
  });
}

test("Codex launch uses OpenAI authentication for the current Codex login", async (t) => {
  const { directory, codex } = await createTestApp(t);
  const captureFile = path.join(directory, "args-openai.txt");
  await writeFile(path.join(directory, ".env"), [
    "ROUTER_AUTH_MODE=auto",
    "ROUTER_API_KEY_ENV=ROUTER_API_KEY",
    "ROUTER_API_KEY=",
    "ROUTER_UPSTREAM_BASE=",
    `CODEX_BIN=${codex}`,
    "",
  ].join("\n"), "utf8");

  const result = runRouter(directory, captureFile);
  assert.equal(result.status, 0, result.stderr);
  const args = (await readFile(captureFile, "utf8")).split("\n").filter(Boolean);
  assert.equal(args.includes("model_providers.gpt_5_6_router.requires_openai_auth=true"), true);
  assert.equal(args.some((value) => value.includes("model_providers.gpt_5_6_router.env_key")), false);
  assert.match(result.stderr, /current Codex login \(chatgpt\)/);
  assert.match(result.stderr, /https:\/\/chatgpt\.com\/backend-api\/codex/);
});

test("Codex launch detects an OpenAI API key login", async (t) => {
  const { directory, codex } = await createTestApp(t);
  const captureFile = path.join(directory, "args-openai-api.txt");
  await writeFile(path.join(directory, ".env"), [
    "ROUTER_AUTH_MODE=auto",
    "ROUTER_API_KEY_ENV=ROUTER_API_KEY",
    "ROUTER_API_KEY=",
    "ROUTER_UPSTREAM_BASE=",
    `CODEX_BIN=${codex}`,
    "",
  ].join("\n"), "utf8");

  const result = runRouter(directory, captureFile, { FAKE_CODEX_LOGIN_MODE: "api_key" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /current Codex login \(api_key\)/);
  assert.match(result.stderr, /https:\/\/api\.openai\.com\/v1/);
});

test("Codex launch uses environment authentication for a third-party key", async (t) => {
  const { directory, codex } = await createTestApp(t);
  const captureFile = path.join(directory, "args-provider.txt");
  await writeFile(path.join(directory, ".env"), [
    "ROUTER_AUTH_MODE=auto",
    "ROUTER_API_KEY_ENV=EXAMPLE_PROVIDER_KEY",
    "EXAMPLE_PROVIDER_KEY=provider-key",
    "ROUTER_UPSTREAM_BASE=https://api.example.com/v1",
    `CODEX_BIN=${codex}`,
    "",
  ].join("\n"), "utf8");

  const result = runRouter(directory, captureFile);
  assert.equal(result.status, 0, result.stderr);
  const args = (await readFile(captureFile, "utf8")).split("\n").filter(Boolean);
  assert.equal(args.includes("model_providers.gpt_5_6_router.requires_openai_auth=false"), true);
  assert.equal(args.includes('model_providers.gpt_5_6_router.env_key="EXAMPLE_PROVIDER_KEY"'), true);
});
