#!/usr/bin/env node
/**
 * Interactive setup for copilot-codex-proxy.
 *
 * 1. Runs the GitHub OAuth device-code flow (VS Code Copilot client ID)
 * 2. Saves the token to ~/.copilot-proxy/vscode-token.json
 * 3. Verifies the token against the Copilot session endpoint
 * 4. Prints the Codex CLI config snippet
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

// ── Constants ────────────────────────────────────────────────────────────────

const CLIENT_ID = "01ab8ac9400c4e429b23";
const SCOPE = "user:email";
const TOKEN_DIR = path.join(os.homedir(), ".copilot-proxy");
const TOKEN_PATH = path.join(TOKEN_DIR, "vscode-token.json");

// ── Color helpers ────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function info(msg) { console.log(`${c.cyan}ℹ${c.reset}  ${msg}`); }
function success(msg) { console.log(`${c.green}✔${c.reset}  ${msg}`); }
function warn(msg) { console.log(`${c.yellow}⚠${c.reset}  ${msg}`); }
function error(msg) { console.log(`${c.red}✖${c.reset}  ${msg}`); }

// ── HTTP helpers (Node built-ins only) ───────────────────────────────────────

function httpsPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const opts = {
      hostname,
      port: 443,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "copilot-codex-proxy-setup",
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let buf = "";
      res.on("data", (chunk) => (buf += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      port: 443,
      path: reqPath,
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "copilot-codex-proxy-setup",
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let buf = "";
      res.on("data", (chunk) => (buf += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Readline helper ──────────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

// ── Step 1: Device-code flow ─────────────────────────────────────────────────

async function requestDeviceCode() {
  const { status, data } = await httpsPost(
    "github.com",
    "/login/device/code",
    { client_id: CLIENT_ID, scope: SCOPE },
  );
  if (status !== 200 || !data.device_code) {
    error("Failed to start device code flow.");
    console.log(data);
    process.exit(1);
  }
  return data;
}

// ── Step 2: Poll for access token ────────────────────────────────────────────

async function pollForToken(deviceCode, interval) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(interval * 1000);
    const { data } = await httpsPost(
      "github.com",
      "/login/oauth/access_token",
      {
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    );

    if (data.access_token) return data.access_token;

    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (data.error === "expired_token") {
      error("Device code expired. Please run setup again.");
      process.exit(1);
    }
    error(`Unexpected error: ${data.error || JSON.stringify(data)}`);
    process.exit(1);
  }
}

// ── Step 3: Save token ───────────────────────────────────────────────────────

function saveToken(accessToken) {
  if (!fs.existsSync(TOKEN_DIR)) fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: accessToken }, null, 2) + "\n");
  if (process.platform !== "win32") {
    fs.chmodSync(TOKEN_PATH, 0o600);
  }
}

// ── Step 4: Verify token ─────────────────────────────────────────────────────

async function verifyToken(accessToken) {
  const { status, data } = await httpsGet(
    "api.github.com",
    "/copilot_internal/v2/token",
    { Authorization: `token ${accessToken}` },
  );
  if (status === 200 && data.token) return true;
  return false;
}

// ── Step 5: Show config snippet ──────────────────────────────────────────────

function showConfigSnippet() {
  const snippet = `
model = "gpt-5.4"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
requires_openai_auth = false`.trim();

  console.log();
  info(`Add the following to ${c.bold}~/.codex/config.toml${c.reset}:`);
  console.log();
  console.log(`${c.dim}────────────────────────────────────────${c.reset}`);
  console.log(`${c.green}${snippet}${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────${c.reset}`);
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(`${c.bold}${c.magenta}  copilot-codex-proxy setup${c.reset}`);
  console.log(`${c.dim}  ─────────────────────────${c.reset}`);
  console.log();

  // Check for existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const existing = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    if (existing.access_token) {
      info("Found existing token. Verifying...");
      const ok = await verifyToken(existing.access_token);
      if (ok) {
        success("Existing token is valid!");
        const answer = await ask(`${c.yellow}?${c.reset}  Re-authenticate anyway? (y/N) `);
        if (answer.trim().toLowerCase() !== "y") {
          showConfigSnippet();
          info(`Start the proxy:  ${c.bold}node proxy.mjs${c.reset}`);
          info(`Then run:         ${c.bold}codex${c.reset}`);
          console.log();
          return;
        }
      } else {
        warn("Existing token is invalid or expired. Re-authenticating...");
      }
    }
  }

  // Step 1 – Request device code
  info("Starting GitHub OAuth device code flow...");
  console.log();

  const dc = await requestDeviceCode();

  console.log(`${c.bold}  1.${c.reset} Open this URL in your browser:`);
  console.log();
  console.log(`     ${c.cyan}${c.bold}https://github.com/login/device${c.reset}`);
  console.log();
  console.log(`${c.bold}  2.${c.reset} Enter this code:`);
  console.log();
  console.log(`     ${c.yellow}${c.bold}${dc.user_code}${c.reset}`);
  console.log();

  await ask(`${c.dim}  Press Enter after you have authorized in the browser...${c.reset}`);

  // Step 2 – Poll for token
  info("Waiting for authorization...");
  const accessToken = await pollForToken(dc.device_code, dc.interval || 5);
  success("GitHub OAuth token obtained!");

  // Step 3 – Save token
  saveToken(accessToken);
  success(`Token saved to ${c.bold}${TOKEN_PATH}${c.reset}`);

  // Step 4 – Verify
  info("Verifying Copilot access...");
  const ok = await verifyToken(accessToken);
  if (ok) {
    success("Copilot session token verified! Your subscription is active.");
  } else {
    warn("Could not verify Copilot access. Make sure you have an active GitHub Copilot subscription.");
  }

  // Step 5 – Show config
  showConfigSnippet();

  console.log(`${c.bold}${c.green}  Setup complete!${c.reset}`);
  console.log();
  info(`Start the proxy:  ${c.bold}node proxy.mjs${c.reset}`);
  info(`Then run:         ${c.bold}codex${c.reset}`);
  info(`Or use:           ${c.bold}./start-codex.sh${c.reset}  (starts both)`);
  console.log();
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
