#!/bin/bash
# Start the Copilot Responses API proxy and launch Codex
# Usage: ./start-codex.sh [codex args...]
#
# The proxy translates between Codex CLI (Responses API) and
# GitHub Copilot's enterprise API, enabling GPT-5.4 and other models.

PROXY_DIR="$(dirname "$(readlink -f "$0")")"
PROXY_PORT=18080

# Check if proxy is already running
if curl -s "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
  echo "[copilot-proxy] Proxy already running on port ${PROXY_PORT}"
else
  echo "[copilot-proxy] Starting proxy on port ${PROXY_PORT}..."
  nohup node "${PROXY_DIR}/proxy.mjs" --port "${PROXY_PORT}" \
    >> "${PROXY_DIR}/proxy.log" 2>&1 &
  PROXY_PID=$!
  echo "[copilot-proxy] Proxy PID: ${PROXY_PID}"
  # Wait for proxy to initialize (needs to fetch session token)
  for i in 1 2 3 4 5; do
    sleep 1
    if curl -s "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
      break
    fi
  done
  if ! curl -s "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
    echo "[copilot-proxy] ERROR: Proxy failed to start. Check ${PROXY_DIR}/proxy.log"
    exit 1
  fi
fi

echo "[copilot-proxy] Proxy ready. Launching Codex with GPT-5.4..."
exec codex "$@"
