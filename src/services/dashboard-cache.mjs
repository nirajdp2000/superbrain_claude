/**
 * Dashboard Blob Cache
 *
 * Persists the /api/dashboard response in Netlify Blobs so cold-start
 * function invocations return in milliseconds instead of re-running 30+
 * external HTTP calls from scratch.
 *
 * TTL: 5 minutes (300 000 ms). Cache is keyed by the sorted symbol list +
 * strategy so different watchlists are cached independently.
 *
 * On local dev (non-Netlify) this is a plain in-process Map with the same
 * TTL — no Blobs dependency needed.
 */

import { config } from "../config.mjs";

const BLOB_STORE_NAME = "superbrain-dashboard";
const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes

// ── Local (non-Netlify) in-process cache ──────────────────────────────────
const localCache = new Map(); // key → { data, expiresAt }

function localGet(key) {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return entry.data;
}

function localSet(key, data, ttlMs = DEFAULT_TTL_MS) {
  localCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Netlify Blobs store ────────────────────────────────────────────────────
let _blobStorePromise = null;

async function getBlobStore() {
  if (!config.isNetlifyRuntime) return null;
  if (!_blobStorePromise) {
    _blobStorePromise = (async () => {
      try {
        const { getStore } = await import("@netlify/blobs");
        return getStore({ name: BLOB_STORE_NAME, consistency: "strong" });
      } catch (err) {
        console.warn("[dashboard-cache] Blobs unavailable:", err.message);
        return null;
      }
    })();
  }
  return _blobStorePromise;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key from symbols + strategy.
 * Symbols are sorted so ["TCS","RELIANCE"] and ["RELIANCE","TCS"] share a key.
 */
// Bump version when buildDashboard response shape changes, to force
// invalidation of all stale Blobs cache entries on deploy.
const CACHE_VERSION = "v2";

export function dashboardCacheKey(symbols = [], strategy = "swing") {
  const sorted = [...symbols].map((s) => s.trim().toUpperCase()).sort().join(",");
  return `dashboard:${CACHE_VERSION}:${strategy}:${sorted}`;
}

/**
 * Read a dashboard entry. Returns null on miss or expiry.
 */
export async function getDashboardCache(key) {
  if (!config.isNetlifyRuntime) {
    return localGet(key);
  }

  const store = await getBlobStore();
  if (!store) return null;

  try {
    const raw = await store.get(key, { type: "json" });
    if (!raw) return null;
    // Check embedded TTL
    if (raw._cacheExpiresAt && Date.now() > raw._cacheExpiresAt) {
      // Stale — delete async (don't await)
      store.delete(key).catch(() => {});
      return null;
    }
    return raw;
  } catch (err) {
    console.warn("[dashboard-cache] read error:", err.message);
    return null;
  }
}

/**
 * Write a dashboard entry with a TTL embedded in the payload.
 */
export async function setDashboardCache(key, data, ttlMs = DEFAULT_TTL_MS) {
  const payload = { ...data, _cacheExpiresAt: Date.now() + ttlMs };

  if (!config.isNetlifyRuntime) {
    localSet(key, payload, ttlMs);
    return;
  }

  const store = await getBlobStore();
  if (!store) return;

  try {
    await store.set(key, JSON.stringify(payload));
  } catch (err) {
    console.warn("[dashboard-cache] write error:", err.message);
  }
}
