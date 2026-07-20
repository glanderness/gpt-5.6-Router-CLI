# GPT5.6-Router Architecture

## 目标

GPT5.6-Router 面向 Codex CLI，提供一个虚拟模型 `gpt-5.6-router`。客户端只选择一次 Router，服务在本地完成任务分类、模型策略和请求改写，再把请求发送到用户配置的、兼容 OpenAI Responses API 的上游服务。

设计目标：

- 决策完全在本地完成。
- 每个判断都能解释和记录。
- 模糊请求使用 Terra。
- 分类逻辑不直接依赖具体模型名称。
- 工具、上下文长度和输入类型进入能力筛选。
- 普通非 Router 模型请求保持原样。

## 模块边界

```text
router-signals.mjs
  请求特征、11 维信号、加权分数、置信度、档位下限

router-policy.mjs
  档位到模型与推理强度的映射、能力元数据、候选过滤

router.mjs
  组合分类层和策略层、改写上游请求、附加最终显示行

server.mjs
  HTTP 转发、流式响应、日志和上游返回信息解析
```

这个拆分融合了两类开源设计：

- ClawRouter：多维本地评分、档位下限、边界置信度和请求属性过滤。
- LiteLLM Complexity / Quality Router：复杂度分类和具体模型策略相互独立。

## 完整请求流程

```text
Codex CLI
  │ model = gpt-5.6-router
  ▼
Request Feature Extraction
  │ 最后一条用户任务
  │ 全部输入上下文 token 估算
  │ 工具数量与工具类型
  │ 输入类型
  │ 结构化输出要求
  ▼
Manual Override
  │ /luna /terra /sol
  ▼
11 Signal Extractors
  │ 每个信号输出 value、weight、contribution、evidence
  ▼
Complexity Classification
  │ 加权分数
  │ Luna / Terra / Sol 初始档位
  │ Terra / Sol 档位下限
  │ 置信度与模糊边界处理
  ▼
Policy Selection
  │ 档位 → 模型
  │ 档位 → 推理强度
  │ 工具 / 上下文 / 输入类型能力过滤
  ▼
Request Rewrite
  │ model
  │ reasoning.effort
  │ 最终回答显示行
  ▼
Configured Responses API Provider
  ▼
Response + Observability
  │ 上游实际模型
  │ 上游实际推理强度
  │ token、延迟和路由详情
```

## 请求特征

分类前先把 Responses 请求转换为结构化特征：

| 特征 | 说明 |
|---|---|
| `latest_task_tokens` | 最后一条用户任务的 token 估算 |
| `task_context_tokens` | 输入历史、消息和工具结果的 token 估算 |
| `estimated_total_tokens` | 输入加 instructions 的总 token 估算 |
| `max_output_tokens` | 请求声明的最大输出 token |
| `available_tool_count` | 请求提供的工具数量 |
| `tool_types` | 工具类型集合 |
| `requires_tools` | 任务文本或 tool choice 是否明确要求工具 |
| `modalities` | text、image、audio、file 等输入类型 |
| `structured_output` | 是否要求结构化输出 |

token 估算对 ASCII 字符使用约 `4 字符/token`，对非 ASCII 字符使用约 `1 字符/token`，目的是获得稳定的本地近似值，不增加额外模型调用。

## 11 维信号

每个信号统一输出：

```json
{
  "name": "codePresence",
  "label": "代码信号",
  "value": 1,
  "weight": 0.12,
  "contribution": 0.12,
  "evidence": ["函数", "function"]
}
```

`value` 位于 `[-1, 1]`，`contribution = value × weight`。

| 信号 | 权重 | 方向 |
|---|---:|---|
| `simpleTask` | 0.18 | 简单文本任务产生负向复杂度 |
| `reasoning` | 0.18 | 分析、研究、预测和推导产生正向复杂度 |
| `codePresence` | 0.12 | 代码、接口、数据库和测试等信号 |
| `multiStep` | 0.11 | 分阶段、连续步骤和完整流程 |
| `technicalDepth` | 0.10 | 架构、性能、协议、算法和系统设计 |
| `scope` | 0.10 | 单文件为轻微负向，多文件和完整系统为正向 |
| `constraints` | 0.06 | 格式、兼容、验证和验收条件数量 |
| `imperative` | 0.04 | 实现、构建、修改、读取和执行等动作 |
| `contextLength` | 0.05 | 当前任务上下文规模 |
| `toolRequirement` | 0.04 | 是否明确需要工具 |
| `inputModality` | 0.02 | 是否包含非文本输入 |

## 分数与档位

基础分：

```text
base = 0.38
```

最终分数：

```text
score = clamp(base + Σ(value × weight), 0, 1)
```

初始档位：

```text
score < 0.30         → Luna
0.30 ≤ score < 0.65  → Terra
score ≥ 0.65         → Sol
```

默认任务没有明显信号时分数为 `0.38`，因此默认进入 Terra。

## 档位下限

加权分数之外保留少量清晰规则：

- 强研究、深度分析或根因任务：最低 Sol。
- 多文件、完整系统或从零搭建任务：最低 Sol。
- 任务上下文超过 100,000 token：最低 Sol。
- 明确需要工具：最低 Terra。
- 结构化输出：最低 Terra。
- 非文本输入：最低 Terra。
- 人工指定：直接选择指定档位，并记录可能的能力提示。

档位下限用于处理“请求很短但本质复杂”的情况。

## 置信度与 Terra 默认路径

置信度根据分数到最近边界的距离计算：

```text
distance = min(|score - 0.30|, |score - 0.65|)
confidence = 0.5 + 0.5 × (1 - exp(-12 × distance))
```

性质：

- 分数正好位于边界时，置信度为 `0.5`。
- 距离边界越远，置信度越接近 `1.0`。
- 自动判断置信度低于 `0.65` 时，统一使用 Terra。
- 明确档位下限生效时，不会被模糊边界降回 Terra。

## 分类层与策略层

分类层输出：

```text
mode
initialMode
minimumMode
score
confidence
ambiguityFallback
signalDetails
features
```

分类层不包含具体模型名称。

策略层再完成映射：

| 档位 | 模型 | 推理强度 |
|---|---|---|
| Luna | `gpt-5.6-luna` | `low` |
| Terra | `gpt-5.6-terra` | `medium` |
| Sol | `gpt-5.6-sol` | `high` |

模型名称和上下文能力可以通过环境变量调整，不需要修改分类代码。

## 能力过滤

每个模型策略包含：

- 是否支持工具。
- 支持的输入类型。
- 上下文窗口。
- 支持的推理强度。

当前本地模型目录显示 Luna、Terra、Sol 都支持文本、图片、工具和 372,000 token 上下文。过滤流程仍然独立存在：

1. 从请求生成 `requiredCapabilities`。
2. 检查三档模型能力。
3. 记录 `candidateModels` 和 `excludedCandidates`。
4. 如果分类档位不满足要求，优先向更高档位寻找候选。
5. 如果没有候选完全满足要求，保守选择 Sol，并记录 `capabilityFallback=true`。

可以分别配置上下文窗口：

```dotenv
ROUTER_LUNA_CONTEXT_TOKENS=372000
ROUTER_TERRA_CONTEXT_TOKENS=372000
ROUTER_SOL_CONTEXT_TOKENS=372000
```

## 决策示例

### 简单任务

```text
请只回复 OK
```

```text
score=0.25, confidence=0.742
Luna → gpt-5.6-luna → low
```

### 模糊边界

```text
用一句话解释这个函数
```

```text
score=0.32, confidence=0.621
接近 Luna/Terra 边界 → Terra
```

### 强推理下限

```text
深度分析这个问题的根因
```

```text
score=0.56, initialMode=Terra
minimumMode=Sol → gpt-5.6-sol → high
```

### 工具与图片

```text
读取文件并总结 + image 输入 + function 工具
```

```text
初始分数接近 Luna
工具与非文本输入下限 → Terra
能力检查通过 → gpt-5.6-terra → medium
```

## 日志

`routing_decision` 事件记录完整决策，`response_completed` 记录最终执行结果。

重点字段：

- `routing_mode`
- `routing_classified_mode`
- `routing_score`
- `routing_confidence`
- `routing_ambiguity_fallback`
- `routing_signal_details`
- `routing_features`
- `routing_required_capabilities`
- `routing_candidate_models`
- `routing_excluded_candidates`
- `selected_model`
- `selected_reasoning_effort`
- `upstream_reported_model`
- `upstream_reported_reasoning_effort`

因此可以分别确认“分类器想选什么”“策略层实际发了什么”以及“上游明确返回了什么”。

## 当前边界

- 信号仍然是规则型，不会自动从用户反馈学习。
- token 数量是本地估算值，不是上游计费值。
- 三个 GPT-5.6 档位当前能力元数据高度相似，能力过滤主要为后续模型差异和异常输入提供稳定接口。
- 当前没有引入向量相似度；低置信度请求统一使用 Terra。
- 当前没有自动回退到第二个上游模型，策略层只负责首次选择。

后续最有价值的工作，是利用真实日志建立标注数据集，校准信号权重、阈值和置信度，而不是继续扩大单一关键词列表。
