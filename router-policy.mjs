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

const tierOrder = ["luna", "terra", "sol"];

function contextWindowFor(mode) {
  const envName = `ROUTER_${mode.toUpperCase()}_CONTEXT_TOKENS`;
  const configured = Number(process.env[envName]);
  return Number.isFinite(configured) && configured > 0 ? configured : 372_000;
}

export const modelPolicies = Object.fromEntries(tierOrder.map((mode) => [
  mode,
  {
    mode,
    model: models[mode],
    reasoningEffort: reasoningEfforts[mode],
    capabilities: {
      tools: true,
      modalities: ["text", "image"],
      contextWindowTokens: contextWindowFor(mode),
      reasoningEfforts: mode === "sol"
        ? ["low", "medium", "high", "xhigh", "max", "ultra"]
        : ["low", "medium", "high", "xhigh", "max"],
    },
  },
]));

function requirementsFrom(features) {
  return {
    tools: features.available_tool_count > 0 || features.requires_tools,
    modalities: features.modalities,
    contextTokens: features.estimated_total_tokens + features.max_output_tokens,
  };
}

function exclusionReasons(policy, requirements) {
  const reasons = [];
  if (requirements.tools && !policy.capabilities.tools) reasons.push("tools");
  for (const modality of requirements.modalities) {
    if (!policy.capabilities.modalities.includes(modality)) reasons.push(`modality:${modality}`);
  }
  if (requirements.contextTokens > policy.capabilities.contextWindowTokens) {
    reasons.push(`context:${requirements.contextTokens}>${policy.capabilities.contextWindowTokens}`);
  }
  if (!policy.capabilities.reasoningEfforts.includes(policy.reasoningEffort)) {
    reasons.push(`reasoning:${policy.reasoningEffort}`);
  }
  return reasons;
}

function selectionOrder(desiredMode) {
  const index = tierOrder.indexOf(desiredMode);
  return [
    desiredMode,
    ...tierOrder.slice(index + 1),
    ...tierOrder.slice(0, index).reverse(),
  ];
}

export function selectRoutingPolicy(classification) {
  const requirements = requirementsFrom(classification.features);
  const evaluated = tierOrder.map((mode) => {
    const policy = modelPolicies[mode];
    const reasons = exclusionReasons(policy, requirements);
    return { ...policy, exclusionReasons: reasons, eligible: reasons.length === 0 };
  });
  const eligible = evaluated.filter((item) => item.eligible);
  const desired = modelPolicies[classification.mode];

  let selected = desired;
  let capabilityFallback = false;
  let selectionReason = `分类档位 ${classification.mode} 对应 ${desired.model}`;

  if (!classification.manualOverride) {
    selected = selectionOrder(classification.mode)
      .map((mode) => evaluated.find((item) => item.mode === mode))
      .find((item) => item?.eligible) || modelPolicies.sol;
    if (selected.mode !== classification.mode) {
      capabilityFallback = true;
      selectionReason = `分类档位 ${classification.mode} 不满足请求能力，改用 ${selected.mode}`;
    } else if (eligible.length === 0) {
      capabilityFallback = true;
      selectionReason = "没有候选模型完全满足请求能力，保守使用 Sol";
    }
  } else {
    const manualEvaluation = evaluated.find((item) => item.mode === classification.mode);
    if (manualEvaluation?.exclusionReasons.length) {
      selectionReason = `人工指定 ${classification.mode}，同时记录能力提示`;
    }
  }

  return {
    requestedMode: classification.mode,
    selectedMode: selected.mode,
    selectedModel: selected.model,
    reasoningEffort: selected.reasoningEffort,
    requiredCapabilities: requirements,
    candidateModels: eligible.map((item) => item.model),
    excludedCandidates: evaluated
      .filter((item) => !item.eligible)
      .map((item) => ({ mode: item.mode, model: item.model, reasons: item.exclusionReasons })),
    capabilityFallback,
    selectionReason,
  };
}
