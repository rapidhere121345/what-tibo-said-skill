# What Tibo Said

一个本地 Codex Plugin / Skill / MCP：检测到明确的 GPT-backed Codex 套餐额度耗尽提示后，生成一条俏皮的 X 帖子并 `@tibo` 请求重置。

默认只预览，不会发帖。只有显式设置 `WHAT_TIBO_SAID_LIVE=1` 后，匹配到额度耗尽信号才会发布。

## 行为

- 只处理 `gpt-*` 模型对应的 Codex GPT 套餐额度；其他模型或缺少模型时直接忽略。
- 识别周/月使用额度耗尽、credits 用尽等明确账户级错误。
- 忽略普通 HTTP 429、瞬时限流、网络故障和关于 quota 的一般讨论。
- 发布独立新帖，不尝试回复其他人的帖子。
- 有可解析的重置时间时，只附带相对剩余时长。
- 本地信息仅包含验证后的 GPT 模型名和操作系统/架构。
- 内置全局冷却与并发锁；默认 24 小时最多成功发布一次。
- 失败不消耗冷却时间，也不会自动重试。
- 公共帖子不包含精确重置日期、时区、UTC/GMT 偏移、位置、原始错误、主机名、用户名、路径、IP、会话 ID 或令牌。

示例文案：

> @tibo my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄
>
> Reset: 3d 8h left · gpt-5.6-sol · linux/x64

## 组成

- `.codex-plugin/plugin.json`：插件清单。
- `hooks/hooks.json`：在 `Stop` / `SubagentStop` 时检查最后一条助手消息。
- `skills/ask-tibo-quota-reset/`：触发与安全边界说明。
- `.mcp.json`：启动本地 stdio MCP。
- `src/`：检测、文案、冷却状态和 X API 客户端。

## 构建与验证

需要 Node.js 22 或更高版本：

```bash
npm install
npm run check
```

构建完成后，把本目录作为本地插件源安装到 Codex。插件入口是 `.codex-plugin/plugin.json`；本项目不会修改用户级 Codex 配置或插件市场。

## X API 配置

1. 在 X Developer Console 创建应用，并取得 OAuth 2.0 **user access token**。
2. 为令牌授予 `tweet.read`、`tweet.write`、`users.read` scopes。
3. 先保持 dry-run，确认预览文案和检测结果。
4. 确认后再开启 live 模式：

```bash
read -rsp 'X user access token: ' X_USER_ACCESS_TOKEN
export X_USER_ACCESS_TOKEN
export WHAT_TIBO_SAID_LIVE=0
```

准备允许自动发帖时：

```bash
export WHAT_TIBO_SAID_LIVE=1
```

其他可选变量见 `.env.example`。状态默认写入插件数据目录、`XDG_STATE_HOME` 或用户 state 目录，也可用 `WHAT_TIBO_SAID_STATE_DIR` 指定。

X 的创建帖子接口是 `POST https://api.x.com/2/tweets`。截至 2026-09-09，X 文档列出的无 URL Create Post 单价为每次请求 0.015 美元；价格可能变化，启用 live 前请重新查看 [X API pricing](https://docs.x.com/x-api/getting-started/pricing) 和 [Create Posts](https://docs.x.com/x-api/posts/create-post)。

## MCP 工具

- `preview_quota_reset`：只生成预览；必须传 `gpt-*` 模型，可附带错误文本和手动 `reset_at`。
- `handle_quota_signal`：先检测，再按 live 开关和冷却策略处理。
- `request_quota_reset`：用户明确要求时手动触发；可传 `reset_at`，仍受 live 开关和冷却保护。

工具返回 `dry_run`、`ignored_not_quota`、`ignored_unsupported_model`、`deduplicated`、`posted`、`config_error` 或 `error`，不会把 access token 写进结果或日志。

## 自动检测边界

自动 Hook 只能检查一次正常结束时可获得的 `last_assistant_message`。如果额度错误发生在模型生成任何助手消息之前，Hook 可能拿不到错误文本，因此无法保证自动识别；这时可在仍可运行的 Codex 会话中手动调用 `request_quota_reset`。这是触发点本身的可见性限制，不通过放宽检测规则来猜测。

## 安全默认值

- dry-run 默认开启。
- 只有通过严格校验的 `gpt-*` 模型才能进入发帖流程；GLM、未知模型和 IP 形式字符串均被拒绝。
- live 模式缺少 `X_USER_ACCESS_TOKEN` 时直接返回配置错误。
- X 请求超时 10 秒，仅接受 HTTP 201，不自动重试。
- 状态文件权限为 `0600`，目录为 `0700`。
- 测试使用模拟 X 客户端，不会向 X 发出真实请求。
