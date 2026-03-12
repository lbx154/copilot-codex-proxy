# copilot-codex-proxy

A local proxy that lets **OpenAI Codex CLI** use your **GitHub Copilot** subscription — no OpenAI API key needed.

[English](#english) | [中文](#中文)

---

## English

### What is this?

`copilot-codex-proxy` is a lightweight local proxy server that bridges OpenAI's [Codex CLI](https://github.com/openai/codex) with the GitHub Copilot API. It lets you use models like **GPT-5.4**, **Claude**, and more through your existing GitHub Copilot subscription.

### Why?

- **Codex CLI normally requires an OpenAI API key** — that means paying for API usage out of pocket.
- **GitHub Copilot already gives you access** to GPT-5.4, Claude Sonnet 4.6, Claude Opus 4.6, Gemini, and more — included in many Individual, Business, and Enterprise plans.
- **This proxy bridges the gap**: Codex CLI speaks the Responses API; Copilot speaks Chat Completions for some models. The proxy translates automatically.

### Supported Models

| Model | API | Proxy Mode |
|---|---|---|
| `gpt-5.4` | Responses API | ✅ Passthrough |
| `gpt-5.2` | Responses API | ✅ Passthrough |
| `gpt-5.1` | Responses API | ✅ Passthrough |
| `gpt-4o` | Chat Completions | 🔄 Translated |
| `claude-sonnet-4.6` | Chat Completions | 🔄 Translated |
| `claude-opus-4.6` | Chat Completions | 🔄 Translated |
| `gemini-3-pro-preview` | Chat Completions | 🔄 Translated |

> **Passthrough** = request is forwarded directly to `api.enterprise.githubcopilot.com/v1/responses`
>
> **Translated** = proxy converts Responses API ↔ Chat Completions format automatically

### Prerequisites

- **Node.js** >= 18
- **GitHub Copilot** subscription (Individual, Business, or Enterprise)
- **OpenAI Codex CLI** — install with `npm install -g @openai/codex`
- **Supported platforms**: macOS, Linux, Windows

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/user/copilot-codex-proxy.git
cd copilot-codex-proxy

# 2. Run interactive setup (GitHub OAuth device flow)
node setup.mjs

# 3. Start the proxy
node proxy.mjs

# 4. In another terminal, use Codex normally
codex
```

Or use the all-in-one helper:

```bash
# Linux / macOS
./start-codex.sh

# Windows
start-codex.bat
```

### How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                        Your Machine                              │
│                                                                  │
│  ┌─────────┐    Responses API     ┌──────────────┐              │
│  │ Codex   │ ──────────────────►  │  proxy.mjs   │              │
│  │  CLI    │ ◄──────────────────  │  :18080       │              │
│  └─────────┘    Responses API     └──────┬───────┘              │
│                                          │                       │
└──────────────────────────────────────────┼───────────────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │   GitHub Copilot │ API              │
                        │                  ▼                  │
                        │  api.enterprise.githubcopilot.com   │
                        │                                     │
                        │  • /v1/responses  (GPT-5.x)        │
                        │  • /v1/chat/completions  (others)   │
                        └─────────────────────────────────────┘

Flow:
  1. Codex CLI sends Responses API request to localhost:18080
  2. proxy.mjs authenticates via GitHub OAuth → session token
  3. For GPT-5.x: passthrough to /v1/responses
     For others: translate to Chat Completions, call API, translate back
  4. Response streamed back to Codex CLI
```

### Configuration

Add the following to `~/.codex/config.toml`:

```toml
model = "gpt-5.4"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false
```

**Switching models** — just change the `model` line:

```toml
model = "claude-sonnet-4.6"
```

The proxy auto-detects whether the model needs passthrough or translation.

### Troubleshooting

| Problem | Solution |
|---|---|
| `Error: No OAuth token available` | Run `node setup.mjs` to authenticate |
| `Error: 401 Unauthorized` | Token expired — run `node setup.mjs` again |
| `Error: ECONNREFUSED 127.0.0.1:18080` | Proxy isn't running — start with `node proxy.mjs` |
| `Copilot access could not be verified` | Make sure you have an active GitHub Copilot subscription |
| Proxy starts but Codex hangs | Check `~/.codex/config.toml` has the correct `base_url` and `wire_api` |
| `Session token refresh failed` | Network issue — the proxy auto-retries every 15 min |

**Logs**: Check `proxy.log` in the project directory for detailed request/response logging.

### License

MIT

---

## 中文

### 这是什么？

`copilot-codex-proxy` 是一个轻量级本地代理服务器，它将 OpenAI [Codex CLI](https://github.com/openai/codex) 与 GitHub Copilot API 连接起来。让你通过现有的 GitHub Copilot 订阅使用 **GPT-5.4**、**Claude** 等模型 —— 无需 OpenAI API 密钥。

### 为什么需要它？

- **Codex CLI 通常需要 OpenAI API 密钥** —— 这意味着需要自费支付 API 使用费用。
- **GitHub Copilot 已经提供了这些模型的访问权限** —— GPT-5.4、Claude Sonnet 4.6、Claude Opus 4.6、Gemini 等，许多个人版、商业版和企业版计划都包含在内。
- **这个代理弥合了协议差异**：Codex CLI 使用 Responses API，而部分 Copilot 模型使用 Chat Completions API。代理会自动进行格式转换。

### 支持的模型

| 模型 | API 类型 | 代理模式 |
|---|---|---|
| `gpt-5.4` | Responses API | ✅ 直通 |
| `gpt-5.2` | Responses API | ✅ 直通 |
| `gpt-5.1` | Responses API | ✅ 直通 |
| `gpt-4o` | Chat Completions | 🔄 自动转换 |
| `claude-sonnet-4.6` | Chat Completions | 🔄 自动转换 |
| `claude-opus-4.6` | Chat Completions | 🔄 自动转换 |
| `gemini-3-pro-preview` | Chat Completions | 🔄 自动转换 |

> **直通** = 请求直接转发到 `api.enterprise.githubcopilot.com/v1/responses`
>
> **自动转换** = 代理自动在 Responses API 和 Chat Completions 格式之间进行转换

### 前置要求

- **Node.js** >= 18
- **GitHub Copilot** 订阅（个人版、商业版或企业版）
- **OpenAI Codex CLI** —— 通过 `npm install -g @openai/codex` 安装
- **支持平台**：macOS、Linux、Windows

### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/user/copilot-codex-proxy.git
cd copilot-codex-proxy

# 2. 运行交互式设置（GitHub OAuth 设备授权流程）
node setup.mjs

# 3. 启动代理
node proxy.mjs

# 4. 在另一个终端中正常使用 Codex
codex
```

或者使用一键启动脚本：

```bash
# Linux / macOS
./start-codex.sh

# Windows
start-codex.bat
```

### 工作原理

```
┌──────────────────────────────────────────────────────────────────┐
│                         本地机器                                  │
│                                                                  │
│  ┌─────────┐    Responses API     ┌──────────────┐              │
│  │ Codex   │ ──────────────────►  │  proxy.mjs   │              │
│  │  CLI    │ ◄──────────────────  │  :18080       │              │
│  └─────────┘    Responses API     └──────┬───────┘              │
│                                          │                       │
└──────────────────────────────────────────┼───────────────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │   GitHub Copilot │ API              │
                        │                  ▼                  │
                        │  api.enterprise.githubcopilot.com   │
                        │                                     │
                        │  • /v1/responses（GPT-5.x）         │
                        │  • /v1/chat/completions（其他模型）   │
                        └─────────────────────────────────────┘

流程：
  1. Codex CLI 发送 Responses API 请求到 localhost:18080
  2. proxy.mjs 通过 GitHub OAuth 认证，获取会话令牌
  3. GPT-5.x 模型：直接转发到 /v1/responses
     其他模型：转换为 Chat Completions 格式，调用 API，再转换回来
  4. 响应以流式方式返回给 Codex CLI
```

### 配置

在 `~/.codex/config.toml` 中添加以下内容：

```toml
model = "gpt-5.4"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false
```

**切换模型** —— 只需修改 `model` 一行：

```toml
model = "claude-sonnet-4.6"
```

代理会自动检测该模型需要直通还是格式转换。

### 常见问题

| 问题 | 解决方案 |
|---|---|
| `Error: No OAuth token available` | 运行 `node setup.mjs` 进行认证 |
| `Error: 401 Unauthorized` | 令牌已过期 —— 重新运行 `node setup.mjs` |
| `Error: ECONNREFUSED 127.0.0.1:18080` | 代理未运行 —— 执行 `node proxy.mjs` 启动 |
| `Copilot access could not be verified` | 确认你有有效的 GitHub Copilot 订阅 |
| 代理启动但 Codex 无响应 | 检查 `~/.codex/config.toml` 中的 `base_url` 和 `wire_api` 是否正确 |
| `Session token refresh failed` | 网络问题 —— 代理每 15 分钟自动重试 |

**日志**：查看项目目录中的 `proxy.log` 获取详细的请求/响应日志。

### 许可证

MIT
