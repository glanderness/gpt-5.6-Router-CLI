import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_AUTO,
  classifyRequest,
  classifyTask,
  confidenceForScore,
  extractLatestUserText,
  extractRequestFeatures,
  reasoningEfforts,
  responseFooterLine,
  routeRequest,
  selectRoutingPolicy,
} from "../router.mjs";

test("manual mode has priority", () => {
  assert.equal(classifyTask("[最强] 帮我处理这个任务").mode, "sol");
  assert.equal(classifyTask("[省钱] 帮我改一句话").mode, "luna");
  assert.equal(classifyTask("[均衡] 深度分析市场走势").mode, "terra");
});

test("greetings and simple tasks select luna", () => {
  assert.equal(classifyTask("你好").mode, "luna");
  assert.equal(classifyTask("Hello!").mode, "luna");
  assert.equal(classifyTask("帮我润色这个标题").mode, "luna");
  assert.equal(classifyTask("把这句话翻译成英文").mode, "luna");
  assert.equal(classifyTask("总结这段话的三个要点").mode, "luna");
  assert.equal(classifyTask("请只回复 OK").mode, "luna");
  assert.equal(classifyTask("直接回答：1 + 1 等于几").mode, "luna");
});

test("normal scoped implementation selects terra", () => {
  assert.equal(classifyTask("请修改单个文件中的按钮文案并验证显示").mode, "terra");
  assert.equal(classifyTask("实现一个普通的 API 接口并运行测试").mode, "terra");
  assert.equal(classifyTask("读取项目文件，帮我判断这个函数为什么报错").mode, "terra");
});

test("signal dimensions are independent and recordable", () => {
  const result = classifyRequest({
    input: "实现一个 API 接口，分两步完成，运行测试并保持兼容性",
  });
  const names = result.signalDetails.map((item) => item.name);
  assert.deepEqual(names, [
    "simpleTask",
    "reasoning",
    "codePresence",
    "multiStep",
    "technicalDepth",
    "scope",
    "constraints",
    "imperative",
    "contextLength",
    "toolRequirement",
    "inputModality",
  ]);
  assert.equal(new Set(names).size, names.length);
  assert.ok(result.signalDetails.every((item) => typeof item.weight === "number"));
  assert.ok(result.signalDetails.every((item) => typeof item.contribution === "number"));
  assert.ok(result.signalDetails.find((item) => item.name === "codePresence").value > 0);
  assert.ok(result.signalDetails.find((item) => item.name === "multiStep").value > 0);
  assert.ok(result.signalDetails.find((item) => item.name === "toolRequirement").value > 0);
});

test("low-confidence boundary decisions use terra", () => {
  assert.equal(confidenceForScore(0.3), 0.5);
  assert.equal(confidenceForScore(0.65), 0.5);
  const result = classifyTask("用一句话解释这个函数");
  assert.equal(result.initialMode, "terra");
  assert.equal(result.mode, "terra");
  assert.equal(result.ambiguityFallback, true);
  assert.ok(result.confidence < 0.65);
});

test("complex and high-stakes research tasks select sol", () => {
  const result = classifyTask("从零搭建一个完整系统，包含架构设计、多文件实现、测试和部署验证");
  assert.equal(result.mode, "sol");
  assert.equal(classifyTask("请做一份 BTC 未来走势预测和投资分析研究报告").mode, "sol");
  assert.equal(classifyTask("深度分析这个问题的根因").mode, "sol");
  assert.equal(classifyTask("深度分析这个问题的根因，最后只回复结论").mode, "sol");
});

test("latest user message is used", () => {
  const text = extractLatestUserText({
    input: [
      { role: "user", content: [{ type: "input_text", text: "旧任务" }] },
      { role: "assistant", content: [{ type: "text", text: "回复" }] },
      { role: "user", content: [{ type: "input_text", text: "新任务" }] },
    ],
  });
  assert.equal(text, "新任务");
});

test("only the auto model is routed", () => {
  const unchangedBody = { model: "gpt-5.6-sol", input: "hello", reasoning: { effort: "high" } };
  const unchanged = routeRequest(unchangedBody);
  assert.equal(unchanged.decision, null);
  assert.equal(unchanged.body, unchangedBody);

  const routed = routeRequest({ model: MODEL_AUTO, input: "帮我润色标题" });
  assert.equal(routed.body.model, "gpt-5.6-luna");
  assert.equal(routed.body.reasoning.effort, "low");
});

test("classification and model policy are separate layers", () => {
  const classification = classifyRequest({ input: "你好" });
  assert.equal(classification.mode, "luna");
  assert.equal(Object.hasOwn(classification, "selectedModel"), false);

  const policy = selectRoutingPolicy(classification);
  assert.equal(policy.selectedMode, "luna");
  assert.equal(policy.selectedModel, "gpt-5.6-luna");
  assert.equal(policy.reasoningEffort, "low");
});

test("tools, context length, and input modalities become capability requirements", () => {
  const body = {
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "读取文件并总结" },
        { type: "input_image", image_url: "data:image/png;base64,AA==" },
      ],
    }],
    tools: [{ type: "function", name: "read_file" }],
    max_output_tokens: 1200,
  };
  const features = extractRequestFeatures(body);
  assert.equal(features.requiresTools, true);
  assert.equal(features.availableToolCount, 1);
  assert.deepEqual(features.modalities, ["image", "text"]);

  const classification = classifyRequest(body);
  assert.equal(classification.minimumMode, "terra");
  const policy = selectRoutingPolicy(classification);
  assert.equal(policy.requiredCapabilities.tools, true);
  assert.deepEqual(policy.requiredCapabilities.modalities, ["image", "text"]);
  assert.equal(policy.requiredCapabilities.contextTokens, features.estimatedTotalTokens + 1200);
  assert.deepEqual(policy.excludedCandidates, []);

  const structured = classifyRequest({
    input: "只回复结果",
    text: { format: { type: "json_schema" } },
  });
  assert.equal(structured.features.structured_output, true);
  assert.equal(structured.minimumMode, "terra");
  assert.equal(structured.mode, "terra");

  const toolResultFeatures = extractRequestFeatures({
    input: [
      { role: "user", content: [{ type: "input_text", text: "继续分析" }] },
      { type: "function_call_output", output: "x".repeat(400) },
    ],
  });
  assert.ok(toolResultFeatures.taskContextTokens > toolResultFeatures.latestTaskTokens);

  const unsupported = classifyRequest({
    input: [{ role: "user", content: [{ type: "input_audio", audio: "AA==" }] }],
  });
  const fallback = selectRoutingPolicy(unsupported);
  assert.equal(fallback.selectedMode, "sol");
  assert.equal(fallback.capabilityFallback, true);
  assert.equal(fallback.excludedCandidates.length, 3);

  const oversized = {
    ...classifyRequest({ input: "普通任务" }),
    features: {
      ...classifyRequest({ input: "普通任务" }).features,
      estimated_total_tokens: 400_000,
    },
  };
  const contextFallback = selectRoutingPolicy(oversized);
  assert.equal(contextFallback.selectedMode, "sol");
  assert.equal(contextFallback.capabilityFallback, true);
  assert.ok(contextFallback.excludedCandidates.every((item) => item.reasons.some((reason) => reason.startsWith("context:"))));
});

test("routing maps reasoning effort and preserves other reasoning fields", () => {
  const luna = routeRequest({ model: MODEL_AUTO, input: "你好", instructions: "Preserve this instruction.", reasoning: { effort: "high", summary: "auto" } });
  assert.equal(luna.decision.reasoningEffort, reasoningEfforts.luna);
  assert.deepEqual(luna.body.reasoning, { effort: "low", summary: "auto" });
  assert.match(luna.body.instructions, /^Preserve this instruction\./);
  assert.match(luna.body.instructions, /Router 实际选择：gpt-5\.6-luna｜推理强度：low/);
  assert.equal(luna.decision.footerLine, responseFooterLine("gpt-5.6-luna", "low"));

  const terra = routeRequest({ model: MODEL_AUTO, input: "实现一个普通的 API 接口并运行测试", reasoning_effort: "low" });
  assert.equal(terra.body.model, "gpt-5.6-terra");
  assert.equal(terra.body.reasoning.effort, "medium");
  assert.equal(terra.body.reasoning_effort, "medium");

  const sol = routeRequest({ model: MODEL_AUTO, input: "请做一份 BTC 走势预测和投资分析研究报告" });
  assert.equal(sol.body.model, "gpt-5.6-sol");
  assert.equal(sol.body.reasoning.effort, "high");
});

test("response footer can be disabled without changing routing", () => {
  const previous = process.env.ROUTER_RESPONSE_FOOTER;
  process.env.ROUTER_RESPONSE_FOOTER = "0";
  try {
    const routed = routeRequest({ model: MODEL_AUTO, input: "你好", instructions: "Keep me." });
    assert.equal(routed.body.model, "gpt-5.6-luna");
    assert.equal(routed.body.instructions, "Keep me.");
    assert.equal(routed.decision.footerLine, null);
  } finally {
    if (previous === undefined) delete process.env.ROUTER_RESPONSE_FOOTER;
    else process.env.ROUTER_RESPONSE_FOOTER = previous;
  }
});
