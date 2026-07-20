import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("bootstrap downloads a package and forwards installer options", async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gpt-router-bootstrap-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const packageRoot = path.join(temporaryDirectory, "GPT5.6-Router-main");
  const archivePath = path.join(temporaryDirectory, "router.tar.gz");
  const capturePath = path.join(temporaryDirectory, "installer-args.txt");
  await mkdir(packageRoot, { recursive: true });
  const fakeInstaller = path.join(packageRoot, "install.sh");
  await writeFile(fakeInstaller, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >"$BOOTSTRAP_CAPTURE"\n', "utf8");
  await chmod(fakeInstaller, 0o755);

  const archive = spawnSync("tar", ["-czf", archivePath, "-C", temporaryDirectory, path.basename(packageRoot)], {
    encoding: "utf8",
  });
  assert.equal(archive.status, 0, archive.stderr);

  const result = spawnSync("bash", [path.join(projectDir, "bootstrap.sh"), "--no-start"], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      BOOTSTRAP_CAPTURE: capturePath,
      GPT56_ROUTER_ARCHIVE_URL: `file://${archivePath}`,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await readFile(capturePath, "utf8"), "--no-start\n");
});
