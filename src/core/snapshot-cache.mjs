/**
 * Snapshot cache — backed by Netlify Blobs.
 *
 * TRANSFORMATION_ROADMAP §0.5.1: Netlify Functions are stateless. In-memory
 * caches do not survive between invocations. Persistent data must use
 * `@netlify/blobs`. This module wraps @netlify/blobs with a TTL contract.
 *
 * Stores used:
 *   "snapshots"     — per-symbol StockSnapshot objects (TTL 5 min market hours / 30 min after close)
 *   "universe-scans"— pre-computed Signal Radar universe (TTL 15 min)
 *   "fundamentals"  — 10-year financial history per symbol (TTL 24 h)
 *   "market-data"   — FII/DII, VIX, sector stats, F&O ban list (TTL varies)
 *   "verdict-log"   — every issued verdict for calibration (no TTL — permanent)
 *
 * Fallback: If Netlify Blobs is unavailable (local dev without netlify-cli,
 * or the `@netlify/blobs` package fails to initialise), a process-local
 * TTLCache is used. This is NOT shared across invocations in production —
 * it only matters for local dev.
 */

import { TTLCache } from "../utils/ttl-cache.mjs";

const IST_OFFSET_MINUTES = 330; // UTC+5:30
const MARKET_OPEN_MIN = 9 * 60 + 15; // 09:15 IST
const MARKET_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST

/**
 * Process-local fallback cache. Only used when @netlify/blobs is unavailable.
 * Keyed by `${store}:${key}`.
 */
const fallbackCache = new TTLCache(5 * 60_000);

let blobsModule = null;
let blobsInitAttempted = false;

async function getBlobsModule() {
  if (blobsInitAttempted) return blobsModule;
  blobsInitAttempted = true;
  try {
    blobsModule = await import("@netlify/blobs");
  } catch (err) {
    console.warn("[snapshot-cache] @netlify/blobs unavailable — using in-memory fallback:", err?.message);
    blobsModule = null;
  }
  return blobsModule;
}

function getStoreInstance(storeName) {
  if (!blobsModule) return null;
  try {
    return blobsModule.getStore({ name: storeName, consistency: "strong" });
  } catch (err) {
    // Outside Netlify runtime, getStore throws. Fall back to local cache.
    return null;
  }
}

/**
 * IST-aware TTL selector. During market hours, we cache 5 minutes so stale
 * prices don't persist. After close, we cache 30 minutes since nothing moves.
 */
export function pickSnapshotTtlSeconds(now = new Date()) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);
  // IST is UTC+5:30. When utcMinutes+330 crosses 1440, IST has already ticked to the next calendar day
  // while UTC hasn't yet — advance the weekday by 1 to get the correct IST weekday.
  const istAdvanced = utcMinutes + IST_OFFSET_MINUTES >= 24 * 60;
  const day = istAdvanced ? (now.getUTCDay() + 1) % 7 : now.getUTCDay();
  // Weekend → long cache
  if (day === 0 || day === 6) return 30 * 60;
  // Weekday market hours → short cache
  if (istMinutes >= MARKET_OPEN_MIN && istMinutes <= MARKET_CLOSE_MIN) return 5 * 60;
  // Weekday after close → medium cache
  return 30 * 60;
}

/**
 * Read a JSON value from a Netlify Blob store. Returns null if not found,
 * expired, or store unavailable.
 *
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<*|null>}
 */
export async function get(storeName, key) {
  await getBlobsModule();
  const store = getStoreInstance(storeName);
  const fallbackKey = `${storeName}:${key}`;

  if (!store) {
    return fallbackCache.get(fallbackKey);
  }

  try {
    const raw = await store.get(key, { type: "json" });
    if (!raw) return null;

    // Enforce our own TTL since @netlify/blobs doesn't expire automatically.
    if (raw.__expiresAt && raw.__expiresAt <= Date.now()) {
      // Expired — best-effort delete, but don't block on it.
      store.delete(key).catch(() => {});
      return null;
    }

    return raw.__payload !== undefined ? raw.__payload : raw;
  } catch (err) {
    console.warn(`[snapshot-cache] get(${storeName}, ${key}) failed:`, err?.message);
    return fallbackCache.get(fallbackKey);
  }
}

/**
 * Write a JSON value to a Netlify Blob store with a TTL (in seconds).
 * Use ttlSeconds = 0 for permanent (no expiry).
 *
 * @param {string} storeName
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds
 */
export async function set(storeName, key, value, ttlSeconds = 300) {
  await getBlobsModule();
  const store = getStoreInstance(storeName);
  const fallbackKey = `${storeName}:${key}`;

  const wrapped = {
    __payload: value,
    __writtenAt: Date.now(),
    __expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  };

  if (!store) {
    fallbackCache.set(fallbackKey, value, ttlSeconds * 1000);
    return value;
  }

  try {
    await store.setJSON(key, wrapped);
  } catch (err) {
    console.warn(`[snapshot-cache] set(${storeName}, ${key}) failed:`, err?.message);
    fallbackCache.set(fallbackKey, value, ttlSeconds * 1000);
  }
  return value;
}

/**
 * Delete a key from a store. Idempotent.
 */
export async function invalidate(storeName, key) {
  await getBlobsModule();
  const store = getStoreInstance(storeName);
  const fallbackKey = `${storeName}:${key}`;

  fallbackCache.set(fallbackKey, null, 1);

  if (!store) return;

  try {
    await store.delete(key);
  } catch (err) {
    console.warn(`[snapshot-cache] invalidate(${storeName}, ${key}) failed:`, err?.message);
  }
}

/* ───────────────────────────── Convenience wrappers ───────────────────────────── */

/** Per-symbol snapshot, TTL varies by market hours. */
export async function getSnapshot(symbol) {
  return get("snapshots", `snapshot:${String(symbol).toUpperCase()}`);
}

export async function setSnapshot(symbol, snapshot, ttlSeconds = pickSnapshotTtlSeconds()) {
  return set("snapshots", `snapshot:${String(symbol).toUpperCase()}`, snapshot, ttlSeconds);
}

export async function invalidateSnapshot(symbol) {
  return invalidate("snapshots", `snapshot:${String(symbol).toUpperCase()}`);
}

/** Pre-computed Signal Radar universe. */
export async function getUniverseScan(kind = "bullish") {
  return get("universe-scans", `scan:${kind}`);
}

export async function setUniverseScan(kind, scan, ttlSeconds = 15 * 60) {
  return set("universe-scans", `scan:${kind}`, scan, ttlSeconds);
}

/** Market-wide data (FII/DII, VIX, sector stats, F&O ban). */
export async function getMarketData(key) {
  return get("market-data", key);
}

export async function setMarketData(key, value, ttlSeconds = 24 * 60 * 60) {
  return set("market-data", key, value, ttlSeconds);
}

/** Fundamentals history (10-year). Long TTL since this only changes quarterly. */
export async function getFundamentalsHistory(symbol) {
  return get("fundamentals", `hist:${String(symbol).toUpperCase()}`);
}

export async function setFundamentalsHistory(symbol, history, ttlSeconds = 24 * 60 * 60) {
  return set("fundamentals", `hist:${String(symbol).toUpperCase()}`, history, ttlSeconds);
}

/** Verdict log — permanent, used for calibration. */
export async function logVerdict(snapshotId, record) {
  return set("verdict-log", `verdict:${snapshotId}`, record, 0);
}
