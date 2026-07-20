import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Router model catalog includes current Codex reasoning metadata", async () => {
  const catalog = JSON.parse(await readFile(path.join(projectDir, "models", "router-models.json"), "utf8"));
  const routerModel = catalog.models.find((model) => model.slug === "gpt-5.6-router");
  assert.ok(routerModel);
  assert.equal(routerModel.supports_reasoning_summaries, true);
  assert.equal(routerModel.effective_context_window_percent, 95);
});
