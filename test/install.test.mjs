import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("installer creates an isolated app and global command links", async (t) => {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "gpt-router-install-"));
  t.after(() => rm(temporaryHome, { recursive: true, force: true }));

  const appDir = path.join(temporaryHome, "app");
  const binDir = path.join(temporaryHome, "bin");
  const fakeCodex = path.join(temporaryHome, "codex");
  const nativeConfig = path.join(temporaryHome, ".codex", "config.toml");
  const nativeAuth = path.join(temporaryHome, ".codex", "auth.json");
  const nativeCodex = path.join(binDir, "codex");
  await mkdir(path.dirname(nativeConfig), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(nativeConfig, "model = \"native-model\"\n", "utf8");
  await writeFile(nativeAuth, "{\"login\":\"native-login\"}\n", "utf8");
  await writeFile(nativeCodex, "#!/bin/sh\necho native-codex\n", "utf8");
  await chmod(nativeCodex, 0o755);
  await writeFile(fakeCodex, [
    "#!/bin/sh",
    "if [ \"${1:-}\" = login ] && [ \"${2:-}\" = status ]; then",
    "  echo 'Logged in using ChatGPT'",
    "fi",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  await chmod(fakeCodex, 0o755);

  const result = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start", "--upstream-base", "https://api.example.com/v1"], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      ROUTER_CODEX_CWD: temporaryHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: appDir,
      GPT_ROUTER_BIN_DIR: binDir,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GPT5\.6-Router is installed\./);
  assert.equal(await readlink(path.join(binDir, "codex-router")), path.join(appDir, "codex-router"));
  assert.equal(await readlink(path.join(binDir, "codex-router-service")), path.join(appDir, "router-service.sh"));
  assert.equal(await readlink(path.join(binDir, "codex-router-uninstall")), path.join(appDir, "uninstall.sh"));
  assert.equal(await readFile(nativeConfig, "utf8"), "model = \"native-model\"\n");
  assert.equal(await readFile(nativeAuth, "utf8"), "{\"login\":\"native-login\"}\n");
  assert.equal(await readFile(nativeCodex, "utf8"), "#!/bin/sh\necho native-codex\n");
  const installedEnvironment = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(installedEnvironment, /ROUTER_UPSTREAM_BASE=https:\/\/api\.example\.com\/v1/);
  assert.match(installedEnvironment, new RegExp(`CODEX_BIN=${fakeCodex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await access(path.join(appDir, "codex-router"), constants.X_OK);
  await access(path.join(appDir, "router-service.sh"), constants.X_OK);
  await access(path.join(appDir, "auth-config.mjs"), constants.R_OK);
  await access(path.join(appDir, "codex-upstream-config.mjs"), constants.R_OK);
  await access(path.join(appDir, "router-signals.mjs"), constants.R_OK);
  await access(path.join(appDir, "router-policy.mjs"), constants.R_OK);
  await access(path.join(appDir, "uninstall.sh"), constants.X_OK);

  await writeFile(path.join(appDir, ".env"), `${installedEnvironment}\nROUTER_PORT=65530\n`, "utf8");
  const serviceStatus = spawnSync(path.join(binDir, "codex-router-service"), ["status"], {
    encoding: "utf8",
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(serviceStatus.status, 1);
  assert.match(serviceStatus.stdout, /Router service is not running\./);
  assert.doesNotMatch(serviceStatus.stderr, /No such file or directory/);

  const unconfiguredAppDir = path.join(temporaryHome, "unconfigured-app");
  const unconfiguredBinDir = path.join(temporaryHome, "unconfigured-bin");
  const unconfigured = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start"], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      ROUTER_CODEX_CWD: temporaryHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: unconfiguredAppDir,
      GPT_ROUTER_BIN_DIR: unconfiguredBinDir,
      ROUTER_UPSTREAM_BASE: "",
    },
  });
  assert.equal(unconfigured.status, 0, unconfigured.stderr || unconfigured.stdout);
  assert.match(unconfigured.stdout, /Authentication: current Codex login/);
  assert.match(unconfigured.stdout, /Upstream: https:\/\/chatgpt\.com\/backend-api\/codex/);
  const unconfiguredEnvironment = await readFile(path.join(unconfiguredAppDir, ".env"), "utf8");
  assert.match(unconfiguredEnvironment, /^ROUTER_UPSTREAM_BASE=$/m);

  const providerAppDir = path.join(temporaryHome, "provider-app");
  const providerBinDir = path.join(temporaryHome, "provider-bin");
  const providerInstall = spawnSync("bash", [
    path.join(projectDir, "install.sh"),
    "--no-start",
    "--upstream-base",
    "https://provider.example.com/v1",
    "--api-key-env",
    "EXAMPLE_PROVIDER_KEY",
  ], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      ROUTER_CODEX_CWD: temporaryHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: providerAppDir,
      GPT_ROUTER_BIN_DIR: providerBinDir,
      ROUTER_AUTH_MODE: "auto",
      ROUTER_API_KEY: "",
      EXAMPLE_PROVIDER_KEY: "provider-key",
    },
  });
  assert.equal(providerInstall.status, 0, providerInstall.stderr || providerInstall.stdout);
  assert.match(providerInstall.stdout, /Authentication: provider key from EXAMPLE_PROVIDER_KEY/);
  const providerEnvironment = await readFile(path.join(providerAppDir, ".env"), "utf8");
  assert.match(providerEnvironment, /^ROUTER_API_KEY_ENV=EXAMPLE_PROVIDER_KEY$/m);
  assert.match(providerEnvironment, /^EXAMPLE_PROVIDER_KEY=provider-key$/m);

  const uninstall = spawnSync(path.join(binDir, "codex-router-uninstall"), [], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      ROUTER_CODEX_CWD: temporaryHome,
      GPT_ROUTER_INSTALL_DIR: appDir,
      GPT_ROUTER_BIN_DIR: binDir,
    },
  });
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  await assert.rejects(access(appDir));
  await assert.rejects(access(path.join(binDir, "codex-router")));
  await assert.rejects(access(path.join(binDir, "codex-router-service")));
  await assert.rejects(access(path.join(binDir, "codex-router-uninstall")));
  assert.equal(await readFile(nativeConfig, "utf8"), "model = \"native-model\"\n");
  assert.equal(await readFile(nativeAuth, "utf8"), "{\"login\":\"native-login\"}\n");
  assert.equal(await readFile(nativeCodex, "utf8"), "#!/bin/sh\necho native-codex\n");
});

test("installer refuses to replace an unrelated command", async (t) => {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "gpt-router-collision-"));
  t.after(() => rm(temporaryHome, { recursive: true, force: true }));
  const appDir = path.join(temporaryHome, "app");
  const binDir = path.join(temporaryHome, "bin");
  const fakeCodex = path.join(temporaryHome, "codex");
  await mkdir(binDir, { recursive: true });
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCodex, 0o755);
  await writeFile(path.join(binDir, "codex-router"), "unrelated-command\n", "utf8");

  const result = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start"], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      ROUTER_CODEX_CWD: temporaryHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: appDir,
      GPT_ROUTER_BIN_DIR: binDir,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to replace an existing command/);
  assert.equal(await readFile(path.join(binDir, "codex-router"), "utf8"), "unrelated-command\n");
});

test("installer reuses the native Codex provider without extra options", async (t) => {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "gpt-router-native-provider-"));
  t.after(() => rm(temporaryHome, { recursive: true, force: true }));
  const codexHome = path.join(temporaryHome, ".codex");
  const appDir = path.join(temporaryHome, "app");
  const binDir = path.join(temporaryHome, "bin");
  const fakeCodex = path.join(temporaryHome, "codex");
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, "config.toml"), `
model_provider = "existing"
[model_providers.existing]
name = "Existing Provider"
base_url = "https://existing.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
`, "utf8");
  await writeFile(fakeCodex, [
    "#!/bin/sh",
    "if [ \"${1:-}\" = login ] && [ \"${2:-}\" = status ]; then",
    "  echo 'Logged in using an API key'",
    "fi",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  await chmod(fakeCodex, 0o755);

  const result = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start"], {
    cwd: temporaryHome,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: codexHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: appDir,
      GPT_ROUTER_BIN_DIR: binDir,
      ROUTER_AUTH_MODE: "auto",
      ROUTER_API_KEY: "",
      ROUTER_UPSTREAM_BASE: "",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex provider: Existing Provider \(existing\)/);
  assert.match(result.stdout, /Upstream: https:\/\/existing\.example\.com\/v1/);
});

test("installer asks for native Codex setup when authentication is not ready", async (t) => {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "gpt-router-native-setup-"));
  t.after(() => rm(temporaryHome, { recursive: true, force: true }));
  const fakeCodex = path.join(temporaryHome, "codex");
  await writeFile(fakeCodex, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(fakeCodex, 0o755);

  const result = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start"], {
    cwd: temporaryHome,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_HOME: path.join(temporaryHome, ".codex"),
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: path.join(temporaryHome, "app"),
      GPT_ROUTER_BIN_DIR: path.join(temporaryHome, "bin"),
      ROUTER_AUTH_MODE: "auto",
      ROUTER_API_KEY: "",
      ROUTER_UPSTREAM_BASE: "",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Finish the native Codex setup/);
});
