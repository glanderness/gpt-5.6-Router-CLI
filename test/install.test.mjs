import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
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
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCodex, 0o755);

  const result = spawnSync("bash", [path.join(projectDir, "install.sh"), "--no-start"], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: temporaryHome,
      CODEX_BIN: fakeCodex,
      GPT_ROUTER_INSTALL_DIR: appDir,
      GPT_ROUTER_BIN_DIR: binDir,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GPT-5\.6 Router CLI is installed\./);
  assert.equal(await readlink(path.join(binDir, "codex-router")), path.join(appDir, "codex-router"));
  assert.equal(await readlink(path.join(binDir, "codex-router-service")), path.join(appDir, "router-service.sh"));
  const installedEnvironment = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(installedEnvironment, /ROUTER_UPSTREAM_BASE=https:\/\/beefapi\.com\/v1/);
  assert.match(installedEnvironment, new RegExp(`CODEX_BIN=${fakeCodex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await access(path.join(appDir, "codex-router"), constants.X_OK);
  await access(path.join(appDir, "router-service.sh"), constants.X_OK);
  await access(path.join(appDir, "router-signals.mjs"), constants.R_OK);
  await access(path.join(appDir, "router-policy.mjs"), constants.R_OK);

  await writeFile(path.join(appDir, ".env"), `${installedEnvironment}\nROUTER_PORT=65530\n`, "utf8");
  const serviceStatus = spawnSync(path.join(binDir, "codex-router-service"), ["status"], {
    encoding: "utf8",
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(serviceStatus.status, 1);
  assert.match(serviceStatus.stdout, /Router service is not running\./);
  assert.doesNotMatch(serviceStatus.stderr, /No such file or directory/);
});
