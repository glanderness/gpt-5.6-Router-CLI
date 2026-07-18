# GPT-5.6 Router CLI

一个专门为 Codex CLI 设计的本地模型 Router。它在 Codex CLI 和 BeefAPI 之间运行一个独立 HTTP 服务，根据任务复杂度选择 GPT-5.6 Luna、Terra 或 Sol。

它不会修改 `~/.codex/config.toml`。只有通过 `./codex-router` 启动的 Codex CLI 会使用 Router，普通 `codex` 命令保持原样。

## 路由规则

| 任务类型 | 模型 | 推理强度 |
|---|---|---|
| 问候、翻译、润色、总结、短回复、极短问答 | GPT-5.6 Luna | `low` |
| 普通开发、文件处理、工具调用、常规分析 | GPT-5.6 Terra | `medium` |
| 深度分析、研究报告、走势预测、投资分析、系统设计、多文件工程 | GPT-5.6 Sol | `high` |

人工指定始终拥有最高优先级：

- `[省钱]`、`[luna]`、`/luna`
- `[均衡]`、`[terra]`、`/terra`
- `[最强]`、`[sol]`、`/sol`

## 工作方式

```text
Codex CLI
    ↓  model: gpt-5.6-router
Local Router 127.0.0.1:8788
    ↓  gpt-5.6-luna / terra / sol
BeefAPI
```

Router 会同时改写模型和推理强度，并在响应结束后记录上游明确返回的实际模型、推理强度和用量。

## 环境要求

- macOS 或 Linux
- Node.js 20+
- Codex CLI 0.144.0+
- Codex CLI 已经配置好可用于 BeefAPI 的 API key

Router 不保存 API key。Codex CLI 发出的认证信息会原样转发给 BeefAPI。

## 快速开始

```bash
git clone https://github.com/glanderness/gpt-5.6-Router-CLI.git
cd gpt-5.6-Router-CLI
cp .env.example .env
npm test
chmod +x codex-router router-service.sh
./codex-router
```

附带一条任务：

```bash
./codex-router "帮我润色这个标题"
./codex-router "[最强] 深度分析这个项目的架构"
```

非交互模式：

```bash
./codex-router exec "请总结 README"
```

如果 Codex CLI 不在 `PATH` 中：

```bash
CODEX_BIN=/absolute/path/to/codex ./codex-router
```

## 管理独立服务

```bash
./router-service.sh start
./router-service.sh status
./router-service.sh logs
./router-service.sh restart
./router-service.sh stop
```

默认地址为 `http://127.0.0.1:8788`，默认上游为 `https://beefapi.com/v1`。可以在 `.env` 中调整：

```dotenv
ROUTER_HOST=127.0.0.1
ROUTER_PORT=8788
ROUTER_UPSTREAM_BASE=https://beefapi.com/v1
```

## 只检查路由判断

启动服务后：

```bash
curl -sS http://127.0.0.1:8788/router/decision \
  -H 'content-type: application/json' \
  -d '{"input":"请做一份行业研究报告"}'
```

返回示例：

```json
{
  "mode": "sol",
  "selectedModel": "gpt-5.6-sol",
  "reasoningEffort": "high"
}
```

## 日志字段

服务日志默认位于：

```text
~/.local/share/gpt-5.6-router-cli/router.log
```

主要字段：

- `requested_model`：Codex CLI 请求的 Router 模型。
- `selected_model`：Router 实际发给上游的模型。
- `selected_reasoning_effort`：Router 实际发给上游的推理强度。
- `upstream_reported_model`：上游响应明确报告的模型。
- `upstream_reported_reasoning_effort`：上游响应明确报告的推理强度。
- `usage`：上游返回的 token 用量。
- `routing_score`、`routing_reason`：可解释的分类结果。

默认不记录任务正文摘要。如果确实需要调试分类，可以在 `.env` 中设置：

```dotenv
ROUTER_LOG_TASK_PREVIEW=1
```

## 测试

```bash
npm test
```

测试覆盖 Luna、Terra、Sol 分类、人工指定、推理强度映射、普通模型透传、流式响应和上游模型日志。

## 当前范围

这个仓库只面向 Codex CLI，不包含 Codex 桌面端模型菜单修改，也不会修改用户的主配置文件。
