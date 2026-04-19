import { getDefaultWatchlist, getUniverse } from "../data/universe.mjs";
import { getMarketContext, resolveStockBundle } from "./market-service.mjs";
import { getNewsForSymbols, getNewsIntelligence, summarizeSymbolNews } from "./news-service.mjs";
import { resolveQueryCandidates, resolveStockAny, resolveStocksAny, searchAnyUniverse } from "./universe-service.mjs";
import { enrichWithOptionsData, getIndiaVix } from "./options-service.mjs";
import { computeEnhancedTechnicalScore } from "./technical-engine.mjs";
import { computeEnhancedFundamentalScore, classifyLynchCategory, reverseDAF, detectMoat, scoreQGLP } from "./fundamental-engine.mjs";
import { enrichWithIndiaSignals, getUpcomingIndianEvents, getSectorRotationSignals, isBudgetSensitiveStock } from "./india-intelligence.mjs";
import { enrichWithGodLevel, computeATRTargetsAndStops, computeConvictionScore, computeBayesianScenarios, getDynamicWeights } from "./godlevel-engine.mjs";

const SECTOR_FAIR_PE = {
  Technology: 28,
  Financials: 18,
  Healthcare: 30,
  Consumer: 35,
  Industrials: 24,
  Auto: 20,
  Materials: 16,
  Energy: 12,
  Utilities: 17,
  Telecom: 20,
};

const STRATEGY_WEIGHTS = {
  intraday: { technical: 0.5, fundamentals: 0.08, news: 0.16, macro: 0.14, events: 0.12, riskPenalty: 0.2 },
  swing: { technical: 0.36, fundamentals: 0.23, news: 0.18, macro: 0.13, events: 0.1, riskPenalty: 0.18 },
  position: { technical: 0.25, fundamentals: 0.32, news: 0.17, macro: 0.14, events: 0.12, riskPenalty: 0.16 },
  longterm: { technical: 0.14, fundamentals: 0.4, news: 0.16, macro: 0.16, events: 0.14, riskPenalty: 0.12 },
};

const MULTI_STRATEGY_ORDER = ["intraday", "swing", "position", "longterm"];
const STRATEGY_LABELS = {
  intraday: "Intraday",
  swing: "Swing",
  position: "Short Term",
  longterm: "Long Term",
};

const EVENT_IMPACT_RULES = {
  war: { default: -5, Energy: 6, Utilities: 1, Healthcare: 1, Materials: 1, Auto: -4, Consumer: -4, Financials: -3, Industrials: -4, Technology: -3, Telecom: -2 },
  oil_shock: { default: -4, Energy: 8, Utilities: 2, Materials: 2, Auto: -6, Consumer: -4, Industrials: -5, Financials: -2, Technology: -2, Telecom: -2, Healthcare: -1 },
  shipping_risk: { default: -3, Industrials: -5, Materials: -5, Consumer: -3, Auto: -4, Energy: -2, Financials: -1, Technology: -1, Telecom: -1, Utilities: -1, Healthcare: -1 },
  sanctions: { default: -4, Energy: 4, Materials: -1, Industrials: -3, Technology: -2, Consumer: -2, Auto: -2, Financials: -2 },
  rates_hike: { default: -4, Financials: 1, Consumer: -3, Auto: -4, Industrials: -2, Technology: -2, RealEstate: -5 },
  rates_cut: { default: 4, Financials: 1, Consumer: 3, Auto: 4, Industrials: 3, Technology: 1, Utilities: 1 },
  inflation: { default: -4, Energy: 1, Consumer: -5, Auto: -4, Industrials: -2, Financials: -1, Technology: -2, Healthcare: -1 },
  currency_pressure: { default: -2, Technology: 5, Healthcare: 3, Auto: -3, Energy: -4, Consumer: -2, Industrials: -2, Telecom: -1, Financials: -1 },
  budget_policy: { default: 2, Industrials: 3, Materials: 2, Utilities: 2, Financials: 1, Consumer: 1, Auto: 1 },
  regulation: { default: -1, Financials: -2, Healthcare: -2, Telecom: -2, Energy: -1 },
  natural_disaster: { default: -4, Healthcare: 2, Utilities: -3, Materials: -2, Industrials: -3, Consumer: -3, Auto: -2, Financials: -1, Technology: -1 },
  monsoon: { default: -2, Consumer: -2, Auto: -1, Industrials: -1, Healthcare: 0, Financials: -1 },
  cyber_risk: { default: -4, Technology: -5, Financials: -4, Telecom: -3, Consumer: -1 },
  earnings: { default: 1, Technology: 1, Financials: 1, Industrials: 1, Consumer: 1, Auto: 1, Healthcare: 1 },
  order_win: { default: 4, Industrials: 6, Technology: 5, Telecom: 4, Materials: 3, Utilities: 2 },
  default_risk: { default: -8, Financials: -4, Consumer: -2, Industrials: -4, Auto: -3, Materials: -3 },
  investigation: { default: -8, Financials: -6, Energy: -5, Industrials: -5, Healthcare: -5, Technology: -4 },
  fda_risk: { default: -4, Healthcare: -8 },
  buyback: { default: 3, Technology: 2, Financials: 2, Consumer: 2, Industrials: 2, Auto: 2 },
  dividend: { default: 2, Financials: 2, Energy: 3, Utilities: 3, Consumer: 1 },
  capex: { default: 2, Industrials: 4, Materials: 4, Energy: 3, Auto: 2, Technology: 2 },
  rating_upgrade: { default: 2, Technology: 2, Financials: 2, Healthcare: 2, Consumer: 2 },
  rating_downgrade: { default: -3, Technology: -2, Financials: -2, Healthcare: -2, Consumer: -2 },
  governance: { default: -6, Financials: -6, Industrials: -5, Energy: -5, Consumer: -4 },
};

const QUERY_STOPWORDS = new Set([
  "SHOULD", "BUY", "SELL", "HOLD", "VIEW", "GIVE", "SHOW", "CHECK", "ANALYZE", "ANALYSIS",
  "RIGHT", "NOW", "FOR", "WITH", "SWING", "TRADE", "TRADING", "POSITION", "POSITIONAL", "INTRADAY",
  "TODAY", "TOMORROW", "PLEASE", "ABOUT", "STOCK", "STOCKS", "RECOMMENDATION", "RECOMMEND",
  "ADVICE", "INVEST", "INVESTING", "LONG", "LONGTERM", "SHORT", "SHORTTERM", "TERM", "PORTFOLIO",
  "ACCUMULATE", "INVESTMENT", "ME", "MY", "THE", "THIS", "THAT", "LOOK", "OUTLOOK", "NEED",
  "WANT", "TELL", "CAN", "DO", "DOES", "IS", "ARE", "PLEASED",
]);

const STRATEGY_QUERY_PATTERNS = {
  intraday: [/\bintraday\b/i, /\bday\s*trade\b/i, /\bdaytrade\b/i, /\bscalp(?:ing)?\b/i, /\btoday\b/i],
  swing: [/\bswing\b/i, /\bswing\s*trade\b/i],
  position: [
    /\bshort\s*-?\s*term\b/i,
    /\bshortterm\b/i,
    /\bposition(?:al)?\b/i,
    /\b3\s*month\b/i,
    /\b6\s*month\b/i,
    /\bfew\s+weeks?\b/i,
    /\bnext\s+few\s+weeks?\b/i,
  ],
  longterm: [
    /\blong\s*-?\s*term\b/i,
    /\blongterm\b/i,
    /\blong\s+run\b/i,
    /\b1\s*year\b/i,
    /\b2\s*year\b/i,
    /\b3\s*year\b/i,
    /\bportfolio\b/i,
    /\binvest(?:ment|ing)?\b/i,
    /\baccumulate\b/i,
    /\bwealth\b/i,
    /\bmulti\s*-?\s*year\b/i,
  ],
};

const MULTI_STRATEGY_REQUEST_PATTERNS = [
  /\ball\s+(?:time\s*frames?|horizons?|strateg(?:y|ies)|setups?|views?|angles?|signals?|recommendations?|info|information|evidence)\b/i,
  /\bevery\s+(?:time\s*frame|horizon|strategy|setup|angle)\b/i,
  /\bacross\s+(?:all\s+)?(?:time\s*frames?|horizons?|strateg(?:y|ies)|angles?)\b/i,
  /\bfull\s+(?:analysis|picture|view|breakdown)\b/i,
  /\bcomplete\s+(?:analysis|picture|view|breakdown)\b/i,
  /\bcompare\b.+\b(?:intraday|swing|short\s*-?\s*term|position(?:al)?|long\s*-?\s*term)\b/i,
  /\b(?:intraday|swing|short\s*-?\s*term|position(?:al)?|long\s*-?\s*term)\b\s*(?:and|or|vs\.?|versus|\/|,)\s*\b(?:intraday|swing|short\s*-?\s*term|position(?:al)?|long\s*-?\s*term)\b/i,
];

const ENTITY_NOISE_PATTERNS = [
  /\bshould\b/gi,
  /\bbuy\b/gi,
  /\bsell\b/gi,
  /\bhold\b/gi,
  /\bview\b/gi,
  /\bgive\b/gi,
  /\bshow\b/gi,
  /\bcheck\b/gi,
  /\banaly[sz]e\b/gi,
  /\banalysis\b/gi,
  /\brecommend(?:ation)?\b/gi,
  /\badvice\b/gi,
  /\btrade\b/gi,
  /\btrading\b/gi,
  /\bintraday\b/gi,
  /\bswing\b/gi,
  /\bshort\s*-?\s*term\b/gi,
  /\bshortterm\b/gi,
  /\blong\s*-?\s*term\b/gi,
  /\blongterm\b/gi,
  /\bposition(?:al)?\b/gi,
  /\bportfolio\b/gi,
  /\binvest(?:ment|ing)?\b/gi,
  /\baccumulate\b/gi,
  /\bwealth\b/gi,
  /\bright\s+now\b/gi,
  /\btoday\b/gi,
  /\btomorrow\b/gi,
  /\bnow\b/gi,
  /\bplease\b/gi,
];

const ENTITY_CUE_PATTERNS = [
  /\bfor\s+(.+?)(?=\b(?:right\s+now|today|tomorrow|please|currently|now)\b|[?.!,]|$)/i,
  /\babout\s+(.+?)(?=\b(?:right\s+now|today|tomorrow|please|currently|now)\b|[?.!,]|$)/i,
  /\bon\s+(.+?)(?=\b(?:right\s+now|today|tomorrow|please|currently|now)\b|[?.!,]|$)/i,
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageDefined(values) {
  const cleaned = values.filter((value) => Number.isFinite(Number(value)));
  return cleaned.length ? average(cleaned.map(Number)) : null;
}

function uniqueStrings(values = [], limit = 8) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function formatTag(tag = "") {
  return tag.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFairPe(stock) {
  return SECTOR_FAIR_PE[stock?.sector] || 22;
}

function getStrategyWeights(strategy) {
  return STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.swing;
}

function normalizeAnalysisStrategy(value = "swing") {
  const normalized = String(value || "swing").trim().toLowerCase();
  return MULTI_STRATEGY_ORDER.includes(normalized) ? normalized : "swing";
}

function getStrategyLabel(strategy = "swing") {
  return STRATEGY_LABELS[normalizeAnalysisStrategy(strategy)] || "Swing";
}

function resolveHorizonDays(strategy, rawHorizonDays) {
  strategy = normalizeAnalysisStrategy(strategy);
  const requested = Number(rawHorizonDays);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.round(requested);
  }
  if (strategy === "intraday") return 1;
  if (strategy === "position") return 60;
  if (strategy === "longterm") return 240;
  return 20;
}

function valuationView(stock, fundamentals) {
  const fairPe = getFairPe(stock);
  const pe = fundamentals.pe;

  if (!pe) {
    return {
      score: 50,
      label: "UNKNOWN",
      detail: "Public valuation data is not available right now.",
    };
  }

  if (pe <= fairPe * 0.85) {
    return {
      score: 78,
      label: "ATTRACTIVE",
      detail: `P/E ${pe} is below the sector fair range near ${fairPe}.`,
    };
  }
  if (pe <= fairPe * 1.12) {
    return {
      score: 64,
      label: "FAIR",
      detail: `P/E ${pe} is close to the sector fair range near ${fairPe}.`,
    };
  }
  if (pe <= fairPe * 1.45) {
    return {
      score: 44,
      label: "FULL",
      detail: `P/E ${pe} is somewhat rich versus the sector fair range near ${fairPe}.`,
    };
  }
  return {
    score: 28,
    label: "STRETCHED",
    detail: `P/E ${pe} is well above the sector fair range near ${fairPe}.`,
  };
}

function computeFundamentalScore(stock, fundamentals) {
  let score = 50;
  const fairPe = getFairPe(stock);

  if (fundamentals.pe) {
    if (fundamentals.pe <= fairPe * 0.9) score += 10;
    else if (fundamentals.pe <= fairPe * 1.2) score += 4;
    else if (fundamentals.pe >= fairPe * 1.7) score -= 10;
  }
  if (fundamentals.roe) {
    if (fundamentals.roe >= 20) score += 10;
    else if (fundamentals.roe >= 15) score += 5;
    else if (fundamentals.roe < 10) score -= 5;
  }
  if (fundamentals.roce) {
    if (fundamentals.roce >= 18) score += 8;
    else if (fundamentals.roce < 10) score -= 4;
  }
  if (fundamentals.debtToEquity !== null && fundamentals.debtToEquity !== undefined) {
    if (fundamentals.debtToEquity <= 0.5) score += 7;
    else if (fundamentals.debtToEquity > 1.5) score -= 10;
  }
  if (fundamentals.promoterHolding) {
    if (fundamentals.promoterHolding >= 55) score += 6;
    else if (fundamentals.promoterHolding < 35) score -= 6;
  }
  if (fundamentals.profitGrowth3yr) {
    if (fundamentals.profitGrowth3yr >= 18) score += 8;
    else if (fundamentals.profitGrowth3yr < 0) score -= 10;
  }
  if (fundamentals.salesGrowth3yr) {
    if (fundamentals.salesGrowth3yr >= 12) score += 5;
    else if (fundamentals.salesGrowth3yr < 0) score -= 5;
  }

  return clamp(Number(score.toFixed(1)));
}

function computeMacroScore(stock, marketContext) {
  let score = 52;
  const fiiFlow = Number(marketContext?.fiiDii?.fiiNetBuy || 0);
  const riskOnScore = Number(marketContext?.riskOnScore || 0);

  if (riskOnScore > 1) score += 12;
  else if (riskOnScore > 0.4) score += 6;
  if (riskOnScore < -1) score -= 12;
  else if (riskOnScore < -0.4) score -= 6;

  if (fiiFlow > 900) score += 8;
  if (fiiFlow < -900) score -= 8;

  const brent = marketContext?.benchmarks?.find((item) => item.label === "Brent");
  const usdinr = marketContext?.benchmarks?.find((item) => item.label === "USDINR");
  const gold = marketContext?.benchmarks?.find((item) => item.label === "Gold");

  if (stock.sector === "Energy" && Number(brent?.changePct || 0) > 1.5) score += 6;
  if ((stock.sector === "Auto" || stock.sector === "Consumer" || stock.sector === "Industrials") && Number(brent?.changePct || 0) > 2) score -= 6;
  if (stock.sector === "Technology" && Number(usdinr?.changePct || 0) > 0.5) score += 5;
  if (stock.sector === "Healthcare" && Number(usdinr?.changePct || 0) > 0.6) score += 3;
  if (Number(gold?.changePct || 0) > 1.5 && riskOnScore < 0) score -= 3;

  return clamp(Number(score.toFixed(1)));
}

function getTagImpact(sector, tag, sentimentScore = 0) {
  const rule = EVENT_IMPACT_RULES[tag];
  let impact = rule ? (rule[sector] ?? rule.default ?? 0) : 0;

  if (["earnings", "regulation", "budget_policy", "rating_upgrade", "rating_downgrade"].includes(tag)) {
    impact += sentimentScore * 6;
  }

  return impact;
}

function buildEventExposure(stock, globalNews) {
  const sourceItems = [...(globalNews?.macro || []), ...(globalNews?.geopolitical || []), ...(globalNews?.official || [])];
  const seen = new Set();
  const items = sourceItems.filter((item) => {
    if (!item?.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });

  let score = 50;
  const drivers = [];

  for (const item of items.slice(0, 40)) {
    let rawImpact = 0;
    for (const tag of item.tags || []) {
      rawImpact += getTagImpact(stock.sector, tag, item.sentiment?.score || 0);
    }

    if (rawImpact === 0) {
      rawImpact = (item.sentiment?.score || 0) * (item.official ? 5 : 3);
    }

    const weightedImpact = rawImpact
      * (item.freshnessScore || 0.5)
      * (item.credibility || 0.8)
      * (item.verified ? 1.12 : 0.96)
      * (item.official ? 1.1 : 1);

    score += weightedImpact;

    if (Math.abs(weightedImpact) >= 1.4) {
      drivers.push({
        headline: item.headline,
        source: item.source,
        publishedAt: item.publishedAt,
        impact: Number(weightedImpact.toFixed(2)),
        tags: item.tags || [],
        summary: item.summary,
        url: item.url,
        official: Boolean(item.official),
        verified: Boolean(item.verified),
      });
    }
  }

  const roundedScore = clamp(Number(score.toFixed(1)));
  return {
    score: roundedScore,
    pressure: roundedScore >= 57 ? "TAILWIND" : roundedScore <= 44 ? "HEADWIND" : "MIXED",
    drivers: drivers
      .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
      .slice(0, 6),
  };
}

function computeRiskScore(technical, fundamentals, newsSummary, marketContext, eventExposure, strictVerification) {
  let risk = 28;

  if ((technical.volatility || 0) > 3.5) risk += 18;
  else if ((technical.volatility || 0) > 2.5) risk += 10;
  if ((technical.drawdown || 0) > 20) risk += 16;
  else if ((technical.drawdown || 0) > 12) risk += 8;

  if ((fundamentals.debtToEquity || 0) > 1.5) risk += 10;
  if (fundamentals.promoterHolding && fundamentals.promoterHolding < 35) risk += 7;
  if ((marketContext?.riskOnScore || 0) < -0.8) risk += 9;
  if (eventExposure.score < 45) risk += 10;
  if (strictVerification && newsSummary.newsCount > 0 && newsSummary.verifiedCount === 0) risk += 8;
  if (newsSummary.newsCount > 0 && newsSummary.realTimeCount === 0) risk += 4;
  if (newsSummary.newsCount > 0 && (newsSummary.avgCredibility || 0) < 0.85) risk += 4;
  if (newsSummary.newsCount > 0 && newsSummary.evidenceGrade === "D") risk += 5;
  if (newsSummary.signalBalance < 0) risk += 5;

  return clamp(Number(risk.toFixed(1)));
}

function classifyVerdict(adjustedScore, riskScore, newsSummary, eventExposure, strictVerification) {
  if (adjustedScore >= 78 && riskScore <= 48 && eventExposure.score >= 52) {
    return "STRONG_BUY";
  }
  if (adjustedScore >= 64 && riskScore <= 62) {
    return "BUY";
  }
  if (strictVerification && newsSummary.newsCount > 0 && newsSummary.verifiedCount === 0 && adjustedScore >= 56) {
    return "HOLD";
  }
  if (adjustedScore >= 46) {
    return "HOLD";
  }
  if (adjustedScore >= 30 || riskScore >= 60 || eventExposure.score <= 42) {
    return "SELL";
  }
  return "STRONG_SELL";
}

function buildTargets(score, riskScore, price, strategy, verdict = "HOLD") {
  if (!price) {
    return { targetPrice: null, stopLoss: null, targetPct: null };
  }

  let targetMultiplier = 0.24;
  let stopBase = 4.2;
  let stopRiskFactor = 0.08;
  let minTarget = -10;
  let maxTarget = 20;
  let minStop = 4;
  let maxStop = 11;

  if (strategy === "intraday") {
    targetMultiplier = 0.11;
    stopBase = 1.8;
    stopRiskFactor = 0.04;
    minTarget = -3;
    maxTarget = 4;
    minStop = 1.5;
    maxStop = 4;
  } else if (strategy === "position") {
    targetMultiplier = 0.38;
    stopBase = 6;
    stopRiskFactor = 0.08;
    minTarget = -10;
    maxTarget = 20;
    minStop = 4;
    maxStop = 11;
  } else if (strategy === "longterm") {
    targetMultiplier = 0.58;
    stopBase = 8.5;
    stopRiskFactor = 0.05;
    minTarget = -12;
    maxTarget = 34;
    minStop = 7;
    maxStop = 16;
  }

  const targetPct = clamp((score - 50) * targetMultiplier - riskScore * 0.035, minTarget, maxTarget);
  const stopPct = clamp(stopBase + riskScore * stopRiskFactor, minStop, maxStop);
  const bearish = ["SELL", "STRONG_SELL"].includes(verdict) || targetPct < 0;

  return {
    targetPrice: Number((price * (1 + targetPct / 100)).toFixed(2)),
    stopLoss: Number((price * (1 + (bearish ? stopPct : -stopPct) / 100)).toFixed(2)),
    targetPct: Number(targetPct.toFixed(2)),
  };
}

function summarizeConfidence(sourceLevel, newsSummary, fundamentals, eventExposure, strictVerification) {
  let confidence = 42;
  const normalizedSource = String(sourceLevel || "");
  const fundamentalsSource = String(fundamentals.source || "");

  if (normalizedSource.startsWith("UPSTOX_LIVE")) confidence += 18;
  else if (normalizedSource === "YAHOO_DELAYED") confidence += 8;
  if (fundamentalsSource === "SCREENER_PUBLIC") confidence += 10;
  else if (fundamentalsSource === "MONEYCONTROL_PUBLIC") confidence += 8;
  else if (fundamentalsSource === "NSE_PUBLIC") confidence += 6;
  confidence += Math.min(newsSummary.verifiedCount * 6, 18);
  confidence += Math.min(newsSummary.officialCount * 4, 10);
  confidence += Math.min(newsSummary.highCredibilityCount * 3, 12);
  confidence += Math.min(newsSummary.realTimeCount * 2, 8);
  confidence += Math.round((newsSummary.freshnessScore || 0) * 8);
  if (eventExposure.drivers.length >= 2) confidence += 4;
  if (strictVerification && newsSummary.newsCount > 0 && newsSummary.verifiedCount === 0) confidence -= 10;
  if (newsSummary.evidenceGrade === "A") confidence += 6;
  if (newsSummary.evidenceGrade === "B") confidence += 3;
  if (newsSummary.evidenceGrade === "D" && newsSummary.newsCount > 0) confidence -= 6;

  return clamp(Number(confidence.toFixed(1)), 28, 95);
}

function buildCatalysts(stock, technical, fundamentals, newsSummary, macroScore, eventExposure, longTermView = null) {
  const catalysts = [];
  if ((technical.return20d || 0) > 4) catalysts.push(`20-day momentum is ${technical.return20d}%`);
  if ((technical.volumeSurge || 0) > 1.2) catalysts.push(`volume is ${technical.volumeSurge}x the recent average`);
  if ((fundamentals.roe || 0) >= 18) catalysts.push(`ROE is healthy at ${fundamentals.roe}%`);
  if ((fundamentals.profitGrowth3yr || 0) >= 15) catalysts.push(`3-year profit growth is ${fundamentals.profitGrowth3yr}%`);
  if (newsSummary.verifiedCount > 0) catalysts.push(`${newsSummary.verifiedCount} cross-verified headline(s) support ${stock.symbol}`);
  if (newsSummary.officialCount > 0) catalysts.push("official-source coverage is available for the current setup");
  if (macroScore >= 60) catalysts.push(`${stock.sector} is aligned with the current Indian macro regime`);
  if (eventExposure.pressure === "TAILWIND" && eventExposure.drivers[0]) {
    catalysts.push(`${formatTag(eventExposure.drivers[0].tags[0] || "macro")} is acting as a tailwind`);
  }
  if (longTermView?.score >= 70) {
    catalysts.push(longTermView.summary);
  }
  return uniqueStrings(catalysts, 6);
}

function buildRisks(technical, fundamentals, newsSummary, marketContext, eventExposure, longTermView = null) {
  const risks = [];
  if ((technical.drawdown || 0) > 15) risks.push(`drawdown remains elevated at ${technical.drawdown}%`);
  if ((technical.volatility || 0) > 3) risks.push(`daily volatility is high at ${technical.volatility}%`);
  if ((fundamentals.debtToEquity || 0) > 1.5) risks.push("balance-sheet leverage is stretched");
  if (fundamentals.promoterHolding && fundamentals.promoterHolding < 35) risks.push("promoter holding is on the lower side");
  if ((marketContext?.riskOnScore || 0) < -0.8) risks.push("macro regime is currently risk-off");
  if (newsSummary.newsCount > 0 && newsSummary.verifiedCount === 0) risks.push("recent headlines are not yet cross-verified");
  if (eventExposure.pressure === "HEADWIND" && eventExposure.drivers[0]) {
    risks.push(`${formatTag(eventExposure.drivers[0].tags[0] || "macro")} is creating a near-term headwind`);
  }
  if (longTermView?.concerns?.[0]) {
    risks.push(longTermView.concerns[0]);
  }
  return uniqueStrings(risks, 6);
}

function scoreLongTermPillars(row) {
  const { stock, technicalSnapshot: technical, fundamentals, scoreBreakdown, eventExposure, verification } = row;
  let businessQuality = 50;
  let growthDurability = 50;
  let balanceSheet = 50;
  let valuation = valuationView(stock, fundamentals).score;
  let marketLeadership = 50;

  if ((fundamentals.roe || 0) >= 20) businessQuality += 14;
  else if ((fundamentals.roe || 0) >= 15) businessQuality += 8;
  else if ((fundamentals.roe || 0) < 10 && fundamentals.roe !== null) businessQuality -= 10;

  if ((fundamentals.roce || 0) >= 18) businessQuality += 10;
  else if ((fundamentals.roce || 0) < 10 && fundamentals.roce !== null) businessQuality -= 6;

  if ((fundamentals.profitGrowth3yr || 0) >= 18) growthDurability += 14;
  else if ((fundamentals.profitGrowth3yr || 0) >= 10) growthDurability += 8;
  else if ((fundamentals.profitGrowth3yr || 0) < 0 && fundamentals.profitGrowth3yr !== null) growthDurability -= 12;

  if ((fundamentals.salesGrowth3yr || 0) >= 12) growthDurability += 10;
  else if ((fundamentals.salesGrowth3yr || 0) < 0 && fundamentals.salesGrowth3yr !== null) growthDurability -= 8;

  if ((fundamentals.debtToEquity || 0) <= 0.5 && fundamentals.debtToEquity !== null) balanceSheet += 16;
  else if ((fundamentals.debtToEquity || 0) > 1.5) balanceSheet -= 18;

  if ((fundamentals.promoterHolding || 0) >= 55) balanceSheet += 10;
  else if ((fundamentals.promoterHolding || 0) < 35 && fundamentals.promoterHolding !== null) balanceSheet -= 10;

  if ((technical.return60d || 0) > 12) marketLeadership += 12;
  else if ((technical.return60d || 0) > 5) marketLeadership += 6;
  else if ((technical.return60d || 0) < -5 && technical.return60d !== null) marketLeadership -= 10;

  if ((technical.nearHighRatio || 0) > 0.92) marketLeadership += 8;
  if ((technical.drawdown || 0) > 18) marketLeadership -= 10;
  if ((verification.verifiedHeadlineCount || 0) >= 2) marketLeadership += 6;
  if (eventExposure.pressure === "TAILWIND") marketLeadership += 6;
  if (scoreBreakdown.macro >= 58) marketLeadership += 5;

  const pillars = [
    {
      label: "Business Quality",
      value: clamp(Number(businessQuality.toFixed(1))),
      detail: `ROE ${fundamentals.roe ?? "N/A"}%, ROCE ${fundamentals.roce ?? "N/A"}%.`,
    },
    {
      label: "Growth Durability",
      value: clamp(Number(growthDurability.toFixed(1))),
      detail: `Sales growth ${fundamentals.salesGrowth3yr ?? "N/A"}%, profit growth ${fundamentals.profitGrowth3yr ?? "N/A"}%.`,
    },
    {
      label: "Balance Sheet",
      value: clamp(Number(balanceSheet.toFixed(1))),
      detail: `Debt/Equity ${fundamentals.debtToEquity ?? "N/A"}, promoter holding ${fundamentals.promoterHolding ?? "N/A"}%.`,
    },
    {
      label: "Valuation",
      value: clamp(Number(valuation.toFixed(1))),
      detail: valuationView(stock, fundamentals).detail,
    },
    {
      label: "Market Leadership",
      value: clamp(Number(marketLeadership.toFixed(1))),
      detail: `60-day return ${technical.return60d ?? "N/A"}%, event pressure ${eventExposure.pressure}.`,
    },
  ];

  const longTermScore = clamp(Number((
    pillars[0].value * 0.28
    + pillars[1].value * 0.24
    + pillars[2].value * 0.2
    + pillars[3].value * 0.16
    + pillars[4].value * 0.12
  ).toFixed(1)));

  return { pillars, longTermScore };
}

function buildLongTermView(row) {
  const { stock, technicalSnapshot: technical, fundamentals, verification, eventExposure } = row;
  const { pillars, longTermScore } = scoreLongTermPillars(row);
  const valuation = valuationView(stock, fundamentals);
  const opportunities = [];
  const concerns = [];

  if ((fundamentals.roe || 0) >= 18) opportunities.push(`Return ratios are strong, with ROE at ${fundamentals.roe}%.`);
  if ((fundamentals.profitGrowth3yr || 0) >= 15) opportunities.push(`Profit has compounded at ${fundamentals.profitGrowth3yr}% over 3 years.`);
  if ((fundamentals.salesGrowth3yr || 0) >= 12) opportunities.push(`Revenue growth remains healthy at ${fundamentals.salesGrowth3yr}% over 3 years.`);
  if ((fundamentals.debtToEquity || 0) <= 0.5 && fundamentals.debtToEquity !== null) opportunities.push("Balance-sheet leverage is conservative for compounding capital.");
  if (valuation.label === "ATTRACTIVE" || valuation.label === "FAIR") opportunities.push(valuation.detail);
  if ((verification.verifiedHeadlineCount || 0) >= 2) opportunities.push("Recent news support is cross-verified across multiple sources.");
  if (eventExposure.pressure === "TAILWIND") opportunities.push("Macro and event flow are supportive rather than hostile right now.");

  if ((fundamentals.debtToEquity || 0) > 1.2) concerns.push(`Debt/Equity at ${fundamentals.debtToEquity} adds balance-sheet risk.`);
  if ((fundamentals.promoterHolding || 0) < 35 && fundamentals.promoterHolding !== null) concerns.push(`Promoter holding at ${fundamentals.promoterHolding}% is weaker than ideal.`);
  if ((fundamentals.profitGrowth3yr || 0) < 5 && fundamentals.profitGrowth3yr !== null) concerns.push("Profit compounding is not yet strong enough for a premium long-term case.");
  if ((technical.drawdown || 0) > 18) concerns.push(`The stock is still ${technical.drawdown}% below its major peak.`);
  if (valuation.label === "STRETCHED") concerns.push(valuation.detail);
  if (eventExposure.pressure === "HEADWIND") concerns.push("Macro and geopolitical pressure are still a headwind for patient investors.");
  if (verification.headlineCount > 0 && verification.verifiedHeadlineCount === 0) concerns.push("The latest news flow is active, but not cross-verified yet.");

  const stance = longTermScore >= 76
    ? "ACCUMULATE"
    : longTermScore >= 64
      ? "BUILD_ON_DIPS"
      : longTermScore >= 50
        ? "WATCHLIST"
        : "AVOID_FOR_NOW";

  const bestOpportunity = opportunities[0] || `${stock.symbol} has a balanced long-term profile but needs more proof points.`;
  const biggestConcern = concerns[0] || "there is no dominant structural red flag in the current public data.";

  return {
    score: longTermScore,
    stance,
    horizon: "12-24 months",
    summary: `${stock.symbol} looks like a ${stance.replaceAll("_", " ").toLowerCase()} long-term candidate because ${bestOpportunity.toLowerCase()}, while the main structural caution is that ${biggestConcern.toLowerCase()}.`,
    pillars,
    opportunities: uniqueStrings(opportunities, 5),
    concerns: uniqueStrings(concerns, 5),
  };
}

function pushReason(list, condition, text) {
  if (condition && text) {
    list.push(text);
  }
}

function buildBuyReasons(row) {
  const reasons = [];
  const { stock, technicalSnapshot: technical, fundamentals, verification, eventExposure, longTermView, peerComparison } = row;
  const valuation = valuationView(stock, fundamentals);
  const candlestick = row.candlestickAnalysis;

  pushReason(reasons, (row.adjustedScore || 0) >= 64, `${stock.symbol} already clears the internal buy threshold with an adjusted score of ${row.adjustedScore}.`);
  pushReason(reasons, (technical.return20d || 0) > 4, `Short-term trend is constructive, with a 20-day return of ${technical.return20d}%.`);
  pushReason(reasons, (technical.return60d || 0) > 8, `Medium-term price action remains strong, with a 60-day return of ${technical.return60d}%.`);
  pushReason(reasons, (fundamentals.roe || 0) >= 18, `Capital efficiency is strong because ROE is ${fundamentals.roe}%.`);
  pushReason(reasons, (fundamentals.profitGrowth3yr || 0) >= 15, `Earnings quality is supported by 3-year profit growth of ${fundamentals.profitGrowth3yr}%.`);
  pushReason(reasons, valuation.label === "ATTRACTIVE" || valuation.label === "FAIR", valuation.detail);
  pushReason(reasons, (verification.verifiedHeadlineCount || 0) >= 2, `The positive setup is backed by ${verification.verifiedHeadlineCount} cross-verified headline(s).`);
  pushReason(reasons, (verification.realTimeHeadlineCount || 0) >= 2, `${verification.realTimeHeadlineCount} real-time company headline(s) are in scope.`);
  pushReason(reasons, verification.evidenceGrade === "A" || verification.evidenceGrade === "B", `Evidence quality is ${verification.evidenceGrade}, which supports a more credible read on the setup.`);
  pushReason(reasons, eventExposure.pressure === "TAILWIND", "Macro and geopolitical pressure currently look more supportive than harmful.");
  pushReason(reasons, (longTermView?.score || 0) >= 70, `Long-term investability is solid, with a structural score of ${longTermView.score}.`);
  pushReason(reasons, peerComparison?.advantages?.[0], peerComparison?.advantages?.[0]);
  pushReason(reasons, candlestick?.validity === "Valid" && candlestick.direction === "bullish", `${candlestick.detectedPattern} is a ${candlestick.strength.toLowerCase()} bullish candle signal in ${candlestick.context.location.toLowerCase()} conditions.`);

  if (reasons.length === 0) {
    reasons.push(`${stock.symbol} has a balanced setup, but a fresh upside trigger is still needed.`);
  }

  return uniqueStrings(reasons, 6);
}

function buildSellReasons(row) {
  const reasons = [];
  const { stock, technicalSnapshot: technical, fundamentals, verification, eventExposure, longTermView, peerComparison } = row;
  const valuation = valuationView(stock, fundamentals);
  const candlestick = row.candlestickAnalysis;

  pushReason(reasons, (row.scoreBreakdown?.risk || 0) >= 58, `Risk remains elevated at ${row.scoreBreakdown.risk}, which limits conviction.`);
  pushReason(reasons, (technical.return20d || 0) < -5, `Short-term price action is weak, with a 20-day return of ${technical.return20d}%.`);
  pushReason(reasons, (technical.drawdown || 0) > 18, `The stock is still ${technical.drawdown}% below its major peak.`);
  pushReason(reasons, (fundamentals.debtToEquity || 0) > 1.2, `Leverage is notable because Debt/Equity stands at ${fundamentals.debtToEquity}.`);
  pushReason(reasons, (fundamentals.promoterHolding || 0) < 35 && fundamentals.promoterHolding !== null, `Promoter holding at ${fundamentals.promoterHolding}% is not ideal.`);
  pushReason(reasons, valuation.label === "STRETCHED" || valuation.label === "FULL", valuation.detail);
  pushReason(reasons, verification.headlineCount > 0 && verification.verifiedHeadlineCount === 0, "News flow exists, but it is not cross-verified yet.");
  pushReason(reasons, verification.evidenceGrade === "D" && verification.headlineCount > 0, "The current news evidence is too weak to materially strengthen the call.");
  pushReason(reasons, verification.headlineCount > 0 && verification.realTimeHeadlineCount === 0, "Recent company-specific coverage is stale rather than real-time.");
  pushReason(reasons, eventExposure.pressure === "HEADWIND", "Macro and geopolitical conditions are acting as a headwind right now.");
  pushReason(reasons, ["WATCHLIST", "AVOID_FOR_NOW"].includes(longTermView?.stance), `The long-term stance is only ${longTermView.stance.replaceAll("_", " ")} at this stage.`);
  pushReason(reasons, peerComparison?.disadvantages?.[0], peerComparison?.disadvantages?.[0]);
  pushReason(reasons, candlestick?.validity === "Valid" && candlestick.direction === "bearish", `${candlestick.detectedPattern} is a ${candlestick.strength.toLowerCase()} bearish candle signal in ${candlestick.context.location.toLowerCase()} conditions.`);

  if (reasons.length === 0) {
    reasons.push(`${stock.symbol} does not have a dominant sell trigger right now, but upside is not yet overwhelming either.`);
  }

  return uniqueStrings(reasons, 6);
}

function buildMonitorPoints(row) {
  const points = [];
  const { stock, fundamentals, technicalSnapshot: technical, verification, eventExposure, peerComparison } = row;
  const candlestick = row.candlestickAnalysis;

  if (verification.headlineCount > 0 && verification.verifiedHeadlineCount === 0) {
    points.push("Wait for the latest headlines to be confirmed by multiple sources.");
  }
  if (verification.headlineCount > 0 && verification.realTimeHeadlineCount === 0) {
    points.push("Look for a fresher company-news pulse before treating the narrative as current.");
  }
  if (verification.evidenceGrade === "D" && verification.headlineCount > 0) {
    points.push("Treat the active news flow as weak evidence until higher-credibility sources confirm it.");
  }
  if ((technical.volumeSurge || 0) < 1) {
    points.push("Watch for stronger participation and volume confirmation.");
  }
  if ((fundamentals.profitGrowth3yr || 0) < 10 && fundamentals.profitGrowth3yr !== null) {
    points.push("Track whether earnings compounding accelerates in the next results cycle.");
  }
  if ((fundamentals.debtToEquity || 0) > 1) {
    points.push("Keep an eye on balance-sheet deleveraging progress.");
  }
  if (eventExposure.pressure !== "TAILWIND") {
    points.push("Monitor macro and geopolitical pressure before sizing aggressively.");
  }
  if (peerComparison?.position === "SECTOR_LAGGARD") {
    points.push("Relative strength versus sector peers needs to improve.");
  }
  if (candlestick?.validity === "Ignore" && candlestick?.detectedPattern && !candlestick.detectedPattern.startsWith("No ")) {
    points.push(`Do not overreact to ${candlestick.detectedPattern}; the candle lacks enough confluence to matter yet.`);
  }
  if (candlestick?.trap?.detected) {
    points.push(candlestick.trap.summary);
  }
  if (points.length === 0) {
    points.push(`The key monitor for ${stock.symbol} is whether the current trend stays supported by verified news and earnings follow-through.`);
  }

  return uniqueStrings(points, 5);
}

function buildCandlestickAnalysis(row) {
  const raw = row.technicalSnapshot?.candlestick || {};
  const context = raw.context || {};
  const bullishVerdict = ["BUY", "STRONG_BUY"].includes(row.verdict);
  const bearishVerdict = ["SELL", "STRONG_SELL"].includes(row.verdict);
  const patternTimeframe = raw.analysisTimeframes?.pattern || raw.timeframe || "daily";
  const trendTimeframe = raw.analysisTimeframes?.trend || context.trendTimeframe || "weekly";

  const systemAligned = raw.direction === "neutral"
    ? raw.validity === "Valid" && context.location !== "NOISE_ZONE"
    : raw.direction === "bullish"
      ? (
          bullishVerdict
          || (context.location === "SUPPORT_ZONE" && Number(row.scoreBreakdown?.technical || 0) >= 45)
          || (context.location === "BREAKOUT_ZONE" && row.technicalSnapshot?.trendBias === "BULLISH")
        )
      : (
          bearishVerdict
          || (context.location === "RESISTANCE_ZONE" && Number(row.scoreBreakdown?.technical || 0) <= 55)
          || (context.location === "BREAKDOWN_ZONE" && row.technicalSnapshot?.trendBias === "BEARISH")
        );

  const validity = raw.validity === "Valid" && systemAligned ? "Valid" : "Ignore";
  const strength = validity === "Valid" ? (raw.strength || "Moderate") : "Weak";
  const signalQuality = validity === "Valid"
    ? (raw.signalQuality || (strength === "Strong" ? "High" : strength))
    : "Weak";
  const baseSummary = raw.summary || "Candlestick context is not available yet.";
  const timeframeText = `Pattern chart: ${formatTag(patternTimeframe)}. Trend filter: ${formatTag(trendTimeframe)}.`;

  return {
    timeframe: raw.timeframe || "daily",
    analysisTimeframes: {
      pattern: patternTimeframe,
      trend: trendTimeframe,
    },
    detectedPattern: raw.detectedPattern || "No high-quality pattern",
    direction: raw.direction || "neutral",
    strength,
    signalQuality,
    qualityScore: raw.qualityScore ?? null,
    validity,
    kind: formatTag(raw.kind || "unknown"),
    systemAligned,
    context: {
      trend: formatTag(context.trend || "UNKNOWN"),
      location: formatTag(context.location || "UNKNOWN"),
      volumeConfirmation: context.volumeConfirmation || "Unavailable",
      marketStructure: formatTag(context.marketStructure || "UNKNOWN"),
      higherTimeframeTrend: formatTag(context.higherTimeframeTrend || "NEUTRAL"),
      regime: formatTag(context.regime || "TRANSITIONAL"),
    },
    trap: raw.trap || null,
    notes: (raw.notes || []).slice(0, 4),
    trigger: raw.trigger || "Wait for stronger candle confirmation before using it as a trigger.",
    candidates: raw.candidates || [],
    summary: validity === "Valid"
      ? `${baseSummary} ${timeframeText} Superbrain is treating it as a valid ${raw.direction} candlestick signal because it aligns with ${formatTag(context.trend || "unknown")} conditions near ${formatTag(context.location || "unknown")}.`
      : `${baseSummary} ${timeframeText} Superbrain is not using it as a standalone trade trigger because confluence is incomplete or the pattern is sitting in a weaker context.`,
    trapText: raw.trap?.detected ? `${raw.trap.label}: ${raw.trap.summary}` : "No active trap signature is standing out.",
  };
}

function deriveCandlestickStatus(row) {
  const raw = row?.technicalSnapshot?.candlestick || {};
  const summary = String(raw.summary || "");
  const insufficientHistory = /not enough candle history/i.test(summary);
  const hasEvaluatedContext = Boolean(raw.detectedPattern)
    && String(raw.context?.trend || "").toUpperCase() !== "UNKNOWN"
    && String(raw.context?.location || "").toUpperCase() !== "UNKNOWN";

  return !insufficientHistory && hasEvaluatedContext ? "ACTIVE" : "INACTIVE";
}

function buildNarrative(row) {
  const bestCatalyst = row.buyReasons?.[0] || row.catalysts?.[0] || `${row.sector} setup is balanced`;
  const biggestRisk = row.sellReasons?.[0] || row.risks?.[0] || "risk is manageable versus current evidence";
  const direction = ["STRONG_BUY", "BUY"].includes(row.verdict)
    ? "bullish"
    : ["SELL", "STRONG_SELL"].includes(row.verdict)
      ? "bearish"
      : "neutral";
  const evidenceText = row.verification?.evidenceGrade
    ? ` Evidence grade ${row.verification.evidenceGrade} with ${row.verification.realTimeHeadlineCount || 0} real-time company headline(s).`
    : "";

  return `${row.symbol} is a ${row.verdict.replaceAll("_", " ")} ${direction} call for ${row.strategy} traders because ${bestCatalyst.toLowerCase()}, while the main caution is that ${biggestRisk.toLowerCase()}.${evidenceText}`.trim();
}

function buildRecommendation(row) {
  const conviction = row.confidence >= 80 ? "High" : row.confidence >= 65 ? "Medium" : "Measured";
  const stance = ["STRONG_BUY", "BUY"].includes(row.verdict)
    ? "Bullish"
    : ["SELL", "STRONG_SELL"].includes(row.verdict)
      ? "Bearish"
      : "Balanced";
  const strongestFactor = row.decisionEngine?.intelligenceEnhancements?.signalDiscipline?.strongestFactors?.[0];
  const executionText = row.decisionEngine?.tradeDecision?.action === "NO_TRADE"
    ? ` Execution status: NO TRADE.${row.decisionEngine?.tradeDecision?.unmetConditions?.[0] ? ` Main filter: ${row.decisionEngine.tradeDecision.unmetConditions[0]}` : " Wait for stronger confluence and cleaner reward-to-risk."}`
    : row.decisionEngine?.tradeDecision?.status === "READY FOR EXECUTION"
      ? ` Execution status: READY FOR EXECUTION with ${row.decisionEngine.tradeDecision.riskReward}:1 reward-to-risk.`
      : "";

  return {
    action: row.verdict,
    stance,
    conviction,
    summary: `${row.thesis || buildNarrative(row)}${strongestFactor ? ` Strongest live factor: ${strongestFactor}.` : ""}${executionText}`.trim(),
    targetPrice: row.targets.targetPrice,
    stopLoss: row.targets.stopLoss,
    targetPct: row.targets.targetPct,
  };
}

function buildDataCoverage(row) {
  const available = [];
  const missingCritical = [];
  const missingSupporting = [];
  const quoteSource = String(row.quote?.source || "");
  const technical = row.technicalSnapshot || {};
  const fundamentals = row.fundamentals || {};
  const newsSummary = row.newsSummary || {};
  const benchmarks = row.marketContext?.benchmarks || [];

  if (row.quote?.price) available.push("Current market quote");
  else missingCritical.push("Current market quote is unavailable.");

  if (technical.return20d !== null && technical.return60d !== null) available.push("Multi-timeframe price structure");
  else missingCritical.push("Multi-timeframe price structure is incomplete.");

  if (technical.higherTimeframe?.available) available.push("Higher-timeframe trend confirmation");
  else missingSupporting.push("Higher-timeframe confirmation is unavailable.");

  if (technical.rsi14 !== null && technical.macd?.histogram !== null) available.push("RSI and MACD momentum");
  else missingSupporting.push("RSI and MACD momentum depth is incomplete.");

  if (technical.vwap20 !== null) available.push("Rolling VWAP context");
  else missingSupporting.push("VWAP context is unavailable.");

  if (technical.support20 !== null && technical.resistance20 !== null) available.push("Key support and resistance levels");
  else missingSupporting.push("Key support and resistance levels are incomplete.");

  if (technical.regime?.label) available.push("Regime and volatility classification");
  else missingSupporting.push("Regime classification is unavailable.");

  if (deriveCandlestickStatus(row) === "ACTIVE") available.push("Candlestick context");
  else missingSupporting.push("Candlestick context is unavailable.");

  if (fundamentals.source && fundamentals.source !== "UNAVAILABLE") available.push("Fundamental ratios");
  else missingCritical.push("Fundamental ratios are unavailable.");

  if (Number.isFinite(Number(row.marketContext?.fiiDii?.fiiNetBuy))) available.push("FII and DII flow");
  else missingSupporting.push("FII and DII flow is unavailable.");

  if (benchmarks.length >= 4) available.push("Global cross-asset context");
  else missingSupporting.push("Global market, commodity, and currency context is incomplete.");

  if (Number(newsSummary.newsCount || 0) > 0) available.push("Company-news narrative");
  else missingSupporting.push("Fresh company-specific news is limited.");

  if (Number(newsSummary.verifiedCount || 0) > 0 || Number(newsSummary.officialCount || 0) > 0) {
    available.push("Verified or official headline confirmation");
  } else if (Number(newsSummary.newsCount || 0) > 0) {
    missingSupporting.push("Cross-verified or official headline confirmation is missing.");
  }

  missingCritical.push("Options OI, PCR, max pain, and strike concentration are not integrated yet.");

  if (row.strategy === "intraday") {
    missingCritical.push("True intraday VWAP and tape-based order flow are not integrated yet.");
  }

  const confidencePenalty = Number((
    missingCritical.length * 4
    + Math.min(4, missingSupporting.length) * 1.5
    + (quoteSource.startsWith("UPSTOX_LIVE") ? 0 : row.strategy === "intraday" ? 4 : 1)
  ).toFixed(1));

  return {
    available,
    missingCritical,
    missingSupporting,
    confidencePenalty,
    coverageScore: clamp(Number((100 - confidencePenalty * 4.4).toFixed(1)), 35, 92),
  };
}

function directionalBiasFromVerdict(verdict = "") {
  if (["BUY", "STRONG_BUY"].includes(verdict)) return "bullish";
  if (["SELL", "STRONG_SELL"].includes(verdict)) return "bearish";
  return "neutral";
}

function percentDistance(a, b) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || Number(a) === 0) {
    return null;
  }
  return Number((Math.abs(Number(a) - Number(b)) / Math.max(Math.abs(Number(a)), 1) * 100).toFixed(2));
}

function buildMultiTimeframeConfirmation(row) {
  const higher = row.technicalSnapshot?.higherTimeframe || {};
  const lowerTrend = String(row.technicalSnapshot?.trendBias || "NEUTRAL").toUpperCase();
  const directionalBias = directionalBiasFromVerdict(row.verdict);

  if (!higher.available) {
    return {
      available: false,
      alignment: "UNKNOWN",
      higherTimeframeTrend: "UNKNOWN",
      lowerTimeframeTrend: lowerTrend,
      supportsDirectionalBias: directionalBias === "neutral",
      executionReady: false,
      note: "Higher-timeframe confirmation is unavailable.",
    };
  }

  const higherTrend = String(higher.trendBias || "NEUTRAL").toUpperCase();
  const alignment = higherTrend === lowerTrend
    ? "ALIGNED"
    : higherTrend === "NEUTRAL" || lowerTrend === "NEUTRAL"
      ? "PARTIAL"
      : "CONFLICT";
  const supportsDirectionalBias = directionalBias === "neutral"
    ? alignment !== "CONFLICT"
    : higherTrend === "NEUTRAL" || higherTrend.toLowerCase() === directionalBias;

  return {
    available: true,
    alignment,
    higherTimeframeTrend: higherTrend,
    lowerTimeframeTrend: lowerTrend,
    supportsDirectionalBias,
    executionReady: alignment !== "CONFLICT" && supportsDirectionalBias,
    note: `Weekly trend is ${higherTrend.toLowerCase()} while the entry timeframe is ${lowerTrend.toLowerCase()}.`,
  };
}

function buildMarketRegimeValidation(row) {
  const technicalRegime = row.technicalSnapshot?.regime || {};
  const directionalBias = directionalBiasFromVerdict(row.verdict);
  const riskOnScore = Number(row.marketContext?.riskOnScore || 0);
  const trendState = String(technicalRegime.trendState || "RANGE").toUpperCase();
  const label = String(technicalRegime.label || "TRANSITIONAL").toUpperCase();

  let tradeEnvironment = "NEUTRAL";
  if (label === "HIGH_VOLATILITY") {
    tradeEnvironment = "UNFAVORABLE";
  } else if (directionalBias === "bullish") {
    tradeEnvironment = trendState === "UPTREND" && riskOnScore >= -0.3
      ? "FAVORABLE"
      : label === "SIDEWAYS"
        ? "SELECTIVE"
        : trendState === "DOWNTREND" || riskOnScore <= -0.8
          ? "UNFAVORABLE"
          : "NEUTRAL";
  } else if (directionalBias === "bearish") {
    tradeEnvironment = trendState === "DOWNTREND" || riskOnScore <= -0.4
      ? "FAVORABLE"
      : label === "SIDEWAYS"
        ? "SELECTIVE"
        : trendState === "UPTREND" && riskOnScore >= 0.8
          ? "UNFAVORABLE"
          : "NEUTRAL";
  } else {
    tradeEnvironment = label === "HIGH_VOLATILITY" ? "SELECTIVE" : "NEUTRAL";
  }

  return {
    label,
    trendState,
    volatilityState: String(technicalRegime.volatilityState || "NORMAL").toUpperCase(),
    rangeWidth20Pct: technicalRegime.rangeWidth20Pct ?? null,
    tradeEnvironment,
    supportsDirectionalBias: tradeEnvironment !== "UNFAVORABLE",
    note: label === "TRENDING"
      ? `The stock is in a trending regime with ${trendState.toLowerCase()} conditions.`
      : label === "SIDEWAYS"
        ? "The stock is rotating in a sideways regime, so only level-based entries deserve attention."
        : label === "HIGH_VOLATILITY"
          ? "Volatility is elevated, so fresh entries should stay selective and smaller."
          : "The regime is transitional, so follow-through needs extra confirmation.",
  };
}

function buildLiquidityLevelAwareness(row) {
  const price = Number(row.quote?.price || 0);
  const technical = row.technicalSnapshot || {};
  const directionalBias = directionalBiasFromVerdict(row.verdict);
  const support = Number.isFinite(Number(technical.support20)) ? Number(technical.support20) : technical.support60;
  const resistance = Number.isFinite(Number(technical.resistance20)) ? Number(technical.resistance20) : technical.resistance60;
  const rawLocation = String(row.technicalSnapshot?.candlestick?.context?.location || "UNKNOWN").toUpperCase();
  const distanceToSupportPct = percentDistance(price, support);
  const distanceToResistancePct = percentDistance(price, resistance);
  const nearSupport = distanceToSupportPct !== null && distanceToSupportPct <= 2.6;
  const nearResistance = distanceToResistancePct !== null && distanceToResistancePct <= 2.6;

  let quality = "MEDIUM";
  let preferredZone = "Wait for a cleaner reaction near support, resistance, or a confirmed breakout zone.";

  if (directionalBias === "bullish") {
    if (rawLocation === "SUPPORT_ZONE" || nearSupport || rawLocation === "BREAKOUT_ZONE") {
      quality = "HIGH";
      preferredZone = rawLocation === "BREAKOUT_ZONE"
        ? "Bullish setups are best after breakout confirmation or a clean breakout retest."
        : "Bullish setups are strongest on support holds or pullbacks into key demand zones.";
    } else if (rawLocation === "RESISTANCE_ZONE" || nearResistance) {
      quality = "LOW";
      preferredZone = "Avoid chasing bullish entries directly into resistance without a confirmed breakout.";
    }
  } else if (directionalBias === "bearish") {
    if (rawLocation === "RESISTANCE_ZONE" || nearResistance || rawLocation === "BREAKDOWN_ZONE") {
      quality = "HIGH";
      preferredZone = rawLocation === "BREAKDOWN_ZONE"
        ? "Bearish setups are strongest after confirmed breakdowns or failed breakdown retests."
        : "Bearish setups improve on resistance rejection or supply-zone failure.";
    } else if (rawLocation === "SUPPORT_ZONE" || nearSupport) {
      quality = "LOW";
      preferredZone = "Avoid initiating bearish positions directly into support without breakdown confirmation.";
    }
  }

  return {
    location: rawLocation,
    nearestSupport: support ?? null,
    nearestResistance: resistance ?? null,
    distanceToSupportPct,
    distanceToResistancePct,
    nearSupport,
    nearResistance,
    quality,
    executionReady: directionalBias === "neutral" ? true : quality !== "LOW",
    preferredZone,
  };
}

function buildEntryTimingAssessment(row, multiTimeframe, marketRegime, liquidityLevels) {
  const technical = row.technicalSnapshot || {};
  const candlestick = row.candlestickAnalysis || {};
  const directionalBias = directionalBiasFromVerdict(row.verdict);
  const bullishExtended = directionalBias === "bullish"
    && (
      Number(technical.rsi14 || 0) >= 70
      || Number(technical.return20d || 0) >= 12
      || Number(liquidityLevels.distanceToSupportPct || 0) >= 6
    );
  const bearishExtended = directionalBias === "bearish"
    && (
      Number(technical.rsi14 || 100) <= 30
      || Number(technical.return20d || 0) <= -12
      || Number(liquidityLevels.distanceToResistancePct || 0) >= 6
    );
  const breakoutConfirmed = directionalBias === "bullish"
    && liquidityLevels.location === "BREAKOUT_ZONE"
    && Number(technical.volumeSurge || 0) >= 1.15
    && candlestick.validity === "Valid";
  const breakdownConfirmed = directionalBias === "bearish"
    && liquidityLevels.location === "BREAKDOWN_ZONE"
    && Number(technical.volumeSurge || 0) >= 1.15
    && candlestick.validity === "Valid";
  const pullbackReady = directionalBias === "bullish"
    ? liquidityLevels.nearSupport
    : directionalBias === "bearish"
      ? liquidityLevels.nearResistance
      : false;

  let status = "WAIT";
  let preferredEntry = "Wait for a cleaner pullback or confirmation candle before acting.";

  if (directionalBias === "neutral") {
    status = "NEUTRAL";
    preferredEntry = "No immediate timing edge is present.";
  } else if (bullishExtended || bearishExtended) {
    status = "EXTENDED";
    preferredEntry = directionalBias === "bullish"
      ? "Avoid chasing strength mid-move. Prefer a pullback into support or a breakout retest."
      : "Avoid shorting an already stretched move. Prefer a bounce into resistance or a breakdown retest.";
  } else if (pullbackReady) {
    status = "OPTIMAL";
    preferredEntry = directionalBias === "bullish"
      ? "Pullback entry is favorable near support with trend confirmation."
      : "Bounce entry is favorable near resistance with trend confirmation.";
  } else if (breakoutConfirmed || breakdownConfirmed) {
    status = "OPTIMAL";
    preferredEntry = directionalBias === "bullish"
      ? "Breakout confirmation is in place, so momentum entry quality is acceptable."
      : "Breakdown confirmation is in place, so downside continuation entry quality is acceptable.";
  } else if (marketRegime.label === "SIDEWAYS") {
    status = "WAIT";
    preferredEntry = "Sideways conditions need a level-based trigger rather than a middle-of-range entry.";
  } else if (multiTimeframe.executionReady && marketRegime.tradeEnvironment === "FAVORABLE") {
    status = "EARLY";
    preferredEntry = "Trend alignment is constructive, but a clearer entry candle would improve timing.";
  }

  return {
    status,
    preferredEntry,
    executionReady: status === "OPTIMAL",
    chaseRisk: status === "EXTENDED" ? "HIGH" : status === "EARLY" ? "MEDIUM" : "LOW",
  };
}

function buildSignalDiscipline(row, signalPrioritization) {
  const high = (signalPrioritization?.high || [])
    .slice()
    .sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3);
  const low = signalPrioritization?.low || [];
  const directionalHigh = uniqueStrings(high.map((item) => item.direction).filter((item) => item && item !== "neutral"), 3);
  const directionalAgreement = directionalHigh.length <= 1 ? "CLEAR" : "MIXED";

  return {
    strongestFactors: high.map((item) => item.title),
    ignoredSignals: low.map((item) => item.title),
    highImpactCount: high.length,
    directionalAgreement,
    primaryDirection: directionalHigh[0] || "neutral",
    executionReady: high.length >= 2 && directionalAgreement !== "MIXED",
  };
}

function buildEnhancementLayer(row, signalPrioritization) {
  const multiTimeframe = buildMultiTimeframeConfirmation(row);
  const marketRegime = buildMarketRegimeValidation(row);
  const liquidityLevels = buildLiquidityLevelAwareness(row);
  const entryTiming = buildEntryTimingAssessment(row, multiTimeframe, marketRegime, liquidityLevels);
  const signalDiscipline = buildSignalDiscipline(row, signalPrioritization);
  const directionalBias = directionalBiasFromVerdict(row.verdict);
  const checks = [
    multiTimeframe.executionReady,
    marketRegime.supportsDirectionalBias,
    liquidityLevels.executionReady,
    entryTiming.executionReady,
    signalDiscipline.executionReady,
  ];

  return {
    directionalBias,
    multiTimeframe,
    marketRegime,
    liquidityLevels,
    entryTiming,
    signalDiscipline,
    confluence: {
      passedChecks: checks.filter(Boolean).length,
      totalChecks: checks.length,
      score: Number(((checks.filter(Boolean).length / checks.length) * 100).toFixed(1)),
    },
  };
}

function severityRank(value = "LOW") {
  if (value === "HIGH") return 3;
  if (value === "MEDIUM") return 2;
  return 1;
}

function buildConflictSignals(row, dataCoverage, enhancementLayer) {
  const conflicts = [];
  const technical = row.technicalSnapshot || {};
  const technicalScore = Number(row.scoreBreakdown?.technical || 50);
  const fundamentalScore = Number(row.scoreBreakdown?.fundamentals || 50);
  const macroScore = Number(row.scoreBreakdown?.macro || 50);
  const evidenceGrade = row.verification?.evidenceGrade || "D";
  const headlineCount = Number(row.verification?.headlineCount || 0);
  const candlestick = row.candlestickAnalysis;
  const directionalBias = directionalBiasFromVerdict(row.verdict);

  if (technicalScore >= 60 && macroScore <= 45) {
    conflicts.push({
      severity: "HIGH",
      title: "Trend is positive but market regime is risk-off",
      detail: "Price structure is constructive while the broader macro backdrop remains hostile.",
    });
  }

  if (technicalScore <= 45 && fundamentalScore >= 65) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Weak tape versus solid fundamentals",
      detail: "The business quality looks better than the current price structure.",
    });
  }

  if (["BUY", "STRONG_BUY"].includes(row.verdict) && evidenceGrade === "D" && headlineCount > 0) {
    conflicts.push({
      severity: "HIGH",
      title: "Bullish call is leaning on weak headline evidence",
      detail: "The setup has active news flow, but the credibility grade is still too weak for aggressive conviction.",
    });
  }

  if (["SELL", "STRONG_SELL"].includes(row.verdict) && Number(row.longTermView?.score || 0) >= 70) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Near-term weakness versus strong long-term quality",
      detail: "The short-term tape is weak, but structural quality remains better than the immediate price action suggests.",
    });
  }

  if (technical.rsi14 !== null && technical.rsi14 >= 72 && ["BUY", "STRONG_BUY"].includes(row.verdict)) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Momentum is strong but overbought",
      detail: `RSI is ${technical.rsi14}, which raises chase risk even if the trend remains constructive.`,
    });
  }

  if (technical.rsi14 !== null && technical.rsi14 <= 30 && ["SELL", "STRONG_SELL"].includes(row.verdict)) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Momentum is weak but already stretched",
      detail: `RSI is ${technical.rsi14}, so the downside may already be crowded in the near term.`,
    });
  }

  if (row.strategy === "intraday" && !String(row.quote?.source || "").startsWith("UPSTOX_LIVE")) {
    conflicts.push({
      severity: "HIGH",
      title: "Intraday strategy without live quote support",
      detail: "An intraday decision should not rely on delayed prices.",
    });
  }

  if (candlestick?.validity === "Valid" && candlestick.direction === "bullish" && ["SELL", "STRONG_SELL"].includes(row.verdict)) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Bearish verdict against a valid bullish candle pattern",
      detail: `${candlestick.detectedPattern} is constructive, so the downside case needs stronger follow-through to stay credible.`,
    });
  }

  if (candlestick?.validity === "Valid" && candlestick.direction === "bearish" && ["BUY", "STRONG_BUY"].includes(row.verdict)) {
    conflicts.push({
      severity: "MEDIUM",
      title: "Bullish verdict against a valid bearish candle pattern",
      detail: `${candlestick.detectedPattern} is warning of exhaustion, so upside conviction should stay measured.`,
    });
  }

  if (enhancementLayer?.multiTimeframe?.alignment === "CONFLICT") {
    conflicts.push({
      severity: "HIGH",
      title: "Lower-timeframe setup conflicts with the higher timeframe",
      detail: enhancementLayer.multiTimeframe.note,
    });
  }

  if (enhancementLayer?.marketRegime?.tradeEnvironment === "UNFAVORABLE" && directionalBias !== "neutral") {
    conflicts.push({
      severity: "HIGH",
      title: "Trade direction is fighting the active regime",
      detail: enhancementLayer.marketRegime.note,
    });
  }

  if (enhancementLayer?.entryTiming?.status === "EXTENDED") {
    conflicts.push({
      severity: "MEDIUM",
      title: "Entry timing is stretched",
      detail: enhancementLayer.entryTiming.preferredEntry,
    });
  }

  if (enhancementLayer?.liquidityLevels?.quality === "LOW" && directionalBias !== "neutral") {
    conflicts.push({
      severity: "MEDIUM",
      title: "Current location is poor versus key levels",
      detail: enhancementLayer.liquidityLevels.preferredZone,
    });
  }

  if (enhancementLayer?.signalDiscipline?.directionalAgreement === "MIXED" && directionalBias !== "neutral") {
    conflicts.push({
      severity: "MEDIUM",
      title: "High-impact signals disagree with each other",
      detail: "The strongest drivers are pointing in different directions, so trade conviction should stay measured.",
    });
  }

  if (dataCoverage.missingCritical.length >= 3) {
    conflicts.push({
      severity: "HIGH",
      title: "Critical data coverage is incomplete",
      detail: "Too many decision inputs are missing for institutional-grade execution confidence.",
    });
  }

  const deduped = [];
  for (const item of conflicts) {
    if (!deduped.some((entry) => entry.title === item.title)) {
      deduped.push(item);
    }
  }

  return deduped.sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function impactLevelFromMagnitude(magnitude = 0) {
  if (magnitude >= 18) return "HIGH IMPACT";
  if (magnitude >= 9) return "MEDIUM";
  return "LOW";
}

function buildDriverCandidates(row) {
  const technical = row.technicalSnapshot || {};
  const quote = row.quote || {};
  const fundamentals = row.fundamentals || {};
  const newsSummary = row.newsSummary || {};
  const topEvent = row.eventExposure?.drivers?.[0];
  const benchmarks = row.marketContext?.benchmarks || [];
  const nifty = benchmarks.find((item) => item.label === "Nifty 50");
  const sensex = benchmarks.find((item) => item.label === "Sensex");
  const usdinr = benchmarks.find((item) => item.label === "USDINR");
  const fiiFlow = Number(row.marketContext?.fiiDii?.fiiNetBuy || 0);
  const evidenceGrade = row.verification?.evidenceGrade || "D";
  const valuation = valuationView(row.stock, fundamentals);
  const peerPosition = row.peerComparison?.position ? formatTag(row.peerComparison.position) : null;
  const candlestick = row.candlestickAnalysis;
  const higherTrend = technical.higherTimeframe?.available ? technical.higherTimeframe.trendBias : "UNKNOWN";
  const regimeLabel = technical.regime?.label || "TRANSITIONAL";

  const technicalMagnitude =
    Math.abs(Number(row.scoreBreakdown?.technical || 50) - 50)
    + Math.abs(Number(technical.return20d || 0)) * 0.6
    + Math.abs(Number(technical.macd?.histogram || 0)) * 18;
  const macroMagnitude =
    Math.abs(Number(row.scoreBreakdown?.macro || 50) - 50)
    + Math.abs(Number(row.marketContext?.riskOnScore || 0)) * 10
    + Math.min(Math.abs(fiiFlow) / 250, 8);
  const newsMagnitude =
    Math.abs(Number(row.scoreBreakdown?.news || 50) - 50)
    + Math.abs(Number(row.eventExposure?.score || 50) - 50) * 0.6
    + Number(newsSummary.verifiedCount || 0) * 3
    + Number(newsSummary.officialCount || 0) * 2;
  const fundamentalMagnitude =
    Math.abs(Number(row.scoreBreakdown?.fundamentals || 50) - 50)
    + Math.abs(Number(fundamentals.roe || 0) - 15) * 0.4
    + (valuation.label === "ATTRACTIVE" || valuation.label === "STRETCHED" ? 6 : 0);

  return [
    {
      key: "technical",
      title: "Price structure and momentum",
      magnitude: technicalMagnitude,
      direction: technical.trendBias === "BULLISH" ? "bullish" : technical.trendBias === "BEARISH" ? "bearish" : "neutral",
      signal: `${row.symbol} has a ${technical.trendBias?.toLowerCase() || "neutral"} tape with 20-day return ${technical.return20d ?? "--"}% and 60-day return ${technical.return60d ?? "--"}%. Weekly trend is ${String(higherTrend).toLowerCase()}.${candlestick?.detectedPattern ? ` Daily candle: ${candlestick.detectedPattern} (${candlestick.validity}).` : ""}`,
      what: `Price is ${quote.price ?? "--"} with RSI ${technical.rsi14 ?? "--"}, MACD ${technical.macd?.posture || "UNAVAILABLE"}, volume ${technical.volumeSurge ?? "--"}x average, and candle context ${candlestick?.context?.location || "Unknown"}.`,
      why: technical.vwap20
        ? `The stock is trading ${quote.price >= technical.vwap20 ? "above" : "below"} its rolling VWAP near ${technical.vwap20}, while support sits near ${technical.support20 ?? "--"} and resistance near ${technical.resistance20 ?? "--"}. Current regime is ${String(regimeLabel).toLowerCase()}.`
        : "VWAP and level context are only partially available right now.",
      impact: "This driver tells us whether institutions are still supporting continuation or whether mean-reversion risk is increasing.",
    },
    {
      key: "macro",
      title: "Macro regime and institutional flow",
      magnitude: macroMagnitude,
      direction: Number(row.scoreBreakdown?.macro || 50) >= 55 ? "bullish" : Number(row.scoreBreakdown?.macro || 50) <= 45 ? "bearish" : "neutral",
      signal: `Market regime is ${row.marketContext?.regime || "BALANCED"} with FII flow ${fiiFlow >= 0 ? "positive" : "negative"} at ${fiiFlow}.`,
      what: `Nifty ${nifty?.changePct ?? "--"}%, Sensex ${sensex?.changePct ?? "--"}%, USDINR ${usdinr?.changePct ?? "--"}%, risk-on score ${row.marketContext?.riskOnScore ?? "--"}.`,
      why: `Institutional flow and cross-asset moves shift risk appetite for ${row.sector} names.`,
      impact: "This sets the background risk budget, position sizing, and how much follow-through a stock-specific setup can realistically get.",
    },
    {
      key: "news",
      title: "News validation and event pressure",
      magnitude: newsMagnitude,
      direction: Number(row.scoreBreakdown?.news || 50) >= 55 || row.eventExposure?.pressure === "TAILWIND"
        ? "bullish"
        : Number(row.scoreBreakdown?.news || 50) <= 45 || row.eventExposure?.pressure === "HEADWIND"
          ? "bearish"
          : "neutral",
      signal: `Evidence grade ${evidenceGrade} with ${newsSummary.realTimeCount || 0} real-time headlines, ${newsSummary.verifiedCount || 0} verified, and event pressure ${row.eventExposure?.pressure || "MIXED"}.`,
      what: topEvent
        ? `${topEvent.headline} is the lead event driver with impact ${topEvent.impact}.`
        : "No single event driver is dominant enough to own the narrative.",
      why: `When headlines are fresh, cross-verified, and aligned with the tape, decision quality improves materially.`,
      impact: "This driver either validates the setup or forces us to discount the narrative as noise.",
    },
    {
      key: "fundamentals",
      title: "Business quality and valuation",
      magnitude: fundamentalMagnitude,
      direction: Number(row.scoreBreakdown?.fundamentals || 50) >= 55 ? "bullish" : Number(row.scoreBreakdown?.fundamentals || 50) <= 45 ? "bearish" : "neutral",
      signal: `ROE ${fundamentals.roe ?? "--"}%, Debt/Equity ${fundamentals.debtToEquity ?? "--"}, valuation ${valuation.label.toLowerCase()}, ${peerPosition ? `${peerPosition.toLowerCase()} versus peers` : "peer context still limited"}.`,
      what: `P/E is ${fundamentals.pe ?? "--"} and 3-year profit growth is ${fundamentals.profitGrowth3yr ?? "--"}%.`,
      why: "Strong businesses can absorb volatility better, while weak balance sheets and stretched valuations reduce the margin of safety.",
      impact: "This driver shapes whether pullbacks should be bought, sold, or simply watched.",
    },
  ].map((driver) => ({
    ...driver,
    impactLevel: impactLevelFromMagnitude(driver.magnitude),
  }));
}

function buildSignalPrioritization(row) {
  const candidates = buildDriverCandidates(row);
  const high = candidates.filter((item) => item.impactLevel === "HIGH IMPACT");
  const medium = candidates.filter((item) => item.impactLevel === "MEDIUM");
  const low = candidates.filter((item) => item.impactLevel === "LOW");

  return {
    high,
    medium,
    low,
  };
}

function normalizeProbabilities(rows = []) {
  const total = rows.reduce((sum, row) => sum + row.raw, 0) || 1;
  const normalized = rows.map((row) => ({
    ...row,
    probability: Math.round((row.raw / total) * 100),
  }));

  const difference = 100 - normalized.reduce((sum, row) => sum + row.probability, 0);
  if (normalized.length && difference !== 0) {
    normalized[0].probability += difference;
  }

  return normalized.map(({ raw, ...rest }) => rest);
}

function buildScenarioAnalysis(row, conflicts, dataCoverage, enhancementLayer) {
  const bias = Number(row.adjustedScore || row.score || 50) - 50;
  const conflictPenalty = conflicts.reduce((sum, item) => sum + (item.severity === "HIGH" ? 10 : 5), 0);
  const regimePenalty = enhancementLayer?.marketRegime?.tradeEnvironment === "UNFAVORABLE" ? 8 : 0;
  const timingPenalty = enhancementLayer?.entryTiming?.status === "EXTENDED" ? 6 : 0;
  const bullishBase = clamp(
    42
    + Math.max(0, bias) * 1.4
    + Math.max(0, Number(row.scoreBreakdown?.technical || 50) - 50) * 0.3
    + (row.eventExposure?.pressure === "TAILWIND" ? 8 : 0)
    + (["BUY", "STRONG_BUY"].includes(row.verdict) ? 10 : 0)
    - conflictPenalty * 0.35,
    8,
    88,
  );
  const bearishBase = clamp(
    42
    + Math.max(0, -bias) * 1.4
    + Math.max(0, 50 - Number(row.scoreBreakdown?.technical || 50)) * 0.3
    + (row.eventExposure?.pressure === "HEADWIND" ? 8 : 0)
    + (["SELL", "STRONG_SELL"].includes(row.verdict) ? 10 : 0)
    - conflictPenalty * 0.25,
    8,
    88,
  );
  const neutralBase = clamp(
    18
    + conflicts.length * 6
    + Math.max(0, 12 - Math.abs(bias) * 0.45)
    + Math.min(10, dataCoverage.missingSupporting.length * 1.4),
    8,
    70,
  );
  const bullishRaw = clamp(
    bullishBase - regimePenalty - (directionalBiasFromVerdict(row.verdict) === "bullish" ? timingPenalty : 0),
    8,
    88,
  );
  const bearishRaw = clamp(
    bearishBase - regimePenalty - (directionalBiasFromVerdict(row.verdict) === "bearish" ? timingPenalty : 0),
    8,
    88,
  );
  const neutralRaw = clamp(
    neutralBase + regimePenalty + Math.round(timingPenalty * 0.6),
    8,
    70,
  );

  return normalizeProbabilities([
    {
      name: "Bullish",
      raw: bullishRaw,
      case: uniqueStrings(row.buyReasons || row.catalysts || [], 3),
    },
    {
      name: "Bearish",
      raw: bearishRaw,
      case: uniqueStrings(row.sellReasons || row.risks || [], 3),
    },
    {
      name: "Neutral",
      raw: neutralRaw,
      case: uniqueStrings([
        ...(row.monitorPoints || []),
        conflicts[0]?.detail || null,
      ], 3),
    },
  ]);
}

function computeRiskReward(row) {
  const price = Number(row.quote?.price);
  const targetPrice = Number(row.targets?.targetPrice);
  const stopLoss = Number(row.targets?.stopLoss);

  if (!Number.isFinite(price) || !Number.isFinite(targetPrice) || !Number.isFinite(stopLoss) || price <= 0) {
    return null;
  }

  const bearish = ["SELL", "STRONG_SELL"].includes(row.verdict);
  const reward = bearish ? Math.max(0, price - targetPrice) : Math.max(0, targetPrice - price);
  const risk = bearish ? Math.max(0, stopLoss - price) : Math.max(0, price - stopLoss);

  if (risk <= 0 || reward <= 0) {
    return null;
  }

  return Number((reward / risk).toFixed(2));
}

function buildTradeDecision(row, conflicts, dataCoverage, enhancementLayer) {
  const bearish = ["SELL", "STRONG_SELL"].includes(row.verdict);
  const bullish = ["BUY", "STRONG_BUY"].includes(row.verdict);
  const riskReward = computeRiskReward(row);
  const blockingIssues = [];

  if (!row.quote?.price) blockingIssues.push("Current price is unavailable.");
  if (row.technicalSnapshot?.return20d === null) blockingIssues.push("Technical snapshot is incomplete.");
  if (riskReward === null) blockingIssues.push("Target and stop structure is incomplete.");
  if (row.strategy === "intraday" && !String(row.quote?.source || "").startsWith("UPSTOX_LIVE")) {
    blockingIssues.push("Intraday execution requires live quotes.");
  }

  const strongConfluence = bullish
    ? [
        Number(row.scoreBreakdown?.technical || 50) >= 60,
        Number(row.scoreBreakdown?.fundamentals || 50) >= 55,
        Number(row.scoreBreakdown?.macro || 50) >= 48,
        Number(row.eventExposure?.score || 50) >= 48,
        Number(row.scoreBreakdown?.risk || 100) <= 52,
        row.verification?.evidenceGrade !== "D" || Number(row.verification?.headlineCount || 0) === 0,
      ].filter(Boolean).length >= 4
    : bearish
      ? [
          Number(row.scoreBreakdown?.technical || 50) <= 45,
          Number(row.adjustedScore || 50) <= 40,
          Number(row.scoreBreakdown?.risk || 100) <= 58,
          Number(row.eventExposure?.score || 50) <= 48 || Number(row.scoreBreakdown?.macro || 50) <= 48,
          Number(row.confidence || 0) >= 60,
        ].filter(Boolean).length >= 4
      : false;

  const clearDirectionalBias = (bullish || bearish) && Math.abs(Number(row.adjustedScore || 50) - 50) >= 14 && Number(row.confidence || 0) >= 60;
  const noConflictingSignals = conflicts.filter((item) => item.severity === "HIGH").length === 0;
  const multiTimeframeAligned = enhancementLayer?.multiTimeframe?.alignment !== "CONFLICT";
  const regimeSupportive = enhancementLayer?.marketRegime?.tradeEnvironment !== "UNFAVORABLE";
  const levelContextSupportive = enhancementLayer?.liquidityLevels?.quality !== "LOW";
  const entryTimingReady = ["OPTIMAL"].includes(enhancementLayer?.entryTiming?.status)
    || (
      enhancementLayer?.entryTiming?.status === "EARLY"
      && Number(riskReward || 0) >= 2.2
      && Number(row.confidence || 0) >= 70
    );
  const signalClarity = enhancementLayer?.signalDiscipline?.directionalAgreement !== "MIXED"
    && Number(enhancementLayer?.signalDiscipline?.highImpactCount || 0) >= 2;
  const enhancedConfluence = Number(enhancementLayer?.confluence?.passedChecks || 0) >= 4;
  const validTrade = (bullish || bearish)
    && strongConfluence
    && clearDirectionalBias
    && noConflictingSignals
    && multiTimeframeAligned
    && regimeSupportive
    && levelContextSupportive
    && entryTimingReady
    && signalClarity
    && enhancedConfluence
    && Number(riskReward || 0) >= 2
    && blockingIssues.length === 0;
  const technical = row.technicalSnapshot || {};
  const baseInvalidation = Number(row.targets?.stopLoss ?? null);
  const keyedInvalidation = bullish && Number.isFinite(Number(technical.support20))
    ? Math.max(baseInvalidation, Number((Number(technical.support20) * 0.993).toFixed(2)))
    : bearish && Number.isFinite(Number(technical.resistance20))
      ? Math.min(baseInvalidation, Number((Number(technical.resistance20) * 1.007).toFixed(2)))
      : baseInvalidation;

  const unmetConditions = [];
  if (!(bullish || bearish)) unmetConditions.push("Directional bias is not strong enough.");
  if (!strongConfluence) unmetConditions.push("Multi-factor confluence is not strong enough.");
  if (!clearDirectionalBias) unmetConditions.push("Directional conviction is not clear enough.");
  if (!noConflictingSignals) unmetConditions.push("Conflicting high-severity signals are still active.");
  if (!multiTimeframeAligned) unmetConditions.push("Higher timeframe is not confirming the trade direction.");
  if (!regimeSupportive) unmetConditions.push("The active regime is not favorable for this direction.");
  if (!levelContextSupportive) unmetConditions.push("The current price location versus support and resistance is not attractive.");
  if (!entryTimingReady) unmetConditions.push(enhancementLayer?.entryTiming?.preferredEntry || "Entry timing is not mature enough yet.");
  if (!signalClarity) unmetConditions.push("The strongest signals are still mixed or too few.");
  if (!enhancedConfluence) unmetConditions.push("The added validation layer is not showing enough confluence.");
  if (Number(riskReward || 0) < 2) unmetConditions.push("Reward-to-risk is below the 2:1 minimum.");
  unmetConditions.push(...blockingIssues);

  return {
    action: validTrade ? (bullish ? "BUY" : "SELL") : "NO_TRADE",
    status: validTrade ? "READY FOR EXECUTION" : "WAIT - CONDITIONS NOT MET",
    direction: bullish ? "bullish" : bearish ? "bearish" : "neutral",
    validTrade,
    riskReward,
    strongConfluence,
    clearDirectionalBias,
    noConflictingSignals,
    multiTimeframeAligned,
    regimeSupportive,
    levelContextSupportive,
    entryTimingReady,
    signalClarity,
    enhancementConfluenceScore: enhancementLayer?.confluence?.score ?? null,
    unmetConditions: uniqueStrings(unmetConditions, 6),
    invalidationLevel: Number.isFinite(Number(keyedInvalidation)) ? keyedInvalidation : row.targets?.stopLoss ?? null,
  };
}

function buildExecutionPlan(row, tradeDecision, enhancementLayer) {
  if (!tradeDecision.validTrade) {
    return {
      status: tradeDecision.status,
      entryType: null,
      entry: null,
      stopLoss: row.targets?.stopLoss ?? null,
      hardStopLoss: row.targets?.stopLoss ?? null,
      targets: [],
      positionSizing: "Stand aside. Reassess after stronger confluence or better reward-to-risk develops.",
      trailingStop: "Not active while the trade gate remains closed.",
      exitPlan: tradeDecision.unmetConditions.slice(0, 3),
    };
  }

  const price = Number(row.quote?.price || 0);
  const target = Number(row.targets?.targetPrice || 0);
  const stop = Number(row.targets?.stopLoss || 0);
  const technical = row.technicalSnapshot || {};
  const bearish = tradeDecision.action === "SELL";
  const referenceLevel = bearish ? technical.resistance20 : technical.support20;
  const timing = enhancementLayer?.entryTiming?.status || "WAIT";
  const useLimit = timing === "OPTIMAL"
    ? Number.isFinite(Number(referenceLevel))
    : Number.isFinite(Number(referenceLevel)) && Math.abs(price - Number(referenceLevel)) / Math.max(price, 1) > 0.01;
  const entry = useLimit && Number(referenceLevel) > 0
    ? Number(referenceLevel)
    : price;
  const target1 = bearish
    ? Number((price - ((price - target) * 0.5)).toFixed(2))
    : Number((price + ((target - price) * 0.5)).toFixed(2));
  const keyedStop = bearish
    ? (Number.isFinite(Number(technical.resistance20)) ? Number((Number(technical.resistance20) * 1.007).toFixed(2)) : stop)
    : (Number.isFinite(Number(technical.support20)) ? Number((Number(technical.support20) * 0.993).toFixed(2)) : stop);
  const hardStopLoss = bearish
    ? Number(Math.min(stop, keyedStop).toFixed(2))
    : Number(Math.max(stop, keyedStop).toFixed(2));
  const invalidationLevel = hardStopLoss;
  const regimeLabel = enhancementLayer?.marketRegime?.label || "TRANSITIONAL";
  const sizing = regimeLabel === "HIGH_VOLATILITY" || enhancementLayer?.marketRegime?.tradeEnvironment === "SELECTIVE"
    ? "Risk 0.35% to 0.6% of capital because conditions are selective. Quantity = capital risk / per-share stop distance."
    : "Risk 0.5% to 1.0% of trading capital. Quantity = capital risk / per-share stop distance.";

  return {
    status: tradeDecision.status,
    entryType: useLimit ? "limit" : "market",
    entry: Number(entry.toFixed(2)),
    stopLoss: Number(stop.toFixed(2)),
    hardStopLoss,
    invalidationLevel,
    targets: [target1, Number(target.toFixed(2))],
    positionSizing: sizing,
    trailingStop: bearish
      ? "After target 1, trail the stop above lower highs or the 20-day resistance zone."
      : "After target 1, trail the stop below higher lows or the 20-day support zone.",
    exitPlan: bearish
      ? [`Book 50% near ${target1}.`, `Move stop to breakeven after target 1.`, `Exit the balance near ${Number(target.toFixed(2))}.`]
      : [`Book 50% near ${target1}.`, `Move stop to breakeven after target 1.`, `Exit the balance near ${Number(target.toFixed(2))}.`],
  };
}

function buildRiskAndFailureConditions(row, conflicts, tradeDecision, enhancementLayer, executionPlan) {
  return uniqueStrings([
    enhancementLayer?.entryTiming?.status === "EXTENDED" ? enhancementLayer.entryTiming.preferredEntry : null,
    enhancementLayer?.marketRegime?.tradeEnvironment === "UNFAVORABLE" ? enhancementLayer.marketRegime.note : null,
    (executionPlan?.hardStopLoss ?? tradeDecision.invalidationLevel) ? `Invalidation level: ${executionPlan?.hardStopLoss ?? tradeDecision.invalidationLevel}.` : null,
    ...(row.monitorPoints || []),
    ...conflicts.map((item) => `${item.title}. ${item.detail}`),
  ], 6);
}

function buildSelfCritique(row, conflicts, dataCoverage, enhancementLayer) {
  const points = [];
  const technical = row.technicalSnapshot || {};

  if (row.verification?.headlineCount > 0 && row.verification?.verifiedHeadlineCount === 0) {
    points.push("The narrative may be overstating the case because the active headlines are not cross-verified yet.");
  }
  if (technical.rsi14 !== null && technical.rsi14 >= 70) {
    points.push("Momentum is strong, but the setup may already be crowded and vulnerable to mean reversion.");
  }
  if (technical.rsi14 !== null && technical.rsi14 <= 30) {
    points.push("Weak momentum may be stretched enough to trigger violent short-covering or reflex bounces.");
  }
  if (Number(row.scoreBreakdown?.macro || 50) < 45 && ["BUY", "STRONG_BUY"].includes(row.verdict)) {
    points.push("A stock-specific bullish view can fail if the broader market remains risk-off.");
  }
  if ((row.peerComparison?.position || "") === "SECTOR_LAGGARD") {
    points.push("Relative weakness versus peers could keep institutional inflows away even if the valuation looks fair.");
  }
  if (!enhancementLayer?.multiTimeframe?.available) {
    points.push("Higher-timeframe confirmation is missing, so the entry bias is less robust than it would be with weekly alignment.");
  }
  if (enhancementLayer?.marketRegime?.label === "SIDEWAYS") {
    points.push("Sideways regimes can generate whipsaws, so directional conviction may be overstated without a clean break from the range.");
  }
  if (enhancementLayer?.entryTiming?.status === "EXTENDED") {
    points.push("The current move may already be extended, so even a correct directional view could produce poor entry quality.");
  }

  return {
    whatCouldBeWrong: uniqueStrings(points, 4),
    missing: uniqueStrings([
      ...dataCoverage.missingCritical,
      ...dataCoverage.missingSupporting,
    ], 6),
    highestUncertainty: conflicts[0]?.detail
      || dataCoverage.missingCritical[0]
      || dataCoverage.missingSupporting[0]
      || "The main uncertainty is whether the current narrative will translate into sustained follow-through.",
  };
}

function buildInstitutionalOutput(row, marketWideOpportunities = null) {
  const dataCoverage = buildDataCoverage(row);
  const signalPrioritization = buildSignalPrioritization(row);
  const enhancementLayer = buildEnhancementLayer(row, signalPrioritization);
  const conflicts = buildConflictSignals(row, dataCoverage, enhancementLayer);
  const topMarketDrivers = buildDriverCandidates(row)
    .sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3)
    .map((driver) => ({ ...driver, impactLevel: "HIGH IMPACT" }));
  const scenarioAnalysis = buildScenarioAnalysis(row, conflicts, dataCoverage, enhancementLayer);
  const tradeDecision = buildTradeDecision(row, conflicts, dataCoverage, enhancementLayer);
  const executionPlan = buildExecutionPlan(row, tradeDecision, enhancementLayer);
  const riskAndFailureConditions = buildRiskAndFailureConditions(row, conflicts, tradeDecision, enhancementLayer, executionPlan);
  const selfCritique = buildSelfCritique(row, conflicts, dataCoverage, enhancementLayer);

  return {
    topMarketDrivers,
    causeEffectAnalysis: topMarketDrivers.map((driver) => ({
      title: driver.title,
      what: driver.what,
      why: driver.why,
      impact: driver.impact,
      direction: driver.direction,
    })),
    signalPrioritization,
    keyHighImpactSignals: signalPrioritization.high.map((item) => ({
      title: item.title,
      direction: item.direction,
      summary: item.signal,
      impactLevel: item.impactLevel,
    })),
    candlestickStatus: row.candlestickStatus || deriveCandlestickStatus(row),
    candlestickAnalysis: row.candlestickAnalysis,
    intelligenceEnhancements: enhancementLayer,
    marketWideOpportunities,
    scenarioAnalysis,
    tradeDecision,
    executionPlan,
    riskAndFailureConditions,
    confidenceScore: row.confidence,
    conflicts,
    dataCoverage,
    selfCritique,
  };
}

function buildAnswer(row) {
  const targetText = row.targets.targetPrice ? `Target ${row.targets.targetPrice}` : "No target";
  const stopText = row.targets.stopLoss ? `stop ${row.targets.stopLoss}` : "no stop";
  const longTermText = row.longTermView ? `Long-term stance: ${row.longTermView.stance.replaceAll("_", " ")}.` : "";
  const tradeText = row.decisionEngine?.tradeDecision?.action === "NO_TRADE"
    ? "Trade decision: NO TRADE."
    : row.decisionEngine?.tradeDecision?.status === "READY FOR EXECUTION"
      ? `Trade decision: ${row.decisionEngine.tradeDecision.action}, ready for execution.`
      : "";
  return `${row.symbol}: ${row.verdict.replaceAll("_", " ")} with ${row.confidence}% confidence. ${row.recommendation.summary} ${tradeText} ${targetText}, ${stopText}. ${longTermText}`.trim();
}

function formatVerdictText(value = "") {
  return String(value || "").replaceAll("_", " ");
}

function normalizeSearchPhrase(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9&. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStrategyKey(value = "swing") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (["intraday", "daytrade", "daytrading", "scalp", "scalping"].includes(normalized)) {
    return "intraday";
  }
  if (["shortterm", "position", "positional"].includes(normalized)) {
    return "position";
  }
  if (["longterm", "longrun", "investment", "investing", "portfolio", "multiyear"].includes(normalized)) {
    return "longterm";
  }
  if (["swing", "swingtrade"].includes(normalized)) {
    return "swing";
  }
  return "swing";
}

function sanitizeEntityHint(value = "") {
  let cleaned = String(value || "");
  for (const pattern of ENTITY_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned
    .replace(/[\(\)\[\]{}]/g, " ")
    .replace(/[^A-Za-z0-9&. ]/g, " ")
    .split(/\s+/)
    .filter((token) => (token.length > 1 || /[&.]/.test(token)) && !QUERY_STOPWORDS.has(token.toUpperCase()))
    .join(" ")
    .trim();
}

function pushEntityHint(hints, seen, value = "") {
  const cleaned = sanitizeEntityHint(value);
  const normalized = normalizeSearchPhrase(cleaned);
  if (!normalized || normalized.length < 2 || QUERY_STOPWORDS.has(normalized) || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  hints.push(cleaned);
}

function extractEntityHints(query = "") {
  const raw = String(query || "").trim();
  if (!raw) {
    return [];
  }

  const hints = [];
  const seen = new Set();

  for (const match of raw.matchAll(/\(([^)]+)\)/g)) {
    pushEntityHint(hints, seen, match[1]);
  }

  for (const pattern of ENTITY_CUE_PATTERNS) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      pushEntityHint(hints, seen, match[1]);
    }
  }

  pushEntityHint(hints, seen, raw.replace(/\(([^)]+)\)/g, " $1 "));
  return hints;
}

function extractQueryTokens(query = "") {
  const tokens = String(query || "")
    .toUpperCase()
    .replace(/[^A-Z0-9&. ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token) && !/^\d+$/.test(token));

  return [...new Set(tokens)];
}

function doesCandidateMatchHint(stock, hint = "") {
  if (!stock || !hint) {
    return false;
  }

  const normalizedHint = normalizeSearchPhrase(hint);
  if (!normalizedHint) {
    return false;
  }

  const aliases = Array.isArray(stock.aliases) ? stock.aliases : [];
  const exactValues = [stock.symbol, stock.name, ...aliases].map((value) => normalizeSearchPhrase(value));
  if (exactValues.includes(normalizedHint)) {
    return true;
  }

  const hintWords = normalizedHint
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !QUERY_STOPWORDS.has(word));
  if (!hintWords.length) {
    return false;
  }

  const haystack = normalizeSearchPhrase(`${stock.symbol} ${stock.name} ${aliases.join(" ")}`);
  const matchedWords = hintWords.filter((word) => haystack.includes(word)).length;
  return hintWords.length === 1 ? matchedWords === 1 : matchedWords === hintWords.length;
}

async function resolveSymbolFromHint(hint = "", limit = 6) {
  const normalizedHint = normalizeSearchPhrase(hint);
  const direct = await resolveStockAny(normalizedHint);
  if (direct && doesCandidateMatchHint(direct, hint)) {
    const directCandidates = await searchAnyUniverse(hint, limit);
    return {
      symbol: direct.symbol,
      candidates: directCandidates.length ? directCandidates : [direct],
    };
  }

  const candidates = await resolveQueryCandidates(hint, limit);
  const strongCandidates = candidates.filter((candidate) => doesCandidateMatchHint(candidate, hint));
  if (strongCandidates.length === 1) {
    return {
      symbol: strongCandidates[0].symbol,
      candidates: candidates.length ? candidates : strongCandidates,
    };
  }
  if (strongCandidates.length > 1) {
    return {
      symbol: null,
      candidates: candidates.length ? candidates : strongCandidates,
    };
  }

  const searched = candidates.length ? candidates : await searchAnyUniverse(hint, limit);
  const searchedMatches = searched.filter((candidate) => doesCandidateMatchHint(candidate, hint));
  if (searchedMatches.length === 1) {
    return { symbol: searchedMatches[0].symbol, candidates: searched };
  }
  if (searchedMatches.length > 1) {
    return { symbol: null, candidates: searched };
  }

  return { symbol: null, candidates: searched };
}

function isAmbiguousExactMatch(query = "", candidates = []) {
  const normalized = String(query || "").trim().toUpperCase();
  if (!normalized || /\s/.test(normalized) || candidates.length <= 1) {
    return false;
  }

  // If there is a perfect exact symbol match, it is never ambiguous
  const hasExactSymbol = candidates.some((item) => item?.symbol === normalized);
  if (hasExactSymbol) {
    return false;
  }

  const related = candidates.filter((item) => {
    const name = String(item?.name || "").toUpperCase();
    return item?.symbol === normalized || item?.symbol?.startsWith(normalized) || name.includes(normalized);
  });

  return related.length > 1 && related.some((item) => item.symbol !== normalized);
}

async function findBestSymbolFromQuery(query = "", explicitSymbol = "") {
  const direct = String(explicitSymbol || "").trim().toUpperCase();
  if (direct) {
    const stock = await resolveStockAny(direct);
    return { symbol: stock?.symbol || null, candidates: stock ? [stock] : [] };
  }

  for (const hint of extractEntityHints(query)) {
    const hintResolved = await resolveSymbolFromHint(hint, 6);
    if (hintResolved.symbol) {
      return hintResolved;
    }
  }

  // 1. Try each extracted token (symbol-like words)
  for (const token of extractQueryTokens(query)) {
    const tokenStock = await resolveStockAny(token);
    if (tokenStock) {
      // resolveStockAny already did exact/alias resolution — trust it, no ambiguity check
      const tokenCandidates = await searchAnyUniverse(token, 6);
      return { symbol: tokenStock.symbol, candidates: tokenCandidates.length ? tokenCandidates : [tokenStock] };
    }
    // Token didn't resolve — try search but only use it if top result has exact alias match
    const tokenSearch = await searchAnyUniverse(token, 4);
    if (tokenSearch.length >= 1) {
      const top = tokenSearch[0];
      const tLower = token.toLowerCase();
      const isExact = top.symbol.toLowerCase() === tLower
        || (top.aliases||[]).some(a => a === tLower);
      if (isExact) return { symbol: top.symbol, candidates: tokenSearch };
    }
  }

  // 2. Try the raw query directly as a symbol/alias (handles "hdfc", "sbi", "sun pharma")
  const rawUpper = query.trim().toUpperCase();
  const directRaw = await resolveStockAny(rawUpper);
  if (directRaw) {
    const rawCandidates = await searchAnyUniverse(rawUpper, 6);
    if (isAmbiguousExactMatch(rawUpper, rawCandidates)) {
      return { symbol: null, candidates: rawCandidates };
    }
    return { symbol: directRaw.symbol, candidates: rawCandidates.length ? rawCandidates : [directRaw] };
  }
  const candidates = await resolveQueryCandidates(query, 6);
  const normalized = rawUpper;

  const exactSymbol = candidates.find(s => s.symbol === normalized);
  if (exactSymbol && !isAmbiguousExactMatch(query, candidates)) {
    return { symbol: exactSymbol.symbol, candidates };
  }

  const exactName = candidates.find(s => s.name.toUpperCase() === normalized);
  if (exactName) return { symbol: exactName.symbol, candidates };

  if (candidates.length === 1) return { symbol: candidates[0].symbol, candidates };

  // 4. Phrase search fallback
  if (candidates.length === 0) {
    const phraseResults = await searchAnyUniverse(query, 3);
    if (phraseResults.length === 1) return { symbol: phraseResults[0].symbol, candidates: phraseResults };
    if (phraseResults.length > 1) return { symbol: null, candidates: phraseResults };
  }

  return { symbol: null, candidates };
}

function inferStrategyContext(query = "", fallback = "swing") {
  const input = String(query || "");
  const matches = [];

  for (const [strategy, patterns] of Object.entries(STRATEGY_QUERY_PATTERNS)) {
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match && Number.isInteger(match.index)) {
        matches.push({
          strategy,
          index: match.index,
          length: match[0]?.length || 0,
        });
      }
    }
  }

  const matchedStrategies = [...new Set(matches.map((entry) => entry.strategy))];
  const requestsAllStrategies = matchedStrategies.length > 1 || MULTI_STRATEGY_REQUEST_PATTERNS.some((pattern) => pattern.test(input));

  if (matches.length && !requestsAllStrategies) {
    matches.sort((left, right) => left.index - right.index || right.length - left.length);
    return {
      strategy: matches[0].strategy,
      matchedStrategies,
      requestsAllStrategies: false,
      selectionMode: "explicit",
    };
  }

  return {
    strategy: normalizeStrategyKey(fallback),
    matchedStrategies,
    requestsAllStrategies,
    selectionMode: requestsAllStrategies ? "consensus" : "fallback",
  };
}

function inferStrategy(query = "", fallback = "swing") {
  return inferStrategyContext(query, fallback).strategy;
}

function strategyToOpportunityTimeframe(strategy = "swing") {
  if (strategy === "intraday") return "intraday";
  if (strategy === "position") return "short_term";
  if (strategy === "longterm") return "long_term";
  return "swing";
}

function peerCandidatesFor(stock) {
  return getUniverse()
    .filter((item) => item.symbol !== stock.symbol && item.sector === stock.sector)
    .slice(0, 8);
}

function peerComposite(bundle) {
  return clamp(Number((computeFundamentalScore(bundle.stock, bundle.fundamentals) * 0.62 + bundle.technical.score * 0.38).toFixed(1)));
}

function buildPeerSummary(row, peers, averages, position) {
  if (!peers.length) {
    return "Sector comparator data is limited right now.";
  }

  const roeDelta = Number.isFinite(averages.roe) && row.fundamentals.roe !== null
    ? Number((row.fundamentals.roe - averages.roe).toFixed(1))
    : null;
  const peDelta = Number.isFinite(averages.pe) && row.fundamentals.pe !== null
    ? Number((row.fundamentals.pe - averages.pe).toFixed(1))
    : null;

  const posture = position === "SECTOR_LEADER"
    ? "is one of the stronger names in its sector peer set"
    : position === "SECTOR_LAGGARD"
      ? "is lagging its sector peer set"
      : "is roughly in line with its sector peer set";

  const roeText = roeDelta === null
    ? "Return-ratio comparison is limited."
    : roeDelta >= 0
      ? `ROE is ${roeDelta}% above the peer average.`
      : `ROE is ${Math.abs(roeDelta)}% below the peer average.`;

  const peText = peDelta === null
    ? "Valuation comparison is limited."
    : peDelta <= 0
      ? `P/E is ${Math.abs(peDelta)} points below the peer average.`
      : `P/E is ${peDelta} points above the peer average.`;

  return `${row.symbol} ${posture}. ${roeText} ${peText}`;
}

async function buildPeerComparison(row) {
  const candidates = peerCandidatesFor(row.stock);
  if (!candidates.length) {
    return {
      available: false,
      sector: row.sector,
      summary: "Comparator coverage is limited for this sector in the current local universe.",
      peers: [],
      advantages: [],
      disadvantages: [],
      position: "UNKNOWN",
    };
  }

  const bundles = (await Promise.all(candidates.map((candidate) => resolveStockBundle(candidate.symbol))))
    .filter((bundle) => bundle?.quote);

  const peers = bundles
    .map((bundle) => ({
      symbol: bundle.stock.symbol,
      companyName: bundle.stock.name,
      sector: bundle.stock.sector,
      price: bundle.quote.price,
      changePct: bundle.quote.changePct,
      pe: bundle.fundamentals.pe,
      roe: bundle.fundamentals.roe,
      profitGrowth3yr: bundle.fundamentals.profitGrowth3yr,
      return20d: bundle.technical.return20d,
      return60d: bundle.technical.return60d,
      drawdown: bundle.technical.drawdown,
      composite: peerComposite(bundle),
    }))
    .sort((left, right) => right.composite - left.composite)
    .slice(0, 3);

  if (!peers.length) {
    return {
      available: false,
      sector: row.sector,
      summary: "Comparator coverage is limited for this sector right now.",
      peers: [],
      advantages: [],
      disadvantages: [],
      position: "UNKNOWN",
    };
  }

  const averages = {
    pe: averageDefined(peers.map((peer) => peer.pe)),
    roe: averageDefined(peers.map((peer) => peer.roe)),
    profitGrowth3yr: averageDefined(peers.map((peer) => peer.profitGrowth3yr)),
    return60d: averageDefined(peers.map((peer) => peer.return60d)),
    composite: averageDefined(peers.map((peer) => peer.composite)) || 50,
  };

  const baseComposite = clamp(Number((row.scoreBreakdown.fundamentals * 0.62 + row.scoreBreakdown.technical * 0.38).toFixed(1)));
  const delta = baseComposite - (averages.composite || 50);
  const position = delta >= 6 ? "SECTOR_LEADER" : delta <= -6 ? "SECTOR_LAGGARD" : "SECTOR_INLINE";
  const advantages = [];
  const disadvantages = [];

  if (row.fundamentals.roe !== null && averages.roe !== null) {
    if (row.fundamentals.roe > averages.roe + 2) {
      advantages.push(`ROE is stronger than the sector-peer average by ${Number((row.fundamentals.roe - averages.roe).toFixed(1))}%.`);
    } else if (row.fundamentals.roe < averages.roe - 2) {
      disadvantages.push(`ROE trails the sector-peer average by ${Number((averages.roe - row.fundamentals.roe).toFixed(1))}%.`);
    }
  }

  if (row.fundamentals.pe !== null && averages.pe !== null) {
    if (row.fundamentals.pe < averages.pe - 1.5) {
      advantages.push(`Valuation is cheaper than the sector-peer average by ${Number((averages.pe - row.fundamentals.pe).toFixed(1))} P/E points.`);
    } else if (row.fundamentals.pe > averages.pe + 1.5) {
      disadvantages.push(`Valuation is richer than the sector-peer average by ${Number((row.fundamentals.pe - averages.pe).toFixed(1))} P/E points.`);
    }
  }

  if (row.technicalSnapshot.return60d !== null && averages.return60d !== null) {
    if (row.technicalSnapshot.return60d > averages.return60d + 4) {
      advantages.push("Relative momentum is stronger than peers on a 60-day basis.");
    } else if (row.technicalSnapshot.return60d < averages.return60d - 4) {
      disadvantages.push("Relative momentum is weaker than peers on a 60-day basis.");
    }
  }

  if (row.fundamentals.profitGrowth3yr !== null && averages.profitGrowth3yr !== null) {
    if (row.fundamentals.profitGrowth3yr > averages.profitGrowth3yr + 4) {
      advantages.push("Earnings compounding is stronger than key sector peers.");
    } else if (row.fundamentals.profitGrowth3yr < averages.profitGrowth3yr - 4) {
      disadvantages.push("Earnings compounding is lagging key sector peers.");
    }
  }

  return {
    available: true,
    sector: row.sector,
    summary: buildPeerSummary(row, peers, averages, position),
    peers,
    averages: {
      pe: averages.pe !== null ? Number(averages.pe.toFixed(1)) : null,
      roe: averages.roe !== null ? Number(averages.roe.toFixed(1)) : null,
      profitGrowth3yr: averages.profitGrowth3yr !== null ? Number(averages.profitGrowth3yr.toFixed(1)) : null,
      return60d: averages.return60d !== null ? Number(averages.return60d.toFixed(1)) : null,
      composite: averages.composite !== null ? Number(averages.composite.toFixed(1)) : null,
    },
    advantages: uniqueStrings(advantages, 4),
    disadvantages: uniqueStrings(disadvantages, 4),
    position,
  };
}

function decorateRow(row) {
  const longTermView = buildLongTermView(row);
  const catalysts = buildCatalysts(row.stock, row.technicalSnapshot, row.fundamentals, row.newsSummary, row.scoreBreakdown.macro, row.eventExposure, longTermView);
  const risks = buildRisks(row.technicalSnapshot, row.fundamentals, row.newsSummary, row.marketContext, row.eventExposure, longTermView);

  const decorated = {
    ...row,
    longTermView,
    catalysts,
    risks,
    candlestickAnalysis: buildCandlestickAnalysis(row),
    candlestickStatus: deriveCandlestickStatus(row),
  };

  decorated.buyReasons = buildBuyReasons(decorated);
  decorated.sellReasons = buildSellReasons(decorated);
  decorated.monitorPoints = buildMonitorPoints(decorated);
  decorated.thesis = buildNarrative(decorated);
  decorated.recommendation = buildRecommendation(decorated);
  decorated.decisionEngine = buildInstitutionalOutput(decorated);
  decorated.tradeDecision = decorated.decisionEngine.tradeDecision;
  decorated.executionPlan = decorated.decisionEngine.executionPlan;
  decorated.recommendation = buildRecommendation(decorated);
  return decorated;
}

async function enrichRowDeep(row, candles = [], marketContext = {}) {
  const peerComparison = await buildPeerComparison(row);
  const withPeer = decorateRow({ ...row, peerComparison });
  // God-level enrichment: RSI divergence, ATR targets, Bayesian, Kelly, full report
  try {
    return enrichWithGodLevel(withPeer, candles, marketContext, withPeer.optionsIntelligence);
  } catch (err) {
    return withPeer;
  }
}

function attachMarketWideContext(row, marketWideOpportunities = null) {
  if (!row) {
    return row;
  }

  const enriched = {
    ...row,
  };
  enriched.decisionEngine = buildInstitutionalOutput(enriched, marketWideOpportunities);
  enriched.tradeDecision = enriched.decisionEngine.tradeDecision;
  enriched.executionPlan = enriched.decisionEngine.executionPlan;
  enriched.recommendation = buildRecommendation(enriched);
  return enriched;
}

function buildAnalysisRowFromBundle({
  bundle,
  marketContext,
  symbolNews,
  globalNews,
  strategy = "swing",
  strictVerification = true,
  optionsData = null,
  advancedTechnical = null,
  enhancedFundamental = null,
  indiaSignals = null,
}) {
  if (!bundle?.quote || !bundle?.stock) {
    return null;
  }

  const normalizedStrategy = normalizeAnalysisStrategy(strategy);
  const weights = getStrategyWeights(normalizedStrategy);
  const stock = bundle.stock;
  const newsSummary = summarizeSymbolNews(stock.symbol, symbolNews);

  // Base scores
  let technicalScore = bundle.technical.score;
  let fundamentalScore = computeFundamentalScore(stock, bundle.fundamentals);
  const macroScore = computeMacroScore(stock, marketContext);
  const eventExposure = buildEventExposure(stock, globalNews);
  const riskScore = computeRiskScore(bundle.technical, bundle.fundamentals, newsSummary, marketContext, eventExposure, strictVerification);

  // Phase 2: Advanced technical blend
  if (advancedTechnical?.enhancedScore !== undefined) {
    technicalScore = clamp(technicalScore * 0.6 + advancedTechnical.enhancedScore * 0.4);
  }

  // Phase 3: Enhanced fundamental blend
  if (enhancedFundamental?.available && enhancedFundamental?.enhancedScore !== undefined) {
    fundamentalScore = clamp(fundamentalScore * 0.5 + enhancedFundamental.enhancedScore * 0.5);
  }

  // Phase 4: Options intelligence
  const optionsScore = (optionsData?.available ? optionsData.optionsScore : 50) || 50;
  const optionsBias = optionsData?.available ? (optionsData.directionalBias || "NEUTRAL") : "NEUTRAL";

  // Phase 5: India signals delta
  const indiaDelta = indiaSignals?.indiaDelta || 0;

  const totalScore = clamp(
    technicalScore * weights.technical
    + fundamentalScore * weights.fundamentals
    + newsSummary.score * weights.news
    + macroScore * weights.macro
    + eventExposure.score * weights.events
    + (optionsData?.available ? (optionsScore - 50) * 0.08 : 0)
    + indiaDelta * 0.5,
  );
  const adjustedScore = clamp(totalScore - riskScore * weights.riskPenalty);
  const verdictOverride = (optionsData?.available && optionsBias !== "NEUTRAL")
    ? (optionsBias === "BULLISH" && adjustedScore >= 58 ? "options_confirm_bullish"
      : optionsBias === "BEARISH" && adjustedScore <= 42 ? "options_confirm_bearish" : null)
    : null;
  const verdict = classifyVerdict(adjustedScore, riskScore, newsSummary, eventExposure, strictVerification);
  const horizonDays = resolveHorizonDays(normalizedStrategy, bundle.horizonDays);
  const dataCoveragePreview = buildDataCoverage({
    strategy: normalizedStrategy,
    quote: bundle.quote,
    technicalSnapshot: bundle.technical,
    fundamentals: bundle.fundamentals,
    marketContext,
    newsSummary,
  });
  const optionsConfidenceBoost = optionsData?.available && verdictOverride ? 4 : 0;
  const confidence = clamp(
    summarizeConfidence(bundle.quote.source, newsSummary, bundle.fundamentals, eventExposure, strictVerification)
    - dataCoveragePreview.confidencePenalty
    + optionsConfidenceBoost,
    18,
    95,
  );
  const targets = buildTargets(adjustedScore, riskScore, bundle.quote.price, normalizedStrategy, verdict);

  return decorateRow({
    stock,
    symbol: stock.symbol,
    companyName: stock.name,
    sector: stock.sector,
    verdict,
    confidence,
    score: Number(totalScore.toFixed(1)),
    adjustedScore: Number(adjustedScore.toFixed(1)),
    strategy: normalizedStrategy,
    horizonDays,
    quote: bundle.quote,
    targets,
    scoreBreakdown: {
      technical: Number(technicalScore.toFixed(1)),
      fundamentals: Number(fundamentalScore.toFixed(1)),
      news: newsSummary.score,
      macro: macroScore,
      events: eventExposure.score,
      risk: riskScore,
      options: optionsData?.available ? optionsScore : null,
      india: indiaDelta,
    },
    // NEW: Enhanced intelligence layers
    optionsIntelligence: optionsData?.available ? {
      pcr: optionsData.pcr,
      pcrSignal: optionsData.pcrSignal,
      maxPainStrike: optionsData.maxPainStrike,
      maxPainDistance: optionsData.maxPainDistance,
      resistanceLevel: optionsData.resistanceLevel,
      supportLevel: optionsData.supportLevel,
      directionalBias: optionsData.directionalBias,
      vix: optionsData.vix,
      vixSignal: optionsData.vixSignal,
      summary: optionsData.summary,
      expiry: optionsData.expiry,
      oiWalls: optionsData.oiWalls,
    } : null,
    advancedTechnical: advancedTechnical ? {
      adx: advancedTechnical.adx,
      supertrend: advancedTechnical.supertrend,
      wyckoff: advancedTechnical.wyckoff,
      elliottWave: advancedTechnical.elliottWave,
      chartPatterns: advancedTechnical.chartPatterns,
      volumeProfile: advancedTechnical.volumeProfile,
      signals: advancedTechnical.signals,
      delta: advancedTechnical.delta,
    } : null,
    fundamentalIntelligence: enhancedFundamental?.available ? {
      qglp: enhancedFundamental.qglp,
      coffeeCan: enhancedFundamental.coffeeCan,
      moat: enhancedFundamental.moat,
      lynch: enhancedFundamental.lynch,
      redFlags: enhancedFundamental.redFlags,
      fundamentalQuality: enhancedFundamental.fundamentalQuality,
      topSignals: enhancedFundamental.topSignals,
    } : null,
    indiaIntelligence: indiaSignals ? {
      signals: indiaSignals.signals,
      giftNifty: indiaSignals.giftNifty,
      upcomingEvents: indiaSignals.upcomingEvents,
      sectorRotation: indiaSignals.sectorRotation,
      resultsSeason: indiaSignals.resultsSeason,
      delta: indiaSignals.indiaDelta,
    } : null,
    verification: {
      strictVerification,
      verifiedHeadlineCount: newsSummary.verifiedCount,
      officialHeadlineCount: newsSummary.officialCount,
      headlineCount: newsSummary.newsCount,
      companySpecificCount: newsSummary.companySpecificCount,
      highCredibilityCount: newsSummary.highCredibilityCount,
      realTimeHeadlineCount: newsSummary.realTimeCount,
      avgSourceCredibility: newsSummary.avgCredibility,
      evidenceGrade: newsSummary.evidenceGrade,
      latestHeadlineAt: newsSummary.latestPublishedAt,
      marketSource: bundle.quote.source,
      fundamentalsSource: bundle.fundamentals.source,
    },
    evidence: {
      grade: newsSummary.evidenceGrade,
      note: newsSummary.credibilityNote,
      latestHeadlineAt: newsSummary.latestPublishedAt,
      realTimeHeadlineCount: newsSummary.realTimeCount,
      highCredibilityCount: newsSummary.highCredibilityCount,
      avgCredibility: newsSummary.avgCredibility,
    },
    macroDrivers: eventExposure.drivers,
    eventExposure,
    technicalSnapshot: bundle.technical,
    fundamentals: bundle.fundamentals,
    marketContext,
    newsSummary,
    news: newsSummary.headlines.map((item) => ({
      headline: item.headline,
      source: item.source,
      publishedAt: item.publishedAt,
      verified: item.verified,
      official: item.official,
      verificationCount: item.verificationCount,
      freshnessScore: item.freshnessScore,
      tags: item.tags || [],
      sentiment: item.sentiment.label,
      summary: item.summary,
      url: item.url,
    })),
  });
}

function buildMultiStrategySummary(row, preferredStrategy = "swing") {
  if (!row) {
    return null;
  }

  const strategy = normalizeAnalysisStrategy(row.strategy);
  const tradeDecision = row.tradeDecision || row.decisionEngine?.tradeDecision || {};
  const executionPlan = row.executionPlan || row.decisionEngine?.executionPlan || {};
  const candlestickAnalysis = row.candlestickAnalysis || row.decisionEngine?.candlestickAnalysis || {};
  const dataCoverage = row.decisionEngine?.dataCoverage || {};
  const verification = row.verification || {};
  const newsSummary = row.newsSummary || {};

  return {
    strategy,
    label: getStrategyLabel(strategy),
    isPrimary: strategy === normalizeAnalysisStrategy(preferredStrategy),
    horizonDays: row.horizonDays,
    symbol: row.symbol,
    companyName: row.companyName,
    verdict: row.verdict,
    confidence: row.confidence,
    adjustedScore: row.adjustedScore,
    recommendation: row.recommendation,
    thesis: row.thesis,
    quote: row.quote,
    targets: row.targets,
    scoreBreakdown: row.scoreBreakdown,
    candlestickStatus: row.candlestickStatus || deriveCandlestickStatus(row),
    recommendationSummary: row.recommendation?.summary || row.thesis || "",
    recommendation: row.recommendation || null,
    catalysts: (row.catalysts || []).slice(0, 4),
    risks: (row.risks || []).slice(0, 4),
    evidenceFor: (row.buyReasons || []).slice(0, 4),
    evidenceAgainst: (row.sellReasons || []).slice(0, 4),
    monitorPoints: (row.monitorPoints || []).slice(0, 4),
    verification: {
      evidenceGrade: verification.evidenceGrade || newsSummary.evidenceGrade || "--",
      headlineCount: verification.headlineCount ?? newsSummary.newsCount ?? 0,
      verifiedHeadlineCount: verification.verifiedHeadlineCount ?? newsSummary.verifiedCount ?? 0,
      officialHeadlineCount: verification.officialHeadlineCount ?? newsSummary.officialCount ?? 0,
      realTimeHeadlineCount: verification.realTimeHeadlineCount ?? newsSummary.realTimeCount ?? 0,
      highCredibilityCount: verification.highCredibilityCount ?? newsSummary.highCredibilityCount ?? 0,
      marketSource: verification.marketSource || row.quote?.source || "--",
      fundamentalsSource: verification.fundamentalsSource || row.fundamentals?.source || "--",
      sourceCoverage: (newsSummary.sourceCoverage || []).slice(0, 6),
    },
    dataCoverage: {
      available: (dataCoverage.available || []).slice(0, 6),
      missingCritical: (dataCoverage.missingCritical || []).slice(0, 4),
      missingSupporting: (dataCoverage.missingSupporting || []).slice(0, 4),
      coverageScore: dataCoverage.coverageScore ?? null,
      confidencePenalty: dataCoverage.confidencePenalty ?? null,
    },
    topDrivers: (row.decisionEngine?.topMarketDrivers || []).slice(0, 3),
    candlestick: {
      timeframe: candlestickAnalysis.timeframe || "daily",
      analysisTimeframes: candlestickAnalysis.analysisTimeframes || {
        pattern: candlestickAnalysis.timeframe || "daily",
        trend: "weekly",
      },
      detectedPattern: candlestickAnalysis.detectedPattern || "No high-quality pattern",
      summary: candlestickAnalysis.summary || "Candlestick context is not available yet.",
      context: candlestickAnalysis.context || {},
      kind: candlestickAnalysis.kind || "Unknown",
      strength: candlestickAnalysis.strength || "Weak",
      signalQuality: candlestickAnalysis.signalQuality || candlestickAnalysis.strength || "Weak",
      qualityScore: candlestickAnalysis.qualityScore ?? null,
      validity: candlestickAnalysis.validity || "Ignore",
      notes: candlestickAnalysis.notes || [],
      trigger: candlestickAnalysis.trigger || "Wait for stronger candle confirmation before using it as a trigger.",
      candidates: candlestickAnalysis.candidates || [],
    },
    tradeDecision: {
      action: tradeDecision.action || "NO_TRADE",
      status: tradeDecision.status || "WAIT - CONDITIONS NOT MET",
      riskReward: tradeDecision.riskReward ?? null,
      invalidationLevel: tradeDecision.invalidationLevel || executionPlan.hardStopLoss || executionPlan.stopLoss || row.targets?.stopLoss || null,
    },
    executionPlan: {
      entryType: executionPlan.entryType || "Wait",
      entry: executionPlan.entry ?? null,
      stopLoss: executionPlan.stopLoss || executionPlan.hardStopLoss || row.targets?.stopLoss || null,
    },
  };
}

function verdictBias(verdict = "") {
  if (String(verdict || "").includes("BUY")) {
    return "bullish";
  }
  if (String(verdict || "").includes("SELL")) {
    return "bearish";
  }
  return "neutral";
}

function strategyFocusPriority(strategy = "") {
  const order = ["swing", "position", "longterm", "intraday"];
  const index = order.indexOf(normalizeAnalysisStrategy(strategy));
  return index === -1 ? order.length : index;
}

function rankStrategyFocus(row) {
  const verdictWeight = {
    STRONG_BUY: 12,
    BUY: 8,
    HOLD: 4,
    SELL: 2,
    STRONG_SELL: 0,
  };

  const verdictBonus = verdictWeight[row?.verdict] ?? 2;
  const adjustedScore = Number(row?.adjustedScore || 0);
  const confidence = Number(row?.confidence || 0);
  const coverageScore = Number(row?.decisionEngine?.dataCoverage?.coverageScore || 0);

  return adjustedScore + confidence * 0.22 + coverageScore * 0.08 + verdictBonus - strategyFocusPriority(row?.strategy) * 0.35;
}

function choosePrimaryStrategyRow(rows = [], requestedStrategy = "") {
  const normalizedRequested = requestedStrategy ? normalizeAnalysisStrategy(requestedStrategy) : "";
  if (normalizedRequested) {
    const exact = rows.find((row) => row.strategy === normalizedRequested);
    if (exact) {
      return {
        row: exact,
        mode: "explicit",
      };
    }
  }

  const ranked = [...rows].sort((left, right) => {
    const delta = rankStrategyFocus(right) - rankStrategyFocus(left);
    if (delta !== 0) {
      return delta;
    }
    return strategyFocusPriority(left.strategy) - strategyFocusPriority(right.strategy);
  });

  return {
    row: ranked[0] || null,
    mode: normalizedRequested ? "fallback" : "consensus",
  };
}

function buildStrategyConsensus(strategyViews = [], primaryView = null, selectionMode = "consensus", matchedStrategies = []) {
  const counts = {
    bullish: 0,
    bearish: 0,
    neutral: 0,
  };

  for (const view of strategyViews) {
    counts[verdictBias(view.verdict)] += 1;
  }

  const total = strategyViews.length || 0;
  const avgConfidence = total
    ? Number((strategyViews.reduce((sum, view) => sum + Number(view.confidence || 0), 0) / total).toFixed(1))
    : 0;
  const strongest = [...strategyViews].sort((left, right) => Number(right.adjustedScore || 0) - Number(left.adjustedScore || 0))[0] || null;
  const weakest = [...strategyViews].sort((left, right) => Number(left.adjustedScore || 0) - Number(right.adjustedScore || 0))[0] || null;

  let alignment = "Mixed across timeframes";
  if (counts.bullish === total && total > 0) {
    alignment = "Bullish across every timeframe";
  } else if (counts.bearish === total && total > 0) {
    alignment = "Bearish across every timeframe";
  } else if (counts.neutral === total && total > 0) {
    alignment = "Neutral across every timeframe";
  } else if (counts.bullish > counts.bearish) {
    alignment = `Bullish bias across ${counts.bullish}/${total} strategies`;
  } else if (counts.bearish > counts.bullish) {
    alignment = `Bearish bias across ${counts.bearish}/${total} strategies`;
  }

  const leadText = primaryView
    ? selectionMode === "explicit"
      ? `${primaryView.label} remains the requested focus.`
      : `${primaryView.label} currently offers the clearest lead signal.`
    : "";

  return {
    alignment,
    summary: `${alignment}. ${leadText}`.trim(),
    selectionMode,
    matchedStrategies,
    bullishCount: counts.bullish,
    bearishCount: counts.bearish,
    neutralCount: counts.neutral,
    avgConfidence,
    strongestStrategy: strongest ? { strategy: strongest.strategy, label: strongest.label, verdict: strongest.verdict } : null,
    weakestStrategy: weakest ? { strategy: weakest.strategy, label: weakest.label, verdict: weakest.verdict } : null,
  };
}

function buildAllStrategiesAnswer({ symbol = "", consensus = null, strategyViews = [], primaryView = null }) {
  const lanes = strategyViews.map((view) => `${view.label} ${formatVerdictText(view.verdict)}`).join(", ");
  const evidenceLine = primaryView?.recommendationSummary || primaryView?.thesis || "";
  return [
    symbol ? `${symbol}:` : "",
    consensus?.summary || "Cross-strategy view is ready.",
    lanes ? `Timeframe map: ${lanes}.` : "",
    evidenceLine,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export async function analyzeMarket(payload = {}) {
  const strategy = normalizeAnalysisStrategy(payload.strategy || "swing");
  const inputStocks = Array.isArray(payload.stocks) && payload.stocks.length > 0 ? payload.stocks.filter(Boolean) : [];
  const symbols = Array.isArray(payload.symbols) && payload.symbols.length > 0 ? payload.symbols : getDefaultWatchlist();
  const strictVerification = payload.strictVerification !== false;
  const includeTargetedNews = payload.includeTargetedNews !== false;
  const targetedNewsLimit = Number.isFinite(Number(payload.newsTargetedLimit))
    ? Math.max(0, Number(payload.newsTargetedLimit))
    : Math.min((inputStocks.length || symbols.length), 8);
  const horizonDays = resolveHorizonDays(strategy, payload.horizonDays);
  const stocks = inputStocks.length > 0 ? inputStocks : await resolveStocksAny(symbols);

  if (stocks.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      strategy,
      horizonDays,
      marketContext: null,
      macroSignals: [],
      eventRadar: [],
      results: [],
      alerts: [],
      disclaimer: "No supported NSE symbols were provided.",
    };
  }

  const [marketContext, symbolNews, globalNews, bundles] = await Promise.all([
    getMarketContext(),
    getNewsForSymbols(stocks.map((stock) => stock.symbol), stocks, {
      includeTargeted: includeTargetedNews,
      targetedLimit: targetedNewsLimit,
      forceRefresh: payload.forceNewsRefresh === true,
    }),
    getNewsIntelligence(),
    Promise.all(stocks.map((stock) => resolveStockBundle(stock))),
  ]);

  // ── Phase 1-5: Parallel enrichment for all stocks ──
  const enrichments = await Promise.all(
    bundles.map(async (bundle) => {
      if (!bundle?.stock || !bundle?.quote) return { options: null, advanced: null, fundamental: null, india: null };
      const symbol = bundle.stock.symbol;
      const candles = bundle.candles || [];
      const [options, advanced, fundamental, india] = await Promise.allSettled([
        enrichWithOptionsData(symbol, bundle.quote?.price),
        Promise.resolve(candles.length >= 20 ? computeEnhancedTechnicalScore(candles, bundle.technical?.score || 50) : null),
        Promise.resolve(computeEnhancedFundamentalScore(bundle.fundamentals, bundle.stock, strategy)),
        enrichWithIndiaSignals(symbol, bundle.stock, marketContext),
      ]);
      return {
        options: options.status === "fulfilled" ? options.value : null,
        advanced: advanced.status === "fulfilled" ? advanced.value : null,
        fundamental: fundamental.status === "fulfilled" ? fundamental.value : null,
        india: india.status === "fulfilled" ? india.value : null,
      };
    })
  );

  const results = [];
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    const enrich = enrichments[i] || {};
    const row = buildAnalysisRowFromBundle({
      bundle: {
        ...bundle,
        horizonDays,
      },
      marketContext,
      symbolNews,
      globalNews,
      strategy,
      strictVerification,
      optionsData: enrich.options,
      advancedTechnical: enrich.advanced,
      enhancedFundamental: enrich.fundamental,
      indiaSignals: enrich.india,
    });
    if (row) {
      results.push(row);
    }
  }

  results.sort((left, right) => right.adjustedScore - left.adjustedScore);

  const alerts = results
    .filter((row) => ["STRONG_BUY", "BUY"].includes(row.verdict))
    .slice(0, 6)
    .map((row) => ({
      symbol: row.symbol,
      verdict: row.verdict,
      confidence: row.confidence,
      reason: row.buyReasons?.[0] || row.catalysts?.[0] || `${row.sector} setup remains constructive`,
      verifiedHeadlineCount: row.verification.verifiedHeadlineCount,
      officialHeadlineCount: row.verification.officialHeadlineCount,
    }));

  return {
    generatedAt: new Date().toISOString(),
    strategy,
    horizonDays,
    marketContext,
    _bundles: payload?._returnBundles ? bundles : undefined,
    macroSignals: [...(globalNews.official || []), ...(globalNews.geopolitical || []), ...(globalNews.macro || [])]
      .slice(0, 12)
      .map((item) => ({
        headline: item.headline,
        source: item.source,
        publishedAt: item.publishedAt,
        summary: item.summary,
        verificationCount: item.verificationCount,
        official: item.official,
        tags: item.tags || [],
        url: item.url,
      })),
    eventRadar: globalNews.eventRadar || [],
    results,
    alerts,
    disclaimer: "This output is an analysis aid for the Indian market. It uses live and public data, but it cannot guarantee perfect accuracy or outcomes. Verify execution, liquidity, and your own risk limits before trading.",
  };
}

// Small helper: race a promise against a timeout. If it times out, resolve to
// `fallback` instead of rejecting. Keeps the dashboard fast even when one
// optional enrichment step hangs.
function raceOrFallback(promise, ms, fallback, label = "op") {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(`[buildDashboard] ${label} timed out after ${ms}ms — using fallback`);
      resolve(fallback);
    }, ms)),
  ]);
}

export async function buildDashboard(query = {}) {
  const selectedSymbols = typeof query.symbols === "string" && query.symbols.trim()
    ? query.symbols.split(",").map((value) => value.trim()).filter(Boolean)
    : getDefaultWatchlist();
  const strategy = String(query.strategy || "swing");
  // Lite mode: skip the two heaviest optional enrichments to guarantee a
  // sub-10-second response on cold start. Consumed via `?lite=true`.
  const liteMode = query.lite === true || query.lite === "true";

  const analysis = await analyzeMarket({
    symbols: selectedSymbols,
    strategy,
    strictVerification: query.strictVerification !== "false",
    horizonDays: resolveHorizonDays(strategy, query.horizonDays),
    _returnBundles: true,
  });

  let focus = analysis.results[0] || null;
  let watchlist = analysis.results;
  let marketWideOpportunities = null;
  const focusBundle = analysis._bundles?.[0];

  if (!liteMode) {
    // Top-signals snapshot is optional — 4 s ceiling. If slow, we serve the
    // dashboard without market-wide opportunities and the UI renders a hint.
    try {
      const { topSignalsService } = await import("./top-signals-service.mjs");
      marketWideOpportunities = await raceOrFallback(
        topSignalsService.getOpportunitySnapshot(strategyToOpportunityTimeframe(strategy), 3),
        4000,
        null,
        "topSignalsService.getOpportunitySnapshot",
      );
    } catch {
      marketWideOpportunities = null;
    }
  }

  if (focus) {
    // enrichRowDeep adds ATR / divergence / flow details. It's optional —
    // cap at 4 s and fall back to the un-enriched focus row on timeout.
    const enrichedFocus = liteMode
      ? focus
      : await raceOrFallback(
          enrichRowDeep(focus, focusBundle?.candles || [], analysis.marketContext || {}),
          4000,
          focus,
          "enrichRowDeep(focus)",
        );
    focus = attachMarketWideContext(enrichedFocus, marketWideOpportunities);
    watchlist = [focus, ...analysis.results.slice(1)];
  }

  return {
    generatedAt: analysis.generatedAt,
    marketContext: analysis.marketContext,
    focus,
    marketWideOpportunities,
    leaders: watchlist.slice(0, 4),
    watchlist,
    alerts: analysis.alerts,
    macroSignals: analysis.macroSignals,
    eventRadar: analysis.eventRadar,
    summary: {
      totalCovered: watchlist.length,
      buySignals: watchlist.filter((row) => row.verdict === "BUY" || row.verdict === "STRONG_BUY").length,
      sellSignals: watchlist.filter((row) => row.verdict === "SELL" || row.verdict === "STRONG_SELL").length,
      avgConfidence: watchlist.length
        ? Number((watchlist.reduce((sum, row) => sum + row.confidence, 0) / watchlist.length).toFixed(1))
        : 0,
    },
    disclaimer: analysis.disclaimer,
    _lite: liteMode,
  };
}

export async function getStockIntelligence(payload = {}) {
  const rawSymbol = String(payload.symbol || "").trim().toUpperCase();
  const strategy = normalizeAnalysisStrategy(payload.strategy || "swing");
  const horizonDays = resolveHorizonDays(strategy, payload.horizonDays);
  const strictVerification = payload.strictVerification !== false;
  const resolved = await resolveStockAny(rawSymbol);
  const symbol = resolved?.symbol || rawSymbol;

  const analysis = await analyzeMarket({
    symbols: [symbol],
    strategy,
    horizonDays,
    strictVerification,
    _returnBundles: true,
  });
  const bundles = analysis._bundles || [];
  const row = analysis.results[0];
  if (!row) {
    const suggestions = await searchAnyUniverse(symbol, 5);
    return {
      found: false,
      symbol,
      answer: `I could not analyze ${symbol} because it is not in the current Superbrain universe.`,
      suggestions: suggestions.map((item) => ({
        symbol: item.symbol,
        companyName: item.name,
      })),
    };
  }

  let marketWideOpportunities = null;
  try {
    const { topSignalsService } = await import("./top-signals-service.mjs");
    marketWideOpportunities = await topSignalsService.getOpportunitySnapshot(strategyToOpportunityTimeframe(strategy), 3);
  } catch {
    marketWideOpportunities = null;
  }

  // Pass bundle candles for god-level ATR/divergence computation
  const focusBundle = bundles?.[0];
  const enriched = attachMarketWideContext(
    await enrichRowDeep(row, focusBundle?.candles || [], analysis.marketContext || {}),
    marketWideOpportunities
  );

  return {
    found: true,
    generatedAt: analysis.generatedAt,
    symbol: enriched.symbol,
    companyName: enriched.companyName,
    strategy,
    horizonDays,
    answer: buildAnswer(enriched),
    recommendation: enriched.recommendation,
    analysis: enriched,
    decisionEngine: enriched.decisionEngine,
    marketWideOpportunities,
    marketContext: analysis.marketContext,
    macroSignals: analysis.macroSignals.slice(0, 6),
    eventRadar: analysis.eventRadar,
    disclaimer: analysis.disclaimer,
  };
}

export async function getStockIntelligenceAllStrategies(payload = {}) {
  const rawSymbol = String(payload.symbol || "").trim().toUpperCase();
  const requestedStrategy = payload.strategy ? normalizeAnalysisStrategy(payload.strategy) : "";
  const strictVerification = payload.strictVerification !== false;
  const resolved = await resolveStockAny(rawSymbol);
  const symbol = resolved?.symbol || rawSymbol;
  const stock = resolved || await resolveStockAny(symbol);

  if (!stock) {
    const suggestions = await searchAnyUniverse(symbol, 5);
    return {
      found: false,
      symbol,
      answer: `I could not analyze ${symbol} because it is not in the current Superbrain universe.`,
      suggestions: suggestions.map((item) => ({
        symbol: item.symbol,
        companyName: item.name,
      })),
    };
  }

  const [marketContext, symbolNews, globalNews, bundle] = await Promise.all([
    getMarketContext(),
    getNewsForSymbols([stock.symbol], [stock], {
      includeTargeted: payload.includeTargetedNews !== false,
      targetedLimit: Math.max(1, Number(payload.newsTargetedLimit || 1)),
      forceRefresh: payload.forceNewsRefresh === true,
    }),
    getNewsIntelligence(),
    resolveStockBundle(stock),
  ]);

  if (!bundle?.quote) {
    const suggestions = await searchAnyUniverse(symbol, 5);
    return {
      found: false,
      symbol,
      answer: `I could not analyze ${symbol} because quote data is unavailable right now.`,
      suggestions: suggestions.map((item) => ({
        symbol: item.symbol,
        companyName: item.name,
      })),
    };
  }

  // ── Phase 2-5 enrichments for the search path ────────────────────────────
  // In analyzeMarket these run per-bundle; here we run them once for the
  // searched stock so Adv. Technical, Frameworks, India Intel, and Options
  // tabs all receive real data instead of showing empty "requires search" states.
  const candles = bundle?.candles || [];
  const [optionsEnrich, advEnrich, fundEnrich, indiaEnrich] = await Promise.allSettled([
    raceOrFallback(
      enrichWithOptionsData(symbol, bundle.quote?.price),
      3000, null, "ask:options",
    ),
    Promise.resolve(
      candles.length >= 20
        ? computeEnhancedTechnicalScore(candles, bundle.technical?.score || 50)
        : null,
    ),
    Promise.resolve(
      computeEnhancedFundamentalScore(bundle.fundamentals, bundle.stock, requestedStrategy || "swing"),
    ),
    raceOrFallback(
      enrichWithIndiaSignals(symbol, stock, marketContext),
      3000, null, "ask:india",
    ),
  ]);
  const askEnrichments = {
    options: optionsEnrich.status === "fulfilled" ? optionsEnrich.value : null,
    advanced: advEnrich.status === "fulfilled" ? advEnrich.value : null,
    fundamental: fundEnrich.status === "fulfilled" ? fundEnrich.value : null,
    india: indiaEnrich.status === "fulfilled" ? indiaEnrich.value : null,
  };

  const strategyRows = MULTI_STRATEGY_ORDER
    .map((strategyKey) => buildAnalysisRowFromBundle({
      bundle: {
        ...bundle,
        horizonDays: strategyKey === requestedStrategy ? payload.horizonDays : undefined,
      },
      marketContext,
      symbolNews,
      globalNews,
      strategy: strategyKey,
      strictVerification,
      // Attach Phase 2-5 data so new tabs show real content on stock search.
      optionsData: askEnrichments.options,
      advancedTechnical: askEnrichments.advanced,
      enhancedFundamental: askEnrichments.fundamental,
      indiaSignals: askEnrichments.india,
    }))
    .filter(Boolean);

  const primarySelection = choosePrimaryStrategyRow(strategyRows, requestedStrategy);
  const primaryBase = primarySelection.row || strategyRows[0] || null;
  if (!primaryBase) {
    return {
      found: false,
      symbol,
      answer: `I could not build a complete analysis for ${symbol} right now.`,
      suggestions: [],
    };
  }

  let marketWideOpportunities = null;
  try {
    const { topSignalsService } = await import("./top-signals-service.mjs");
    // 4 s cap — same guard as buildDashboard. Fails fast so the ask response
    // returns even when topSignalsService is backed up.
    marketWideOpportunities = await raceOrFallback(
      topSignalsService.getOpportunitySnapshot(strategyToOpportunityTimeframe(primaryBase.strategy), 3),
      4000,
      null,
      "ask:topSignalsService.getOpportunitySnapshot",
    );
  } catch {
    marketWideOpportunities = null;
  }

  const enrichedPrimary = attachMarketWideContext(
    await raceOrFallback(
      enrichRowDeep(primaryBase, bundle?.candles || [], marketContext || {}),
      4000,
      primaryBase,
      "ask:enrichRowDeep",
    ),
    marketWideOpportunities
  );
  const strategyViews = strategyRows.map((row) => buildMultiStrategySummary(row, primaryBase.strategy)).filter(Boolean);
  const primarySummary = strategyViews.find((entry) => entry.strategy === primaryBase.strategy) || strategyViews[0] || null;
  const strategyConsensus = buildStrategyConsensus(strategyViews, primarySummary, primarySelection.mode, payload.matchedStrategies || []);
  const strategySelection = {
    mode: primarySelection.mode,
    requestedStrategy: requestedStrategy || null,
    matchedStrategies: payload.matchedStrategies || [],
    primaryStrategy: primarySummary?.strategy || primaryBase.strategy,
    primaryLabel: primarySummary?.label || getStrategyLabel(primaryBase.strategy),
  };
  const answer = buildAllStrategiesAnswer({
    symbol: enrichedPrimary.symbol,
    consensus: strategyConsensus,
    strategyViews,
    primaryView: primarySummary,
  });

  return {
    found: true,
    generatedAt: new Date().toISOString(),
    symbol: enrichedPrimary.symbol,
    companyName: enrichedPrimary.companyName,
    strategy: primaryBase.strategy,
    strategyLabel: getStrategyLabel(primaryBase.strategy),
    horizonDays: enrichedPrimary.horizonDays,
    answer,
    recommendation: enrichedPrimary.recommendation,
    analysis: enrichedPrimary,
    decisionEngine: enrichedPrimary.decisionEngine,
    marketWideOpportunities,
    marketContext,
    macroSignals: [...(globalNews.official || []), ...(globalNews.geopolitical || []), ...(globalNews.macro || [])]
      .slice(0, 6)
      .map((item) => ({
        headline: item.headline,
        source: item.source,
        publishedAt: item.publishedAt,
        summary: item.summary,
        verificationCount: item.verificationCount,
        official: item.official,
        tags: item.tags || [],
        url: item.url,
      })),
    eventRadar: globalNews.eventRadar || [],
    allStrategies: strategyViews,
    primaryStrategyView: primarySummary,
    strategyConsensus,
    strategySelection,
    disclaimer: "This output is an analysis aid for the Indian market. It uses live and public data, but it cannot guarantee perfect accuracy or outcomes. Verify execution, liquidity, and your own risk limits before trading.",
  };
}

export async function askSuperbrain(payload = {}) {
  const query = String(payload.query || payload.symbol || "").trim();
  const strategyContext = inferStrategyContext(query, String(payload.strategy || "swing"));
  const strategy = strategyContext.strategy;
  const resolved = await findBestSymbolFromQuery(query, payload.symbol || "");
  const symbol = String(resolved.symbol || "").trim().toUpperCase();

  if (!symbol) {
    const suggestions = (resolved.candidates?.length ? resolved.candidates : await searchAnyUniverse(query, 5)).map((item) => ({
      symbol: item.symbol,
      companyName: item.name,
    }));
    return {
      found: false,
      query,
      answer: resolved.candidates?.length > 1
        ? "I found multiple matching stocks. Pick one from the suggestions so I can give a precise call."
        : "I could not confidently map that question to a supported Indian stock yet.",
      suggestions,
    };
  }

  if (payload.includeAllStrategies === false) {
    return getStockIntelligence({
      symbol,
      strategy,
      horizonDays: resolveHorizonDays(strategy, payload.horizonDays),
      strictVerification: payload.strictVerification !== false,
    });
  }

  return getStockIntelligenceAllStrategies({
    symbol,
    strategy: strategyContext.selectionMode === "explicit" ? strategy : "",
    matchedStrategies: strategyContext.matchedStrategies,
    horizonDays: resolveHorizonDays(strategy, payload.horizonDays),
    strictVerification: payload.strictVerification !== false,
  });
}
