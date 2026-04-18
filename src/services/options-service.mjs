/**
 * Superbrain Options Intelligence Service
 * Phase 1 + Phase 4: NSE Options Chain, PCR, Max Pain, India VIX, OI Analysis
 * Data source: NSE public API (no auth required)
 */

import { TTLCache } from "../utils/ttl-cache.mjs";
import { fetchJson, fetchText } from "../utils/http.mjs";

const optionsCache = new TTLCache(3 * 60_000);      // 3 min
const vixCache = new TTLCache(60_000);               // 1 min
const rolloverCache = new TTLCache(5 * 60_000);      // 5 min

const NSE_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "accept": "application/json",
  "accept-language": "en-US,en;q=0.9",
  "referer": "https://www.nseindia.com/",
};

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = safeNum(v);
  return n !== null ? Math.round(n * 100) / 100 : null;
}

// ─────────────────────────────────────────────
// INDIA VIX
// ─────────────────────────────────────────────
export async function getIndiaVix() {
  const cacheKey = "india_vix";
  const cached = vixCache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchJson(
      "https://www.nseindia.com/api/allIndices",
      { headers: NSE_HEADERS, timeout: 8000 }
    );
    const indices = data?.data || [];
    const vixEntry = indices.find(
      (i) => i?.index === "India VIX" || i?.indexSymbol === "INDIAVIX"
    );
    if (!vixEntry) throw new Error("VIX entry not found");

    const vix = safeNum(vixEntry.last);
    const vixChange = safeNum(vixEntry.change);
    const vixChangePct = safeNum(vixEntry.percentChange);

    const result = {
      vix: round2(vix),
      change: round2(vixChange),
      changePct: round2(vixChangePct),
      signal: classifyVix(vix),
      source: "NSE_LIVE",
    };
    vixCache.set(cacheKey, result);
    return result;
  } catch (err) {
    // Fallback: try Yahoo VIX proxy
    try {
      const yData = await fetchJson(
        "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1d&range=5d",
        { timeout: 6000 }
      );
      const meta = yData?.chart?.result?.[0]?.meta;
      const vix = safeNum(meta?.regularMarketPrice);
      if (!vix) throw new Error("No VIX from Yahoo");
      const result = {
        vix: round2(vix),
        change: round2(meta?.regularMarketChange),
        changePct: round2(meta?.regularMarketChangePercent),
        signal: classifyVix(vix),
        source: "YAHOO_DELAYED",
      };
      vixCache.set(cacheKey, result);
      return result;
    } catch (_) {
      return { vix: null, change: null, changePct: null, signal: "UNAVAILABLE", source: "UNAVAILABLE" };
    }
  }
}

function classifyVix(vix) {
  if (!vix) return "UNKNOWN";
  if (vix > 30) return "EXTREME_FEAR";
  if (vix > 20) return "HIGH_FEAR";
  if (vix > 15) return "MODERATE";
  if (vix > 12) return "CALM";
  return "EXTREME_COMPLACENCY";
}

// ─────────────────────────────────────────────
// NSE OPTIONS CHAIN
// ─────────────────────────────────────────────
export async function getOptionsChain(symbol = "NIFTY") {
  const key = `options_chain_${symbol.toUpperCase()}`;
  const cached = optionsCache.get(key);
  if (cached) return cached;

  try {
    const nseSymbol = normalizeOptionsSymbol(symbol);
    const isIndex = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(nseSymbol);
    const url = isIndex
      ? `https://www.nseindia.com/api/option-chain-indices?symbol=${nseSymbol}`
      : `https://www.nseindia.com/api/option-chain-equities?symbol=${nseSymbol}`;

    const raw = await fetchJson(url, { headers: NSE_HEADERS, timeout: 10000 });
    const records = raw?.records?.data || [];
    const expiryDates = raw?.records?.expiryDates || [];
    const underlyingValue = safeNum(raw?.records?.underlyingValue) || safeNum(raw?.filtered?.IV);
    const spotPrice = underlyingValue;

    if (!records.length) throw new Error("Empty options chain");

    // Use nearest expiry
    const nearestExpiry = expiryDates[0] || null;
    const chainData = nearestExpiry
      ? records.filter((r) => r.expiryDate === nearestExpiry)
      : records.slice(0, 50);

    const processed = processOptionsChain(chainData, spotPrice);
    const result = {
      symbol: nseSymbol,
      spotPrice: round2(spotPrice),
      expiry: nearestExpiry,
      expiryDates: expiryDates.slice(0, 6),
      chain: processed.chain,
      pcr: processed.pcr,
      maxPain: processed.maxPain,
      oiWalls: processed.oiWalls,
      ivRank: null, // Requires 52-week data
      summary: buildOptionsSummary(processed, spotPrice),
      source: "NSE_LIVE",
      timestamp: new Date().toISOString(),
    };
    optionsCache.set(key, result);
    return result;
  } catch (err) {
    return {
      symbol,
      spotPrice: null,
      expiry: null,
      chain: [],
      pcr: null,
      maxPain: null,
      oiWalls: { call: [], put: [] },
      summary: null,
      source: "UNAVAILABLE",
      error: err.message,
    };
  }
}

function normalizeOptionsSymbol(symbol) {
  const s = symbol.toUpperCase().trim();
  const aliases = {
    "NIFTY50": "NIFTY",
    "BANKNIFTY": "BANKNIFTY",
    "BANKNIFIT": "BANKNIFTY",
    "FINNIFTY": "FINNIFTY",
  };
  return aliases[s] || s;
}

function processOptionsChain(records, spotPrice) {
  let totalCallOI = 0;
  let totalPutOI = 0;
  const strikesMap = new Map();

  for (const record of records) {
    const strike = safeNum(record.strikePrice);
    if (!strike) continue;

    const ce = record.CE || {};
    const pe = record.PE || {};

    const callOI = safeNum(ce.openInterest, 0);
    const putOI = safeNum(pe.openInterest, 0);
    const callOIChg = safeNum(ce.changeinOpenInterest, 0);
    const putOIChg = safeNum(pe.changeinOpenInterest, 0);
    const callIV = safeNum(ce.impliedVolatility, 0);
    const putIV = safeNum(pe.impliedVolatility, 0);
    const callLTP = safeNum(ce.lastPrice, 0);
    const putLTP = safeNum(pe.lastPrice, 0);
    const callVol = safeNum(ce.totalTradedVolume, 0);
    const putVol = safeNum(pe.totalTradedVolume, 0);

    totalCallOI += callOI;
    totalPutOI += putOI;

    strikesMap.set(strike, {
      strike,
      callOI: Math.round(callOI / 100) * 100,
      putOI: Math.round(putOI / 100) * 100,
      callOIChg,
      putOIChg,
      callIV: round2(callIV),
      putIV: round2(putIV),
      callLTP: round2(callLTP),
      putLTP: round2(putLTP),
      callVol,
      putVol,
      totalOI: callOI + putOI,
    });
  }

  const chain = [...strikesMap.values()].sort((a, b) => a.strike - b.strike);

  // PCR
  const pcr = totalCallOI > 0 ? round2(totalPutOI / totalCallOI) : null;
  const pcrSignal = classifyPCR(pcr);

  // Max Pain = strike where option writers lose least
  const maxPain = calculateMaxPain(chain);

  // OI Walls: Top 5 strikes with highest OI (resistance = call walls, support = put walls)
  const callWalls = chain
    .filter((s) => spotPrice ? s.strike > spotPrice : true)
    .sort((a, b) => b.callOI - a.callOI)
    .slice(0, 5)
    .map((s) => ({ strike: s.strike, oi: s.callOI, type: "RESISTANCE" }));

  const putWalls = chain
    .filter((s) => spotPrice ? s.strike < spotPrice : true)
    .sort((a, b) => b.putOI - a.putOI)
    .slice(0, 5)
    .map((s) => ({ strike: s.strike, oi: s.putOI, type: "SUPPORT" }));

  return {
    chain,
    pcr: { value: pcr, signal: pcrSignal, totalCallOI: Math.round(totalCallOI), totalPutOI: Math.round(totalPutOI) },
    maxPain: { strike: maxPain, distanceFromSpot: spotPrice ? round2(((maxPain - spotPrice) / spotPrice) * 100) : null },
    oiWalls: { call: callWalls, put: putWalls },
  };
}

function calculateMaxPain(chain) {
  if (!chain.length) return null;
  let minPain = Infinity;
  let maxPainStrike = chain[0]?.strike || 0;

  for (const candidate of chain) {
    const s = candidate.strike;
    let totalPain = 0;
    for (const row of chain) {
      // Call writers lose when spot > strike (intrinsic value loss)
      if (s > row.strike) totalPain += (s - row.strike) * row.callOI;
      // Put writers lose when spot < strike
      if (s < row.strike) totalPain += (row.strike - s) * row.putOI;
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = s;
    }
  }
  return maxPainStrike;
}

function classifyPCR(pcr) {
  if (!pcr) return "UNKNOWN";
  if (pcr >= 1.5) return "EXTREMELY_BULLISH";
  if (pcr >= 1.2) return "BULLISH";
  if (pcr >= 0.8) return "NEUTRAL";
  if (pcr >= 0.6) return "BEARISH";
  return "EXTREMELY_BEARISH";
}

function buildOptionsSummary(processed, spotPrice) {
  const { pcr, maxPain, oiWalls } = processed;
  const nearestCallWall = oiWalls.call[0];
  const nearestPutWall = oiWalls.put[0];

  const resistanceLevel = nearestCallWall?.strike || null;
  const supportLevel = nearestPutWall?.strike || null;

  const summary = [];
  if (pcr?.signal) summary.push(`PCR ${pcr.value} → ${pcr.signal}`);
  if (maxPain?.strike) summary.push(`Max Pain: ${maxPain.strike} (${maxPain.distanceFromSpot > 0 ? "+" : ""}${maxPain.distanceFromSpot}% from spot)`);
  if (resistanceLevel) summary.push(`Key Resistance (Call Wall): ${resistanceLevel}`);
  if (supportLevel) summary.push(`Key Support (Put Wall): ${supportLevel}`);

  return {
    text: summary.join(" | "),
    resistanceLevel,
    supportLevel,
    directionalBias: deriveBias(pcr?.signal, maxPain?.distanceFromSpot),
  };
}

function deriveBias(pcrSignal, maxPainDist) {
  if (pcrSignal === "EXTREMELY_BULLISH" || pcrSignal === "BULLISH") return "BULLISH";
  if (pcrSignal === "EXTREMELY_BEARISH" || pcrSignal === "BEARISH") return "BEARISH";
  if (maxPainDist !== null) {
    if (maxPainDist > 2) return "BEARISH"; // price will be pulled down to max pain
    if (maxPainDist < -2) return "BULLISH"; // price will be pulled up to max pain
  }
  return "NEUTRAL";
}

// ─────────────────────────────────────────────
// OI ROLLOVER ANALYSIS
// ─────────────────────────────────────────────
export function classifyOIRollover({ oiChange, pricePct }) {
  if (oiChange === null || oiChange === undefined) return "UNKNOWN";
  const oiBuildup = oiChange > 0;
  const priceUp = pricePct > 0;

  if (oiBuildup && priceUp) return "LONG_BUILDUP";      // Bullish
  if (oiBuildup && !priceUp) return "SHORT_BUILDUP";    // Bearish
  if (!oiBuildup && priceUp) return "SHORT_COVERING";   // Bullish (short squeeze)
  return "LONG_UNWINDING";                              // Bearish
}

export function getOIRolloverSignal(rolloverType) {
  const signals = {
    LONG_BUILDUP: { bias: "BULLISH", strength: 75, label: "Long build-up — institutional longs entering" },
    SHORT_COVERING: { bias: "BULLISH", strength: 60, label: "Short covering — bears exiting" },
    SHORT_BUILDUP: { bias: "BEARISH", strength: 75, label: "Short build-up — institutional shorts entering" },
    LONG_UNWINDING: { bias: "BEARISH", strength: 60, label: "Long unwinding — bulls exiting" },
    UNKNOWN: { bias: "NEUTRAL", strength: 50, label: "Insufficient OI data" },
  };
  return signals[rolloverType] || signals.UNKNOWN;
}

// ─────────────────────────────────────────────
// IV RANK CALCULATOR (requires stored 52w data)
// ─────────────────────────────────────────────
export function calculateIVRank(currentIV, iv52wLow, iv52wHigh) {
  if (!currentIV || !iv52wLow || !iv52wHigh || iv52wHigh <= iv52wLow) return null;
  const rank = round2(((currentIV - iv52wLow) / (iv52wHigh - iv52wLow)) * 100);
  return {
    rank,
    signal: rank > 80 ? "SELL_OPTIONS" : rank < 20 ? "BUY_OPTIONS" : "NEUTRAL",
    label: rank > 80
      ? "IV very high — sell premium strategies (Iron Condor, Covered Call)"
      : rank < 20
      ? "IV very low — buy options (long straddle/strangle)"
      : "IV in normal range",
  };
}

// ─────────────────────────────────────────────
// OPTIONS STRATEGY RECOMMENDER
// ─────────────────────────────────────────────
export function recommendOptionsStrategy({ bias, ivRank, daysToExpiry, riskProfile = "moderate" }) {
  const strategies = [];

  if (bias === "BULLISH") {
    if (ivRank?.rank > 70) {
      strategies.push({ name: "Bull Put Spread", type: "CREDIT", risk: "LIMITED", description: "Sell OTM put, buy further OTM put. Profits if stock stays above short strike. High IV = good premium." });
    } else {
      strategies.push({ name: "Bull Call Spread", type: "DEBIT", risk: "LIMITED", description: "Buy ATM call, sell OTM call. Max profit at short strike. Defined risk." });
    }
    if (riskProfile === "aggressive") {
      strategies.push({ name: "Long Call", type: "DEBIT", risk: "PREMIUM", description: "Simple directional bullish bet. High leverage." });
    }
  } else if (bias === "BEARISH") {
    if (ivRank?.rank > 70) {
      strategies.push({ name: "Bear Call Spread", type: "CREDIT", risk: "LIMITED", description: "Sell OTM call, buy further OTM call. Profits from time decay and downward movement." });
    } else {
      strategies.push({ name: "Bear Put Spread", type: "DEBIT", risk: "LIMITED", description: "Buy ATM put, sell OTM put. Defined risk bearish play." });
    }
  } else {
    // Neutral
    if (ivRank?.rank > 80) {
      strategies.push({ name: "Iron Condor", type: "CREDIT", risk: "LIMITED", description: "Sell OTM call spread + OTM put spread. Maximum profit when stock stays in narrow range. Best in high IV." });
      strategies.push({ name: "Short Straddle", type: "CREDIT", risk: "UNLIMITED", description: "Sell ATM call and put. Profits from time decay. High risk if large move occurs. Only with very high IV." });
    } else if (ivRank?.rank < 20) {
      strategies.push({ name: "Long Straddle", type: "DEBIT", risk: "PREMIUM", description: "Buy ATM call and put. Profits from large move in either direction. Best before events with low current IV." });
      strategies.push({ name: "Long Strangle", type: "DEBIT", risk: "PREMIUM", description: "Buy OTM call and put. Cheaper than straddle, needs larger move to profit." });
    } else {
      strategies.push({ name: "Covered Call", type: "INCOME", risk: "LIMITED", description: "If holding stock, sell OTM call to generate monthly income. Good in sideways markets." });
    }
  }

  if (daysToExpiry && daysToExpiry < 7) {
    strategies.forEach((s) => {
      s.note = "Gamma risk very high — weekly expiry approaching. Theta accelerating.";
    });
  }

  return strategies;
}

// ─────────────────────────────────────────────
// ENRICH STOCK SIGNAL WITH OPTIONS DATA
// ─────────────────────────────────────────────
export async function enrichWithOptionsData(symbol, currentPrice) {
  try {
    const [optionsData, vixData] = await Promise.all([
      getOptionsChain(symbol).catch(() => null),
      getIndiaVix().catch(() => null),
    ]);

    if (!optionsData || optionsData.source === "UNAVAILABLE") {
      return { available: false, reason: "Options chain unavailable" };
    }

    const { pcr, maxPain, oiWalls, summary } = optionsData;

    // Score contribution from options data
    let optionsScore = 50;
    if (pcr?.signal === "BULLISH" || pcr?.signal === "EXTREMELY_BULLISH") optionsScore += 15;
    if (pcr?.signal === "BEARISH" || pcr?.signal === "EXTREMELY_BEARISH") optionsScore -= 15;

    // Max pain magnet effect
    if (maxPain?.distanceFromSpot !== null) {
      const mpDist = maxPain.distanceFromSpot;
      if (Math.abs(mpDist) < 1) optionsScore += 5; // Near max pain = stability
    }

    // VIX signal
    let vixSignal = null;
    if (vixData?.vix) {
      if (vixData.vix > 25) optionsScore -= 10; // High fear = risk off
      if (vixData.vix < 13) optionsScore += 5;  // Low fear = calm market
      vixSignal = vixData.signal;
    }

    return {
      available: true,
      optionsScore: Math.round(Math.max(0, Math.min(100, optionsScore))),
      pcr: pcr?.value,
      pcrSignal: pcr?.signal,
      maxPainStrike: maxPain?.strike,
      maxPainDistance: maxPain?.distanceFromSpot,
      resistanceLevel: summary?.resistanceLevel,
      supportLevel: summary?.supportLevel,
      directionalBias: summary?.directionalBias,
      oiWalls: oiWalls,
      vix: vixData?.vix,
      vixSignal,
      summary: summary?.text,
      expiry: optionsData.expiry,
      source: optionsData.source,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
