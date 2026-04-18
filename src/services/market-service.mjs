import { config } from "../config.mjs";
import { fetchJson, fetchText } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";
import { fetchUpstoxQuotes, getUpstoxStatus } from "./upstox-service.mjs";
import { resolveStockAny } from "./universe-service.mjs";

const quoteCache = new TTLCache(30_000);
const candleCache = new TTLCache(15 * 60_000);
const fundamentalsCache = new TTLCache(6 * 60 * 60_000);
const contextCache = new TTLCache(5 * 60_000);

const YAHOO_OVERRIDES = {
  "M&M": "M%26M.NS",
  TATAMOTORS: "TATAMOTORS.BO",
};

const FUNDAMENTAL_FIELDS = [
  "pe",
  "roe",
  "roce",
  "debtToEquity",
  "promoterHolding",
  "salesGrowth3yr",
  "profitGrowth3yr",
  "dividendYield",
];

const MARKET_WEB_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSearchText(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

function parseLooseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[^\d.\-]/g, "")
    .trim();

  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function finalizeFundamentals(symbol, payload = {}, meta = {}) {
  return {
    symbol,
    pe: round(parseLooseNumber(payload.pe), 2),
    roe: round(parseLooseNumber(payload.roe), 2),
    roce: round(parseLooseNumber(payload.roce), 2),
    debtToEquity: round(parseLooseNumber(payload.debtToEquity), 2),
    promoterHolding: round(parseLooseNumber(payload.promoterHolding), 2),
    salesGrowth3yr: round(parseLooseNumber(payload.salesGrowth3yr), 2),
    profitGrowth3yr: round(parseLooseNumber(payload.profitGrowth3yr), 2),
    dividendYield: round(parseLooseNumber(payload.dividendYield), 2),
    source: meta.source || "UNAVAILABLE",
    provider: meta.provider || meta.source || "UNAVAILABLE",
    reason: meta.reason ?? null,
    resolvedVariant: meta.resolvedVariant ?? null,
    secondarySources: Array.isArray(meta.secondarySources) ? meta.secondarySources : [],
  };
}

function countFundamentalValues(payload = {}) {
  return FUNDAMENTAL_FIELDS.reduce((count, field) => (
    payload?.[field] !== null && payload?.[field] !== undefined && Number.isFinite(Number(payload[field]))
      ? count + 1
      : count
  ), 0);
}

function mergeFundamentalPayloads(...payloads) {
  const merged = {};
  for (const payload of payloads) {
    if (!payload) {
      continue;
    }
    for (const field of FUNDAMENTAL_FIELDS) {
      if (merged[field] === null || merged[field] === undefined) {
        const candidate = payload[field];
        if (candidate !== null && candidate !== undefined && Number.isFinite(Number(candidate))) {
          merged[field] = candidate;
        }
      }
    }
  }
  return merged;
}

function buildFundamentalLookupVariants(stockOrSymbol) {
  const stock = typeof stockOrSymbol === "string" ? { symbol: stockOrSymbol } : (stockOrSymbol || {});
  const symbol = String(stock.symbol || "").trim().toUpperCase();
  const name = String(stock.name || "").trim();
  const simplifiedName = name
    .replace(/\b(limited|ltd|india|industries|industry|corporation|company|co|enterprises?|holdings?)\b/gi, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uniqueStrings([
    symbol,
    symbol.replace(/&/g, ""),
    symbol.replace(/-/g, ""),
    simplifiedName ? simplifiedName.replace(/\s+/g, "-").toUpperCase() : "",
    simplifiedName ? simplifiedName.replace(/\s+/g, "").toUpperCase() : "",
  ]);
}

function buildFundamentalSearchTerms(stockOrSymbol) {
  const stock = typeof stockOrSymbol === "string" ? { symbol: stockOrSymbol } : (stockOrSymbol || {});
  const symbol = String(stock.symbol || "").trim().toUpperCase();
  const name = String(stock.name || "").trim();
  const simplifiedName = name
    .replace(/\b(limited|ltd|india|industries|industry|corporation|company|co|enterprises?|holdings?)\b/gi, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uniqueStrings([
    symbol,
    name,
    simplifiedName,
    simplifiedName ? simplifiedName.replace(/\s+/g, " ") : "",
  ]);
}

function computeCagrFromSeries(points = []) {
  const recent = points
    .map((point) => ({
      label: point?.year || point?.displayPeriod || point?.label || "",
      value: parseLooseNumber(point?.value ?? point?.formattedValue ?? point?.revenue ?? point?.profit),
    }))
    .filter((point) => Number.isFinite(point.value))
    .slice(-4);

  if (recent.length < 4) {
    return null;
  }

  const start = recent[0].value;
  const end = recent[recent.length - 1].value;
  const years = recent.length - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || years <= 0) {
    return null;
  }

  return ((end / start) ** (1 / years) - 1) * 100;
}

function extractMoneycontrolListedSymbol(candidate = {}) {
  const raw = String(candidate?.pdt_dis_nm || "");
  const match = raw.match(/<span>\s*[^,]+,\s*([^,<]+)\s*(?:,|<\/span>)/i);
  return normalizeSearchText(match?.[1] || "");
}

function buildEmaSeries(values = [], period = 12) {
  if (!values.length) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const series = [];
  let previous = values[0];

  for (const value of values) {
    previous = series.length === 0 ? value : (value - previous) * multiplier + previous;
    series.push(previous);
  }

  return series;
}

function computeRsi(closes = [], period = 14) {
  if (closes.length < period + 1) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMacd(closes = []) {
  if (closes.length < 35) {
    return {
      line: null,
      signal: null,
      histogram: null,
      posture: "UNAVAILABLE",
    };
  }

  const ema12 = buildEmaSeries(closes, 12);
  const ema26 = buildEmaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => ema12[index] - ema26[index]);
  const signalSeries = buildEmaSeries(macdSeries, 9);
  const line = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  const histogram = line - signal;

  return {
    line: round(line, 3),
    signal: round(signal, 3),
    histogram: round(histogram, 3),
    posture: histogram > 0.12 ? "BULLISH" : histogram < -0.12 ? "BEARISH" : "NEUTRAL",
  };
}

function computeRollingVwap(candles = [], period = 20) {
  const window = candles.slice(-period).filter((candle) =>
    Number.isFinite(Number(candle.high))
    && Number.isFinite(Number(candle.low))
    && Number.isFinite(Number(candle.close))
    && Number.isFinite(Number(candle.volume))
    && Number(candle.volume) > 0);

  if (!window.length) {
    return null;
  }

  let weightedValue = 0;
  let weightedVolume = 0;
  for (const candle of window) {
    const typicalPrice = (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
    weightedValue += typicalPrice * Number(candle.volume);
    weightedVolume += Number(candle.volume);
  }

  return weightedVolume > 0 ? weightedValue / weightedVolume : null;
}

function computeKeyLevels(closes = []) {
  if (!closes.length) {
    return {
      support20: null,
      resistance20: null,
      support60: null,
      resistance60: null,
    };
  }

  const recent20 = closes.slice(-20);
  const recent60 = closes.slice(-60);

  return {
    support20: recent20.length ? round(Math.min(...recent20), 2) : null,
    resistance20: recent20.length ? round(Math.max(...recent20), 2) : null,
    support60: recent60.length ? round(Math.min(...recent60), 2) : null,
    resistance60: recent60.length ? round(Math.max(...recent60), 2) : null,
  };
}

function aggregateCandlesByStride(candles = [], stride = 5) {
  if (!Array.isArray(candles) || candles.length === 0 || stride <= 1) {
    return candles || [];
  }

  const aggregated = [];
  for (let index = 0; index < candles.length; index += stride) {
    const bucket = candles.slice(index, index + stride).filter(Boolean);
    if (!bucket.length) {
      continue;
    }

    aggregated.push({
      open: Number(bucket[0].open ?? bucket[0].close ?? 0),
      close: Number(bucket[bucket.length - 1].close ?? bucket[bucket.length - 1].open ?? 0),
      high: Math.max(...bucket.map((candle) => Number(candle.high ?? candle.close ?? candle.open ?? 0))),
      low: Math.min(...bucket.map((candle) => Number(candle.low ?? candle.close ?? candle.open ?? 0))),
      volume: bucket.reduce((sum, candle) => sum + Number(candle.volume || 0), 0),
    });
  }

  return aggregated;
}

function computeHigherTimeframeSnapshot(candles = [], latestPrice = null) {
  const weeklyCandles = aggregateCandlesByStride(candles, 5).slice(-26);
  const closes = weeklyCandles.map((candle) => Number(candle.close || 0)).filter(Number.isFinite);
  const price = Number(latestPrice || closes[closes.length - 1] || 0);

  if (!Number.isFinite(price) || closes.length < 10) {
    return {
      timeframe: "weekly",
      available: false,
      sma4: null,
      sma8: null,
      return4w: null,
      return12w: null,
      trendBias: "NEUTRAL",
    };
  }

  const sma4 = average(closes.slice(-4));
  const sma8 = average(closes.slice(-8));
  const reference4w = closes[Math.max(0, closes.length - 5)] || closes[0];
  const reference12w = closes[Math.max(0, closes.length - 13)] || closes[0];
  const return4w = reference4w > 0 ? ((price - reference4w) / reference4w) * 100 : 0;
  const return12w = reference12w > 0 ? ((price - reference12w) / reference12w) * 100 : 0;

  const trendBias = price > sma4 && sma4 > sma8 && return4w > 0
    ? "BULLISH"
    : price < sma4 && sma4 < sma8 && return4w < 0
      ? "BEARISH"
      : "NEUTRAL";

  return {
    timeframe: "weekly",
    available: true,
    sma4: round(sma4, 2),
    sma8: round(sma8, 2),
    return4w: round(return4w, 2),
    return12w: round(return12w, 2),
    trendBias,
  };
}

function classifyTradeRegimeSnapshot({
  latestPrice,
  sma20,
  sma50,
  return20d,
  return60d,
  volatility,
  support20,
  resistance20,
}) {
  const price = Math.max(Number(latestPrice || 0), 1);
  const rangeWidth20Pct = Number.isFinite(Number(support20)) && Number.isFinite(Number(resistance20))
    ? ((Number(resistance20) - Number(support20)) / price) * 100
    : null;
  const trendSpreadPct = Number.isFinite(Number(sma20)) && Number.isFinite(Number(sma50))
    ? (Math.abs(Number(sma20) - Number(sma50)) / price) * 100
    : null;
  const directionalStrength = Math.max(Math.abs(Number(return20d || 0)), Math.abs(Number(return60d || 0)) / 2);

  let label = "TRANSITIONAL";
  if (Number(volatility || 0) >= 3.8) {
    label = "HIGH_VOLATILITY";
  } else if (
    directionalStrength >= 6
    && Number.isFinite(Number(trendSpreadPct))
    && Number(trendSpreadPct) >= 2.2
    && Number.isFinite(Number(rangeWidth20Pct))
    && Number(rangeWidth20Pct) >= 6
  ) {
    label = "TRENDING";
  } else if (
    Number.isFinite(Number(rangeWidth20Pct))
    && Number(rangeWidth20Pct) <= 8
    && Math.abs(Number(return20d || 0)) <= 4.5
    && Math.abs(Number(return60d || 0)) <= 10
  ) {
    label = "SIDEWAYS";
  }

  const trendState = Number(return20d || 0) >= 3 && Number(return60d || 0) >= 6 && Number(sma20 || 0) >= Number(sma50 || 0)
    ? "UPTREND"
    : Number(return20d || 0) <= -3 && Number(return60d || 0) <= -6 && Number(sma20 || 0) <= Number(sma50 || 0)
      ? "DOWNTREND"
      : "RANGE";

  const volatilityState = Number(volatility || 0) >= 3.8
    ? "HIGH"
    : Number(volatility || 0) <= 1.7
      ? "LOW"
      : "NORMAL";

  return {
    label,
    trendState,
    volatilityState,
    rangeWidth20Pct: round(rangeWidth20Pct, 2),
    trendSpreadPct: round(trendSpreadPct, 2),
  };
}

function candleRange(candle) {
  return Math.max(0.0001, Number(candle?.high || 0) - Number(candle?.low || 0));
}

function candleBody(candle) {
  return Math.abs(Number(candle?.close || 0) - Number(candle?.open || 0));
}

function upperShadow(candle) {
  return Number(candle?.high || 0) - Math.max(Number(candle?.open || 0), Number(candle?.close || 0));
}

function lowerShadow(candle) {
  return Math.min(Number(candle?.open || 0), Number(candle?.close || 0)) - Number(candle?.low || 0);
}

function isBullishCandle(candle) {
  return Number(candle?.close || 0) > Number(candle?.open || 0);
}

function isBearishCandle(candle) {
  return Number(candle?.close || 0) < Number(candle?.open || 0);
}

function bodyToRangeRatio(candle) {
  return candleBody(candle) / candleRange(candle);
}

function levelProximity(left, right, tolerancePct = 0.35) {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return false;
  }

  const base = Math.max(Math.abs(leftValue), Math.abs(rightValue), 1);
  return Math.abs(leftValue - rightValue) <= base * (tolerancePct / 100);
}

function humanizeTag(value = "") {
  return String(value || "").replaceAll("_", " ").toLowerCase();
}

function classifyCandlestickStrength(score) {
  if (score >= 5.8) {
    return "Strong";
  }
  if (score >= 3.8) {
    return "Moderate";
  }
  return "Weak";
}

function classifyCandlestickSignalQuality(score) {
  if (score >= 7.6) {
    return "Ultra";
  }
  if (score >= 5.8) {
    return "High";
  }
  if (score >= 3.8) {
    return "Moderate";
  }
  return "Weak";
}

function classifyTrendContext({ sma20, sma50, return20d, return60d }) {
  if (Number(sma20) > Number(sma50) && Number(return20d) > 0 && Number(return60d) >= 0) {
    return "UPTREND";
  }
  if (Number(sma20) < Number(sma50) && Number(return20d) < 0 && Number(return60d) <= 0) {
    return "DOWNTREND";
  }
  return "RANGE";
}

function classifyMarketStructure(candles = []) {
  if (candles.length < 12) {
    return "MIXED";
  }

  const previous = candles.slice(-10, -5);
  const recent = candles.slice(-5);

  const previousHigh = Math.max(...previous.map((candle) => Number(candle.high || 0)));
  const previousLow = Math.min(...previous.map((candle) => Number(candle.low || 0)));
  const recentHigh = Math.max(...recent.map((candle) => Number(candle.high || 0)));
  const recentLow = Math.min(...recent.map((candle) => Number(candle.low || 0)));

  if (recentHigh > previousHigh && recentLow > previousLow) {
    return "HIGHER_HIGHS_HIGHER_LOWS";
  }
  if (recentHigh < previousHigh && recentLow < previousLow) {
    return "LOWER_HIGHS_LOWER_LOWS";
  }

  const previousRange = Math.max(0.0001, previousHigh - previousLow);
  const recentRange = recentHigh - recentLow;
  if (recentRange / previousRange < 0.8) {
    return "RANGE_COMPRESSION";
  }

  return "MIXED";
}

function classifyLocationContext(latestPrice, latestCandle, closes = []) {
  const previous20 = closes.slice(-21, -1);
  const previous60 = closes.slice(-61, -1);
  const previousResistance20 = previous20.length ? Math.max(...previous20) : null;
  const previousSupport20 = previous20.length ? Math.min(...previous20) : null;
  const previousResistance60 = previous60.length ? Math.max(...previous60) : null;
  const previousSupport60 = previous60.length ? Math.min(...previous60) : null;
  const distanceBase = Math.max(Number(latestPrice || 1), 1);
  const near = (level, threshold = 0.018) => Number.isFinite(Number(level)) && Math.abs(latestPrice - level) / distanceBase <= threshold;

  let zone = "NOISE_ZONE";
  if (Number.isFinite(previousResistance20) && latestPrice > previousResistance20 * 1.004) {
    zone = "BREAKOUT_ZONE";
  } else if (Number.isFinite(previousSupport20) && latestPrice < previousSupport20 * 0.996) {
    zone = "BREAKDOWN_ZONE";
  } else if (near(previousSupport20, 0.015) || near(previousSupport60, 0.02)) {
    zone = "SUPPORT_ZONE";
  } else if (near(previousResistance20, 0.015) || near(previousResistance60, 0.02)) {
    zone = "RESISTANCE_ZONE";
  }

  const fakeBreakout = Number.isFinite(previousResistance20)
    && Number(latestCandle?.high || 0) > previousResistance20 * 1.003
    && latestPrice < previousResistance20
    && upperShadow(latestCandle) > candleBody(latestCandle) * 1.2;
  const fakeBreakdown = Number.isFinite(previousSupport20)
    && Number(latestCandle?.low || 0) < previousSupport20 * 0.997
    && latestPrice > previousSupport20
    && lowerShadow(latestCandle) > candleBody(latestCandle) * 1.2;

  const trap = fakeBreakout
    ? {
        detected: true,
        label: "Fake breakout",
        direction: "bearish",
        summary: "Price pushed above resistance but failed to hold the breakout, which raises liquidity-grab risk.",
      }
    : fakeBreakdown
      ? {
          detected: true,
          label: "Fake breakdown",
          direction: "bullish",
          summary: "Price swept below support and recovered, which suggests a downside liquidity grab.",
        }
      : null;

  return {
    zone,
    trap,
    previousResistance20: round(previousResistance20, 2),
    previousSupport20: round(previousSupport20, 2),
    previousResistance60: round(previousResistance60, 2),
    previousSupport60: round(previousSupport60, 2),
  };
}

function detectCandlestickCandidates(candles = [], volumeSurge = 1) {
  if (candles.length < 4) {
    return [];
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const third = candles[candles.length - 3];
  const fourth = candles[candles.length - 4];
  const latestRange = candleRange(latest);
  const latestBody = candleBody(latest);
  const previousBody = candleBody(previous);
  const thirdBody = candleBody(third);
  const latestBodyRatio = bodyToRangeRatio(latest);
  const previousBodyRatio = bodyToRangeRatio(previous);
  const thirdBodyRatio = bodyToRangeRatio(third);
  const avgBody10 = average(candles.slice(-10).map((candle) => candleBody(candle)).filter(Number.isFinite));
  const closePosition = (Number(latest.close || 0) - Number(latest.low || 0)) / latestRange;
  const previousMidpoint = (Number(previous.open || 0) + Number(previous.close || 0)) / 2;
  const thirdMidpoint = (Number(third.open || 0) + Number(third.close || 0)) / 2;
  const strongBodyThreshold = Math.max(avgBody10 * 0.9, 0.0001);
  const wideBodyThreshold = Math.max(avgBody10 * 1.15, 0.0001);

  const candidates = [];

  if (
    isBearishCandle(previous)
    && isBullishCandle(latest)
    && Number(latest.open || 0) <= Number(previous.close || 0)
    && Number(latest.close || 0) >= Number(previous.open || 0)
    && latestBody >= previousBody * 1.05
  ) {
    candidates.push({ pattern: "Bullish Engulfing", direction: "bullish", kind: "reversal", reliability: 2.8 });
  }

  if (
    isBullishCandle(previous)
    && isBearishCandle(latest)
    && Number(latest.open || 0) >= Number(previous.close || 0)
    && Number(latest.close || 0) <= Number(previous.open || 0)
    && latestBody >= previousBody * 1.05
  ) {
    candidates.push({ pattern: "Bearish Engulfing", direction: "bearish", kind: "reversal", reliability: 2.8 });
  }

  if (
    lowerShadow(latest) >= latestBody * 2.2
    && upperShadow(latest) <= latestBody * 0.8
    && closePosition >= 0.65
  ) {
    candidates.push({ pattern: "Hammer", direction: "bullish", kind: "reversal", reliability: 2.4 });
  }

  if (
    upperShadow(latest) >= latestBody * 2.2
    && lowerShadow(latest) <= latestBody * 0.8
    && closePosition <= 0.35
  ) {
    candidates.push({ pattern: "Shooting Star", direction: "bearish", kind: "reversal", reliability: 2.4 });
  }

  if (latestBody / latestRange <= 0.12) {
    candidates.push({ pattern: "Doji", direction: "neutral", kind: "indecision", reliability: 1.5 });
  }

  const secondSmall = candleBody(previous) <= Math.max(avgBody10 * 0.45, 0.0001);

  if (
    isBearishCandle(third)
    && thirdBody >= strongBodyThreshold
    && secondSmall
    && isBullishCandle(latest)
    && Number(latest.close || 0) > thirdMidpoint
  ) {
    candidates.push({ pattern: "Morning Star", direction: "bullish", kind: "reversal", reliability: 3.2 });
  }

  if (
    isBullishCandle(third)
    && thirdBody >= strongBodyThreshold
    && secondSmall
    && isBearishCandle(latest)
    && Number(latest.close || 0) < thirdMidpoint
  ) {
    candidates.push({ pattern: "Evening Star", direction: "bearish", kind: "reversal", reliability: 3.2 });
  }

  if (
    isBearishCandle(previous)
    && previousBody >= strongBodyThreshold
    && isBullishCandle(latest)
    && latestBody <= previousBody * 0.7
    && Number(latest.open || 0) >= Number(previous.close || 0)
    && Number(latest.close || 0) <= Number(previous.open || 0)
  ) {
    candidates.push({ pattern: "Bullish Harami", direction: "bullish", kind: "reversal", reliability: 2.5 });
  }

  if (
    isBullishCandle(previous)
    && previousBody >= strongBodyThreshold
    && isBearishCandle(latest)
    && latestBody <= previousBody * 0.7
    && Number(latest.open || 0) <= Number(previous.close || 0)
    && Number(latest.close || 0) >= Number(previous.open || 0)
  ) {
    candidates.push({ pattern: "Bearish Harami", direction: "bearish", kind: "reversal", reliability: 2.5 });
  }

  if (
    isBearishCandle(previous)
    && previousBody >= strongBodyThreshold
    && isBullishCandle(latest)
    && Number(latest.open || 0) <= Number(previous.close || 0) * 1.002
    && Number(latest.close || 0) > previousMidpoint
    && Number(latest.close || 0) < Number(previous.open || 0)
  ) {
    candidates.push({ pattern: "Piercing Line", direction: "bullish", kind: "reversal", reliability: 2.9 });
  }

  if (
    isBullishCandle(previous)
    && previousBody >= strongBodyThreshold
    && isBearishCandle(latest)
    && Number(latest.open || 0) >= Number(previous.close || 0) * 0.998
    && Number(latest.close || 0) < previousMidpoint
    && Number(latest.close || 0) > Number(previous.open || 0)
  ) {
    candidates.push({ pattern: "Dark Cloud Cover", direction: "bearish", kind: "reversal", reliability: 2.9 });
  }

  if (
    isBearishCandle(previous)
    && isBullishCandle(latest)
    && levelProximity(previous.low, latest.low)
    && Number(latest.close || 0) > previousMidpoint
  ) {
    candidates.push({ pattern: "Tweezer Bottom", direction: "bullish", kind: "reversal", reliability: 2.7 });
  }

  if (
    isBullishCandle(previous)
    && isBearishCandle(latest)
    && levelProximity(previous.high, latest.high)
    && Number(latest.close || 0) < previousMidpoint
  ) {
    candidates.push({ pattern: "Tweezer Top", direction: "bearish", kind: "reversal", reliability: 2.7 });
  }

  if (
    isBullishCandle(third)
    && isBullishCandle(previous)
    && isBullishCandle(latest)
    && thirdBody >= strongBodyThreshold
    && previousBody >= strongBodyThreshold
    && latestBody >= strongBodyThreshold
    && thirdBodyRatio >= 0.55
    && previousBodyRatio >= 0.55
    && latestBodyRatio >= 0.55
    && Number(third.close || 0) < Number(previous.close || 0)
    && Number(previous.close || 0) < Number(latest.close || 0)
    && Number(previous.open || 0) >= Math.min(Number(third.open || 0), Number(third.close || 0))
    && Number(previous.open || 0) <= Math.max(Number(third.open || 0), Number(third.close || 0))
    && Number(latest.open || 0) >= Math.min(Number(previous.open || 0), Number(previous.close || 0))
    && Number(latest.open || 0) <= Math.max(Number(previous.open || 0), Number(previous.close || 0))
  ) {
    candidates.push({ pattern: "Three White Soldiers", direction: "bullish", kind: "continuation", reliability: 3.4 });
  }

  if (
    isBearishCandle(third)
    && isBearishCandle(previous)
    && isBearishCandle(latest)
    && thirdBody >= strongBodyThreshold
    && previousBody >= strongBodyThreshold
    && latestBody >= strongBodyThreshold
    && thirdBodyRatio >= 0.55
    && previousBodyRatio >= 0.55
    && latestBodyRatio >= 0.55
    && Number(third.close || 0) > Number(previous.close || 0)
    && Number(previous.close || 0) > Number(latest.close || 0)
    && Number(previous.open || 0) <= Math.max(Number(third.open || 0), Number(third.close || 0))
    && Number(previous.open || 0) >= Math.min(Number(third.open || 0), Number(third.close || 0))
    && Number(latest.open || 0) <= Math.max(Number(previous.open || 0), Number(previous.close || 0))
    && Number(latest.open || 0) >= Math.min(Number(previous.open || 0), Number(previous.close || 0))
  ) {
    candidates.push({ pattern: "Three Black Crows", direction: "bearish", kind: "continuation", reliability: 3.4 });
  }

  if (
    isBullishCandle(latest)
    && latestBodyRatio >= 0.82
    && upperShadow(latest) <= latestRange * 0.1
    && lowerShadow(latest) <= latestRange * 0.1
    && latestBody >= wideBodyThreshold
  ) {
    candidates.push({ pattern: "Bullish Marubozu", direction: "bullish", kind: "continuation", reliability: volumeSurge >= 1.15 ? 3 : 2.5 });
  }

  if (
    isBearishCandle(latest)
    && latestBodyRatio >= 0.82
    && upperShadow(latest) <= latestRange * 0.1
    && lowerShadow(latest) <= latestRange * 0.1
    && latestBody >= wideBodyThreshold
  ) {
    candidates.push({ pattern: "Bearish Marubozu", direction: "bearish", kind: "continuation", reliability: volumeSurge >= 1.15 ? 3 : 2.5 });
  }

  if (
    fourth
    && Number(latest.high || 0) < Number(previous.high || 0)
    && Number(latest.low || 0) > Number(previous.low || 0)
    && latestBodyRatio <= 0.45
    && previousBodyRatio >= 0.55
  ) {
    const direction = Number(previous.close || 0) > Number(third.close || 0)
      ? "bullish"
      : Number(previous.close || 0) < Number(third.close || 0)
        ? "bearish"
        : "neutral";
    candidates.push({
      pattern: "Inside Bar Coil",
      direction,
      kind: direction === "neutral" ? "indecision" : "continuation",
      reliability: 2.1,
    });
  }

  if (
    isBullishCandle(latest)
    && latestBodyRatio >= 0.68
    && closePosition >= 0.7
    && latestBody >= wideBodyThreshold
  ) {
    candidates.push({ pattern: "Strong Bullish Momentum Candle", direction: "bullish", kind: "continuation", reliability: volumeSurge >= 1.15 ? 2.8 : 2.1 });
  }

  if (
    isBearishCandle(latest)
    && latestBodyRatio >= 0.68
    && closePosition <= 0.3
    && latestBody >= wideBodyThreshold
  ) {
    candidates.push({ pattern: "Strong Bearish Momentum Candle", direction: "bearish", kind: "continuation", reliability: volumeSurge >= 1.15 ? 2.8 : 2.1 });
  }

  return candidates;
}

function scoreCandlestickCandidate(candidate, context) {
  let score = Number(candidate.reliability || 0);
  const notes = [];
  const trend = context.trend;
  const location = context.location;
  const structure = context.marketStructure;
  const volumeSurge = Number(context.volumeSurge || 1);
  const trap = context.trap;
  const weeklyTrendBias = String(context.weeklyTrendBias || "NEUTRAL");
  const macdPosture = String(context.macdPosture || "UNAVAILABLE");
  const regimeLabel = String(context.regimeLabel || "TRANSITIONAL");
  const rsi14 = Number(context.rsi14);

  if (candidate.direction === "bullish") {
    if (candidate.kind === "continuation" && (trend === "UPTREND" || location === "BREAKOUT_ZONE")) {
      score += 1.4;
      notes.push("pattern aligns with the prevailing uptrend");
    }
    if (candidate.kind === "reversal" && (trend === "DOWNTREND" || location === "SUPPORT_ZONE" || location === "BREAKDOWN_ZONE")) {
      score += 1.3;
      notes.push("pattern appears in a reversal-friendly zone");
    }
    if (structure === "HIGHER_HIGHS_HIGHER_LOWS") {
      score += 1;
      notes.push("market structure remains constructive");
    }
    if (trap?.direction === "bullish") {
      score += 1.2;
      notes.push("liquidity grab supports a bullish reversal read");
    }
    if (location === "RESISTANCE_ZONE" && candidate.kind !== "continuation") {
      score -= 1.8;
    }
    if (weeklyTrendBias === "BULLISH") {
      score += 0.9;
      notes.push("weekly trend confirms the bullish bias");
    } else if (weeklyTrendBias === "BEARISH") {
      score -= 1.1;
      notes.push("weekly trend is fighting the bullish setup");
    }
    if (macdPosture === "BULLISH") {
      score += 0.6;
      notes.push("MACD posture supports upside follow-through");
    } else if (macdPosture === "BEARISH") {
      score -= 0.6;
    }
    if (Number.isFinite(rsi14)) {
      if (candidate.kind === "reversal" && rsi14 <= 45) {
        score += 0.5;
        notes.push("RSI is positioned for a reversal bounce");
      }
      if (candidate.kind === "continuation" && rsi14 >= 52 && rsi14 <= 72) {
        score += 0.6;
        notes.push("RSI is supportive without looking exhausted");
      }
      if (rsi14 >= 78) {
        score -= 0.7;
        notes.push("RSI is stretched, which raises chase risk");
      }
    }
    if (regimeLabel === "TRENDING" && candidate.kind === "continuation") {
      score += 0.6;
      notes.push("market regime favors continuation structures");
    }
    if (regimeLabel === "SIDEWAYS" && candidate.kind === "reversal") {
      score += 0.4;
      notes.push("range conditions make reversal candles more relevant");
    }
  }

  if (candidate.direction === "bearish") {
    if (candidate.kind === "continuation" && (trend === "DOWNTREND" || location === "BREAKDOWN_ZONE")) {
      score += 1.4;
      notes.push("pattern aligns with the prevailing downtrend");
    }
    if (candidate.kind === "reversal" && (trend === "UPTREND" || location === "RESISTANCE_ZONE" || location === "BREAKOUT_ZONE")) {
      score += 1.3;
      notes.push("pattern appears in a reversal-friendly zone");
    }
    if (structure === "LOWER_HIGHS_LOWER_LOWS") {
      score += 1;
      notes.push("market structure remains weak");
    }
    if (trap?.direction === "bearish") {
      score += 1.2;
      notes.push("liquidity grab supports a bearish reversal read");
    }
    if (location === "SUPPORT_ZONE" && candidate.kind !== "continuation") {
      score -= 1.8;
    }
    if (weeklyTrendBias === "BEARISH") {
      score += 0.9;
      notes.push("weekly trend confirms the bearish bias");
    } else if (weeklyTrendBias === "BULLISH") {
      score -= 1.1;
      notes.push("weekly trend is fighting the bearish setup");
    }
    if (macdPosture === "BEARISH") {
      score += 0.6;
      notes.push("MACD posture supports downside follow-through");
    } else if (macdPosture === "BULLISH") {
      score -= 0.6;
    }
    if (Number.isFinite(rsi14)) {
      if (candidate.kind === "reversal" && rsi14 >= 55) {
        score += 0.5;
        notes.push("RSI leaves room for a downside reversal");
      }
      if (candidate.kind === "continuation" && rsi14 >= 28 && rsi14 <= 48) {
        score += 0.6;
        notes.push("RSI supports downside continuation without extreme exhaustion");
      }
      if (rsi14 <= 22) {
        score -= 0.7;
        notes.push("RSI is stretched, which raises squeeze risk");
      }
    }
    if (regimeLabel === "TRENDING" && candidate.kind === "continuation") {
      score += 0.6;
      notes.push("market regime favors continuation structures");
    }
    if (regimeLabel === "SIDEWAYS" && candidate.kind === "reversal") {
      score += 0.4;
      notes.push("range conditions make reversal candles more relevant");
    }
  }

  if (candidate.direction === "neutral") {
    if (location === "SUPPORT_ZONE" || location === "RESISTANCE_ZONE" || location === "BREAKOUT_ZONE" || location === "BREAKDOWN_ZONE") {
      score += 1;
      notes.push("indecision matters because it is appearing at a key level");
    } else {
      score -= 1.4;
    }
    if (regimeLabel === "SIDEWAYS" || regimeLabel === "TRANSITIONAL") {
      score += 0.4;
    }
  }

  if (volumeSurge >= 1.2) {
    score += 1.2;
    notes.push(`volume confirms the candle at ${round(volumeSurge, 2)}x average`);
  } else if (volumeSurge >= 1) {
    score += 0.4;
  } else {
    score -= 0.8;
  }

  if (location === "NOISE_ZONE" && candidate.direction !== "neutral") {
    score -= 2.2;
    notes.push("pattern is forming away from a meaningful decision zone");
  }

  const strength = classifyCandlestickStrength(score);
  const signalQuality = classifyCandlestickSignalQuality(score);
  const validity = strength === "Weak" ? "Ignore" : "Valid";

  return {
    ...candidate,
    score: round(score, 2),
    strength,
    signalQuality,
    validity,
    notes: uniqueStrings(notes).slice(0, 6),
  };
}

function buildCandlestickTrigger(candidate, context) {
  if (!candidate) {
    return "Wait for a cleaner daily candle setup before using candlesticks as a trade trigger.";
  }

  if (candidate.direction === "neutral") {
    return "Use the signal candle range as the trigger zone and wait for a directional close outside that range.";
  }

  if (candidate.direction === "bullish") {
    if (candidate.kind === "reversal") {
      return context.location === "SUPPORT_ZONE"
        ? "Best trigger is bullish follow-through above the signal candle high while risk stays below the signal low."
        : "Wait for a close above the signal candle high or a clean retest before acting on the reversal.";
    }
    return context.location === "BREAKOUT_ZONE"
      ? "Momentum trigger is valid if price keeps holding above breakout support on the next daily close."
      : "Continuation trigger improves if the next daily candle confirms above the current signal high.";
  }

  if (candidate.kind === "reversal") {
    return context.location === "RESISTANCE_ZONE"
      ? "Best trigger is bearish follow-through below the signal candle low while risk stays above the signal high."
      : "Wait for a close below the signal candle low or a failed retest before acting on the reversal.";
  }

  return context.location === "BREAKDOWN_ZONE"
    ? "Momentum trigger is valid if price keeps holding below breakdown resistance on the next daily close."
    : "Continuation trigger improves if the next daily candle confirms below the current signal low.";
}

function buildCandlestickSnapshot(candles = [], latestPrice, derived = {}) {
  const patternTimeframe = "daily";
  const trendTimeframe = derived.higherTimeframe?.available
    ? (derived.higherTimeframe.timeframe || "weekly")
    : "daily";

  if (candles.length < 12) {
    return {
      timeframe: patternTimeframe,
      analysisTimeframes: {
        pattern: patternTimeframe,
        trend: trendTimeframe,
      },
      detectedPattern: "No reliable pattern",
      direction: "neutral",
      strength: "Weak",
      signalQuality: "Weak",
      qualityScore: null,
      validity: "Ignore",
      kind: "indecision",
      context: {
        trend: "UNKNOWN",
        location: "UNKNOWN",
        volumeConfirmation: "Unavailable",
        marketStructure: "UNKNOWN",
        higherTimeframeTrend: String(derived.higherTimeframe?.trendBias || "NEUTRAL"),
        regime: String(derived.regimeLabel || "TRANSITIONAL"),
      },
      trap: null,
      notes: [],
      trigger: "Wait for more daily candle history before using candlestick analysis.",
      summary: "Not enough daily candle history is available for reliable candlestick analysis.",
      candidates: [],
    };
  }

  const latest = candles[candles.length - 1];
  const trend = classifyTrendContext(derived);
  const marketStructure = classifyMarketStructure(candles);
  const locationContext = classifyLocationContext(latestPrice, latest, candles.map((candle) => Number(candle.close || 0)).filter(Number.isFinite));
  const volumeConfirmation = Number(derived.volumeSurge || 1) >= 1.2
    ? "Strong"
    : Number(derived.volumeSurge || 1) >= 1
      ? "Average"
      : "Weak";

  const context = {
    trend,
    location: locationContext.zone,
    volumeConfirmation,
    marketStructure,
    volumeSurge: Number(derived.volumeSurge || 1),
    trap: locationContext.trap,
    weeklyTrendBias: String(derived.higherTimeframe?.trendBias || "NEUTRAL"),
    macdPosture: String(derived.macdPosture || "UNAVAILABLE"),
    rsi14: round(derived.rsi14, 2),
    regimeLabel: String(derived.regimeLabel || "TRANSITIONAL"),
  };

  const candidates = detectCandlestickCandidates(candles, derived.volumeSurge)
    .map((candidate) => scoreCandlestickCandidate(candidate, context))
    .sort((left, right) => right.score - left.score);

  const primary = candidates[0];
  if (!primary) {
    return {
      timeframe: patternTimeframe,
      analysisTimeframes: {
        pattern: patternTimeframe,
        trend: trendTimeframe,
      },
      detectedPattern: "No high-quality pattern",
      direction: "neutral",
      strength: "Weak",
      signalQuality: "Weak",
      qualityScore: null,
      validity: "Ignore",
      kind: "indecision",
      context: {
        trend,
        location: locationContext.zone,
        volumeConfirmation,
        marketStructure,
        higherTimeframeTrend: String(derived.higherTimeframe?.trendBias || "NEUTRAL"),
        regime: String(derived.regimeLabel || "TRANSITIONAL"),
      },
      trap: locationContext.trap,
      notes: [],
      trigger: "Wait for a clearer daily candle trigger before upgrading the pattern read.",
      summary: "No meaningful high-quality candlestick pattern is standing out from the recent daily candles.",
      candidates: [],
    };
  }

  const timeframeSummary = trendTimeframe === patternTimeframe
    ? "Pattern detection is using the daily chart only."
    : `Pattern detection is using the daily chart with ${humanizeTag(trendTimeframe)} trend confirmation.`;
  const confluenceSnippet = primary.notes.length
    ? ` Key confluence: ${primary.notes.slice(0, 3).join("; ")}.`
    : "";

  return {
    timeframe: patternTimeframe,
    analysisTimeframes: {
      pattern: patternTimeframe,
      trend: trendTimeframe,
    },
    detectedPattern: primary.pattern,
    direction: primary.direction,
    strength: primary.strength,
    signalQuality: primary.signalQuality,
    qualityScore: primary.score,
    validity: primary.validity,
    kind: primary.kind,
    context: {
      trend,
      location: locationContext.zone,
      volumeConfirmation,
      marketStructure,
      higherTimeframeTrend: String(derived.higherTimeframe?.trendBias || "NEUTRAL"),
      regime: String(derived.regimeLabel || "TRANSITIONAL"),
    },
    trap: locationContext.trap,
    notes: primary.notes,
    trigger: buildCandlestickTrigger(primary, context),
    summary: `${primary.pattern} detected on the daily chart near ${humanizeTag(locationContext.zone)} with ${humanizeTag(trend)} context and ${volumeConfirmation.toLowerCase()} volume confirmation. ${timeframeSummary}${confluenceSnippet}`.trim(),
    candidates: candidates.slice(0, 4).map((candidate) => ({
      pattern: candidate.pattern,
      direction: candidate.direction,
      kind: candidate.kind,
      strength: candidate.strength,
      signalQuality: candidate.signalQuality,
      validity: candidate.validity,
      score: candidate.score,
      notes: candidate.notes,
    })),
  };
}

async function fetchYahooChart(symbol, range = "6mo", interval = "1d") {
  const cacheKey = `${symbol}:${range}:${interval}`;
  const cached = candleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const override = YAHOO_OVERRIDES[symbol];
  const tickers = override ? [override, `${symbol}.NS`, `${symbol}.BO`] : [`${symbol}.NS`, `${symbol}.BO`];

  for (const ticker of tickers) {
    try {
      const encoded = encodeURIComponent(ticker);
      const response = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}`, {
        params: {
          range,
          interval,
          includePrePost: "false",
        },
      });

      const result = response?.chart?.result?.[0];
      if (!result?.meta) {
        continue;
      }

      const timestamps = result.timestamp || [];
      const quoteBlock = result.indicators?.quote?.[0] || {};
      const candles = timestamps.map((timestamp, index) => ({
        timestamp: new Date(timestamp * 1000).toISOString(),
        open: safeNumber(quoteBlock.open?.[index]),
        high: safeNumber(quoteBlock.high?.[index]),
        low: safeNumber(quoteBlock.low?.[index]),
        close: safeNumber(quoteBlock.close?.[index]),
        volume: safeNumber(quoteBlock.volume?.[index]),
      })).filter((candle) => candle.open !== null && candle.high !== null && candle.low !== null && candle.close !== null);

      return candleCache.set(cacheKey, {
        symbol,
        meta: result.meta,
        candles,
      });
    } catch {
      continue;
    }
  }

  return candleCache.set(cacheKey, { symbol, meta: null, candles: [] }, 10_000);
}

async function fetchYahooQuote(stock) {
  const cacheKey = `quote:${stock.symbol}`;
  const cached = quoteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { meta } = await fetchYahooChart(stock.symbol, "5d", "1d");
  if (!meta?.regularMarketPrice) {
    return null;
  }

  const lastPrice = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose || meta.previousClose || lastPrice);
  const change = lastPrice - previousClose;
  const changePct = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return quoteCache.set(cacheKey, {
    symbol: stock.symbol,
    companyName: stock.name,
    sector: stock.sector,
    price: Number(lastPrice.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    open: safeNumber(meta.regularMarketOpen),
    high: safeNumber(meta.regularMarketDayHigh),
    low: safeNumber(meta.regularMarketDayLow),
    volume: safeNumber(meta.regularMarketVolume) || 0,
    source: "YAHOO_DELAYED",
    asOf: new Date().toISOString(),
  });
}

export async function getQuotes(stocks) {
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return [];
  }

  const liveStatus = await getUpstoxStatus();
  const liveQuotes = liveStatus.connected ? await fetchUpstoxQuotes(stocks).catch(() => []) : [];
  const liveMap = new Map(liveQuotes.map((quote) => [quote.symbol, quote]));
  const largeSweep = stocks.length > 250;

  const results = [];
  for (const stock of stocks) {
    if (liveMap.has(stock.symbol)) {
      results.push(liveMap.get(stock.symbol));
      continue;
    }

    if (largeSweep) {
      continue;
    }

    const fallbackQuote = await fetchYahooQuote(stock);
    if (fallbackQuote) {
      results.push(fallbackQuote);
    }
  }

  return results;
}

export async function getDailyCandles(symbol) {
  const chart = await fetchYahooChart(symbol, "6mo", "1d");
  return chart.candles || [];
}

function scoreMoneycontrolCandidate(stock, candidate = {}, query = "") {
  const symbol = normalizeSearchText(stock?.symbol || "");
  const name = normalizeSearchText(stock?.name || "");
  const queryText = normalizeSearchText(query);
  const listedSymbol = extractMoneycontrolListedSymbol(candidate);
  const candidateText = normalizeSearchText([
    candidate?.name,
    candidate?.stock_name,
    candidate?.pdt_dis_nm,
    candidate?.sc_sector,
  ].filter(Boolean).join(" "));

  let score = 0;
  if (symbol && listedSymbol === symbol) score += 240;
  else if (symbol && listedSymbol && listedSymbol !== symbol && queryText === symbol) score -= 80;
  if (name && normalizeSearchText(candidate?.name || candidate?.stock_name || "") === name) score += 120;
  if (symbol && candidateText.includes(` ${symbol} `)) score += 120;
  if (symbol && candidateText.endsWith(` ${symbol}`)) score += 120;
  if (symbol && candidateText.includes(symbol)) score += 70;
  if (name && candidateText.includes(name)) score += 55;
  if (queryText && candidateText.includes(queryText)) score += 30;
  if (candidate?.link_src?.includes("/india/stockpricequote/")) score += 8;
  return score;
}

async function searchMoneycontrolProfile(stock) {
  const queries = buildFundamentalSearchTerms(stock).slice(0, 4);
  let bestMatch = null;

  for (const query of queries) {
    try {
      const rows = await fetchJson("https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php", {
        params: {
          classic: "true",
          query,
          type: 1,
          format: "json",
        },
        headers: {
          ...MARKET_WEB_HEADERS,
          accept: "application/json,text/plain,*/*",
          referer: "https://www.moneycontrol.com/",
        },
        timeoutMs: Math.max(config.httpTimeoutMs, 12_000),
      });

      for (const row of Array.isArray(rows) ? rows.slice(0, 8) : []) {
        const score = scoreMoneycontrolCandidate(stock, row, query);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { row, score, query };
        }
      }

      if (bestMatch?.score >= 120) {
        break;
      }
    } catch {
      continue;
    }
  }

  return bestMatch?.row || null;
}

function parseMoneycontrolAnnualGraph(html = "") {
  const match = html.match(/<div id="C-12-graph" style="display:\s*none;">([\s\S]*?)<\/div>/i);
  if (!match?.[1]) {
    return [];
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

function readMoneycontrolHeading(graph = [], heading = "") {
  return graph.find((entry) => normalizeSearchText(entry?.heading) === normalizeSearchText(heading)) || null;
}

async function fetchMoneycontrolFundamentals(stock) {
  const profile = await searchMoneycontrolProfile(stock);
  if (!profile?.link_src) {
    return null;
  }

  const html = await fetchText(profile.link_src, {
    headers: {
      ...MARKET_WEB_HEADERS,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://www.moneycontrol.com/",
    },
    timeoutMs: Math.max(config.httpTimeoutMs, 12_000),
  });

  const graph = parseMoneycontrolAnnualGraph(html);
  const revenueSeries = readMoneycontrolHeading(graph, "Revenue")?.data || [];
  const profitSeries = readMoneycontrolHeading(graph, "Net Profit")?.data || [];

  const extracted = finalizeFundamentals(String(stock.symbol || "").trim().toUpperCase(), {
    pe: html.match(/<td>\s*TTM\s*PE[\s\S]*?<span class="nsepe bsepe">\s*([\d.,-]+)\s*<\/span>/i)?.[1] ?? null,
    roe: readMoneycontrolHeading(graph, "ROE")?.data?.slice(-1)?.[0]?.value ?? null,
    debtToEquity: readMoneycontrolHeading(graph, "Debt to Equity")?.data?.slice(-1)?.[0]?.value ?? null,
    promoterHolding: html.match(/Promoter holding[^%]{0,120}?(\d+(?:\.\d+)?)%/i)?.[1] ?? null,
    salesGrowth3yr: computeCagrFromSeries(revenueSeries),
    profitGrowth3yr: computeCagrFromSeries(profitSeries),
    dividendYield: html.match(/<td>\s*Dividend Yield\s*<\/td>\s*<td class="nsedy bsedy">\s*([\d.,-]+)\s*<\/td>/i)?.[1] ?? null,
  }, {
    source: "MONEYCONTROL_PUBLIC",
    provider: "MONEYCONTROL_PUBLIC",
    reason: null,
    resolvedVariant: profile.link_src,
  });

  return countFundamentalValues(extracted) ? extracted : null;
}

async function fetchNseFundamentals(stock) {
  const symbol = String(stock?.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  const data = await fetchJson("https://www.nseindia.com/api/quote-equity", {
    params: { symbol },
    headers: {
      ...MARKET_WEB_HEADERS,
      accept: "application/json,text/plain,*/*",
      referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      "x-requested-with": "XMLHttpRequest",
    },
    timeoutMs: Math.max(config.httpTimeoutMs, 10_000),
  });

  const extracted = finalizeFundamentals(symbol, {
    pe: data?.metadata?.pdSymbolPe ?? null,
  }, {
    source: "NSE_PUBLIC",
    provider: "NSE_PUBLIC",
    reason: null,
    resolvedVariant: symbol,
  });

  return countFundamentalValues(extracted) ? extracted : null;
}

export async function getFundamentals(symbolOrStock) {
  const stock = typeof symbolOrStock === "string" ? { symbol: symbolOrStock } : (symbolOrStock || {});
  const symbol = String(stock.symbol || "").trim().toUpperCase();
  const cacheKey = `fundamentals:${symbol}`;
  const cached = fundamentalsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const variants = buildFundamentalLookupVariants(stock);
  let lastReason = "";
  let hadReachablePage = false;

  for (const variant of variants) {
    try {
      const html = await fetchText(`https://www.screener.in/company/${encodeURIComponent(variant)}/`, {
        timeoutMs: Math.max(config.httpTimeoutMs, 12_000),
      });
      if (!html || html.length < 5000) {
        if (html) {
          hadReachablePage = true;
          lastReason = "Screener page loaded without usable ratio data.";
        }
        continue;
      }
      hadReachablePage = true;

      const ratioMap = {};
      const ratioRegex = /<li[^>]*>[\s\S]*?<span[^>]*class="name"[^>]*>\s*([\s\S]*?)\s*<\/span>[\s\S]*?<span[^>]*class="number"[^>]*>\s*([\d,.\-]+)\s*<\/span>/gi;
      let match;
      while ((match = ratioRegex.exec(html)) !== null) {
        const key = match[1].replace(/\s+/g, " ").trim().toLowerCase();
        const value = Number(match[2].replace(/,/g, ""));
        if (key && Number.isFinite(value)) {
          ratioMap[key] = value;
        }
      }

      const getValue = (...keys) => {
        for (const key of keys) {
          const found = Object.entries(ratioMap).find(([ratioKey]) => ratioKey.includes(key.toLowerCase()));
          if (found) {
            return found[1];
          }
        }
        return null;
      };

      const promoterMatch = html.match(/Promoters[\s\S]{0,400}?<td[^>]*>\s*(\d{1,2}\.\d{1,2})%/);
      const debtMatch = html.match(/[Dd]ebt\s+to\s+[Ee]quity[\s\S]{0,300}?<td[^>]*>\s*([\d.]+)\s*<\/td>/);
      const salesGrowthMatch = html.match(/Compounded\s+Sales\s+Growth[\s\S]{0,600}?3\s+Years[\s\S]{0,200}?<td[^>]*>\s*(-?\d+\.?\d*)\s*%/i);
      const profitGrowthMatch = html.match(/Compounded\s+Profit\s+Growth[\s\S]{0,600}?3\s+Years[\s\S]{0,200}?<td[^>]*>\s*(-?\d+\.?\d*)\s*%/i);

      const extracted = {
        pe: getValue("stock p/e", "p/e"),
        roe: getValue("roe"),
        roce: getValue("roce"),
        debtToEquity: debtMatch ? Number(debtMatch[1]) : null,
        promoterHolding: promoterMatch ? Number(promoterMatch[1]) : null,
        salesGrowth3yr: salesGrowthMatch ? Number(salesGrowthMatch[1]) : null,
        profitGrowth3yr: profitGrowthMatch ? Number(profitGrowthMatch[1]) : null,
        dividendYield: getValue("dividend yield"),
      };

      const hasUsableData = Object.values(extracted).some((value) => value !== null && value !== undefined);
      if (!hasUsableData) {
        lastReason = "Screener page loaded without usable ratio data.";
        continue;
      }

      return fundamentalsCache.set(cacheKey, finalizeFundamentals(symbol, extracted, {
        source: "SCREENER_PUBLIC",
        provider: "SCREENER_PUBLIC",
        reason: null,
        resolvedVariant: variant,
      }));
    } catch (error) {
      if (String(error?.name || "").includes("Abort")) {
        lastReason = "Screener public source timed out.";
      } else if (String(error?.message || "").includes("HTTP 404")) {
        lastReason = "No public Screener profile matched this symbol.";
      } else {
        lastReason = "Screener public source is unreachable right now.";
      }
      continue;
    }
  }

  const fallbackResults = await Promise.allSettled([
    fetchMoneycontrolFundamentals(stock),
    fetchNseFundamentals(stock),
  ]);

  const successfulFallbacks = fallbackResults
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(Boolean)
    .sort((left, right) => countFundamentalValues(right) - countFundamentalValues(left));

  if (successfulFallbacks.length) {
    const primary = successfulFallbacks[0];
    const merged = mergeFundamentalPayloads(...successfulFallbacks);
    const secondarySources = successfulFallbacks
      .slice(1)
      .map((entry) => entry.source)
      .filter(Boolean);

    return fundamentalsCache.set(cacheKey, finalizeFundamentals(symbol, merged, {
      source: primary.source,
      provider: primary.provider,
      reason: null,
      resolvedVariant: primary.resolvedVariant,
      secondarySources,
    }));
  }

  const fallbackFailureReasons = [];
  if (fallbackResults[0]?.status === "rejected") {
    fallbackFailureReasons.push("Moneycontrol public source is unreachable right now.");
  }
  if (fallbackResults[1]?.status === "rejected") {
    fallbackFailureReasons.push("NSE public quote source is unreachable right now.");
  }

  const finalReason = lastReason
    || (hadReachablePage
      ? "Screener page did not expose usable ratios."
      : "Public fundamentals sources are unreachable right now.");

  return fundamentalsCache.set(cacheKey, finalizeFundamentals(symbol, {}, {
    source: "UNAVAILABLE",
    provider: "SCREENER_PUBLIC",
    reason: [finalReason, ...fallbackFailureReasons].filter(Boolean).join(" "),
    resolvedVariant: null,
  }), 15 * 60_000);
}

async function fetchYahooInstrument(ticker, label) {
  const response = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`, {
    params: {
      range: "5d",
      interval: "1d",
      includePrePost: "false",
    },
  });

  const meta = response?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) {
    return null;
  }

  const lastPrice = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose || meta.previousClose || lastPrice);
  const changePct = previousClose > 0 ? ((lastPrice - previousClose) / previousClose) * 100 : 0;

  return {
    label,
    ticker,
    price: Number(lastPrice.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
  };
}

export async function fetchFIIDIIData() {
  const cached = contextCache.get("fii-dii");
  if (cached) {
    return cached;
  }

  const data = await fetchJson("https://archives.nseindia.com/content/fo/fii_stats.json");
  const rows = Array.isArray(data) ? data : [];
  const latest = rows[rows.length - 1] || rows[0];
  if (!latest) {
    return null;
  }

  return contextCache.set("fii-dii", {
    date: latest.date || latest.DATE || new Date().toISOString().slice(0, 10),
    fiiNetBuy: Number(latest.NET || latest.net || latest.fiiNet || 0),
    diiNetBuy: Number(latest.DII_NET || latest.diiNet || 0),
    mood: Number(latest.NET || latest.net || latest.fiiNet || 0) >= 0 ? "BULLISH" : "BEARISH",
    source: "NSE_PUBLIC",
  }, 30 * 60_000);
}

export async function getMarketContext() {
  const cached = contextCache.get("market-context");
  if (cached) {
    return cached;
  }

  const [nifty, sensex, usdinr, brent, gold, fiiDii] = await Promise.all([
    fetchYahooInstrument("^NSEI", "Nifty 50").catch(() => null),
    fetchYahooInstrument("^BSESN", "Sensex").catch(() => null),
    fetchYahooInstrument("INR=X", "USDINR").catch(() => null),
    fetchYahooInstrument("BZ=F", "Brent").catch(() => null),
    fetchYahooInstrument("GC=F", "Gold").catch(() => null),
    fetchFIIDIIData().catch(() => null),
  ]);

  const benchmarks = [nifty, sensex, usdinr, brent, gold].filter(Boolean);
  const riskOnScore =
    average(benchmarks.filter((item) => item.label === "Nifty 50" || item.label === "Sensex").map((item) => item.changePct))
    - Math.max(0, (usdinr?.changePct || 0) * 0.8)
    - Math.max(0, (brent?.changePct || 0) * 0.5);

  const regime = riskOnScore >= 0.8 ? "RISK_ON" : riskOnScore <= -0.8 ? "RISK_OFF" : "BALANCED";

  return contextCache.set("market-context", {
    regime,
    riskOnScore: Number(riskOnScore.toFixed(2)),
    benchmarks,
    fiiDii,
    generatedAt: new Date().toISOString(),
  });
}

export function computeTechnicalSnapshot(candles = [], quote = null) {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  const volumes = candles.map((candle) => candle.volume || 0);
  const latestPrice = quote?.price || closes[closes.length - 1] || null;

  if (!latestPrice || closes.length < 30) {
    return {
      score: 50,
      volatility: null,
      return20d: null,
      return60d: null,
      volumeSurge: null,
      nearHighRatio: null,
      drawdown: null,
      rsi14: null,
      macd: { line: null, signal: null, histogram: null, posture: "UNAVAILABLE" },
      vwap20: null,
      sma20: null,
      sma50: null,
      support20: null,
      resistance20: null,
      support60: null,
      resistance60: null,
      trendBias: "NEUTRAL",
      higherTimeframe: {
        timeframe: "weekly",
        available: false,
        sma4: null,
        sma8: null,
        return4w: null,
        return12w: null,
        trendBias: "NEUTRAL",
      },
      regime: {
        label: "TRANSITIONAL",
        trendState: "RANGE",
        volatilityState: "NORMAL",
        rangeWidth20Pct: null,
        trendSpreadPct: null,
      },
      candlestick: {
        timeframe: "daily",
        analysisTimeframes: {
          pattern: "daily",
          trend: "weekly",
        },
        detectedPattern: "No reliable pattern",
        direction: "neutral",
        strength: "Weak",
        signalQuality: "Weak",
        qualityScore: null,
        validity: "Ignore",
        kind: "indecision",
        context: {
          trend: "UNKNOWN",
          location: "UNKNOWN",
          volumeConfirmation: "Unavailable",
          marketStructure: "UNKNOWN",
          higherTimeframeTrend: "NEUTRAL",
          regime: "TRANSITIONAL",
        },
        trap: null,
        notes: [],
        trigger: "Wait for more daily candle history before using candlestick analysis.",
        summary: "Not enough candle history is available for candlestick analysis.",
        candidates: [],
      },
    };
  }

  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const return20d = ((latestPrice - closes[Math.max(0, closes.length - 21)]) / closes[Math.max(0, closes.length - 21)]) * 100;
  const return60d = ((latestPrice - closes[Math.max(0, closes.length - 61)]) / closes[Math.max(0, closes.length - 61)]) * 100;
  const nearHighRatio = latestPrice / Math.max(...closes.slice(-120));
  const rollingPeak = Math.max(...closes);
  const drawdown = ((rollingPeak - latestPrice) / rollingPeak) * 100;
  const avgVolume20 = average(volumes.slice(-20));
  const volumeSurge = avgVolume20 > 0 ? (volumes[volumes.length - 1] || avgVolume20) / avgVolume20 : 1;
  const rsi14 = computeRsi(closes, 14);
  const macd = computeMacd(closes);
  const vwap20 = computeRollingVwap(candles, 20);
  const keyLevels = computeKeyLevels(closes);
  const higherTimeframe = computeHigherTimeframeSnapshot(candles, latestPrice);

  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
  }
  const meanReturn = average(returns);
  const variance = average(returns.map((value) => (value - meanReturn) ** 2));
  const volatility = Math.sqrt(variance) * 100;

  let score = 50;
  if (latestPrice > sma20) score += 10;
  if (sma20 > sma50) score += 10;
  if (return20d > 4) score += 10;
  if (return60d > 10) score += 8;
  if (nearHighRatio > 0.92) score += 8;
  if (volumeSurge > 1.25) score += 6;
  if (rsi14 !== null && rsi14 >= 54 && rsi14 <= 72) score += 6;
  if (rsi14 !== null && rsi14 < 40) score -= 6;
  if (macd.histogram !== null && macd.histogram > 0) score += 5;
  if (macd.histogram !== null && macd.histogram < 0) score -= 5;
  if (vwap20 !== null && latestPrice > vwap20) score += 4;
  if (vwap20 !== null && latestPrice < vwap20) score -= 4;
  if (drawdown > 18) score -= 10;
  if (volatility > 3.2) score -= 6;
  if (return20d < -5) score -= 10;

  const trendBias = score >= 62
    ? "BULLISH"
    : score <= 42
      ? "BEARISH"
      : "NEUTRAL";
  const regime = classifyTradeRegimeSnapshot({
    latestPrice,
    sma20,
    sma50,
    return20d,
    return60d,
    volatility,
    support20: keyLevels.support20,
    resistance20: keyLevels.resistance20,
  });
  const candlestick = buildCandlestickSnapshot(candles, latestPrice, {
    sma20,
    sma50,
    return20d,
    return60d,
    volumeSurge,
    higherTimeframe,
    rsi14,
    macdPosture: macd.posture,
    regimeLabel: regime.label,
  });

  return {
    score: Math.max(0, Math.min(100, Number(score.toFixed(1)))),
    volatility: Number(volatility.toFixed(2)),
    return20d: Number(return20d.toFixed(2)),
    return60d: Number(return60d.toFixed(2)),
    volumeSurge: Number(volumeSurge.toFixed(2)),
    nearHighRatio: Number(nearHighRatio.toFixed(3)),
    drawdown: Number(drawdown.toFixed(2)),
    rsi14: round(rsi14, 2),
    macd,
    vwap20: round(vwap20, 2),
    sma20: round(sma20, 2),
    sma50: round(sma50, 2),
    support20: keyLevels.support20,
    resistance20: keyLevels.resistance20,
    support60: keyLevels.support60,
    resistance60: keyLevels.resistance60,
    trendBias,
    higherTimeframe,
    regime,
    candlestick,
  };
}

export async function resolveStockBundle(symbolOrStock) {
  const stock = typeof symbolOrStock === "string"
    ? await resolveStockAny(symbolOrStock)
    : symbolOrStock;
  if (!stock) {
    return null;
  }

  const [quote, candles, fundamentals] = await Promise.all([
    getQuotes([stock]).then((rows) => rows[0] || null),
    getDailyCandles(stock.symbol),
    getFundamentals(stock),
  ]);

  return {
    stock,
    quote,
    candles,
    fundamentals,
    technical: computeTechnicalSnapshot(candles, quote),
  };
}
