<table>
  <tr>
    <td align="center"><strong>找优质算力就上 BeefAPI</strong></td>
    <td align="center">
      <strong>算力网址</strong><br>
      <a href="https://beefapi.com/">https://beefapi.com/</a>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3 align="center">个人联系方式</h3>
      <p>如果大家对于这个 Skill 或者 AI 自媒体、创业感兴趣，可以直接扫描右侧二维码，添加我的企业微信来找我聊天。</p>
    </td>
    <td width="50%" align="center">
      <strong>我的二维码</strong><br><br>
      <img src="assets/lucas-wecom-qr.png" alt="Lucas 企业微信二维码" width="360">
    </td>
  </tr>
</table>

## Router 系统图

GPT5.6-Router 的核心思路是：Codex CLI 始终只选择虚拟模型 `gpt-5.6-router`，本地 Router 再根据当前任务特征选择 Luna、Terra 或 Sol，并将改写后的 Responses 请求发送到用户已配置的上游 Provider。

<table>
  <tr>
    <td align="center">
      <strong>① 用户入口</strong><br><br>
      <code>codex-router</code><br>
      Codex CLI<br>
      <code>gpt-5.6-router</code>
    </td>
    <td align="center">→</td>
    <td align="center">
      <strong>② 启动与认证</strong><br><br>
      检测 Codex 登录模式<br>
      读取当前 Provider<br>
      启动或复用本地服务
    </td>
    <td align="center">→</td>
    <td align="center">
      <strong>③ 本地 HTTP Router</strong><br><br>
      <code>127.0.0.1:8788/v1</code><br>
      <code>server.mjs</code><br>
      <code>POST /v1/responses</code>
    </td>
  </tr>
  <tr>
    <td colspan="5" align="center">↓ 请求进入本地决策链</td>
  </tr>
  <tr>
    <td align="center">
      <strong>④ 特征提取</strong><br><br>
      最后一条任务<br>
      上下文长度<br>
      工具与输入类型<br>
      结构化输出
    </td>
    <td align="center">→</td>
    <td align="center">
      <strong>⑤ 复杂度分类</strong><br><br>
      人工指定<br>
      Luna 资格层<br>
      11 维加权信号<br>
      档位下限与 Terra 模糊边界
    </td>
    <td align="center">→</td>
    <td align="center">
      <strong>⑥ 模型策略</strong><br><br>
      档位到模型映射<br>
      推理强度映射<br>
      工具、图片和上下文<br>
      能力匹配
    </td>
  </tr>
  <tr>
    <td colspan="5" align="center">↓ 改写 <code>model</code> 与 <code>reasoning.effort</code></td>
  </tr>
  <tr>
    <td align="center">
      <strong>Luna</strong><br>
      <code>gpt-5.6-luna</code><br>
      <code>low</code><br>
      明确的简单对话
    </td>
    <td align="center">或</td>
    <td align="center">
      <strong>Terra</strong><br>
      <code>gpt-5.6-terra</code><br>
      <code>medium</code><br>
      日常工作与模糊边界
    </td>
    <td align="center">或</td>
    <td align="center">
      <strong>Sol</strong><br>
      <code>gpt-5.6-sol</code><br>
      <code>high</code><br>
      强推理与完整系统任务
    </td>
  </tr>
  <tr>
    <td colspan="5" align="center">↓ 发送到已配置的 Responses API Provider</td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <strong>⑦ 上游 Provider</strong><br><br>
      ChatGPT / Plus<br>
      OpenAI API<br>
      第三方 Responses Provider
    </td>
    <td align="center">→</td>
    <td colspan="2" align="center">
      <strong>⑧ 响应与可观测性</strong><br><br>
      透传流式或非流式响应<br>
      记录实际模型与推理强度<br>
      记录路由理由、耗时与用量
    </td>
  </tr>
</table>

### 核心路径

<table>
  <thead>
    <tr>
      <th>路径</th>
      <th>执行链</th>
      <th>用途</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>启动路径</strong></td>
      <td><code>codex-router</code> → 检测登录与 Provider → <code>router-service.sh ensure</code> → 临时 Codex 参数</td>
      <td>只修改当前 Router 进程的连接方式，不写入用户原有 Codex 配置。</td>
    </tr>
    <tr>
      <td><strong>主路由路径</strong></td>
      <td><code>POST /v1/responses</code> → <code>routeRequest()</code> → 特征与分类 → 策略选择 → 请求改写 → 上游</td>
      <td>只对 <code>gpt-5.6-router</code> 执行动态选择，其他模型请求保持原样。</td>
    </tr>
    <tr>
      <td><strong>简单任务路径</strong></td>
      <td>人工指定优先；否则检查 Luna 资格；再否则进入 11 维加权分类</td>
      <td>明确的短对话优先 Luna；不满足资格时再进入完整评分链。</td>
    </tr>
    <tr>
      <td><strong>能力匹配路径</strong></td>
      <td>分类档位 → 工具 / 图片 / 上下文检查 → 候选模型 → 最终模型</td>
      <td>分类与具体模型解耦；当目标档位不满足请求时，优先选择能力合适的更高档位。</td>
    </tr>
    <tr>
      <td><strong>响应路径</strong></td>
      <td>上游响应 → SSE 或 JSON 解析 → Codex CLI → <code>response_completed</code> 日志</td>
      <td>返回内容保持透传，同时记录上游明确返回的模型和推理强度。</td>
    </tr>
  </tbody>
</table>

### 辅助接口与运行路径

<table>
  <thead>
    <tr>
      <th>接口或文件</th>
      <th>作用</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>GET /v1/models</code></td>
      <td>转发上游模型目录，并加入虚拟模型 <code>gpt-5.6-router</code>。</td>
    </tr>
    <tr>
      <td><code>GET /health</code></td>
      <td>返回本地服务状态、认证模式、登录来源和当前上游地址。</td>
    </tr>
    <tr>
      <td><code>POST /router/decision</code></td>
      <td>只返回本地路由决策，用于检查分类结果，不发送到上游。</td>
    </tr>
    <tr>
      <td><code>~/.local/share/gpt5.6-router/router.log</code></td>
      <td>记录请求、决策、实际模型、推理强度、耗时和用量。</td>
    </tr>
    <tr>
      <td><code>~/.local/share/gpt5.6-router/router-error.log</code></td>
      <td>记录本地服务运行期间的错误输出。</td>
    </tr>
  </tbody>
</table>

更完整的分类规则、权重和日志字段见 [Router Architecture](docs/ROUTER_ARCHITECTURE.md)。

# GPT5.6-Router

GPT5.6-Router 是一个面向 Codex CLI 的本地模型 Router。你只需在 Codex 中选择稳定模型标识 `gpt-5.6-router`，Router 就会根据任务复杂度，在 Luna、Terra 与 Sol 三档模型和推理强度之间自动选择。

项目不会要求你再配置一次上游。它会读取原生 Codex 当前选中的 Provider，复用已有的上游地址和认证方式：ChatGPT/Plus、OpenAI API key，以及兼容 Responses API 的第三方 Provider 都可以沿用。

```text
Codex CLI
  ↓ model: gpt-5.6-router
Local Router (127.0.0.1)
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
ROUTER_HOST=127.0.0.1
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
curl -sS http://127.0.0.1:8788/router/decision \
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
