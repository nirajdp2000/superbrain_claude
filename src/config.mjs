import fs from "fs";
import os from "os";
import path from "path";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const pivot = trimmed.indexOf("=");
    if (pivot === -1) {
      continue;
    }

    const key = trimmed.slice(0, pivot).trim();
    let value = trimmed.slice(pivot + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function normalizeOrigin(value) {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const defaultPort = Number(process.env.PORT || 3210);
const isNetlifyRuntime = Boolean(
  process.env.NETLIFY
  || process.env.NETLIFY_DEV
  || process.env.URL
  || process.env.DEPLOY_PRIME_URL
  || process.env.CONTEXT
  || process.env.SITE_NAME,
);
// ─────────────────────────────────────────────────────────
// Netlify zero-config defaults.
// The app ships with baked-in Upstox credentials + site URL so that
// a Netlify deploy works without any manual env-var setup. These can
// still be overridden by setting the corresponding environment variable
// in Netlify Site settings.
// ─────────────────────────────────────────────────────────
const NETLIFY_DEFAULTS = {
  publicSiteUrl: "https://superbrainai.netlify.app",
  upstoxClientId: "4ec51c87-a099-4ade-b727-960817b31c94",
  upstoxClientSecret: "n7qldsrvus",
  adminToken: "superbrain-admin-2025",
  allowedOrigins: [
    "https://superbrainai.netlify.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8888",
  ],
};

const netlifyDeployUrl = normalizeOrigin(process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "");
const configuredPublicSiteUrl = normalizeOrigin(process.env.SUPERBRAIN_PUBLIC_SITE_URL || "");
const netlifyProductionUrl = normalizeOrigin(process.env.URL || "");
const publicSiteUrl = netlifyDeployUrl
  || configuredPublicSiteUrl
  || netlifyProductionUrl
  || (isNetlifyRuntime ? NETLIFY_DEFAULTS.publicSiteUrl : "");
const defaultTokenDbPath = process.env.SUPERBRAIN_TOKEN_DB_PATH
  || (isNetlifyRuntime
    ? path.join(os.tmpdir(), "superbrain", "upstox-token-store.json")
    : "./data/upstox-token-store.json");
const defaultRedirectUri = publicSiteUrl ? `${publicSiteUrl}/api/upstox/callback` : "";

const envAllowedOrigins = (process.env.SUPERBRAIN_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const allowedOrigins = envAllowedOrigins.length
  ? envAllowedOrigins
  : (isNetlifyRuntime ? [...NETLIFY_DEFAULTS.allowedOrigins] : []);

if (publicSiteUrl && !allowedOrigins.includes(publicSiteUrl)) {
  allowedOrigins.push(publicSiteUrl);
}

export const config = {
  port: Number.isFinite(defaultPort) ? defaultPort : 3210,
  publicSiteUrl,
  isNetlifyRuntime,
  allowedOrigins,
  adminToken: process.env.SUPERBRAIN_ADMIN_TOKEN
    || (isNetlifyRuntime ? NETLIFY_DEFAULTS.adminToken : ""),
  tokenDbPath: path.resolve(process.cwd(), defaultTokenDbPath),
  httpTimeoutMs: Math.max(1500, Number(process.env.SUPERBRAIN_HTTP_TIMEOUT_MS || 9000)),
  upstoxProxyUrl: (process.env.SUPERBRAIN_UPSTOX_PROXY_URL ?? "").replace(/\/+$/, ""),
  tokenBlobStore: process.env.SUPERBRAIN_TOKEN_BLOB_STORE || "superbrain-upstox",
  upstox: {
    clientId: process.env.UPSTOX_CLIENT_ID
      || (isNetlifyRuntime ? NETLIFY_DEFAULTS.upstoxClientId : ""),
    clientSecret: process.env.UPSTOX_CLIENT_SECRET
      || (isNetlifyRuntime ? NETLIFY_DEFAULTS.upstoxClientSecret : ""),
    redirectUri: process.env.UPSTOX_REDIRECT_URI || defaultRedirectUri,
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || "",
    refreshToken: process.env.UPSTOX_REFRESH_TOKEN || "",
  },
};

export function hasAdminToken() {
  return Boolean(config.adminToken);
}

export function resolveAllowedOrigin(origin) {
  if (!origin) {
    return "";
  }
  if (config.allowedOrigins.length === 0) {
    return origin;
  }
  return config.allowedOrigins.includes(origin) ? origin : "";
}
