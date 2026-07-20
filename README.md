# GPT5.6-Router

GPT5.6-Router 是一个面向 Codex CLI 的本地模型 Router。你只需在 Codex 中选择稳定模型标识 `gpt-5.6-router`，Router 就会根据任务复杂度，在 Luna、Terra 与 Sol 三档模型和推理强度之间自动选择。

项目同时支持当前 Codex 登录和第三方 API。默认自动检测认证方式：检测到第三方 key 时使用对应服务商，否则读取 Codex 登录状态，在 ChatGPT/Plus 与 OpenAI API key 之间选择正确的官方上游。

```text
Codex CLI
  ↓ model: gpt-5.6-router
Local Router (localhost)
  ↓ selected model + reasoning effort
Your Responses API provider
```

## 你会得到什么

- 11 个可记录、可解释的复杂度信号，而不是单一关键词判断。
- Luna / Terra / Sol 三档分类，模糊边界默认使用 Terra。
- 工具、上下文长度、输入类型和结构化输出的能力匹配。
- 最终回答单独显示实际选择的模型与推理强度。
- 日志可核对 Router 选择和上游实际返回的模型。
- 独立运行，不修改 `~/.codex/config.toml`；普通 `codex` 命令保持原样。

完整的决策设计见 [Router Architecture](docs/ROUTER_ARCHITECTURE.md)。

## 开始使用

### 1. 准备条件

- macOS 或 Linux
- Node.js 20+
- Codex CLI 0.144.0+
- ChatGPT/Plus 登录，或一个兼容 OpenAI Responses API 的第三方服务

第三方 key 只保存在权限为 `600` 的本地 `.env` 中，不会写入项目或日志。

### 2. 获取项目并安装

从 GitHub 项目页的 **Code** 按钮复制仓库地址后执行：

```bash
git clone <repository-url>
cd GPT5.6-Router
./install.sh
```

如果 Codex CLI 当前使用 ChatGPT/Plus 登录，到这里已经完成。Router 会自动使用官方 ChatGPT Codex 上游。

使用第三方 API 时：

```bash
./install.sh --upstream-base https://api.example.com/v1 --provider-key
```

安装器会隐藏输入内容，并自动切换到第三方认证。如果 key 已经保存在环境变量中，可以直接复用：

```bash
./install.sh \
  --upstream-base https://api.example.com/v1 \
  --api-key-env EXAMPLE_PROVIDER_KEY
```

安装脚本会创建独立运行目录、写入本地 `.env`、安装 `codex-router` 和 `codex-router-service` 命令，并启动 Router。`.env` 被 Git 忽略，不会随项目提交。

只安装、不立即启动服务：

```bash
./install.sh --no-start
```

之后重复运行安装脚本即可更新认证方式或上游地址，已有配置会保留。

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

若 `~/.local/bin` 不在 `PATH` 中，安装脚本会显示需要添加的路径。未进行全局安装时，可在仓库目录运行：

```bash
./codex-router
```

## 配置上游与模型

安装后的配置文件位于：

```text
~/.local/share/gpt5.6-router/app/.env
```

常用配置：

```dotenv
ROUTER_HOST=localhost
ROUTER_PORT=8788

# 默认自动选择：存在 ROUTER_API_KEY 时使用第三方认证，否则使用当前 Codex 登录。
ROUTER_AUTH_MODE=auto
ROUTER_API_KEY_ENV=ROUTER_API_KEY
ROUTER_API_KEY=

# Plus 模式可以留空；第三方认证必须填写。
ROUTER_UPSTREAM_BASE=

# 如果服务商使用不同的模型标识，可在这里覆盖。
# ROUTER_LUNA_MODEL=your-luna-model
# ROUTER_TERRA_MODEL=your-terra-model
# ROUTER_SOL_MODEL=your-sol-model

# 设置为 0 可关闭最终回答中的 Router 显示行。
ROUTER_RESPONSE_FOOTER=1
```

自动选择顺序：

1. `ROUTER_AUTH_MODE=auto` 且 `ROUTER_API_KEY_ENV` 指向的变量有值：使用第三方 key。
2. 没有第三方 key：读取 `codex login status`。
3. ChatGPT/Plus 登录使用 ChatGPT Codex 上游；OpenAI API key 登录使用 OpenAI API 上游。
4. 用户可以用 `ROUTER_AUTH_MODE=openai` 或 `provider_key` 明确指定。

查看当前选择，不启动会话：

```bash
codex-router --router-auth-status
```

输出不会包含 key 内容。

第三方上游至少需要支持：

- `POST /v1/responses`；
- 流式 Responses 响应（如果你会使用流式 Codex 请求）；
- 你配置的三个模型标识。

如果没有配置 `ROUTER_UPSTREAM_BASE`，Router 会根据 Codex 登录类型自动使用 ChatGPT Codex 或 OpenAI API 上游。第三方 key 模式缺少上游地址时会在启动前返回明确提示。

## 路由规则

| 任务类型 | 档位 | 默认推理强度 |
|---|---|---|
| 问候、翻译、润色、总结、短回复 | Luna | `low` |
| 普通开发、文件处理、工具调用、常规分析 | Terra | `medium` |
| 深度分析、研究报告、系统设计、多文件工程 | Sol | `high` |

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
  "classificationVersion": "signals-v2"
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
```

升级项目后运行：

```bash
git pull
./install.sh
```

已有 `.env` 会被保留；如需变更上游地址，重新传入 `--upstream-base` 即可。

## 本地开发与测试

```bash
npm test
```

测试覆盖三档分类、人工指定、置信度回退、能力匹配、请求转发、流式响应、上游模型日志和安装流程。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 当前范围

本项目仅面向 Codex CLI，不修改 Codex 桌面端的模型菜单，也不改变用户的主配置文件。
