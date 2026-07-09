/**
 * Application-level DNS override for restricted networks.
 *
 * Some sandboxed / containerized environments (corporate Kubernetes pods with
 * cluster-managed DNS, locked-down notebooks, etc.) hijack DNS resolution for
 * github.com and its API hosts to a broken internal address, causing
 * `ECONNREFUSED` even though the machine's real internet egress works fine.
 * The normal fix is to add entries to `/etc/hosts`, but that file is often
 * read-only (Kubernetes-managed mount) or requires `sudo` the user doesn't
 * have.
 *
 * This module patches Node's `dns.lookup` for a small, fixed set of
 * GitHub/Copilot hostnames so setup.mjs / proxy.mjs never depend on system
 * DNS or file permissions for those specific hosts. It is OPT-IN and a no-op
 * unless explicitly enabled, so machines with working DNS are unaffected.
 *
 * Enable with:
 *   COPILOT_PROXY_DNS_FIX=1 node setup.mjs
 *   COPILOT_PROXY_DNS_FIX=1 node proxy.mjs
 *
 * Override or extend the built-in IPs (comma-separated host=ip pairs) if
 * GitHub rotates an address or you hit a hijacked host not listed below:
 *   COPILOT_PROXY_DNS_MAP="api.github.com=140.82.113.6,github.com=140.82.114.3"
 */

import dns from "node:dns";

// Known-good GitHub IPs for the hosts this project talks to. Verified live
// against GitHub's own DNS at the time of writing; GitHub's API/auth fronts
// are far more stable than their content-CDN IPs, but if one of these ever
// goes stale, override it via COPILOT_PROXY_DNS_MAP instead of editing this
// file.
const DEFAULT_HOST_MAP = {
  "github.com": "140.82.114.3",
  "api.github.com": "140.82.113.6",
  "api.enterprise.githubcopilot.com": "140.82.112.21",
  "api.githubcopilot.com": "140.82.112.21",
};

function truthyEnv(name) {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseHostMapEnv(raw) {
  const out = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const host = pair.slice(0, idx).trim().toLowerCase();
    const ip = pair.slice(idx + 1).trim();
    if (host && ip) out[host] = ip;
  }
  return out;
}

let installed = false;

/**
 * Install the dns.lookup override if COPILOT_PROXY_DNS_FIX is enabled.
 * Idempotent and safe to import multiple times. Returns the effective host
 * map when installed, or null when left disabled (default).
 */
export function installDnsFixIfEnabled() {
  if (!truthyEnv("COPILOT_PROXY_DNS_FIX")) return null;
  const hostMap = {
    ...DEFAULT_HOST_MAP,
    ...parseHostMapEnv(process.env.COPILOT_PROXY_DNS_MAP),
  };
  if (!installed) {
    const originalLookup = dns.lookup;
    dns.lookup = function patchedLookup(hostname, options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      const override = hostMap[String(hostname).toLowerCase()];
      if (override) {
        const family = 4;
        if (options && options.all) {
          callback(null, [{ address: override, family }]);
        } else {
          callback(null, override, family);
        }
        return undefined;
      }
      return originalLookup.call(dns, hostname, options, callback);
    };
    installed = true;
  }
  console.error(
    `[dns-fix] COPILOT_PROXY_DNS_FIX enabled — overriding DNS for: ${Object.keys(hostMap).join(", ")}`,
  );
  return hostMap;
}
