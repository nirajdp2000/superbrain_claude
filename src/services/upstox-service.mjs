import { config } from "../config.mjs";
import { fetchJson, fetchText } from "../utils/http.mjs";
import { readTokenRecord, writeTokenRecord } from "./token-store.mjs";

const UPSTOX_API = "https://api.upstox.com";
const QUOTE_BATCH_SIZE = 120;
const QUOTE_BATCH_CONCURRENCY = 6;
const SESSION_PROBE_TTL_MS = 5 * 60 * 1000;

let sessionProbeCache = {
  token: "",
  timestamp: 0,
  result: null,
};

function getProxyBaseUrl() {
  return config.upstoxProxyUrl || "";
}

function canUseProxy() {
  return Boolean(getProxyBaseUrl());
}

async function tryProxy(path) {
  if (!canUseProxy()) {
    return null;
  }

  try {
    return await fetchJson(`${getProxyBaseUrl()}${path}`, { timeoutMs: 1800 });
  } catch {
    return null;
  }
}

function proxyHeaders(hostHeader, protocol = "http") {
  const headers = {};
  if (hostHeader) {
    headers["x-forwarded-host"] = hostHeader;
  }
  if (protocol) {
    headers["x-forwarded-proto"] = protocol;
  }
  return headers;
}

async function tryProxyHtml(path, hostHeader, protocol = "http") {
  if (!canUseProxy()) {
    return null;
  }

  try {
    return await fetchText(`${getProxyBaseUrl()}${path}`, {
      timeoutMs: 5000,
      headers: proxyHeaders(hostHeader, protocol),
    });
  } catch {
    return null;
  }
}

function tokenIsExpiring(expiresAt) {
  return Date.now() >= Number(expiresAt || 0) - 5 * 60 * 1000;
}

async function refreshAccessToken(record) {
  if (!record?.refreshToken || !config.upstox.clientId || !config.upstox.clientSecret || !config.upstox.redirectUri) {
    return record;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
    client_id: config.upstox.clientId,
    client_secret: config.upstox.clientSecret,
    redirect_uri: config.upstox.redirectUri,
  });

  const response = await fetchJson(`${UPSTOX_API}/v2/login/authorization/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  return await writeTokenRecord({
    accessToken: response.access_token,
    refreshToken: response.refresh_token || record.refreshToken,
    expiresAt: Date.now() + Number(response.expires_in || 86400) * 1000,
  });
}

async function probeAccessToken(token) {
  if (!token) {
    return { valid: false, userInfo: null, error: "Missing token" };
  }

  if (
    sessionProbeCache.token === token
    && sessionProbeCache.result
    && Date.now() - sessionProbeCache.timestamp < SESSION_PROBE_TTL_MS
  ) {
    return sessionProbeCache.result;
  }

  try {
    const data = await fetchJson(`${UPSTOX_API}/v2/user/profile`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    const result = {
      valid: true,
      userInfo: data?.data || null,
      error: null,
    };
    sessionProbeCache = {
      token,
      timestamp: Date.now(),
      result,
    };
    return result;
  } catch (error) {
    const result = {
      valid: false,
      userInfo: null,
      error: error.message,
    };
    sessionProbeCache = {
      token,
      timestamp: Date.now(),
      result,
    };
    return result;
  }
}

export function isUpstoxConfigured(redirectUriOverride = "") {
  const redirectUri = redirectUriOverride || config.upstox.redirectUri;
  return Boolean(config.upstox.clientId && config.upstox.clientSecret && redirectUri);
}

export async function getValidAccessToken() {
  let record = await readTokenRecord();
  if (!record?.accessToken) {
    return null;
  }

  if (tokenIsExpiring(record.expiresAt)) {
    try {
      record = await refreshAccessToken(record);
    } catch {
      record = await readTokenRecord();
    }
  }

  return record?.accessToken || null;
}

export function buildAuthorizationUrl(state = "superbrain-india", redirectUriOverride = "") {
  const redirectUri = redirectUriOverride || config.upstox.redirectUri;
  if (!isUpstoxConfigured(redirectUri)) {
    throw new Error("Upstox credentials are not configured.");
  }

  const url = new URL(`${UPSTOX_API}/v2/login/authorization/dialog`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.upstox.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeAuthorizationCode(code, redirectUriOverride = "") {
  const redirectUri = redirectUriOverride || config.upstox.redirectUri;
  if (!isUpstoxConfigured(redirectUri)) {
    throw new Error("Upstox credentials are not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.upstox.clientId,
    client_secret: config.upstox.clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetchJson(`${UPSTOX_API}/v2/login/authorization/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  return await writeTokenRecord({
    accessToken: response.access_token,
    refreshToken: response.refresh_token || null,
    expiresAt: Date.now() + Number(response.expires_in || 86400) * 1000,
  });
}

export async function storeManualToken({ accessToken, refreshToken = null, expiresIn = 86400 }) {
  return await writeTokenRecord({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Number(expiresIn || 86400) * 1000,
  });
}

/**
 * Public: force a token refresh using the stored refresh token.
 * Called by the scheduler before market open.
 */
export async function refreshTokenNow() {
  const record = await readTokenRecord();
  if (!record?.refreshToken) return null;
  const refreshed = await refreshAccessToken(record);
  return refreshed?.accessToken || null;
}

/**
 * Fetch the authenticated user's Upstox profile.
 */
export async function fetchUpstoxProfile() {
  const token = await getValidAccessToken();
  if (!token) return null;
  const data = await fetchJson(`${UPSTOX_API}/v2/user/profile`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  return data?.data || null;
}

export async function getUpstoxStatus() {
  const proxiedStatus = await tryProxy("/api/upstox/connection-info");
  if (proxiedStatus) {
    return {
      configured: true,
      connected: Boolean(proxiedStatus.connected || proxiedStatus.isAuthenticated),
      authenticated: Boolean(proxiedStatus.isAuthenticated ?? proxiedStatus.connected),
      hasStoredToken: Boolean(proxiedStatus.connected || proxiedStatus.isAuthenticated),
      expiresAt: null,
      tokenSource: "shared-backend",
      dataSource: proxiedStatus.dataSource || (proxiedStatus.connected ? "live" : "simulated"),
      message: proxiedStatus.message || "",
      userInfo: proxiedStatus.userInfo || null,
      sharedConnection: true,
    };
  }

  if (canUseProxy() && !isUpstoxConfigured()) {
    return {
      configured: true,
      connected: false,
      authenticated: false,
      hasStoredToken: false,
      expiresAt: null,
      tokenSource: "shared-backend",
      dataSource: "simulated",
      message: `Shared Upstox mode is configured, but the main backend at ${getProxyBaseUrl()} is not reachable right now.`,
      userInfo: null,
      sharedConnection: true,
    };
  }

  const record = await readTokenRecord();
  const token = await getValidAccessToken();
  const session = token ? await probeAccessToken(token) : { valid: false, userInfo: null, error: null };
  const connected = Boolean(token && session.valid);

  return {
    configured: isUpstoxConfigured(),
    connected,
    authenticated: connected,
    hasStoredToken: Boolean(record?.accessToken),
    expiresAt: record?.expiresAt || null,
    tokenSource: record?.accessToken ? "db" : config.upstox.accessToken ? "env" : "none",
    dataSource: connected ? "live" : "simulated",
    message: connected
      ? "Connected to Upstox. Tokens will auto-refresh daily."
      : token
        ? "Stored Upstox token is no longer valid. Reconnect Upstox to restore live quotes."
        : "Not connected. Using public market data.",
    userInfo: session.userInfo || null,
    sharedConnection: false,
  };
}

export async function getUpstoxConnectionInfo() {
  const proxiedInfo = await tryProxy("/api/upstox/connection-info");
  if (proxiedInfo) {
    return {
      ...proxiedInfo,
      sharedConnection: true,
      connectUrl: "/upstox/connect",
    };
  }

  if (canUseProxy() && !isUpstoxConfigured()) {
    return {
      connected: false,
      isAuthenticated: false,
      dataSource: "simulated",
      message: `Start the initial app backend on ${getProxyBaseUrl()} to reuse the same Upstox connection flow.`,
      userInfo: null,
      features: {
        liveQuotes: false,
        historicalData: false,
        portfolio: false,
        orders: false,
      },
      sharedConnection: true,
      connectUrl: "/upstox/connect",
    };
  }

  const status = await getUpstoxStatus();
  return {
    connected: status.connected,
    isAuthenticated: status.connected,
    dataSource: status.connected ? "live" : "simulated",
    message: status.message,
    userInfo: status.userInfo,
    features: {
      liveQuotes: status.connected,
      historicalData: status.connected,
      portfolio: false,
      orders: false,
    },
    sharedConnection: false,
    connectUrl: "/upstox/connect",
  };
}

export async function getUpstoxQuickConnect() {
  const proxiedQuickConnect = await tryProxy("/api/upstox/quick-connect");
  if (proxiedQuickConnect) {
    const action = proxiedQuickConnect.action
      ? {
          ...proxiedQuickConnect.action,
          url: "/upstox/connect",
        }
      : null;

    return {
      ...proxiedQuickConnect,
      action,
      sharedConnection: true,
      connectUrl: "/upstox/connect",
    };
  }

  if (canUseProxy() && !isUpstoxConfigured()) {
    return {
      connected: false,
      message: `Use the initial application backend at ${getProxyBaseUrl()} for the shared Upstox login flow.`,
      action: {
        type: "oauth",
        url: "/upstox/connect",
        label: "Connect Upstox Account",
      },
      sharedConnection: true,
      connectUrl: "/upstox/connect",
    };
  }

  const status = await getUpstoxStatus();
  if (status.connected) {
    return {
      connected: true,
      message: "Already connected to Upstox",
      action: null,
      sharedConnection: false,
      connectUrl: "/upstox/connect",
    };
  }

  if (!isUpstoxConfigured()) {
    return {
      connected: false,
      message: "Upstox credentials not configured for local Superbrain mode.",
      action: null,
      sharedConnection: false,
      connectUrl: "/upstox/connect",
    };
  }

  return {
    connected: false,
    message: "Click below to connect your Upstox account and get live market data",
    action: {
      type: "oauth",
      url: "/upstox/connect",
      label: "Connect Upstox Account",
    },
    sharedConnection: false,
    connectUrl: "/upstox/connect",
  };
}

export async function getUpstoxConnectUrl() {
  const proxiedQuickConnect = await tryProxy("/api/upstox/quick-connect");
  if (proxiedQuickConnect) {
    return "/upstox/connect";
  }
  if (canUseProxy()) {
    return "/upstox/connect";
  }
  return "/api/upstox/connect";
}

export async function getSharedUpstoxConnectPage(hostHeader, protocol = "http") {
  return tryProxyHtml("/upstox/connect", hostHeader, protocol);
}

export async function getSharedUpstoxCallbackPage(search = "", hostHeader, protocol = "http") {
  const query = search
    ? (search.startsWith("?") ? search : `?${search}`)
    : "";
  return tryProxyHtml(`/api/upstox/callback${query}`, hostHeader, protocol);
}

function normalizeQuotePayload(dataByKey) {
  return Object.entries(dataByKey || {}).map(([instrumentKey, payload]) => {
    const ohlc = payload.ohlc || {};
    const lastPrice = Number(payload.last_price || ohlc.close || 0);
    const netChange = Number(payload.net_change || 0);
    const previousClose = Number.isFinite(netChange) ? lastPrice - netChange : Number(ohlc.close || lastPrice);

    return {
      quoteKey: instrumentKey,
      instrumentKey: payload.instrument_token || instrumentKey,
      symbol: String(payload.symbol || instrumentKey.split(":").pop() || "").toUpperCase(),
      lastPrice,
      previousClose,
      open: Number(ohlc.open || payload.last_price || 0),
      high: Number(ohlc.high || payload.last_price || 0),
      low: Number(ohlc.low || payload.last_price || 0),
      volume: Number(payload.volume || 0),
    };
  });
}

function chunkArray(values = [], size = 1) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchQuoteBatch(stocks, token) {
  const instrumentKeys = stocks.map((stock) => stock.instrumentKey).filter(Boolean);
  if (!instrumentKeys.length) {
    return [];
  }

  const response = await fetchJson(`${UPSTOX_API}/v2/market-quote/quotes`, {
    params: {
      instrument_key: instrumentKeys.join(","),
    },
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });

  const byInstrumentKey = new Map(stocks.map((stock) => [stock.instrumentKey, stock]));
  return normalizeQuotePayload(response.data).map((quote) => {
    const stock = byInstrumentKey.get(quote.instrumentKey);
    const change = quote.lastPrice - quote.previousClose;
    const changePct = quote.previousClose > 0 ? (change / quote.previousClose) * 100 : 0;

    return {
      symbol: stock?.symbol || quote.symbol || quote.instrumentKey,
      companyName: stock?.name || stock?.symbol || quote.symbol || quote.instrumentKey,
      sector: stock?.sector || "Unknown",
      price: Number(quote.lastPrice.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePct: Number(changePct.toFixed(2)),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      volume: quote.volume,
      source: "UPSTOX_LIVE",
      asOf: new Date().toISOString(),
    };
  });
}

export async function fetchUpstoxQuotes(stocks) {
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return [];
  }

  const proxiedQuotes = await tryProxy(`/api/upstox/quotes?symbols=${encodeURIComponent(stocks.map((stock) => stock.symbol).join(","))}`);
  if (proxiedQuotes?.connected && Array.isArray(proxiedQuotes.quotes)) {
    return proxiedQuotes.quotes.map((quote) => ({
      ...quote,
      source: "UPSTOX_LIVE_SHARED",
      asOf: new Date().toISOString(),
    }));
  }

  const token = await getValidAccessToken();
  if (!token) {
    return [];
  }

  const session = await probeAccessToken(token);
  if (!session.valid) {
    return [];
  }

  const eligibleStocks = stocks.filter((stock) => stock?.instrumentKey);
  if (eligibleStocks.length === 0) {
    return [];
  }

  const batches = chunkArray(eligibleStocks, QUOTE_BATCH_SIZE);
  const quotes = [];

  for (let index = 0; index < batches.length; index += QUOTE_BATCH_CONCURRENCY) {
    const batchGroup = batches.slice(index, index + QUOTE_BATCH_CONCURRENCY);
    const groupResults = await Promise.all(
      batchGroup.map((batch) => fetchQuoteBatch(batch, token).catch(() => [])),
    );
    quotes.push(...groupResults.flat());
  }

  return quotes;
}
