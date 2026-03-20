# copilot-codex-proxy

A local proxy that lets **OpenAI Codex CLI** and **Claude Code** use your **GitHub Copilot** subscription — no OpenAI / Anthropic API key needed.

[English](#english) | [中文](#中文)

---

## English

### What is this?

`copilot-codex-proxy` is a lightweight local proxy server that bridges [OpenAI Codex CLI](https://github.com/openai/codex) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with the GitHub Copilot API. It lets you use models like **GPT-5.4**, **Claude Sonnet 4.6**, **Claude Opus 4.6**, and more through your existing GitHub Copilot subscription.

### Why?

- **Codex CLI requires an OpenAI API key**, **Claude Code requires an Anthropic API key** — both mean paying for API usage out of pocket.
- **GitHub Copilot already gives you access** to GPT-5.4, Claude Sonnet 4.6, Claude Opus 4.6, Gemini, and more — included in many Individual, Business, and Enterprise plans.
- **This proxy bridges the gap**: it translates between the APIs that these tools expect and the GitHub Copilot API, all automatically.

### Supported Models

| Model | Route via Proxy |
|---|---|
| `gpt-5.4` | ✅ Responses API passthrough |
| `gpt-5.2` | ✅ Responses API passthrough |
| `gpt-5.1` | ✅ Responses API passthrough |
| `claude-sonnet-4.6` | ✅ Anthropic Messages API (direct / translated from Responses) |
| `claude-opus-4.6` | ✅ Anthropic Messages API (direct / translated from Responses) |
| `claude-haiku-4.5` | ✅ Anthropic Messages API (direct / translated from Responses) |
| `gpt-4o` | 🔄 Chat Completions translation |
| `gemini-3-pro-preview` | 🔄 Chat Completions translation |

> **Passthrough** = request forwarded directly to `api.enterprise.githubcopilot.com`
>
> **Anthropic Messages API** = Claude Code sends native Anthropic requests; Codex sends Responses API which gets translated to Anthropic Messages
>
> **Chat Completions translation** = proxy converts Responses API ↔ Chat Completions format

### Supported Clients

| Client | Protocol | Status |
|---|---|---|
| [OpenAI Codex CLI](https://github.com/openai/codex) | Responses API (`/v1/responses`) | ✅ All models |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Anthropic Messages API (`/v1/messages`) | ✅ Claude models |

### Prerequisites

- **Node.js** >= 18
- **GitHub Copilot** subscription (Individual, Business, or Enterprise)
- **Supported platforms**: macOS, Linux, Windows

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/lbx154/copilot-codex-proxy.git
cd copilot-codex-proxy

# 2. Run interactive setup (GitHub OAuth device flow)
node setup.mjs

# 3. Start the proxy
node proxy.mjs
```

### Configuration for Codex CLI

> Codex CLI communicates via the **Responses API**. The proxy handles all model routing automatically.

**Step 1**: Install Codex CLI

```bash
npm install -g @openai/codex
```

**Step 2**: Add the following to `~/.codex/config.toml`:

```toml
model = "gpt-5.4"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false
```

**Step 3**: Start the proxy, then use Codex:

```bash
# Terminal 1
node proxy.mjs

# Terminal 2
codex
```

Or use the all-in-one helper:

```bash
# Linux / macOS
./start-codex.sh

# Windows
start-codex.bat
```

**Switching models** — just change the `model` line in `config.toml`:

```toml
model = "claude-sonnet-4.6"   # Claude models
model = "gpt-5.4"             # GPT models
model = "gpt-4o"              # Older GPT models (auto-translated)
```

The proxy auto-detects model type and routes accordingly:
- **Claude models** → Responses API is translated to Anthropic Messages API → Copilot
- **GPT-5.x** → Responses API passthrough → Copilot
- **Other models** → Responses API translated to Chat Completions → Copilot

### Configuration for Claude Code

> Claude Code communicates via the **Anthropic Messages API**. The proxy passes requests directly to Copilot's Anthropic-compatible endpoint.

**Step 1**: Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

**Step 2**: Start the proxy:

```bash
node proxy.mjs
```

**Step 3**: Launch Claude Code with these environment variables:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:18080 \
ANTHROPIC_API_KEY=copilot-proxy \
claude
```

> **Note**: `ANTHROPIC_API_KEY` can be set to any non-empty string (e.g. `copilot-proxy`). The proxy ignores it and uses GitHub Copilot authentication instead.

**Optional**: To avoid setting env vars every time, add them to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=copilot-proxy
```

Then simply run:

```bash
claude
```

**Specifying a model**: Claude Code uses `claude-sonnet-4-5` by default. To use a different model:

```bash
claude --model claude-sonnet-4.6
claude --model claude-opus-4.6
```

> The proxy automatically normalizes model names: `claude-sonnet-4-6` → `claude-sonnet-4.6`, so both formats work.

### How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                        Your Machine                              │
│                                                                  │
│  ┌─────────┐    Responses API     ┌──────────────┐              │
│  │ Codex   │ ──────────────────►  │              │              │
│  │  CLI    │ ◄──────────────────  │              │              │
│  └─────────┘                      │  proxy.mjs   │              │
│                                   │  :18080       │              │
│  ┌─────────┐    Anthropic API     │              │              │
│  │ Claude  │ ──────────────────►  │              │              │
│  │  Code   │ ◄──────────────────  │              │              │
│  └─────────┘                      └──────┬───────┘              │
│                                          │                       │
└──────────────────────────────────────────┼───────────────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │   GitHub Copilot │ API              │
                        │                  ▼                  │
                        │  api.enterprise.githubcopilot.com   │
                        │                                     │
                        │  • /v1/responses  (GPT-5.x)        │
                        │  • /v1/messages   (Claude)          │
                        │  • /chat/completions (others)       │
                        └─────────────────────────────────────┘

Codex CLI flow:
  1. Codex sends Responses API request → proxy
  2. GPT-5.x → passthrough to /v1/responses
     Claude  → translated to Anthropic Messages API → /v1/messages
     Others  → translated to Chat Completions → /chat/completions
  3. Response streamed back to Codex

Claude Code flow:
  1. Claude Code sends Anthropic Messages API request → proxy
  2. Proxy forwards directly to /v1/messages (passthrough)
  3. Response streamed back to Claude Code
```

### API Endpoints

The proxy exposes the following endpoints on `http://127.0.0.1:18080`:

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/v1/models` or `/models` | GET | List available models (proxied from Copilot) |
| `/v1/responses` or `/responses` | POST | Responses API (for Codex CLI) |
| `/v1/messages` or `/messages` | POST | Anthropic Messages API (for Claude Code) |

### Advanced Options

**Custom port**:

```bash
node proxy.mjs --port 9090
```

Remember to update `base_url` in Codex config and `ANTHROPIC_BASE_URL` for Claude Code accordingly.

### Troubleshooting

| Problem | Solution |
|---|---|
| `Error: No OAuth token available` | Run `node setup.mjs` to authenticate |
| `Error: 401 Unauthorized` | Token expired — run `node setup.mjs` again |
| `Error: ECONNREFUSED 127.0.0.1:18080` | Proxy isn't running — start with `node proxy.mjs` |
| `Copilot access could not be verified` | Make sure you have an active GitHub Copilot subscription |
| Proxy starts but Codex hangs | Check `~/.codex/config.toml` has the correct `base_url` and `wire_api` |
| Claude Code returns auth errors | Make sure `ANTHROPIC_BASE_URL` is set and `ANTHROPIC_API_KEY` is non-empty |
| Claude Code model not found | Try `claude --model claude-sonnet-4.6` explicitly |
| `Session token refresh failed` | Network issue — the proxy auto-retries every 15 min |

**Logs**: Check `proxy.log` in the project directory, or watch the terminal where `node proxy.mjs` is running.

### License

MIT

---

## 中文

### 这是什么？

`copilot-codex-proxy` 是一个轻量级本地代理服务器，它将 [OpenAI Codex CLI](https://github.com/openai/codex) 和 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 与 GitHub Copilot API 连接起来。让你通过现有的 GitHub Copilot 订阅使用 **GPT-5.4**、**Claude Sonnet 4.6**、**Claude Opus 4.6** 等模型 —— 无需 OpenAI / Anthropic API 密钥。

### 为什么需要它？

- **Codex CLI 需要 OpenAI API 密钥**，**Claude Code 需要 Anthropic API 密钥** —— 都意味着自费支付 API 使用费用。
- **GitHub Copilot 已经提供了这些模型的访问权限** —— GPT-5.4、Claude Sonnet 4.6、Claude Opus 4.6、Gemini 等，许多个人版、商业版和企业版计划都包含在内。
- **这个代理弥合了协议差异**：自动在各工具期望的 API 协议和 GitHub Copilot API 之间进行转换。

### 支持的模型

| 模型 | 代理路由方式 |
|---|---|
| `gpt-5.4` | ✅ Responses API 直通 |
| `gpt-5.2` | ✅ Responses API 直通 |
| `gpt-5.1` | ✅ Responses API 直通 |
| `claude-sonnet-4.6` | ✅ Anthropic Messages API（直通 / 从 Responses 转换） |
| `claude-opus-4.6` | ✅ Anthropic Messages API（直通 / 从 Responses 转换） |
| `claude-haiku-4.5` | ✅ Anthropic Messages API（直通 / 从 Responses 转换） |
| `gpt-4o` | 🔄 Chat Completions 转换 |
| `gemini-3-pro-preview` | 🔄 Chat Completions 转换 |

### 支持的客户端

| 客户端 | 协议 | 状态 |
|---|---|---|
| [OpenAI Codex CLI](https://github.com/openai/codex) | Responses API (`/v1/responses`) | ✅ 支持所有模型 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Anthropic Messages API (`/v1/messages`) | ✅ 支持 Claude 模型 |

### 前置要求

- **Node.js** >= 18
- **GitHub Copilot** 订阅（个人版、商业版或企业版）
- **支持平台**：macOS、Linux、Windows

### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/lbx154/copilot-codex-proxy.git
cd copilot-codex-proxy

# 2. 运行交互式设置（GitHub OAuth 设备授权流程）
node setup.mjs

# 3. 启动代理
node proxy.mjs
```

### 配置 Codex CLI

> Codex CLI 通过 **Responses API** 通信，代理会自动处理所有模型路由。

**第一步**：安装 Codex CLI

```bash
npm install -g @openai/codex
```

**第二步**：在 `~/.codex/config.toml` 中添加以下内容：

```toml
model = "gpt-5.4"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false
```

**第三步**：启动代理，然后使用 Codex：

```bash
# 终端 1
node proxy.mjs

# 终端 2
codex
```

或者使用一键启动脚本：

```bash
# Linux / macOS
./start-codex.sh

# Windows
start-codex.bat
```

**切换模型** —— 只需修改 `config.toml` 中的 `model` 一行：

```toml
model = "claude-sonnet-4.6"   # Claude 模型
model = "gpt-5.4"             # GPT 模型
model = "gpt-4o"              # 旧版 GPT 模型（自动转换）
```

代理会自动检测模型类型并选择路由：
- **Claude 模型** → Responses API 转换为 Anthropic Messages API → Copilot
- **GPT-5.x** → Responses API 直通 → Copilot
- **其他模型** → Responses API 转换为 Chat Completions → Copilot

### 配置 Claude Code

> Claude Code 通过 **Anthropic Messages API** 通信，代理将请求直接转发到 Copilot 的 Anthropic 兼容端点。

**第一步**：安装 Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

**第二步**：启动代理：

```bash
node proxy.mjs
```

**第三步**：通过环境变量启动 Claude Code：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:18080 \
ANTHROPIC_API_KEY=copilot-proxy \
claude
```

> **注意**：`ANTHROPIC_API_KEY` 可以设置为任意非空字符串（如 `copilot-proxy`）。代理会忽略它，使用 GitHub Copilot 认证。

**可选**：为避免每次都设置环境变量，可以将其添加到 shell 配置文件（`~/.bashrc`、`~/.zshrc` 等）：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=copilot-proxy
```

之后直接运行即可：

```bash
claude
```

**指定模型**：Claude Code 默认使用 `claude-sonnet-4-5`，如需使用其他模型：

```bash
claude --model claude-sonnet-4.6
claude --model claude-opus-4.6
```

> 代理会自动规范化模型名称：`claude-sonnet-4-6` → `claude-sonnet-4.6`，两种格式均可使用。

### 工作原理

```
┌──────────────────────────────────────────────────────────────────┐
│                         本地机器                                  │
│                                                                  │
│  ┌─────────┐    Responses API     ┌──────────────┐              │
│  │ Codex   │ ──────────────────►  │              │              │
│  │  CLI    │ ◄──────────────────  │              │              │
│  └─────────┘                      │  proxy.mjs   │              │
│                                   │  :18080       │              │
│  ┌─────────┐    Anthropic API     │              │              │
│  │ Claude  │ ──────────────────►  │              │              │
│  │  Code   │ ◄──────────────────  │              │              │
│  └─────────┘                      └──────┬───────┘              │
│                                          │                       │
└──────────────────────────────────────────┼───────────────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │   GitHub Copilot │ API              │
                        │                  ▼                  │
                        │  api.enterprise.githubcopilot.com   │
                        │                                     │
                        │  • /v1/responses  (GPT-5.x)        │
                        │  • /v1/messages   (Claude)          │
                        │  • /chat/completions（其他模型）     │
                        └─────────────────────────────────────┘

Codex CLI 流程：
  1. Codex 发送 Responses API 请求 → 代理
  2. GPT-5.x → 直通转发到 /v1/responses
     Claude  → 转换为 Anthropic Messages API → /v1/messages
     其他    → 转换为 Chat Completions → /chat/completions
  3. 响应以流式方式返回给 Codex

Claude Code 流程：
  1. Claude Code 发送 Anthropic Messages API 请求 → 代理
  2. 代理直接转发到 /v1/messages（直通）
  3. 响应以流式方式返回给 Claude Code
```

### API 端点

代理在 `http://127.0.0.1:18080` 上暴露以下端点：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/v1/models` 或 `/models` | GET | 列出可用模型（从 Copilot 代理获取） |
| `/v1/responses` 或 `/responses` | POST | Responses API（供 Codex CLI 使用） |
| `/v1/messages` 或 `/messages` | POST | Anthropic Messages API（供 Claude Code 使用） |

### 高级选项

**自定义端口**：

```bash
node proxy.mjs --port 9090
```

需要相应更新 Codex 配置中的 `base_url` 和 Claude Code 的 `ANTHROPIC_BASE_URL`。

### 常见问题

| 问题 | 解决方案 |
|---|---|
| `Error: No OAuth token available` | 运行 `node setup.mjs` 进行认证 |
| `Error: 401 Unauthorized` | 令牌已过期 —— 重新运行 `node setup.mjs` |
| `Error: ECONNREFUSED 127.0.0.1:18080` | 代理未运行 —— 执行 `node proxy.mjs` 启动 |
| `Copilot access could not be verified` | 确认你有有效的 GitHub Copilot 订阅 |
| 代理启动但 Codex 无响应 | 检查 `~/.codex/config.toml` 中的 `base_url` 和 `wire_api` 是否正确 |
| Claude Code 报认证错误 | 确认 `ANTHROPIC_BASE_URL` 已设置且 `ANTHROPIC_API_KEY` 非空 |
| Claude Code 找不到模型 | 尝试显式指定 `claude --model claude-sonnet-4.6` |
| `Session token refresh failed` | 网络问题 —— 代理每 15 分钟自动重试 |

**日志**：查看项目目录中的 `proxy.log`，或查看运行 `node proxy.mjs` 的终端输出。

### 许可证

MIT
