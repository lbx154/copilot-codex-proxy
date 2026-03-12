#!/usr/bin/env node
/**
 * Copilot Responses API Proxy
 *
 * Proxies OpenAI Responses API requests to the GitHub Copilot enterprise API
 * using session tokens obtained from /copilot_internal/v2/token.
 *
 * For models available via Chat Completions only (e.g. gpt-4o),
 * translates Responses API → Chat Completions and back.
 *
 * For models available via Responses API (e.g. gpt-5.4), passes through directly.
 *
 * Usage:
 *   node proxy.mjs [--port PORT]
 *
 * Requires a VS Code Copilot OAuth token in ~/.copilot-proxy/vscode-token.json
 * (auto-created on first run via device code flow).
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const HOME = os.homedir();
const VSCODE_CLIENT_ID = "01ab8ac9400c4e429b23";
const VSCODE_TOKEN_PATH = path.join(HOME, ".copilot-proxy", "vscode-token.json");
const COPILOT_CONFIG_PATH = path.join(HOME, ".copilot", "config.json");

// ---------------------------------------------------------------------------
// Token management: OAuth token → session token
// ---------------------------------------------------------------------------

let oauthToken = "";
let sessionToken = "";
let sessionExpiry = 0;
let apiHost = "api.enterprise.githubcopilot.com";
let apiPathPrefix = "";

function loadOAuthToken() {
  // First try dedicated vscode token file
  if (fs.existsSync(VSCODE_TOKEN_PATH)) {
    const data = JSON.parse(fs.readFileSync(VSCODE_TOKEN_PATH, "utf-8"));
    return data.access_token;
  }
  // Fall back to copilot CLI token
  if (fs.existsSync(COPILOT_CONFIG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(COPILOT_CONFIG_PATH, "utf-8"));
    const tokens = cfg.copilot_tokens ?? {};
    const first = Object.values(tokens)[0];
    if (first) return first;
  }
  return "";
}

function saveOAuthToken(token) {
  const dir = path.dirname(VSCODE_TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VSCODE_TOKEN_PATH, JSON.stringify({ access_token: token }));
}

function httpsJson(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (d) => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({ _raw: body, _status: res.statusCode }); }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function refreshSessionToken() {
  if (!oauthToken) throw new Error("No OAuth token available");

  const data = await httpsJson({
    hostname: "api.github.com",
    path: "/copilot_internal/v2/token",
    method: "GET",
    headers: {
      Authorization: `token ${oauthToken}`,
      Accept: "application/json",
      "User-Agent": "copilot-proxy/1.0",
      "Editor-Version": "vscode/1.96.0",
      "Editor-Plugin-Version": "copilot/1.300.0",
    },
  });

  if (!data.token) {
    throw new Error(`Failed to get session token: ${JSON.stringify(data).slice(0, 200)}`);
  }

  sessionToken = data.token;
  sessionExpiry = data.expires_at ?? 0;

  if (data.endpoints?.api) {
    const url = new URL(data.endpoints.api);
    apiHost = url.hostname;
    apiPathPrefix = url.pathname.replace(/\/$/, "");
  }

  console.log(`[proxy] Session token refreshed, expires at ${new Date(sessionExpiry * 1000).toISOString()}`);
  console.log(`[proxy] API endpoint: https://${apiHost}${apiPathPrefix}`);
  return sessionToken;
}

async function getSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  // Refresh 60 seconds before expiry
  if (sessionToken && sessionExpiry > now + 60) {
    return sessionToken;
  }
  return refreshSessionToken();
}

// Initialize
oauthToken = loadOAuthToken();
if (!oauthToken) {
  console.error("[proxy] No OAuth token found. Please save a VS Code Copilot OAuth token to", VSCODE_TOKEN_PATH);
  console.error('[proxy] Format: {"access_token": "gho_..."}');
  process.exit(1);
}
console.log(`[proxy] OAuth token loaded (${oauthToken.slice(0, 8)}...)`);

// Get initial session token
await refreshSessionToken();

// Refresh session token periodically (every 15 minutes)
setInterval(async () => {
  try { await refreshSessionToken(); }
  catch (err) { console.error(`[proxy] Token refresh failed: ${err.message}`); }
}, 15 * 60 * 1000);

// ---------------------------------------------------------------------------
// Responses API  →  Chat Completions translation
// ---------------------------------------------------------------------------

/**
 * Convert Responses API `input` (string | array) into Chat Completions
 * `messages` array.
 */
function inputToMessages(input, instructions) {
  const messages = [];

  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  if (!Array.isArray(input)) {
    messages.push({ role: "user", content: String(input) });
    return messages;
  }

  for (const item of input) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }

    // Message-type items
    if (item.type === "message") {
      const content = Array.isArray(item.content)
        ? item.content.map(c => {
            if (c.type === "input_text") return { type: "text", text: c.text };
            if (c.type === "input_image") return { type: "image_url", image_url: { url: c.image_url ?? c.url } };
            if (c.type === "input_audio") return { type: "text", text: "[audio input]" };
            return { type: "text", text: c.text ?? JSON.stringify(c) };
          })
        : item.content;
      messages.push({ role: item.role, content });
      continue;
    }

    // Function call output (tool result)
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output,
      });
      continue;
    }

    // Function call item → assistant message with tool_calls
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id: item.call_id ?? item.id,
            type: "function",
            function: {
              name: item.name,
              arguments: item.arguments,
            },
          },
        ],
        content: null,
      });
      continue;
    }

    // Fallback: treat as user message
    if (item.content) {
      messages.push({ role: item.role ?? "user", content: item.content });
    }
  }

  return messages;
}

/**
 * Convert Responses API `tools` to Chat Completions `tools`.
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  const result = [];
  for (const t of tools) {
    if (t.type === "function") {
      result.push({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: t.strict,
        },
      });
    }
    // web_search, file_search etc. are Copilot/OpenAI specific – skip for now
  }
  return result.length > 0 ? result : undefined;
}

function buildChatRequest(body) {
  const messages = inputToMessages(body.input, body.instructions);
  const req = {
    model: body.model,
    messages,
    stream: true,
  };

  const tools = convertTools(body.tools);
  if (tools) req.tools = tools;

  if (body.temperature != null) req.temperature = body.temperature;
  if (body.top_p != null) req.top_p = body.top_p;
  if (body.max_output_tokens != null) req.max_tokens = body.max_output_tokens;
  if (body.max_tokens != null) req.max_tokens = body.max_tokens;

  return req;
}

// ---------------------------------------------------------------------------
// Chat Completions SSE  →  Responses API SSE translation
// ---------------------------------------------------------------------------

function responsesEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

class ResponsesStreamWriter {
  constructor(res) {
    this.res = res;
    this.responseId = `resp_${randomUUID().replace(/-/g, "")}`;
    this.outputIndex = 0;
    this.contentPartIndex = 0;
    this.textSoFar = "";
    this.currentToolCalls = {};
    this.headersSent = false;
    this.model = "gpt-4o";
  }

  sendHeaders() {
    if (this.headersSent) return;
    this.headersSent = true;
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
  }

  write(event, data) {
    this.sendHeaders();
    this.res.write(responsesEvent(event, data));
  }

  emitCreated() {
    this.write("response.created", {
      type: "response.created",
      response: {
        id: this.responseId,
        object: "response",
        status: "in_progress",
        model: this.model,
        output: [],
      },
    });
    this.write("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: this.responseId,
        object: "response",
        status: "in_progress",
        model: this.model,
        output: [],
      },
    });
  }

  emitTextStart() {
    const itemId = `item_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.currentItemId = itemId;
    this.write("response.output_item.added", {
      type: "response.output_item.added",
      output_index: this.outputIndex,
      item: {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    });
    this.write("response.content_part.added", {
      type: "response.content_part.added",
      output_index: this.outputIndex,
      content_index: this.contentPartIndex,
      part: { type: "output_text", text: "" },
    });
  }

  emitTextDelta(delta) {
    this.textSoFar += delta;
    this.write("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: this.outputIndex,
      content_index: this.contentPartIndex,
      delta,
    });
  }

  emitTextDone() {
    this.write("response.output_text.done", {
      type: "response.output_text.done",
      output_index: this.outputIndex,
      content_index: this.contentPartIndex,
      text: this.textSoFar,
    });
    this.write("response.content_part.done", {
      type: "response.content_part.done",
      output_index: this.outputIndex,
      content_index: this.contentPartIndex,
      part: { type: "output_text", text: this.textSoFar },
    });
    this.write("response.output_item.done", {
      type: "response.output_item.done",
      output_index: this.outputIndex,
      item: {
        id: this.currentItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: this.textSoFar }],
      },
    });
    this.outputIndex++;
    this.textSoFar = "";
  }

  emitToolCallDelta(toolCall) {
    const id = toolCall.index ?? 0;
    if (!this.currentToolCalls[id]) {
      this.currentToolCalls[id] = {
        callId: toolCall.id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        name: "",
        arguments: "",
      };
    }
    const tc = this.currentToolCalls[id];
    if (toolCall.id) tc.callId = toolCall.id;
    if (toolCall.function?.name) tc.name += toolCall.function.name;
    if (toolCall.function?.arguments) tc.arguments += toolCall.function.arguments;
  }

  emitToolCallsDone() {
    for (const [, tc] of Object.entries(this.currentToolCalls)) {
      const itemId = `item_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      this.write("response.output_item.added", {
        type: "response.output_item.added",
        output_index: this.outputIndex,
        item: {
          id: itemId,
          type: "function_call",
          call_id: tc.callId,
          name: tc.name,
          arguments: "",
          status: "in_progress",
        },
      });

      // Emit arguments as delta
      if (tc.arguments) {
        this.write("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          output_index: this.outputIndex,
          delta: tc.arguments,
        });
      }

      this.write("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        output_index: this.outputIndex,
        arguments: tc.arguments,
      });

      this.write("response.output_item.done", {
        type: "response.output_item.done",
        output_index: this.outputIndex,
        item: {
          id: itemId,
          type: "function_call",
          call_id: tc.callId,
          name: tc.name,
          arguments: tc.arguments,
          status: "completed",
        },
      });
      this.outputIndex++;
    }
    this.currentToolCalls = {};
  }

  emitCompleted(usage) {
    this.write("response.completed", {
      type: "response.completed",
      response: {
        id: this.responseId,
        object: "response",
        status: "completed",
        model: this.model,
        usage: usage
          ? {
              input_tokens: usage.prompt_tokens ?? 0,
              output_tokens: usage.completion_tokens ?? 0,
              total_tokens: usage.total_tokens ?? 0,
            }
          : undefined,
      },
    });
    this.res.end();
  }

  emitError(message) {
    this.sendHeaders();
    this.write("error", {
      type: "error",
      message,
    });
    this.res.end();
  }
}

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------

function copilotHeaders(contentLength) {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${sessionToken}`,
    "X-GitHub-Api-Version": "2025-05-01",
    "Copilot-Integration-Id": "vscode-chat",
    "Openai-Intent": "conversation-agent",
    "X-Initiator": "user",
    "Editor-Version": "vscode/1.96.0",
    "Editor-Plugin-Version": "copilot/1.300.0",
  };
  if (contentLength != null) h["Content-Length"] = contentLength;
  return h;
}

/**
 * Passthrough: forward Responses API request directly to Copilot Responses API.
 * Used for models that natively support the Responses API (e.g. gpt-5.4).
 * Returns a Promise that resolves to true on success, false on unsupported model.
 */
function forwardResponsesPassthrough(body, res, fallbackFn) {
  const payload = JSON.stringify(body);
  const isStream = body.stream !== false;

  const options = {
    hostname: apiHost,
    port: 443,
    path: `${apiPathPrefix}/v1/responses`,
    method: "POST",
    headers: copilotHeaders(Buffer.byteLength(payload)),
  };

  console.log(`[proxy] Passthrough → https://${apiHost}${apiPathPrefix}/v1/responses (model=${body.model})`);

  const req = https.request(options, (upstream) => {
    if (upstream.statusCode !== 200) {
      let errBody = "";
      upstream.on("data", (d) => errBody += d);
      upstream.on("end", () => {
        // If the model doesn't support Responses API, fall back to translation
        if (errBody.includes("unsupported_api_for_model") && fallbackFn) {
          console.log(`[proxy] Model ${body.model} doesn't support Responses API, falling back to Chat Completions`);
          fallbackFn();
          return;
        }
        console.error(`[proxy] Upstream error ${upstream.statusCode}: ${errBody}`);
        res.writeHead(upstream.statusCode, { "Content-Type": "application/json" });
        res.end(errBody);
      });
      return;
    }

    // Stream the response directly back to client
    const ct = isStream ? "text/event-stream" : "application/json";
    res.writeHead(200, {
      "Content-Type": ct,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    upstream.pipe(res);
  });

  req.on("error", (err) => {
    console.error(`[proxy] Passthrough error: ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: err.message } }));
  });

  req.write(payload);
  req.end();
}

/**
 * Translation: convert Responses API → Chat Completions for models
 * that only support Chat Completions (e.g. gpt-4o).
 */
function forwardToCopilot(chatBody, writer) {
  const payload = JSON.stringify(chatBody);

  const options = {
    hostname: apiHost,
    port: 443,
    path: `${apiPathPrefix}/chat/completions`,
    method: "POST",
    headers: copilotHeaders(Buffer.byteLength(payload)),
  };

  const req = https.request(options, (upstream) => {
    if (upstream.statusCode !== 200) {
      let body = "";
      upstream.on("data", (d) => (body += d));
      upstream.on("end", () => {
        console.error(`[proxy] Upstream error ${upstream.statusCode}: ${body}`);
        writer.emitError(`Upstream error ${upstream.statusCode}: ${body}`);
      });
      return;
    }

    writer.model = chatBody.model;
    writer.emitCreated();

    let textStarted = false;
    let hasToolCalls = false;
    let lastUsage = null;
    let buffer = "";

    upstream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.usage) lastUsage = parsed.usage;

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        // Text content
        if (delta.content != null && delta.content !== "") {
          if (!textStarted) {
            textStarted = true;
            writer.emitTextStart();
          }
          writer.emitTextDelta(delta.content);
        }

        // Tool calls
        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            writer.emitToolCallDelta(tc);
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          if (textStarted) {
            writer.emitTextDone();
            textStarted = false;
          }
          if (hasToolCalls) {
            writer.emitToolCallsDone();
            hasToolCalls = false;
          }
        }
      }
    });

    upstream.on("end", () => {
      // Handle any remaining text
      if (textStarted) {
        writer.emitTextDone();
      }
      if (hasToolCalls) {
        writer.emitToolCallsDone();
      }
      writer.emitCompleted(lastUsage);
    });

    upstream.on("error", (err) => {
      console.error(`[proxy] Upstream stream error: ${err.message}`);
      writer.emitError(err.message);
    });
  });

  req.on("error", (err) => {
    console.error(`[proxy] Request error: ${err.message}`);
    writer.emitError(err.message);
  });

  req.write(payload);
  req.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Models endpoint - fetch from upstream Copilot API
  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
    const tok = await getSessionToken();
    const mopts = {
      hostname: apiHost,
      path: `${apiPathPrefix}/models`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": "2025-05-01",
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Version": "vscode/1.96.0",
      },
    };
    const upstream = https.request(mopts, (ures) => {
      let body = "";
      ures.on("data", (d) => body += d);
      ures.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      });
    });
    upstream.on("error", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    });
    upstream.end();
    return;
  }

  // Responses API
  if (req.method === "POST" && (req.url === "/v1/responses" || req.url === "/responses")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
        return;
      }

      try {
        await getSessionToken();
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Token refresh failed: ${err.message}` } }));
        return;
      }

      console.log(`[proxy] ${new Date().toISOString()} POST /v1/responses model=${parsed.model}`);

      // Try Responses API passthrough first; fall back to Chat Completions translation
      const doChatFallback = () => {
        const chatBody = buildChatRequest(parsed);
        const writer = new ResponsesStreamWriter(res);
        forwardToCopilot(chatBody, writer);
      };

      forwardResponsesPassthrough(parsed, res, doChatFallback);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found" } }));
});

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "18080", 10);

server.listen(port, "127.0.0.1", () => {
  console.log(`[proxy] Copilot Responses API proxy listening on http://127.0.0.1:${port}`);
  console.log(`[proxy] Forwarding to https://${apiHost}${apiPathPrefix}`);
  console.log(`[proxy] Supports: Responses API passthrough (gpt-5.4, etc.) + Chat Completions translation (gpt-4o, etc.)`);
});
