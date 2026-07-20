const tierRank = { luna: 0, terra: 1, sol: 2 };

const manualModes = [
  { mode: "luna", markers: ["[省钱]", "[luna]", "/luna"] },
  { mode: "terra", markers: ["[均衡]", "[terra]", "/terra"] },
  { mode: "sol", markers: ["[最强]", "[sol]", "/sol"] },
];

const patterns = {
  greeting: /^(?:你好|您好|嗨|哈喽|在吗|hi|hello|hey)(?:[!！。,.，?？\s]*)$/iu,
  socialGreeting: /^(?:早上好|上午好|中午好|下午好|晚上好|早安|晚安|good\s*(?:morning|afternoon|evening|night))(?:[!！。,.，?？\s]*)$/iu,
  wellbeing: /^(?:(?:你|您)(?:今天|最近|这几天|现在)?(?:过得|感觉|状态)?(?:怎么样|好吗|还好吗|如何)|(?:今天|最近|这几天)(?:过得|感觉|状态)?(?:怎么样|好吗|还好吗|如何)|how\s+are\s+you)(?:[!！。,.，?？\s]*)$/iu,
  gratitude: /^(?:谢谢|感谢|多谢|谢了|辛苦了|thanks|thank\s+you)(?:你|您|啦|了|啊|呀|哈)?(?:[!！。,.，?？\s]*)$/iu,
  acknowledgement: /^(?:好|好的|好呀|可以|行|明白|明白了|知道了|收到|没问题|ok|okay|got\s+it)(?:啦|了|啊|呀|哈)?(?:[!！。,.，?？\s]*)$/iu,
  farewell: /^(?:再见|拜拜|回头见|下次聊|先这样|晚点聊|bye|goodbye|see\s+you)(?:啦|了|啊|呀)?(?:[!！。,.，?？\s]*)$/iu,
  lightEntertainment: /^(?:(?:给我)?(?:讲|说)(?:一个|个)?(?:笑话|段子|小故事)|(?:来|出)(?:一个|个)?谜语|讲个笑话|tell\s+me\s+a\s+(?:joke|story))(?:吧|呗|呀|啊)?(?:[!！。,.，?？\s]*)$/iu,
  casualIdentity: /^(?:你是谁|你叫什么(?:名字)?|你在(?:干嘛|做什么)|你会什么|who\s+are\s+you|what\s+can\s+you\s+do)(?:[!！。,.，?？\s]*)$/iu,
  contextDependency: /(?:刚才|之前|上面|前面|上一轮|前文|上述|按这个|照这个|基于这个)|^(?:继续|接着|然后呢|下一步|再来|往下|把这个|把那个|把它|修改它|改一下它|这个|那个|它)/iu,
  shortQuestion: /^(?:什么是|怎么|如何|能否|可以吗|在吗|多少钱|几点|what is|how do|can you)(?:.{0,36})[?？]?$/iu,
  simple: /翻译|润色|改写|总结|格式化|排版|标题|一句话|提取要点|简单问答|只回复|简短回答|直接回答|直接告诉我|translate|rewrite|summari[sz]e|format|headline|just reply|brief answer|answer directly/giu,
  reasoningStrong: /深度分析|深入研究|研究报告|走势预测|投资分析|行业研判|预测模型|根因分析|严谨推导|证明这个|系统性分析|deep analysis|research report|market forecast|investment analysis|root cause|rigorous proof/giu,
  reasoningModerate: /分析|比较|评估|权衡|原因|为什么|推理|验证思路|analy[sz]e|compare|evaluate|trade-?off|reasoning|why/giu,
  code: /```|代码|函数|接口|\bapi\b|数据库|组件|模块|脚本|测试用例|报错|编译|重构|function|class|interface|database|component|module|script|test case|refactor|compile/giu,
  multiStep: /多步骤|逐步|分阶段|分.{0,4}步|两步|三步|完整流程|先.+再|然后|第一步|第二步|步骤\s*\d+|端到端|multi-step|step by step|first.+then|end-to-end|phase\s*\d+/giu,
  technical: /架构|迁移|部署|性能优化|并发|缓存|协议|工作流|系统设计|数据结构|算法|可观测性|兼容性|architecture|migration|deployment|performance optimization|concurrency|cache|protocol|workflow|system design|data structure|algorithm|observability|compatibility/giu,
  multiScope: /多文件|跨文件|整个项目|完整项目|完整系统|从零搭建|完整实现|大规模重构|多个模块|multi-file|cross-file|entire project|complete system|from scratch|complete implementation|large refactor|multiple modules/giu,
  singleScope: /单个文件|单文件|一个文件|小改|简单修改|只改|明确修改|修复一个|single file|small change|only change|one file/giu,
  constraints: /必须|同时|不要|不能|保持|兼容|验证|测试|只允许|最多|至少|限定|格式|性能|验收|must|without|keep|compatible|verify|validate|at most|at least|format|acceptance/giu,
  imperative: /实现|构建|创建|修改|修复|设计|生成|搭建|读取|检查|运行|执行|implement|build|create|modify|fix|design|generate|read|inspect|run|execute/giu,
  toolRequirement: /读取.{0,12}文件|查看.{0,12}文件|修改.{0,12}文件|运行.{0,12}(?:测试|命令)|执行.{0,12}(?:测试|命令)|调用.{0,8}工具|使用.{0,8}(?:浏览器|终端)|检查.{0,8}(?:日志|项目)|read.{0,20}file|modify.{0,20}file|run.{0,20}(?:test|command)|use.{0,12}(?:browser|terminal)|inspect.{0,12}(?:logs|project)/giu,
};

const signalWeights = {
  simpleTask: 0.18,
  reasoning: 0.18,
  codePresence: 0.12,
  multiStep: 0.11,
  technicalDepth: 0.10,
  scope: 0.10,
  constraints: 0.06,
  imperative: 0.04,
  contextLength: 0.05,
  toolRequirement: 0.04,
  inputModality: 0.02,
};

const baseScore = 0.38;
const lunaBoundary = 0.30;
const solBoundary = 0.65;
const ambiguityConfidenceThreshold = 0.65;

const simpleIntentRules = [
  { category: "greeting", confidence: 0.99, pattern: patterns.greeting },
  { category: "social-greeting", confidence: 0.98, pattern: patterns.socialGreeting },
  { category: "wellbeing", confidence: 0.96, pattern: patterns.wellbeing },
  { category: "gratitude", confidence: 0.98, pattern: patterns.gratitude },
  { category: "acknowledgement", confidence: 0.97, pattern: patterns.acknowledgement },
  { category: "farewell", confidence: 0.98, pattern: patterns.farewell },
  { category: "light-entertainment", confidence: 0.9, pattern: patterns.lightEntertainment },
  { category: "casual-identity", confidence: 0.94, pattern: patterns.casualIdentity },
];

function uniqueMatches(text, pattern, limit = 6) {
  return [...new Set(text.match(pattern) || [])].slice(0, limit);
}

function estimateTokens(text) {
  const value = String(text || "");
  let ascii = 0;
  let nonAscii = 0;
  for (const char of value) {
    if (char.codePointAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii);
}

function inspectContent(content, stats) {
  if (typeof content === "string") {
    stats.texts.push(content);
    stats.modalities.add("text");
    return;
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    inspectContent([content], stats);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (typeof item === "string") {
      stats.texts.push(item);
      stats.modalities.add("text");
      continue;
    }
    const type = String(item?.type || "").toLowerCase();
    if (type === "input_text" || type === "text" || type === "output_text") {
      if (typeof item.text === "string") stats.texts.push(item.text);
      stats.modalities.add("text");
    } else if (type === "function_call_output" || type === "tool_result") {
      if (typeof item.output === "string") stats.texts.push(item.output);
      if (typeof item.content === "string") stats.texts.push(item.content);
      stats.modalities.add("text");
    } else if (type.includes("image")) {
      stats.modalities.add("image");
    } else if (type.includes("audio")) {
      stats.modalities.add("audio");
    } else if (type.includes("file")) {
      stats.modalities.add("file");
    }
  }
}

function textFromContent(content) {
  const stats = { texts: [], modalities: new Set() };
  inspectContent(content, stats);
  return stats.texts.join("\n");
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

export function extractRequestFeatures(body = {}) {
  const inputStats = { texts: [], modalities: new Set() };
  const input = body?.input;
  let userMessageCount = 0;

  if (typeof input === "string") {
    inspectContent(input, inputStats);
    userMessageCount = 1;
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item?.role === "user") userMessageCount += 1;
      if (item?.content !== undefined) inspectContent(item.content, inputStats);
      else inspectContent(item, inputStats);
    }
  }

  if (inputStats.modalities.size === 0) inputStats.modalities.add("text");
  const latestUserText = extractLatestUserText(body);
  const inputText = inputStats.texts.join("\n");
  const instructions = typeof body?.instructions === "string" ? body.instructions : "";
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const toolTypes = [...new Set(tools.map((tool) => String(tool?.type || "unknown")))];
  const toolChoiceRequired = body?.tool_choice === "required" || body?.tool_choice?.type === "required";
  const textRequiresTools = patterns.toolRequirement.test(latestUserText);
  patterns.toolRequirement.lastIndex = 0;
  const maxOutputTokens = Number.isFinite(body?.max_output_tokens)
    ? Math.max(0, Number(body.max_output_tokens))
    : 0;
  const simpleIntent = simpleIntentRules.find((rule) => rule.pattern.test(latestUserText.trim())) || null;
  const contextDependent = patterns.contextDependency.test(latestUserText.trim());

  return {
    latestUserText,
    normalizedText: latestUserText.trim().toLowerCase(),
    userMessageCount,
    taskContextTokens: estimateTokens(inputText),
    latestTaskTokens: estimateTokens(latestUserText),
    estimatedTotalTokens: estimateTokens(`${instructions}\n${inputText}`),
    maxOutputTokens,
    availableToolCount: tools.length,
    toolTypes,
    requiresTools: toolChoiceRequired || textRequiresTools,
    toolChoiceRequired,
    modalities: [...inputStats.modalities].sort(),
    hasStructuredOutput: Boolean(
      body?.response_format
      || (body?.text?.format?.type && body.text.format.type !== "text")
    ),
    simpleIntent: simpleIntent
      ? { category: simpleIntent.category, confidence: simpleIntent.confidence, evidence: latestUserText.trim() }
      : null,
    contextDependent,
    contextDependencyEvidence: contextDependent ? latestUserText.trim().slice(0, 80) : null,
  };
}

function signal(name, label, value, evidence = []) {
  const weight = signalWeights[name];
  const roundedValue = Math.max(-1, Math.min(1, value));
  return {
    name,
    label,
    value: Number(roundedValue.toFixed(3)),
    weight,
    contribution: Number((roundedValue * weight).toFixed(4)),
    evidence,
  };
}

export function extractComplexitySignals(features) {
  const text = features.normalizedText;
  const simpleEvidence = uniqueMatches(text, patterns.simple);
  const greeting = patterns.greeting.test(features.latestUserText.trim());
  const shortQuestion = patterns.shortQuestion.test(features.latestUserText.trim());
  const simpleValue = -Math.min(
    1,
    (greeting ? 1 : 0)
      + (simpleEvidence.length ? 0.75 : 0)
      + (shortQuestion ? 0.45 : 0),
  );

  const strongReasoning = uniqueMatches(text, patterns.reasoningStrong);
  const moderateReasoning = uniqueMatches(text, patterns.reasoningModerate);
  const reasoningValue = strongReasoning.length
    ? 1
    : Math.min(0.8, moderateReasoning.length * 0.35);

  const codeEvidence = uniqueMatches(text, patterns.code);
  const codeBlock = text.includes("```");
  const codeValue = codeBlock || codeEvidence.length >= 2 ? 1 : (codeEvidence.length ? 0.65 : 0);

  const multiStepEvidence = uniqueMatches(text, patterns.multiStep);
  const multiStepValue = multiStepEvidence.length >= 2 ? 1 : (multiStepEvidence.length ? 0.6 : 0);

  const technicalEvidence = uniqueMatches(text, patterns.technical);
  const technicalValue = technicalEvidence.length >= 2 ? 1 : (technicalEvidence.length ? 0.6 : 0);

  const multiScopeEvidence = uniqueMatches(text, patterns.multiScope);
  const singleScopeEvidence = uniqueMatches(text, patterns.singleScope);
  const scopeValue = multiScopeEvidence.length ? 1 : (singleScopeEvidence.length ? -0.35 : 0);

  const constraintEvidence = uniqueMatches(text, patterns.constraints);
  if (features.hasStructuredOutput) constraintEvidence.push("structured-output");
  const constraintValue = Math.min(1, constraintEvidence.length / 4);

  const imperativeEvidence = uniqueMatches(text, patterns.imperative);
  const imperativeValue = Math.min(0.8, imperativeEvidence.length * 0.25);

  const contextValue = features.taskContextTokens > 100_000
    ? 1
    : features.taskContextTokens > 30_000
      ? 0.7
      : features.taskContextTokens > 8_000
        ? 0.35
        : 0;

  const nonTextModalities = features.modalities.filter((item) => item !== "text");
  const modalityValue = Math.min(1, nonTextModalities.length * 0.5);

  return [
    signal("simpleTask", "简单任务", simpleValue, [
      ...(greeting ? ["greeting"] : []),
      ...(shortQuestion ? ["short-question"] : []),
      ...simpleEvidence,
    ]),
    signal("reasoning", "推理深度", reasoningValue, [...strongReasoning, ...moderateReasoning]),
    signal("codePresence", "代码信号", codeValue, codeEvidence),
    signal("multiStep", "多步骤", multiStepValue, multiStepEvidence),
    signal("technicalDepth", "技术深度", technicalValue, technicalEvidence),
    signal("scope", "任务范围", scopeValue, [...multiScopeEvidence, ...singleScopeEvidence]),
    signal("constraints", "约束数量", constraintValue, constraintEvidence),
    signal("imperative", "执行型指令", imperativeValue, imperativeEvidence),
    signal("contextLength", "上下文长度", contextValue, contextValue ? [`${features.taskContextTokens} tokens`] : []),
    signal("toolRequirement", "工具需求", features.requiresTools ? 0.65 : 0, features.requiresTools ? features.toolTypes : []),
    signal("inputModality", "输入类型", modalityValue, nonTextModalities),
  ];
}

function modeForScore(score) {
  if (score < lunaBoundary) return "luna";
  if (score < solBoundary) return "terra";
  return "sol";
}

function maxMode(left, right) {
  return tierRank[left] >= tierRank[right] ? left : right;
}

export function confidenceForScore(score) {
  const distance = Math.min(Math.abs(score - lunaBoundary), Math.abs(score - solBoundary));
  return Number((0.5 + 0.5 * (1 - Math.exp(-12 * distance))).toFixed(3));
}

function evaluateLunaEligibility(features, signalDetails) {
  const exclusions = [];
  if (!features.simpleIntent) exclusions.push("no-explicit-simple-intent");
  if (features.contextDependent) exclusions.push("context-dependent-request");
  if (features.latestTaskTokens > 80) exclusions.push("latest-task-too-long");
  if (features.taskContextTokens > 8_000) exclusions.push("context-too-long");
  if (features.requiresTools) exclusions.push("tools-required");
  if (features.hasStructuredOutput) exclusions.push("structured-output");
  if (features.modalities.some((item) => item !== "text")) exclusions.push("non-text-input");

  for (const name of ["reasoning", "codePresence", "multiStep", "technicalDepth", "scope"]) {
    const detail = signalDetails.find((item) => item.name === name);
    if (detail?.value > 0) exclusions.push(`complex-signal:${name}`);
  }
  const constraints = signalDetails.find((item) => item.name === "constraints");
  if (constraints?.value > 0.25) exclusions.push("multiple-constraints");

  return {
    eligible: Boolean(features.simpleIntent) && exclusions.length === 0,
    category: features.simpleIntent?.category || null,
    confidence: features.simpleIntent?.confidence || 0,
    evidence: features.simpleIntent?.evidence || null,
    exclusions,
  };
}

function featureSummary(features) {
  return {
    latest_task_tokens: features.latestTaskTokens,
    task_context_tokens: features.taskContextTokens,
    estimated_total_tokens: features.estimatedTotalTokens,
    max_output_tokens: features.maxOutputTokens,
    user_message_count: features.userMessageCount,
    available_tool_count: features.availableToolCount,
    tool_types: features.toolTypes,
    requires_tools: features.requiresTools,
    modalities: features.modalities,
    structured_output: features.hasStructuredOutput,
    simple_intent: features.simpleIntent,
    context_dependent: features.contextDependent,
    context_dependency_evidence: features.contextDependencyEvidence,
  };
}

export function classifyRequest(body = {}) {
  const features = extractRequestFeatures(body);
  const lower = features.normalizedText;

  for (const rule of manualModes) {
    if (rule.markers.some((marker) => lower.includes(marker.toLowerCase()))) {
      return {
        mode: rule.mode,
        initialMode: rule.mode,
        minimumMode: rule.mode,
        score: null,
        normalizedScore: null,
        confidence: 1,
        ambiguityFallback: false,
        manualOverride: true,
        classificationPath: "manual-override",
        lunaEligibility: null,
        reason: `人工指定 ${rule.mode}`,
        signals: ["manual override"],
        signalDetails: [],
        features: featureSummary(features),
        classificationVersion: "signals-v3",
      };
    }
  }

  const signalDetails = extractComplexitySignals(features);
  const normalizedScore = Math.max(
    0,
    Math.min(1, baseScore + signalDetails.reduce((sum, item) => sum + item.contribution, 0)),
  );
  const roundedScore = Number(normalizedScore.toFixed(3));
  const initialMode = modeForScore(roundedScore);
  const lunaEligibility = evaluateLunaEligibility(features, signalDetails);

  if (lunaEligibility.eligible) {
    return {
      mode: "luna",
      initialMode,
      minimumMode: "luna",
      score: Math.round(roundedScore * 100),
      normalizedScore: roundedScore,
      confidence: lunaEligibility.confidence,
      ambiguityFallback: false,
      manualOverride: false,
      classificationPath: "luna-eligibility",
      lunaEligibility,
      reason: `明确简单意图 ${lunaEligibility.category}；Luna 资格通过；基础加权分 ${Math.round(roundedScore * 100)}`,
      signals: [`简单对话 ${lunaEligibility.category}`],
      signalDetails,
      features: featureSummary(features),
      classificationVersion: "signals-v3",
    };
  }

  let minimumMode = "luna";
  const floorReasons = [];

  const reasoning = signalDetails.find((item) => item.name === "reasoning");
  const scope = signalDetails.find((item) => item.name === "scope");
  if (reasoning?.value === 1) {
    minimumMode = "sol";
    floorReasons.push("强推理或研究任务最低使用 Sol");
  }
  if (scope?.value === 1) {
    minimumMode = "sol";
    floorReasons.push("跨文件或完整系统任务最低使用 Sol");
  }
  if (features.taskContextTokens > 100_000) {
    minimumMode = "sol";
    floorReasons.push("超大任务上下文最低使用 Sol");
  } else if (
    features.requiresTools
    || features.hasStructuredOutput
    || features.modalities.some((item) => item !== "text")
  ) {
    minimumMode = maxMode(minimumMode, "terra");
    floorReasons.push("工具、结构化输出或非文本输入最低使用 Terra");
  }
  if (features.contextDependent) {
    minimumMode = maxMode(minimumMode, "terra");
    floorReasons.push("请求依赖上一轮上下文，最低使用 Terra");
  }

  let mode = maxMode(initialMode, minimumMode);
  let confidence = confidenceForScore(roundedScore);
  let ambiguityFallback = false;
  const floorApplied = tierRank[minimumMode] > tierRank[initialMode];

  if (floorApplied) confidence = Math.max(confidence, 0.9);
  else if (confidence < ambiguityConfidenceThreshold) {
    mode = "terra";
    ambiguityFallback = true;
  }

  const triggered = signalDetails.filter((item) => item.value !== 0);
  const signalSummaries = triggered.map((item) => {
    const contribution = Math.round(item.contribution * 100);
    return `${item.label} ${contribution > 0 ? "+" : ""}${contribution}`;
  });
  const reasons = [
    `加权分 ${Math.round(roundedScore * 100)}`,
    `初始档位 ${initialMode}`,
    `置信度 ${confidence.toFixed(3)}`,
    ...floorReasons,
    ...(ambiguityFallback ? ["接近档位边界，统一使用 Terra"] : []),
  ];

  return {
    mode,
    initialMode,
    minimumMode,
    score: Math.round(roundedScore * 100),
    normalizedScore: roundedScore,
    confidence: Number(confidence.toFixed(3)),
    ambiguityFallback,
    manualOverride: false,
    classificationPath: "weighted-signals",
    lunaEligibility,
    reason: reasons.join("；"),
    signals: signalSummaries.length ? signalSummaries : ["默认均衡档"],
    signalDetails,
    features: featureSummary(features),
    classificationVersion: "signals-v3",
  };
}

export function classifyTask(text) {
  return classifyRequest({ input: String(text || "") });
}
