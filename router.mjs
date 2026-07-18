export const MODEL_AUTO = process.env.ROUTER_AUTO_MODEL || "gpt-5.6-router";

export const models = {
  luna: process.env.ROUTER_LUNA_MODEL || "gpt-5.6-luna",
  terra: process.env.ROUTER_TERRA_MODEL || "gpt-5.6-terra",
  sol: process.env.ROUTER_SOL_MODEL || "gpt-5.6-sol",
};

export const reasoningEfforts = {
  luna: "low",
  terra: "medium",
  sol: "high",
};

function responseFooterEnabled() {
  return process.env.ROUTER_RESPONSE_FOOTER !== "0";
}

export function responseFooterLine(selectedModel, reasoningEffort) {
  return `Router 实际选择：${selectedModel}｜推理强度：${reasoningEffort}`;
}

function responseFooterInstruction(selectedModel, reasoningEffort) {
  const footer = responseFooterLine(selectedModel, reasoningEffort);
  return [
    "Only when producing the final user-facing answer, append the following exact text as one separate final line.",
    "Do not append it to tool calls, intermediate updates, or structured data.",
    footer,
  ].join("\n");
}

const manualModes = [
  { mode: "luna", markers: ["[省钱]", "[luna]", "/luna"] },
  { mode: "terra", markers: ["[均衡]", "[terra]", "/terra"] },
  { mode: "sol", markers: ["[最强]", "[sol]", "/sol"] },
];

// These signals describe work, rather than prompt length. A short request can still be Sol work.
const signals = [
  { pattern: /深度分析|深入研究|研究报告|走势预测|投资分析|行业研判|尽调|预测模型|根因分析|系统设计|架构设计|端到端|完整实现|从零搭建|大规模重构|跨文件|多文件/giu, points: 42, minimumScore: 66, label: "高复杂度研究或工程" },
  { pattern: /架构|重构|迁移|部署|性能优化|数据库设计|测试覆盖|工作流|多步骤|不确定|探索|全面分析|详细分析/giu, points: 18, label: "复杂工程或分析" },
  { pattern: /单个文件|单文件|一个文件|小改|简单修改|只改|明确修改|修复一个/giu, points: -10, label: "范围受限" },
  { pattern: /翻译|润色|改写|总结|格式化|排版|标题|一句话|提取要点|简单问答|只回复|简短回答|直接回答|直接告诉我/giu, points: -28, label: "简单文本或短回复任务" },
  { pattern: /architecture|system design|deep analysis|research report|market forecast|investment analysis|root cause|end-to-end|complete implementation|from scratch|large refactor|multi-file/giu, points: 42, minimumScore: 66, label: "high-complexity work" },
  { pattern: /refactor|migration|deployment|performance optimization|database design|test coverage|workflow|explore|comprehensive analysis/giu, points: 18, label: "complex work" },
  { pattern: /single file|small change|only change|translate|rewrite|summarize|format|headline|just reply|brief answer|answer directly/giu, points: -22, label: "simple scoped work" },
];

const greetingPattern = /^(?:你好|您好|嗨|哈喽|在吗|hi|hello|hey)(?:[!！。,.，?？\s]*)$/iu;
const shortQuestionPattern = /^(?:什么是|怎么|如何|能否|可以吗|在吗|多少钱|几点)(?:.{0,30})[?？]?$/u;

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "input_text" || item?.type === "text") return item.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractLatestUserText(body) {
  const input = body?.input;
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";

  const userTexts = input
    .filter((item) => item?.role === "user")
    .map((item) => textFromContent(item.content))
    .filter(Boolean);

  return userTexts.at(-1) || "";
}

export function classifyTask(text) {
  const normalized = String(text || "").trim();
  const lower = normalized.toLowerCase();

  for (const rule of manualModes) {
    if (rule.markers.some((marker) => lower.includes(marker.toLowerCase()))) {
      return { mode: rule.mode, score: null, reason: `人工指定 ${rule.mode}`, signals: ["manual override"] };
    }
  }

  if (greetingPattern.test(normalized)) {
    return { mode: "luna", score: 0, reason: "问候语", signals: ["greeting"] };
  }

  let score = 38;
  let minimumScore = 0;
  const reasons = [];
  for (const signal of signals) {
    const matches = normalized.match(signal.pattern);
    if (!matches?.length) continue;
    const applied = signal.points * Math.min(matches.length, 2);
    score += applied;
    minimumScore = Math.max(minimumScore, signal.minimumScore || 0);
    reasons.push(`${signal.label} ${applied > 0 ? "+" : ""}${applied}`);
  }

  // Length is deliberately only a small tie-breaker: it cannot alone select Sol.
  if (normalized.length > 1500) {
    score += 8;
    reasons.push("描述很长 +8");
  } else if (normalized.length < 45 && shortQuestionPattern.test(normalized)) {
    score -= 18;
    reasons.push("极短明确问答 -18");
  }

  score = Math.max(minimumScore, Math.max(0, Math.min(100, score)));
  const mode = score <= 20 ? "luna" : score <= 65 ? "terra" : "sol";
  return { mode, score, reason: reasons.join("；") || "默认均衡档", signals: reasons };
}

export function routeRequest(body) {
  if (!body || body.model !== MODEL_AUTO) return { body, decision: null };

  const userText = extractLatestUserText(body);
  const classification = classifyTask(userText);
  const selectedModel = models[classification.mode];
  const reasoningEffort = reasoningEfforts[classification.mode];
  const footerLine = responseFooterLine(selectedModel, reasoningEffort);
  const routedBody = {
    ...body,
    model: selectedModel,
    reasoning: {
      ...(body.reasoning && typeof body.reasoning === "object" ? body.reasoning : {}),
      effort: reasoningEffort,
    },
  };

  if (responseFooterEnabled()) {
    const existingInstructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    routedBody.instructions = [
      existingInstructions,
      responseFooterInstruction(selectedModel, reasoningEffort),
    ].filter(Boolean).join("\n\n");
  }

  if (Object.hasOwn(body, "reasoning_effort")) {
    routedBody.reasoning_effort = reasoningEffort;
  }

  return {
    body: routedBody,
    decision: {
      ...classification,
      requestedModel: MODEL_AUTO,
      selectedModel,
      reasoningEffort,
      footerLine: responseFooterEnabled() ? footerLine : null,
      preview: userText.slice(0, 120).replace(/\s+/g, " "),
    },
  };
}
