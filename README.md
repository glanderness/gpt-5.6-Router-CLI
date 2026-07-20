# GPT5.6-Router

GPT5.6-Router 是一个面向 Codex CLI 的本地模型 Router。你只需在 Codex 中选择稳定模型标识 `gpt-5.6-router`，Router 就会根据任务复杂度，在 Luna、Terra 与 Sol 三档模型和推理强度之间自动选择。

项目不会要求你再配置一次上游。它会读取原生 Codex 当前选中的 Provider，复用已有的上游地址和认证方式：ChatGPT/Plus、OpenAI API key，以及兼容 Responses API 的第三方 Provider 都可以沿用。

```text
Codex CLI
  ↓ model: gpt-5.6-router
Local Router (localhost)
  ↓ selected model + reasoning effort
Your Responses API provider
```

## 你会得到什么

- 11 个可记录、可解释的复杂度信号，而不是单一关键词判断。
- 独立的 Luna 资格层，让明确的日常对话优先使用低延迟档位。
- Luna / Terra / Sol 三档分类，模糊边界默认使用 Terra。
- 工具、上下文长度、输入类型和结构化输出的能力匹配。
- 最终回答单独显示实际选择的模型与推理强度。
- 日志可核对 Router 选择和上游实际返回的模型。
- 独立运行，不修改 `~/.codex/config.toml`；普通 `codex` 命令保持原样。

## 原生 Codex 隔离保证

GPT5.6-Router 只在用户主动运行 `codex-router` 时生效。安装和运行过程中：

- 不创建或替换名为 `codex` 的命令；
- 不修改 `~/.codex/config.toml`、Codex 登录状态、默认模型或已有会话；
- Router 使用的 `-c` 和 `-m` 参数只作用于当前 `codex-router` 进程；
- 不向父终端写入环境变量；普通 `codex` 不会连接本地 Router；
- 若没有登录，Router 会停止并提示用户自行处理，不会主动运行登录命令；
- 安装器发现同名命令属于其他程序时会停止，不会覆盖它。

完整的隔离边界和验证矩阵见 [Codex Isolation](docs/CODEX_ISOLATION.md)。

因此可以在同一个终端中并行使用：

```bash
codex         # 用户原来的 Codex CLI
codex-router  # 仅本次会话使用 GPT5.6-Router
```

完整的决策设计见 [Router Architecture](docs/ROUTER_ARCHITECTURE.md)。

## 开始使用

准备条件：macOS 或 Linux、Node.js 20+、Codex CLI 0.144.0+。

### 1. 先让原生 Codex 正常工作

先按照 Codex 自己的流程完成一种上游配置：

- 使用 ChatGPT/Plus 登录；
- 使用 OpenAI API key 登录；
- 或在 Codex 配置中选中一个兼容 Responses API 的第三方 Provider。

然后直接运行 `codex`，确认它可以正常完成一条简单任务。GPT5.6-Router 不负责创建登录、不修改 `~/.codex/config.toml`，也不会替换原来的 `codex` 命令。

### 2. 一条命令安装 Router

确认原生 Codex 可用后，运行：

```bash
curl -fsSL https://raw.githubusercontent.com/glanderness/GPT5.6-Router/main/bootstrap.sh | bash
```

安装器会自动读取并复用当前 Codex 的：

- `model_provider`；
- Provider 的 `base_url` 和 `wire_api`；
- `requires_openai_auth` 或 `env_key` 认证方式。

它只读取认证配置，不读取、复制或显示 key 内容。配置不完整时，安装会停止并指出应先修正哪一项。

如果你更希望先查看本地文件，也可以使用源码安装：

```bash
git clone https://github.com/glanderness/GPT5.6-Router.git
cd GPT5.6-Router
./install.sh
```

只安装、不立即启动服务：`./install.sh --no-start`。

### 3. 运行

```bash
codex-router
```

也可以直接带一条任务：

```bash
codex-router "帮我润色这个标题"
codex-router "[最强] 深度分析这个项目的架构"
codex-router exec "请总结 README"
```

若 `~/.local/bin` 不在 `PATH` 中，安装器会显示需要添加的路径。源码目录中也可以直接运行：

```bash
./codex-router
```

## 自动复用 Codex 上游

安装后的配置文件位于：

```text
~/.local/share/gpt5.6-router/app/.env
```

常用配置：

```dotenv
ROUTER_HOST=localhost
ROUTER_PORT=8788

# 默认读取当前 Codex Provider。通常不需要修改下面三项。
ROUTER_AUTH_MODE=auto
ROUTER_API_KEY_ENV=ROUTER_API_KEY
ROUTER_API_KEY=

# 可选的高级上游覆盖；正常安装保持为空。
ROUTER_UPSTREAM_BASE=

# 如果服务商使用不同的模型标识，可在这里覆盖。
# ROUTER_LUNA_MODEL=your-luna-model
# ROUTER_TERRA_MODEL=your-terra-model
# ROUTER_SOL_MODEL=your-sol-model

# 设置为 0 可关闭最终回答中的 Router 显示行。
ROUTER_RESPONSE_FOOTER=1
```

自动选择顺序：

1. 如果 Router 自己设置了高级覆盖，使用覆盖值；
2. 否则读取当前 Codex 的 `model_provider` 和对应 Provider 配置；
3. 自定义 Provider 复用其 `base_url`，并匹配 `requires_openai_auth`、`env_key` 或无认证模式；
4. 默认官方 Provider 根据当前 Codex 登录类型选择 ChatGPT Codex 或 OpenAI API 上游。

查看当前选择，不启动会话：

```bash
codex-router --router-auth-status
```

输出会显示 Provider 名称、认证来源和上游地址，但不会包含 key 内容。

第三方上游至少需要支持：

- `POST /v1/responses`；
- 流式 Responses 响应（如果你会使用流式 Codex 请求）；
- 你配置的三个模型标识。

第三方 Provider 必须使用 `wire_api = "responses"`。如果 Provider 使用 `env_key`，对应环境变量需要像运行原生 Codex 时一样在当前终端可用。

只有在无法复用原生配置或需要临时切换时，才建议使用高级覆盖：

```bash
./install.sh --upstream-base https://api.example.com/v1 --api-key-env EXAMPLE_PROVIDER_KEY
```

交互输入 key 的 `--provider-key` 仍然保留；只有这种高级方式会把 key 写入权限为 `600` 的 Router 本地 `.env`。

## 路由规则

| 任务类型 | 档位 | 默认推理强度 |
|---|---|---|
| 问候、翻译、润色、总结、短回复 | Luna | `low` |
| 普通开发、文件处理、工具调用、常规分析 | Terra | `medium` |
| 深度分析、研究报告、系统设计、多文件工程 | Sol | `high` |

在加权复杂度评分之前，Router 会先执行 Luna 资格判断。问候、关心、致谢、确认、告别、轻量娱乐等明确简单意图，在纯文本、无需工具、不依赖上一轮且没有复杂信号时直接使用 Luna。

“继续”“按刚才的方案执行”“把这个修改一下”等请求虽然很短，但依赖历史上下文，因此最低使用 Terra。Codex 提供了工具但当前任务没有要求使用时，不会阻止日常对话进入 Luna。

自动判断使用加权复杂度分数：

```text
Luna  < 0.30
Terra 0.30–0.65
Sol   ≥ 0.65
```

当分数接近边界、置信度低于 `0.65` 时，统一使用 Terra。深度研究、多文件或完整系统任务最低使用 Sol；明确需要工具、结构化输出或非文本输入时最低使用 Terra。

人工指定优先级最高：

- `[省钱]`、`[luna]`、`/luna`
- `[均衡]`、`[terra]`、`/terra`
- `[最强]`、`[sol]`、`/sol`

## 验证安装

检查服务状态：

```bash
codex-router-service status
```

只检查路由判断，不请求上游：

```bash
curl -sS http://localhost:8788/router/decision \
  -H 'content-type: application/json' \
  -d '{"input":"请做一份行业研究报告"}'
```

预期结果包含：

```json
{
  "selectedModel": "gpt-5.6-sol",
  "reasoningEffort": "high",
  "classificationVersion": "signals-v3"
}
```

执行一次完整请求后，可查看日志：

```bash
codex-router-service logs
```

重点字段：

- `selected_model`、`selected_reasoning_effort`：Router 实际发送的选择。
- `upstream_reported_model`、`upstream_reported_reasoning_effort`：上游实际返回的选择。
- `routing_signal_details`、`routing_confidence`：分类依据与置信度。
- `routing_required_capabilities`、`routing_candidate_models`：能力匹配结果。

默认不记录任务正文摘要。如需临时调试分类，可在 `.env` 中设置：

```dotenv
ROUTER_LOG_TASK_PREVIEW=1
```

## 常用管理命令

```bash
codex-router-service start
codex-router-service status
codex-router-service logs
codex-router-service restart
codex-router-service ensure
codex-router-service stop
codex-router-uninstall
```

`codex-router-uninstall` 只删除本项目安装目录、运行日志和本项目创建的三个命令链接，不修改 Codex 主配置或登录信息。

升级项目后运行：

```bash
git pull
./install.sh
```

已有 `.env` 会被保留。原生 Codex Provider 发生变化后，下次运行 `codex-router` 会重新读取并刷新本地服务。

## 本地开发与测试

```bash
npm test
```

测试覆盖三档分类、人工指定、置信度回退、能力匹配、请求转发、流式响应、上游模型日志和安装流程。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 当前范围

本项目仅面向 Codex CLI，不修改 Codex 桌面端的模型菜单，也不改变用户的主配置文件。
