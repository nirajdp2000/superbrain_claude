import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fetchWithTimeout } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";
import { getUniverse } from "../data/universe.mjs";
import { config } from "../config.mjs";

const universeCache = new TTLCache(12 * 60 * 60_000);
const cacheFilePath = path.resolve(process.cwd(), "data", "broad-equity-universe.json");
const CACHE_VERSION = 2;
const BLOB_KEY = "broad-equity-universe-v2";
const BLOB_TTL_MS = 12 * 60 * 60_000; // 12 hours
const BLOB_STORE_NAME = "superbrain-universe";

// On Netlify cold start, downloading NSE+BSE JSON costs several seconds which
// we cannot afford inside the 26s function budget. The in-flight refresh
// promise is shared so only one cold invocation ever triggers the actual
// download — every other caller gets the local fallback immediately.
let inFlightRefresh = null;

const INSTRUMENT_SOURCES = [
  {
    exchange: "NSE",
    url: "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
  },
  {
    exchange: "BSE",
    url: "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz",
  },
];

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeAlias(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values = []) {
  return [...new Set(values.map((value) => normalizeAlias(value)).filter(Boolean))];
}

function inferSector(symbol = "", name = "", fallback = "Unknown") {
  const text = `${symbol} ${name}`.toLowerCase();
  if (fallback && fallback !== "Diversified" && fallback !== "Unknown") {
    return fallback;
  }
  if (/\b(bank|finance|finserv|insurance|capital|credit)\b/.test(text)) return "Financials";
  if (/\b(soft|tech|technology|infotech|software|digital)\b/.test(text)) return "Technology";
  if (/\b(pharma|hospital|health|life|labs|medical)\b/.test(text)) return "Healthcare";
  if (/\b(tyre|motors|auto|maruti|hero|eicher)\b/.test(text)) return "Auto";
  if (/\b(steel|cement|pipes|tubes|paint|chem|metal|mining)\b/.test(text)) return "Materials";
  if (/\b(power|grid|electric|utility)\b/.test(text)) return "Utilities";
  if (/\b(telecom|airtel|communication)\b/.test(text)) return "Telecom";
  if (/\b(oil|gas|energy|coal|petro)\b/.test(text)) return "Energy";
  if (/\b(consum|foods|retail|fashion|hospitality|travel)\b/.test(text)) return "Consumer";
  if (/\b(engineering|infrastructure|micro systems|ports|defence|defense|industrial|ship|rail|aerospace)\b/.test(text)) return "Industrials";
  return fallback || "Unknown";
}

function filterEquityInstrument(row = {}) {
  const segment = String(row.segment || "").toUpperCase();
  const instrumentType = String(row.instrument_type || row.instrumentType || "").toUpperCase();
  const symbol = String(row.trading_symbol || row.symbol || "").trim();
  const name = String(row.short_name || row.name || row.company_name || "").trim();
  const combined = `${symbol} ${name}`;

  if (!segment.endsWith("_EQ")) {
    return false;
  }

  if (!row.instrument_key || !symbol || !name) {
    return false;
  }

  if (["INDEX", "ETF", "ETN", "MF", "BOND"].includes(instrumentType)) {
    return false;
  }

  if (/%/i.test(combined)) {
    return false;
  }

  if (/-RE$/i.test(symbol)) {
    return false;
  }

  if (/^[0-9]/.test(symbol) && /\d.*\d.*\d/.test(combined)) {
    return false;
  }

  if (
    /\b(etf|mutual fund|index fund|gsec|bond|debenture|govt|liquidbees|commercial paper|market linked|market link|linked note|rights entitlement|preference|pref|reit|invit|tranche|secured|unsecured|series)\b/i.test(combined)
    || /\b(goi|ncd|pvt|underinv|srcar|mkt link|linked)\b/i.test(combined)
    || /\bzc\b/i.test(combined)
  ) {
    return false;
  }

  return true;
}

function buildAliases(symbol, name, exchange) {
  const simplifiedName = normalizeText(name)
    .replace(/\b(limited|ltd|india|industries|industry|corporation|company|co|enterprise|enterprises)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return dedupe([
    symbol,
    name,
    simplifiedName,
    `${symbol} ${exchange}`,
  ]);
}

function instrumentRank(row = {}) {
  let rank = 0;
  const exchange = String(row.exchange || "").toUpperCase();
  const instrumentType = String(row.instrument_type || "").toUpperCase();
  if (exchange === "NSE") rank += 6;
  if (instrumentType === "EQ") rank += 4;
  if (Number(row.lot_size || row.lotSize || 1) === 1) rank += 2;
  if (String(row.security_type || "").toUpperCase() === "NORMAL") rank += 1;
  return rank;
}

function normalizeInstrument(row = {}, exchangeHint = "") {
  const exchange = String(row.exchange || exchangeHint || "").toUpperCase() || (String(row.segment || "").toUpperCase().startsWith("BSE") ? "BSE" : "NSE");
  const symbol = normalizeText(row.trading_symbol || row.symbol || "").toUpperCase();
  const name = normalizeText(row.short_name || row.name || row.company_name || symbol);
  const sector = inferSector(symbol, name, normalizeText(row.sector || ""));

  return {
    symbol,
    name,
    sector,
    exchange,
    instrumentKey: normalizeText(row.instrument_key || row.instrumentKey || row.key),
    isin: normalizeText(row.isin),
    source: "upstox-bod",
    aliases: buildAliases(symbol, name, exchange),
  };
}

async function fetchInstrumentSource(source) {
  const response = await fetchWithTimeout(source.url, {
    headers: {
      accept: "application/json,application/octet-stream,*/*",
    },
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.url}`);
  }

  const payload = Buffer.from(await response.arrayBuffer());
  const isCompressed = payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b;
  const jsonText = isCompressed
    ? zlib.gunzipSync(payload).toString("utf8")
    : payload.toString("utf8");

  const rows = JSON.parse(jsonText);
  return Array.isArray(rows) ? rows : [];
}

function preferRecord(current, next) {
  if (!current) return next;
  return instrumentRank(next) > instrumentRank(current) ? next : current;
}

function dedupeUniverse(rows = []) {
  const byCompany = new Map();

  for (const row of rows) {
    if (!filterEquityInstrument(row)) {
      continue;
    }

    const normalized = normalizeInstrument(row);
    if (!normalized.symbol || !normalized.instrumentKey || !normalized.name) {
      continue;
    }

    const dedupeKey = normalized.isin || `${normalized.exchange}:${normalized.symbol}:${normalized.name}`;
    const current = byCompany.get(dedupeKey);
    byCompany.set(dedupeKey, preferRecord(current, normalized));
  }

  return [...byCompany.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function readDiskCache() {
  if (!fs.existsSync(cacheFilePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cacheFilePath, "utf8"));
    if (raw?.version !== CACHE_VERSION || !Array.isArray(raw?.items) || raw.items.length === 0) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeDiskCache(payload) {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
    fs.writeFileSync(cacheFilePath, JSON.stringify(payload, null, 2));
  } catch {
    // Ignore disk cache failures.
  }
}

// ── Netlify Blobs persistence (survives cold starts) ─────────────────────
async function readBlobCache() {
  if (!config.isNetlifyRuntime) return null;
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: BLOB_STORE_NAME, consistency: "strong" });
    const raw = await store.get(BLOB_KEY, { type: "json" });
    if (!raw?._expiresAt || Date.now() > raw._expiresAt) {
      return null;
    }
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      return null;
    }
    return raw;
  } catch (err) {
    console.warn("[broad-universe] blob read failed:", err?.message || err);
    return null;
  }
}

async function writeBlobCache(payload) {
  if (!config.isNetlifyRuntime) return;
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: BLOB_STORE_NAME, consistency: "strong" });
    await store.set(BLOB_KEY, JSON.stringify({
      ...payload,
      _expiresAt: Date.now() + BLOB_TTL_MS,
    }));
  } catch (err) {
    console.warn("[broad-universe] blob write failed:", err?.message || err);
  }
}

function buildLocalFallback() {
  return getUniverse().map((stock) => ({
    ...stock,
    isin: "",
    source: stock.source || "local-universe",
  }));
}

async function downloadAndCache() {
  const t0 = Date.now();
  const rawRows = (await Promise.all(INSTRUMENT_SOURCES.map(fetchInstrumentSource))).flat();
  const items = dedupeUniverse(rawRows);

  if (items.length === 0) {
    throw new Error("Empty universe after dedupe");
  }

  const payload = {
    version: CACHE_VERSION,
    fetchedAt: new Date().toISOString(),
    source: "upstox-bod",
    count: items.length,
    items,
  };

  universeCache.set("broad-equity-universe", payload, 12 * 60 * 60_000);
  writeDiskCache(payload);
  await writeBlobCache(payload);
  console.log(`[broad-universe] downloaded ${items.length} instruments in ${Date.now() - t0}ms`);
  return items;
}

/**
 * Fetches the broad equity universe with aggressive cold-start optimization:
 *
 * 1. In-process cache hit → return immediately
 * 2. Netlify Blobs cache hit → hydrate in-process cache, return
 * 3. Disk cache hit (local dev) → hydrate in-process cache, return
 * 4. Cold start with no cache:
 *    - On Netlify: return LOCAL FALLBACK immediately (~82 curated stocks),
 *      kick off async download to populate Blob cache for next request
 *    - Locally: download synchronously
 */
export async function getBroadEquityUniverse(forceRefresh = false) {
  // 1. In-process cache
  const cached = universeCache.get("broad-equity-universe");
  if (cached && !forceRefresh) {
    return cached.items;
  }

  // 2. Netlify Blobs cache (survives cold starts)
  if (!forceRefresh) {
    const blobCached = await readBlobCache();
    if (blobCached) {
      universeCache.set("broad-equity-universe", blobCached, 12 * 60 * 60_000);
      console.log(`[broad-universe] blob hit: ${blobCached.items.length} instruments`);
      return blobCached.items;
    }
  }

  // 3. Disk cache (local dev only)
  const diskCached = readDiskCache();
  if (diskCached && !forceRefresh) {
    universeCache.set("broad-equity-universe", diskCached, 12 * 60 * 60_000);
    // Also seed the Blob cache so the next Netlify cold start is fast.
    writeBlobCache(diskCached).catch(() => {});
    return diskCached.items;
  }

  // 4. Cold start with no cache
  //    On Netlify: return fallback now, fetch real universe in background.
  //    Locally: fetch synchronously.
  if (config.isNetlifyRuntime) {
    // Kick off download asynchronously — shared across concurrent callers.
    if (!inFlightRefresh) {
      inFlightRefresh = downloadAndCache()
        .catch((err) => {
          console.warn("[broad-universe] background download failed:", err?.message || err);
        })
        .finally(() => {
          inFlightRefresh = null;
        });
    }

    const fallback = buildLocalFallback();
    console.log(`[broad-universe] cold start: returning ${fallback.length} curated stocks while download runs in background`);
    const payload = {
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      source: "local-fallback",
      count: fallback.length,
      items: fallback,
    };
    // Short TTL so we retry the Blob cache (or fresh download) soon.
    universeCache.set("broad-equity-universe", payload, 2 * 60_000);
    return fallback;
  }

  // Local dev / long-running server: synchronous download with fallback on error.
  try {
    return await downloadAndCache();
  } catch (err) {
    console.warn("[broad-universe] download failed, using fallback:", err?.message || err);
    const fallback = buildLocalFallback();
    const payload = {
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      source: "local-fallback",
      count: fallback.length,
      items: fallback,
    };
    universeCache.set("broad-equity-universe", payload, 30 * 60_000);
    return fallback;
  }
}

export async function getBroadEquityUniverseStats(forceRefresh = false) {
  const items = await getBroadEquityUniverse(forceRefresh);
  return {
    count: items.length,
    source: items[0]?.source === "upstox-bod" ? "upstox-bod" : "local-fallback",
  };
}
