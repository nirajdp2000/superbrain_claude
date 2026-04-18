/**
 * Trading Analysis Engine — V2 API surface.
 *
 * Previously this module returned Math.random() for everything. It now delegates
 * to the real market/technical/fundamental pipeline used by /api/analyze.
 *
 * Data flow:
 *   symbol → resolveStockBundle → { stock, quote, candles, fundamentals }
 *          → computeTechnicalSnapshot
 *          → getNewsForSymbols + summarizeSymbolNews
 *          → per-timeframe projection
 */

import { TTLCache } from "../utils/ttl-cache.mjs";
import {
  computeTechnicalSnapshot,
  getQuotes,
  resolveStockBundle,
} from "./market-service.mjs";
import { getNewsForSymbols, summarizeSymbolNews } from "./news-service.mjs";
import { resolveStockAny } from "./universe-service.mjs";

const analysisCache = new TTLCache(5 * 60_000);      // 5 minutes
const marketDataCache = new TTLCache(15_000);        // 15 seconds
const sentimentCache = new TTLCache(10 * 60_000);    // 10 minutes

const TIMEFRAME_ALIASES = {
  intraday: "intraday",
  swing: "swing",
  short_term: "short_term",
  "short-term": "short_term",
  shortterm: "short_term",
  position: "short_term",
  long_term: "long_term",
  "long-term": "long_term",
  longterm: "long_term",
};

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = safeNum(value);
  if (n === null) return null;
  return Number(n.toFixed(digits));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTimeframe(value = "swing") {
  const key = String(value || "").trim().toLowerCase();
  return TIMEFRAME_ALIASES[key] || "swing";
}

class TradingAnalysisEngine {
  constructor() {
    this.riskProfiles = {
      conservative: { max_risk: 0.02, min_rr_ratio: 2.0, stopAtrMultiplier: 0.8, targetAtrMultiplier: 2.0 },
      moderate:     { max_risk: 0.03, min_rr_ratio: 1.5, stopAtrMultiplier: 1.0, targetAtrMultiplier: 2.0 },
      aggressive:   { max_risk: 0.05, min_rr_ratio: 1.0, stopAtrMultiplier: 1.3, targetAtrMultiplier: 2.5 },
    };
  }

  async analyzeStock(symbol, timeframes = ["intraday", "swing", "short_term", "long_term"], riskProfile = "moderate") {
    const resolvedSymbol = String(symbol || "").trim().toUpperCase();
    if (!resolvedSymbol) {
      throw new Error("Symbol is required");
    }

    const normalizedTimeframes = [...new Set(timeframes.map(normalizeTimeframe))];
    const profile = this.riskProfiles[riskProfile] || this.riskProfiles.moderate;
    const cacheKey = `analysis:${resolvedSymbol}:${normalizedTimeframes.join(",")}:${riskProfile}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) return cached;

    const bundle = await resolveStockBundle(resolvedSymbol);
    if (!bundle?.stock || !bundle.quote) {
      throw new Error(`Unable to resolve market data for ${resolvedSymbol}`);
    }

    const technical = computeTechnicalSnapshot(bundle.candles || [], bundle.quote);
    const newsItems = await getNewsForSymbols([bundle.stock.symbol]).catch(() => []);
    const newsSummary = summarizeSymbolNews(bundle.stock.symbol, newsItems);

    const perTimeframe = {};
    for (const timeframe of normalizedTimeframes) {
      perTimeframe[timeframe] = this.analyzeTimeframe(timeframe, {
        stock: bundle.stock,
        quote: bundle.quote,
        technical,
        fundamentals: bundle.fundamentals || {},
        newsSummary,
        profile,
      });
    }

    const result = {
      symbol: bundle.stock.symbol,
      name: bundle.stock.name,
      sector: bundle.stock.sector,
      current_price: round(bundle.quote.price, 2),
      change: round(bundle.quote.change, 2),
      change_percent: round(bundle.quote.changePct, 2),
      data_source: bundle.quote.source || "aggregated",
      timestamp: new Date().toISOString(),
      analysis: perTimeframe,
      ai_summary: this.generateAISummary(bundle.stock.symbol, perTimeframe, newsSummary, technical),
      risk_factors: this.identifyRiskFactors(perTimeframe, technical, newsSummary, bundle.fundamentals || {}),
      last_updated: new Date().toISOString(),
    };

    return analysisCache.set(cacheKey, result);
  }

  analyzeTimeframe(timeframe, context) {
    switch (timeframe) {
      case "intraday": return this.analyzeIntraday(context);
      case "swing": return this.analyzeSwing(context);
      case "short_term": return this.analyzeShortTerm(context);
      case "long_term": return this.analyzeLongTerm(context);
      default:
        return this.analyzeSwing(context);
    }
  }

  // ── Intraday ────────────────────────────────────────
  analyzeIntraday({ quote, technical, newsSummary, profile }) {
    const price = safeNum(quote.price);
    const open = safeNum(quote.open, price);
    const atr = this.deriveATR(technical, price);
    const vwap = safeNum(technical.vwap20, price);
    const rsi = safeNum(technical.rsi14, 50);
    const above = price > vwap;

    const trend = above && rsi > 55 ? "bullish"
      : !above && rsi < 45 ? "bearish"
      : "sideways";

    const entry = trend === "bullish" ? Math.max(price, vwap) : Math.min(price, vwap);
    const stopLoss = trend === "bullish"
      ? entry - atr * profile.stopAtrMultiplier
      : entry + atr * profile.stopAtrMultiplier;
    const target = trend === "bullish"
      ? entry + atr * profile.targetAtrMultiplier
      : entry - atr * profile.targetAtrMultiplier;

    const confidence = this.confidence(technical, newsSummary, "intraday");

    return {
      trend,
      entry: round(entry, 2),
      target: round(target, 2),
      stop_loss: round(stopLoss, 2),
      confidence: Math.round(confidence),
      risk_reward: this.riskReward(entry, target, stopLoss),
      indicators: {
        rsi: round(rsi, 2),
        macd: technical.macd?.posture || "NEUTRAL",
        vwap_position: above ? "above" : "below",
        volume_surge: round(technical.volumeSurge, 2),
      },
      time_horizon: "1–5 hours",
      setup: this.identifyIntradaySetup(technical, open, price),
      data_quality: this.dataQuality(technical),
    };
  }

  // ── Swing ───────────────────────────────────────────
  analyzeSwing({ quote, technical, newsSummary, profile }) {
    const price = safeNum(quote.price);
    const atr = this.deriveATR(technical, price);
    const bullish = technical.trendBias === "BULLISH";
    const bearish = technical.trendBias === "BEARISH";

    const setup = bullish
      ? "bullish_trend_pullback"
      : bearish
        ? "bearish_breakdown"
        : "neutral_range";

    const entry = bullish
      ? Math.min(price, safeNum(technical.sma20, price) + atr * 0.3)
      : bearish
        ? Math.max(price, safeNum(technical.sma20, price) - atr * 0.3)
        : price;

    const stopLoss = bullish
      ? entry - atr * profile.stopAtrMultiplier
      : bearish
        ? entry + atr * profile.stopAtrMultiplier
        : entry - atr;

    const target = bullish
      ? entry + atr * profile.targetAtrMultiplier
      : bearish
        ? entry - atr * profile.targetAtrMultiplier
        : entry + atr;

    const confidence = this.confidence(technical, newsSummary, "swing");

    return {
      setup,
      entry: round(entry, 2),
      target: round(target, 2),
      stop_loss: round(stopLoss, 2),
      confidence: Math.round(confidence),
      risk_reward: this.riskReward(entry, target, stopLoss),
      time_horizon: "3–10 days",
      volume_confirmation: safeNum(technical.volumeSurge, 1) >= 1.2,
      key_levels: {
        support20: technical.support20,
        resistance20: technical.resistance20,
        sma20: technical.sma20,
        sma50: technical.sma50,
      },
      pattern: technical.candlestick?.detectedPattern || "No high-quality pattern",
      data_quality: this.dataQuality(technical),
    };
  }

  // ── Short-term / Positional (1–3 months) ────────────
  analyzeShortTerm({ technical, fundamentals, newsSummary }) {
    let score = 0;
    const pe = safeNum(fundamentals.pe);
    const roe = safeNum(fundamentals.roe);
    const salesGrowth = safeNum(fundamentals.salesGrowth3yr);
    const bullish = technical.trendBias === "BULLISH";
    const bearish = technical.trendBias === "BEARISH";

    if (bullish) score += 2;
    if (bearish) score -= 2;
    if (safeNum(technical.return60d, 0) > 10) score += 1;
    if (safeNum(technical.return60d, 0) < -10) score -= 1;
    if (roe !== null && roe > 15) score += 1;
    if (salesGrowth !== null && salesGrowth > 10) score += 1;
    if (pe !== null && pe < 30) score += 1;
    if (pe !== null && pe > 60) score -= 1;
    if (newsSummary?.signalBalance > 0) score += 1;
    if (newsSummary?.signalBalance < 0) score -= 1;

    const direction = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
    const expectedMove = this.expectedMove(technical, 3);

    return {
      direction,
      expected_move: `${direction === "bullish" ? "+" : direction === "bearish" ? "-" : "±"}${Math.abs(expectedMove).toFixed(1)}%`,
      timeframe: "1–3 months",
      confidence: Math.round(this.confidence(technical, newsSummary, "short_term")),
      technical_score: Math.round(technical.score || 50),
      fundamental_score: this.fundamentalScore(fundamentals),
      sentiment_score: Math.round(newsSummary?.score || 50),
      key_factors: this.keyFactors({ technical, fundamentals, newsSummary }),
      data_quality: this.dataQuality(technical),
    };
  }

  // ── Long term (6+ months) ───────────────────────────
  analyzeLongTerm({ fundamentals, newsSummary, technical }) {
    const verdict = this.longTermVerdict(fundamentals, newsSummary);
    const strength = this.businessStrength(fundamentals);
    const confidence = this.longTermConfidence(fundamentals, newsSummary);

    return {
      verdict,
      strength,
      confidence: Math.round(confidence),
      fundamentals: {
        pe: round(fundamentals.pe, 2),
        roe: round(fundamentals.roe, 2),
        roce: round(fundamentals.roce, 2),
        debt_to_equity: round(fundamentals.debtToEquity, 2),
        sales_growth_3y: round(fundamentals.salesGrowth3yr, 2),
        profit_growth_3y: round(fundamentals.profitGrowth3yr, 2),
        promoter_holding: round(fundamentals.promoterHolding, 2),
        dividend_yield: round(fundamentals.dividendYield, 2),
      },
      fundamentals_source: fundamentals.source || "UNAVAILABLE",
      technical_bias: technical.trendBias || "NEUTRAL",
      sentiment: newsSummary?.score ?? null,
      data_quality: fundamentals.source && fundamentals.source !== "UNAVAILABLE" ? "high" : "low",
    };
  }

  // ── Helpers ─────────────────────────────────────────
  deriveATR(technical, price) {
    const volatility = safeNum(technical.volatility);
    if (volatility && price) {
      return Math.max((volatility / 100) * price, 0.5);
    }
    return Math.max(price * 0.015, 0.5);
  }

  confidence(technical, newsSummary, timeframe) {
    let score = 50;
    score += (safeNum(technical.score, 50) - 50) * 0.5;
    score += ((safeNum(newsSummary?.score, 50) - 50) * 0.3);

    if (technical.trendBias === "BULLISH") score += 5;
    if (technical.trendBias === "BEARISH") score += 5; // conviction in direction either way

    if (timeframe === "intraday") score *= 0.85;
    if (timeframe === "long_term") score *= 1.05;

    return clamp(score, 15, 95);
  }

  riskReward(entry, target, stopLoss) {
    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stopLoss);
    if (!risk) return 0;
    return round(reward / risk, 2);
  }

  identifyIntradaySetup(technical, open, price) {
    const rsi = safeNum(technical.rsi14, 50);
    if (rsi > 70) return "overbought";
    if (rsi < 30) return "oversold";
    if (price > open && technical.trendBias === "BULLISH") return "bullish_momentum";
    if (price < open && technical.trendBias === "BEARISH") return "bearish_momentum";
    return "neutral";
  }

  expectedMove(technical, months) {
    const vol = safeNum(technical.volatility, 1.5);
    return vol * Math.sqrt(months * 21);
  }

  fundamentalScore(fundamentals = {}) {
    const roe = safeNum(fundamentals.roe);
    const roce = safeNum(fundamentals.roce);
    const de = safeNum(fundamentals.debtToEquity);
    const salesGrowth = safeNum(fundamentals.salesGrowth3yr);
    const profitGrowth = safeNum(fundamentals.profitGrowth3yr);

    let score = 50;
    if (roe !== null) score += (roe - 15) * 1.2;
    if (roce !== null) score += (roce - 15) * 1.0;
    if (de !== null) score -= Math.max(0, (de - 1)) * 8;
    if (salesGrowth !== null) score += (salesGrowth - 10) * 0.8;
    if (profitGrowth !== null) score += (profitGrowth - 10) * 0.8;

    return Math.round(clamp(score, 0, 100));
  }

  longTermVerdict(fundamentals, newsSummary) {
    const score = this.fundamentalScore(fundamentals);
    const sentimentBoost = safeNum(newsSummary?.score, 50) > 60 ? 5 : 0;
    const combined = score + sentimentBoost;
    if (combined >= 80) return "strong_buy";
    if (combined >= 65) return "buy";
    if (combined >= 45) return "hold";
    return "avoid";
  }

  businessStrength(fundamentals = {}) {
    const score = this.fundamentalScore(fundamentals);
    if (score >= 80) return "excellent";
    if (score >= 60) return "good";
    if (score >= 40) return "average";
    return "weak";
  }

  longTermConfidence(fundamentals = {}, newsSummary) {
    let confidence = 45;
    if (fundamentals.source && fundamentals.source !== "UNAVAILABLE") confidence += 15;
    const roe = safeNum(fundamentals.roe);
    const de = safeNum(fundamentals.debtToEquity);
    if (roe !== null && roe > 15) confidence += 15;
    if (de !== null && de < 1) confidence += 10;
    if (newsSummary?.highCredibilityCount > 0) confidence += 5;
    return clamp(confidence, 20, 90);
  }

  keyFactors({ technical, fundamentals, newsSummary }) {
    const factors = [];
    if (technical.trendBias === "BULLISH") factors.push("technical_uptrend");
    if (technical.trendBias === "BEARISH") factors.push("technical_downtrend");
    if (safeNum(technical.volumeSurge, 1) > 1.3) factors.push("volume_expansion");
    if (safeNum(fundamentals.roe, 0) > 15) factors.push("high_roe");
    if (safeNum(fundamentals.debtToEquity, 0) > 1.5) factors.push("elevated_leverage");
    if (newsSummary?.signalBalance > 0) factors.push("positive_news_flow");
    if (newsSummary?.signalBalance < 0) factors.push("negative_news_flow");
    return factors.length ? factors : ["insufficient_signals"];
  }

  generateAISummary(symbol, analysis, newsSummary, technical) {
    const parts = [];
    if (analysis.intraday) {
      parts.push(`Intraday ${analysis.intraday.trend} (${analysis.intraday.confidence}% confidence, RR ${analysis.intraday.risk_reward}).`);
    }
    if (analysis.swing) {
      parts.push(`Swing ${analysis.swing.setup} over ${analysis.swing.time_horizon}, RR ${analysis.swing.risk_reward}.`);
    }
    if (analysis.short_term) {
      parts.push(`Short-term ${analysis.short_term.direction} bias, expected move ${analysis.short_term.expected_move} over ${analysis.short_term.timeframe}.`);
    }
    if (analysis.long_term) {
      parts.push(`Long-term verdict: ${analysis.long_term.verdict} (${analysis.long_term.strength} fundamentals).`);
    }
    if (newsSummary?.newsCount) {
      parts.push(`News: ${newsSummary.newsCount} items, balance ${newsSummary.signalBalance}, grade ${newsSummary.evidenceGrade}.`);
    }
    parts.push(`Technical trend bias: ${technical.trendBias}.`);
    return parts.join(" ");
  }

  identifyRiskFactors(analysis, technical, newsSummary, fundamentals) {
    const risks = [];
    if (safeNum(technical.volatility, 0) > 3) risks.push("high_volatility");
    if (safeNum(technical.drawdown, 0) > 20) risks.push("deep_drawdown");
    if (safeNum(fundamentals.debtToEquity, 0) > 1.5) risks.push("high_debt");
    if ((newsSummary?.score ?? 50) < 40) risks.push("negative_sentiment");
    if (analysis.intraday && analysis.intraday.confidence < 45) risks.push("low_intraday_confidence");
    if (analysis.long_term && analysis.long_term.data_quality === "low") risks.push("limited_fundamentals_data");
    return risks.length ? risks : ["standard_market_risk"];
  }

  dataQuality(technical) {
    if (!technical || technical.score === undefined) return "low";
    if (technical.rsi14 === null && technical.sma20 === null) return "low";
    if (technical.higherTimeframe?.available === false) return "medium";
    return "high";
  }

  // ── Thin endpoints used by server routes ────────────
  async getMarketData(symbol) {
    const resolvedSymbol = String(symbol || "").trim().toUpperCase();
    const cacheKey = `market:${resolvedSymbol}`;
    const cached = marketDataCache.get(cacheKey);
    if (cached) return cached;

    const stock = await resolveStockAny(resolvedSymbol);
    if (!stock) {
      throw new Error(`Unknown symbol: ${resolvedSymbol}`);
    }

    const [quote] = await getQuotes([stock]);
    if (!quote) {
      throw new Error(`No quote available for ${resolvedSymbol}`);
    }

    const payload = {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      price: round(quote.price, 2),
      change: round(quote.change, 2),
      change_percent: round(quote.changePct, 2),
      open: round(quote.open, 2),
      high: round(quote.high, 2),
      low: round(quote.low, 2),
      previous_close: round(quote.previousClose, 2),
      volume: safeNum(quote.volume, 0),
      source: quote.source || "aggregated",
      timestamp: new Date().toISOString(),
    };

    return marketDataCache.set(cacheKey, payload);
  }

  async getMarketSentiment(symbol) {
    const resolvedSymbol = String(symbol || "").trim().toUpperCase();
    const cacheKey = `sentiment:${resolvedSymbol}`;
    const cached = sentimentCache.get(cacheKey);
    if (cached) return cached;

    const stock = await resolveStockAny(resolvedSymbol);
    if (!stock) {
      throw new Error(`Unknown symbol: ${resolvedSymbol}`);
    }

    const items = await getNewsForSymbols([stock.symbol]).catch(() => []);
    const summary = summarizeSymbolNews(stock.symbol, items);

    const payload = {
      symbol: stock.symbol,
      overall: summary.score >= 55 ? "bullish" : summary.score <= 45 ? "bearish" : "neutral",
      score: round((summary.score - 50) / 50, 3),
      news_score: summary.score,
      news_count: summary.newsCount,
      verified_count: summary.verifiedCount,
      official_count: summary.officialCount,
      high_credibility_count: summary.highCredibilityCount,
      signal_balance: summary.signalBalance,
      evidence_grade: summary.evidenceGrade,
      dominant_tags: summary.dominantTags,
      bullish_headlines: summary.bullishHeadlines.slice(0, 3).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
      bearish_headlines: summary.bearishHeadlines.slice(0, 3).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
      timestamp: new Date().toISOString(),
    };

    return sentimentCache.set(cacheKey, payload);
  }
}

export const tradingEngine = new TradingAnalysisEngine();
