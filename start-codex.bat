@echo off
REM Start the Copilot Responses API proxy and launch Codex
REM Usage: start-codex.bat [codex args...]

set PROXY_PORT=18080

REM Check if proxy is already running
curl -s "http://127.0.0.1:%PROXY_PORT%/health" >nul 2>&1
if %errorlevel% equ 0 (
    echo [copilot-proxy] Proxy already running on port %PROXY_PORT%
) else (
    echo [copilot-proxy] Starting proxy on port %PROXY_PORT%...
    start /b node "%~dp0proxy.mjs" --port %PROXY_PORT% > "%~dp0proxy.log" 2>&1

    REM Wait for proxy to initialize
    set READY=0
    for /l %%i in (1,1,5) do (
        timeout /t 1 /nobreak >nul
        curl -s "http://127.0.0.1:%PROXY_PORT%/health" >nul 2>&1
        if !errorlevel! equ 0 set READY=1
    )
    curl -s "http://127.0.0.1:%PROXY_PORT%/health" >nul 2>&1
    if %errorlevel% neq 0 (
        echo [copilot-proxy] ERROR: Proxy failed to start. Check %~dp0proxy.log
        exit /b 1
    )
)

echo [copilot-proxy] Proxy ready. Launching Codex with GPT-5.4...
codex %*
