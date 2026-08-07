import { classifyRequest, extractLatestUserText } from "./router-signals.mjs";
import { models, reasoningEfforts, selectRoutingPolicy } from "./router-policy.mjs";
import {
  normalizeContextLineage,
  normalizeRoutingIntent,
} from "./runtime-contracts.mjs";

export const MODEL_AUTO = process.env.ROUTER_AUTO_MODEL || "gpt-5.6-router";
export { classifyRequest, classifyTask, confidenceForScore, extractComplexitySignals, extractLatestUserText, extractRequestFeatures } from "./router-signals.mjs";
export { modelPolicies, models, reasoningEfforts, selectRoutingPolicy } from "./router-policy.mjs";

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

export function routeRequest(body) {
  if (!body || body.model !== MODEL_AUTO) return { body, decision: null };

  const latestUserText = extractLatestUserText(body);
  const classification = classifyRequest(body);
  const policy = selectRoutingPolicy(classification);
  const routingIntent = normalizeRoutingIntent(body.routing_intent);
  const contextLineage = normalizeContextLineage(body.context_lineage);
  const footerLine = responseFooterLine(policy.selectedModel, policy.reasoningEffort);
  const upstreamInput = Object.fromEntries(
    Object.entries(body).filter(([key]) => (
      key !== "routing_intent" && key !== "context_lineage"
    )),
  );
  const routedBody = {
    ...upstreamInput,
    model: policy.selectedModel,
    reasoning: {
      ...(body.reasoning && typeof body.reasoning === "object" ? body.reasoning : {}),
      effort: policy.reasoningEffort,
    },
  };

  if (responseFooterEnabled()) {
    const existingInstructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    routedBody.instructions = [
      existingInstructions,
      responseFooterInstruction(policy.selectedModel, policy.reasoningEffort),
    ].filter(Boolean).join("\n\n");
  }

  if (Object.hasOwn(body, "reasoning_effort")) {
    routedBody.reasoning_effort = policy.reasoningEffort;
  }

  return {
    body: routedBody,
    decision: {
      ...classification,
      mode: policy.selectedMode,
      classifiedMode: classification.mode,
      requestedModel: MODEL_AUTO,
      selectedModel: policy.selectedModel,
      reasoningEffort: policy.reasoningEffort,
      policyReason: policy.selectionReason,
      requiredCapabilities: policy.requiredCapabilities,
      candidateModels: policy.candidateModels,
      excludedCandidates: policy.excludedCandidates,
      capabilityFallback: policy.capabilityFallback,
      routingIntent,
      routingResolution: {
        model: policy.selectedModel,
        reasoningEffort: policy.reasoningEffort,
        fallbackAllowed: routingIntent.fallback_allowed,
      },
      contextLineage,
      footerLine: responseFooterEnabled() ? footerLine : null,
      preview: latestUserText.slice(0, 120).replace(/\s+/g, " "),
    },
  };
}
