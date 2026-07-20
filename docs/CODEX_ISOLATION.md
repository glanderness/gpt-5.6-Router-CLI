# Codex CLI Isolation

GPT5.6-Router 的设计目标是：只有用户主动运行 `codex-router` 时才改变当前进程的模型连接方式，普通 `codex` 始终保持原有行为。

## 原生状态

项目不会写入或删除：

- `~/.codex/config.toml`；
- Codex 登录状态；
- Codex 已保存的会话；
- 用户原有的 `codex` 可执行文件；
- 用户 Shell 的 PATH 配置或启动文件。

Router 会只读检查当前 Codex 登录状态和可用的模型服务配置，以便选择合适的上游连接。检查结果只进入当前 Router 进程，不会写回 Codex。

## Router 自有状态

默认情况下，项目只创建：

```text
~/.local/share/gpt5.6-router/app
~/.local/share/gpt5.6-router/router.log
~/.local/share/gpt5.6-router/router-error.log
~/.local/share/gpt5.6-router/router.pid
~/.local/bin/codex-router
~/.local/bin/codex-router-service
~/.local/bin/codex-router-uninstall
```

安装器不会创建名为 `codex` 的命令。若三个 Router 命令中的任何一个已被其他程序占用，安装会停止并保留原文件。

## 当前进程覆盖

`codex-router` 调用原生 Codex CLI 时使用命令行 `-c` 和 `-m` 参数，设置当前进程使用的模型服务、模型目录和推理强度。Codex CLI 将 `-c` 定义为对本次调用的配置覆盖；这些参数不会写入 `~/.codex/config.toml`。

Router 的 `.env` 只在启动脚本的子进程中加载，不会修改调用它的父终端环境。

## 登录行为

Router 只执行只读的 `codex login status` 检查。若没有可用登录，Router 会停止并给出提示，不会主动执行 `codex login`、`codex logout` 或修改登录文件。

默认情况下，Router 只读取第三方 Provider 的配置字段和 `env_key` 名称，不复制 key 内容。只有用户主动使用 `--provider-key` 高级选项时，输入值才会保存在权限为 `600` 的 Router `.env` 中，并与 Codex 主配置分离。

## 卸载边界

`codex-router-uninstall` 仅在识别到本项目安装标记时执行，并且只删除：

- Router 自己的应用目录；
- Router 自己的 PID 与日志文件；
- 明确指向本项目安装目录的三个命令链接。

如果命令链接已经指向其他程序，卸载器会保留它。

## 自动验证

测试使用临时 HOME 创建原生 Codex 配置、登录状态和 `codex` 命令，然后执行安装与卸载。测试要求这些原生文件在操作前后逐字一致，同时验证：

- 无登录时不会调用登录命令；
- 同名命令冲突时安装停止且原文件不变；
- 卸载后 Router 文件消失，Codex 原生文件仍存在；
- Router 的命令行配置只传给当前 Codex 子进程。
