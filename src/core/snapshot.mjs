/**
 * Snapshot builder — TRANSFORMATION_ROADMAP §5 Phase 1.1
 *
 * `buildStockSnapshot(symbol, opts)` is THE ONLY FUNCTION that fetches raw
 * market data for a stock. It returns a StockSnapshot — every numeric field
 * wrapped with provenance metadata per src/core/provenance.mjs.
 *
 * Caching contract (Phase 1.2 / snapshot-cache.mjs):
 *   - buildStockSnapshot does NOT read or write the cache — it only builds.
 *   - The CALLER (analysis-service.mjs) is responsible for checking the cache
 *     before calling this, and for persisting the scored snapshot afterward.
 *   - This keeps the dependency graph acyclic:
 *       core/snapshot.mjs → services/* (data only)
 *       analysis-service.mjs → core/snapshot.mjs + core/scoring helpers
 *
 * assembleSnapshot() is exported separately so analyzeMarket (which already
 * has a bundle in hand) can build a snapshot without a redundant re-fetch.
 *
 * serializeSnapshot() strips internal _bundle / _stock references before the
 * snapshot is written to Netlify Blobs (keeps stored objects lean).
 *
 * Roadmap Principle #3: "Every number has a provenance."
 * Roadmap Principle #7: "Deterministic within a snapshot."
 */

import * as prov from "./provenance.mjs";
import { resolveStockAny } from "../services/universe-service.mjs";
import { resolveStockBundle, getMarketContext } from "../services/market-service.mjs";
import { getNewsForSymbols, getNewsIntelligence } from "../services/news-service.mjs";

// ─────────────────────────────────────────────────────────────────────────────
//  JSDoc typedefs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {"STRONG_BUY"|"BUY"|"HOLD"|"SELL"|"STRONG_SELL"|"NO_CALL"} VerdictLetter
 */

/**
 * @typedef {Object} StrategyScore
 * @property {string}       strategy        — "intraday"|"swing"|"position"|"longterm"
 * @property {number}       adjustedScore   — 0..100 weighted pillar sum minus risk penalty
 * @property {number}       riskScore       — 0..100 composite risk (higher = more risky)
 * @property {Object}       scoreBreakdown  — {technical, fundamentals, news, macro, events, risk}
 * @property {Object}       verdict         — {letter: VerdictLetter, confidence, reasoning, gate}
 * @property {Object}       targets         — {targetPrice, stopLoss, targetPct}
 * @property {number}       confidence      — 0..100 confidence in this strategy's call
 */

/**
 * @typedef {Object} StockSnapshot
 * The canonical, immutable data bundle for one stock at one point in time.
 * Keyed by {symbol, snapshotId, asOf}.
 *
 * Identity:
 * @property {string}  snapshotId     — deterministic 5-min-windowed key
 * @property {string}  asOf           — ISO 8601 timestamp of data capture
 * @property {string}  symbol
 * @property {string}  companyName
 * @property {string}  exchange
 * @property {string}  sector
 * @property {string}  marketCapBand  — "large"|"mid"|"small"|"micro"
 * @property {boolean} isFnO
 *
 * Provenance-wrapped price fields (import('./provenance.mjs').Provenance):
 * @property {import('./provenance.mjs').Provenance} price
 * @property {import('./provenance.mjs').Provenance} changePct
 * @property {import('./provenance.mjs').Provenance} volume
 * @property {import('./provenance.mjs').Provenance} open
 * @property {import('./provenance.mjs').Provenance} high
 * @property {import('./provenance.mjs').Provenance} low
 * @property {import('./provenance.mjs').Provenance} prevClose
 * @property {import('./provenance.mjs').Provenance} high52w
 * @property {import('./provenance.mjs').Provenance} low52w
 * @property {import('./provenance.mjs').Provenance} marketCap
 *
 * Provenance-wrapped data objects:
 * @property {import('./provenance.mjs').Provenance} technical     — technical snapshot object
 * @property {import('./provenance.mjs').Provenance} fundamentals  — fundamentals object
 * @property {import('./provenance.mjs').Provenance} marketContext — market-wide context
 * @property {import('./provenance.mjs').Provenance} newsDigest    — {symbolItems, global}
 * @property {import('./provenance.mjs').Provenance} candles       — OHLCV array
 *
 * Scores (populated by analysis-service.mjs after all four strategies are run):
 * @property {Object.<string, StrategyScore>} scores — keyed by strategy name
 *
 * Internal refs (present in memory, stripped before Blobs serialization):
 * @property {Object} [_bundle]  — raw resolveStockBundle() result
 * @property {Object} [_stock]   — resolved stock info object
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Snapshot ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic snapshot ID from symbol + timestamp.
 * Rounds to the nearest 5-minute window so concurrent requests within
 * the same window share one cache entry (Roadmap Principle #7).
 *
 * @param {string} symbol
 * @param {number} [timestampMs]
 * @returns {string}
 */
export function genSnapshotId(symbol, timestampMs = Date.now()) {
  const window5m = Math.floor(timestampMs / 300_000) * 300_000;
  return `${String(symbol).toLowerCase()}-${window5m.toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a raw StockSnapshot by fetching all data sources in parallel.
 *
 * Does NOT:
 *   - Check or write the snapshot cache (caller's responsibility).
 *   - Score strategies (analysis-service.mjs attaches scores afterward).
 *
 * Returns null when:
 *   - The symbol is not in the universe.
 *   - Quote data is unavailable from all sources.
 *
 * @param {string} symbol
 * @param {Object} [opts]
 * @param {boolean} [opts.includeTargetedNews=true]
 * @param {number}  [opts.newsTargetedLimit=1]
 * @param {boolean} [opts.forceNewsRefresh=false]
 * @returns {Promise<StockSnapshot|null>}
 */
export async function buildStockSnapshot(symbol, opts = {}) {
  const upperSymbol = String(symbol || "").trim().toUpperCase();
  if (!upperSymbol) return null;

  const stock = await resolveStockAny(upperSymbol);
  if (!stock) return null;

  const fetchStart = Date.now();

  // Single parallel round-trip — all four data sources.
  const [bundle, marketCtx, symbolNews, globalNews] = await Promise.all([
    resolveStockBundle(stock),
    getMarketContext().catch((err) => {
      console.warn("[snapshot] getMarketContext failed:", err?.message);
      return null;
    }),
    getNewsForSymbols([upperSymbol], [stock], {
      includeTargeted: opts.includeTargetedNews !== false,
      targetedLimit: Math.max(1, Number(opts.newsTargetedLimit || 1)),
      forceRefresh: opts.forceNewsRefresh === true,
    }).catch((err) => {
      console.warn("[snapshot] getNewsForSymbols failed:", err?.message);
      return null;
    }),
    getNewsIntelligence().catch((err) => {
      console.warn("[snapshot] getNewsIntelligence failed:", err?.message);
      return null;
    }),
  ]);

  if (!bundle?.quote) {
    return null; // Quote unavailable — callers handle this as a soft "not found"
  }

  return assembleSnapshot(upperSymbol, stock, bundle, marketCtx, symbolNews, globalNews, fetchStart);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble a StockSnapshot from pre-fetched components.
 * Exported so analyzeMarket (which already has bundles) can wrap its data
 * without a redundant network round-trip.
 *
 * @param {string}      symbol
 * @param {Object}      stock
 * @param {Object}      bundle        — from resolveStockBundle()
 * @param {Object|null} marketCtx     — from getMarketContext()
 * @param {Object|null} symbolNews    — from getNewsForSymbols()
 * @param {Object|null} globalNews    — from getNewsIntelligence()
 * @param {number}      [fetchStart]  — epoch ms at fetch start (for latency)
 * @returns {StockSnapshot}
 */
export function assembleSnapshot(
  symbol,
  stock,
  bundle,
  marketCtx,
  symbolNews,
  globalNews,
  fetchStart = Date.now(),
) {
  const { quote, candles = [], technical = {}, fundamentals = {} } = bundle;

  const quoteSource  = detectQuoteSource(quote);
  const fundSource   = detectFundamentalsSource(fundamentals);
  const priceConf    = quoteSource.startsWith("UPSTOX") ? "live" : "delayed";
  const now          = Date.now();
  const latencyMs    = now - fetchStart;

  /** @type {StockSnapshot} */
  return {
    // ── Identity ──────────────────────────────────────────────────────────────
    snapshotId:    genSnapshotId(symbol, now),
    asOf:          new Date(now).toISOString(),
    symbol:        stock.symbol  || symbol,
    companyName:   stock.name    || stock.companyName || symbol,
    exchange:      stock.exchange     || "NSE",
    sector:        stock.sector       || "Unknown",
    marketCapBand: stock.marketCapBand || deriveCapBand(quote.marketCap),
    isFnO:         Boolean(stock.isFnO),

    // ── Price (provenance-wrapped) ────────────────────────────────────────────
    price:     prov.wrap(nullToUndef(quote.price),     quoteSource, priceConf, { latencyMs }),
    changePct: prov.wrap(nullToUndef(quote.changePct), quoteSource, priceConf),
    volume:    prov.wrap(nullToUndef(quote.volume),    quoteSource, priceConf),
    open:      prov.wrap(nullToUndef(quote.open),      quoteSource, priceConf),
    high:      prov.wrap(nullToUndef(quote.high),      quoteSource, priceConf),
    low:       prov.wrap(nullToUndef(quote.low),       quoteSource, priceConf),
    prevClose: prov.wrap(nullToUndef(quote.prevClose), quoteSource, priceConf),
    high52w:   prov.wrap(nullToUndef(quote.high52w),   quoteSource, "delayed"),
    low52w:    prov.wrap(nullToUndef(quote.low52w),    quoteSource, "delayed"),
    marketCap: prov.wrap(
      nullToUndef(quote.marketCap ?? fundamentals?.marketCap),
      fundamentals?.marketCap != null ? fundSource : quoteSource,
      "delayed",
    ),

    // ── Data objects (provenance-wrapped) ────────────────────────────────────
    technical: prov.wrap(
      technical,
      quoteSource,
      priceConf,
    ),
    fundamentals: prov.wrap(
      fundamentals,
      fundSource,
      fundamentals && Object.keys(fundamentals).length > 1 ? "live" : "fallback",
    ),
    marketContext: prov.wrap(
      marketCtx ?? {},
      "nse",
      "live",
    ),
    newsDigest: prov.wrap(
      { symbolItems: symbolNews ?? [], global: globalNews ?? {} },
      "news-aggregator",
      "live",
    ),
    candles: prov.wrap(
      candles,
      quoteSource,
      priceConf,
      { latencyMs },
    ),

    // ── Scores (populated by analysis-service.mjs, not here) ─────────────────
    scores: {},

    // ── Internal refs (stripped before Blobs serialization) ──────────────────
    _bundle: bundle,
    _stock:  stock,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove internal _bundle and _stock before writing to Netlify Blobs.
 * Those objects are large, redundant with provenance fields, and not needed
 * for cross-tab rendering — the analysis pipeline re-fetches them on a cold
 * cache miss.
 *
 * Also strips per-strategy `_row` internal refs from scores (if any).
 *
 * @param {StockSnapshot} snapshot
 * @returns {Object}  — serializable, safe to pass to setSnapshot()
 */
export function serializeSnapshot(snapshot) {
  // eslint-disable-next-line no-unused-vars
  const { _bundle, _stock, ...rest } = snapshot;

  // Strip _row from each strategy score too (added by analysis-service.mjs
  // during Phase 1 for internal use, not needed in the cached blob).
  if (rest.scores && typeof rest.scores === "object") {
    const cleanScores = {};
    for (const [strategy, score] of Object.entries(rest.scores)) {
      if (!score) continue;
      // eslint-disable-next-line no-unused-vars
      const { _row, ...cleanScore } = score;
      cleanScores[strategy] = cleanScore;
    }
    rest.scores = cleanScores;
  }

  return rest;
}

/**
 * Whether a cached snapshot has complete per-strategy scores.
 * Used by analysis-service.mjs to decide whether the cached snapshot can
 * serve the response without re-scoring.
 *
 * @param {StockSnapshot|null|undefined} snapshot
 * @returns {boolean}
 */
export function isSnapshotScored(snapshot) {
  if (!snapshot?.scores || typeof snapshot.scores !== "object") return false;
  const strategies = ["intraday", "swing", "position", "longterm"];
  return strategies.every((s) => snapshot.scores[s]?.verdict?.letter);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map known source strings to canonical source names for provenance. */
function detectQuoteSource(quote) {
  if (!quote) return "unknown";
  const raw = String(quote.source || quote.dataSource || "").toUpperCase();
  if (raw.includes("UPSTOX")) return "UPSTOX_LIVE";
  if (raw.includes("NSE"))    return "NSE_OFFICIAL";
  if (raw.includes("BSE"))    return "BSE_OFFICIAL";
  if (raw.includes("SCREENER")) return "SCREENER_PUBLIC";
  return "YAHOO_DELAYED";
}

function detectFundamentalsSource(fundamentals) {
  if (!fundamentals) return "unknown";
  const raw = String(fundamentals.source || "").toUpperCase();
  if (raw.includes("SCREENER"))       return "SCREENER_PUBLIC";
  if (raw.includes("UPSTOX"))         return "UPSTOX_LIVE";
  if (raw.includes("MONEYCONTROL"))   return "MONEYCONTROL_PUBLIC";
  if (raw.includes("NSE"))            return "NSE_PUBLIC";
  return "SCREENER_PUBLIC"; // most likely default
}

/** Derive market-cap band from numeric market cap (in ₹ crore). */
function deriveCapBand(marketCapCr) {
  const cap = Number(marketCapCr || 0);
  if (cap >= 20_000) return "large";
  if (cap >=  5_000) return "mid";
  if (cap >=    500) return "small";
  return "micro";
}

/** Replace null with undefined so provenance.wrap() stores it cleanly. */
function nullToUndef(v) {
  return v === null ? undefined : v;
}
