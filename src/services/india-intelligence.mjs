/**
 * Superbrain India-Specific Intelligence Engine
 * Phase 5: Event Calendar, Sector Rotation, GIFT NIFTY,
 *           Results Season, Promoter Activity, Budget Stocks
 * Source: Indian Stock Market Master Manual Ch.1, Ch.10, Ch.17
 */

import { TTLCache } from "../utils/ttl-cache.mjs";
import { fetchJson } from "../utils/http.mjs";

const giftNiftyCache = new TTLCache(60_000);        // 1 min
const insiderCache = new TTLCache(6 * 60 * 60_000); // 6 hours
const eventCache = new TTLCache(24 * 60 * 60_000);  // 24 hours

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────
// GIFT NIFTY PRE-MARKET SIGNAL (Ch.1.4)
// ─────────────────────────────────────────────
export async function getGIFTNiftySignal() {
  const key = "gift_nifty_signal";
  const cached = giftNiftyCache.get(key);
  if (cached) return cached;

  try {
    // CME Group / SGX NIFTY equivalent
    // Try Yahoo Finance GIFT NIFTY proxy (NIFTY=F)
    const data = await fetchJson(
      "https://query1.finance.yahoo.com/v8/finance/chart/NIFTY50.NS?interval=5m&range=1d",
      { timeout: 8000 }
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const lastClose = safeNum(meta?.chartPreviousClose) || safeNum(meta?.previousClose);
    const currentPrice = safeNum(meta?.regularMarketPrice);

    if (!currentPrice || !lastClose) throw new Error("GIFT data unavailable");

    const gapPct = ((currentPrice - lastClose) / lastClose) * 100;
    const result = {
      currentFuturesPrice: Math.round(currentPrice),
      prevNSEClose: Math.round(lastClose),
      gapPct: Math.round(gapPct * 100) / 100,
      gapType: gapPct > 0.3 ? "GAP_UP" : gapPct < -0.3 ? "GAP_DOWN" : "FLAT",
      signal: classifyGapSignal(gapPct),
      interpretation: gapInterpretation(gapPct),
      source: "NSE_FUTURES_PROXY",
    };
    giftNiftyCache.set(key, result);
    return result;
  } catch (err) {
    return { available: false, reason: "GIFT NIFTY data unavailable", source: "UNAVAILABLE" };
  }
}

function classifyGapSignal(gapPct) {
  if (gapPct > 1.5) return "STRONG_GAP_UP";
  if (gapPct > 0.5) return "GAP_UP";
  if (gapPct > 0.2) return "SLIGHT_GAP_UP";
  if (gapPct < -1.5) return "STRONG_GAP_DOWN";
  if (gapPct < -0.5) return "GAP_DOWN";
  if (gapPct < -0.2) return "SLIGHT_GAP_DOWN";
  return "FLAT_OPEN";
}

function gapInterpretation(gapPct) {
  if (Math.abs(gapPct) > 1) {
    return `Large gap of ${gapPct > 0 ? "+" : ""}${Math.round(gapPct * 10) / 10}% — intraday confidence reduced. Gap-fade or gap-continuation strategies apply.`;
  }
  if (Math.abs(gapPct) > 0.3) {
    return `Normal gap of ${gapPct > 0 ? "+" : ""}${Math.round(gapPct * 10) / 10}% — adjust intraday entry accordingly.`;
  }
  return "Flat open expected — normal intraday conditions.";
}

// ─────────────────────────────────────────────
// INDIA ECONOMIC EVENT CALENDAR (Ch.10, Ch.17)
// ─────────────────────────────────────────────
export function getUpcomingIndianEvents() {
  const today = new Date();
  const month = today.getMonth() + 1; // 1-12
  const day = today.getDate();

  const events = [];

  // Results Seasons (approximate)
  if (month === 4 || month === 5) {
    events.push({
      type: "RESULTS_SEASON",
      name: "Q4/FY Results Season",
      impact: "HIGH",
      sectors: ["ALL"],
      description: "Full-year results. Maximum volatility across sectors. IV expansion expected.",
      tradingNote: "Avoid naked directional bets 48hrs before individual company results. Prefer straddles near results.",
    });
  }
  if (month === 7 || month === 8) {
    events.push({
      type: "RESULTS_SEASON",
      name: "Q1 Results Season",
      impact: "HIGH",
      sectors: ["ALL"],
      description: "Q1 (Apr-Jun) results. First monsoon data impacts FMCG, auto, agri.",
    });
  }
  if (month === 10 || month === 11) {
    events.push({
      type: "RESULTS_SEASON",
      name: "Q2 Results Season",
      impact: "HIGH",
      sectors: ["ALL"],
      description: "Q2 (Jul-Sep) results. Festive season data. Auto, consumer, FMCG focus.",
    });
  }
  if (month === 1 || month === 2) {
    events.push({
      type: "RESULTS_SEASON",
      name: "Q3 Results Season",
      impact: "HIGH",
      sectors: ["ALL"],
      description: "Q3 (Oct-Dec) results. Winter quarter — infrastructure, cement, real estate.",
    });
  }

  // Union Budget (Feb 1)
  if (month === 1 || (month === 2 && day < 5)) {
    events.push({
      type: "BUDGET",
      name: "Union Budget",
      date: `Feb 1, ${today.getFullYear()}`,
      impact: "EXTREME",
      sectors: ["Infrastructure", "Defense", "Railways", "FMCG", "Financials"],
      description: "Biggest single-day market event. Sector themes announced here shape 12-month narratives.",
      tradingNote: "Budget stocks: L&T, HAL, BEL, IRCTC, RVNL, NHB, LIC Housing. Buy 30 days before, sell on announcement.",
    });
  }

  // RBI MPC (6 meetings per year: Feb, Apr, Jun, Aug, Oct, Dec)
  const rbiMonths = [2, 4, 6, 8, 10, 12];
  if (rbiMonths.includes(month) && day <= 10) {
    events.push({
      type: "RBI_MPC",
      name: "RBI Monetary Policy Committee",
      impact: "HIGH",
      sectors: ["Financials", "Real Estate", "Auto", "Consumer"],
      description: "Rate decision impacts banks, NBFCs, real estate. Rate cut = broad bullish. Rate hike = Financials pressure.",
      tradingNote: "NIFTY BANK reacts most. Watch IT and FMCG as defensive plays if hawkish surprise.",
    });
  }

  // Derivatives Expiry (last Thursday of month)
  const lastThursday = getLastThursday(today.getFullYear(), month);
  const daysToExpiry = Math.round((lastThursday - today) / (1000 * 60 * 60 * 24));
  if (daysToExpiry >= 0 && daysToExpiry <= 7) {
    events.push({
      type: "FO_EXPIRY",
      name: `Monthly F&O Expiry`,
      daysAway: daysToExpiry,
      impact: daysToExpiry < 3 ? "HIGH" : "MEDIUM",
      sectors: ["ALL"],
      description: `Monthly F&O expiry in ${daysToExpiry} day(s). Gamma risk high. Max pain pinning effect accelerates.`,
      tradingNote: "OTM options lose value rapidly. Avoid long OTM options this close to expiry. Max pain magnet effect.",
    });
  }

  // Monsoon Season
  if (month >= 6 && month <= 9) {
    events.push({
      type: "MONSOON",
      name: "Monsoon Season",
      impact: "MEDIUM",
      sectors: ["Agriculture", "FMCG", "Rural", "Tractor"],
      description: "Monsoon progress affects rural consumption, agri stocks, FMCG rural demand. IMD weekly data.",
      tradingNote: "Above-normal monsoon = bullish for FMCG rural, Tractor (M&M, Escorts), fertilizers.",
    });
  }

  return {
    events: events.sort((a, b) => (b.impact === "EXTREME" ? 1 : 0) - (a.impact === "EXTREME" ? 1 : 0)),
    highestRisk: events.find((e) => e.impact === "EXTREME" || e.impact === "HIGH") || null,
    eventRiskScore: events.length > 0 ? Math.min(100, events.length * 20 + (events.some((e) => e.impact === "EXTREME") ? 30 : 0)) : 0,
  };
}

function getLastThursday(year, month) {
  const lastDay = new Date(year, month, 0);
  const dayOfWeek = lastDay.getDay();
  const offset = (dayOfWeek >= 4) ? dayOfWeek - 4 : dayOfWeek + 3;
  return new Date(year, month - 1, lastDay.getDate() - offset);
}

// ─────────────────────────────────────────────
// SECTOR ROTATION MODEL (Ch.17)
// Maps macro signals to sector bias
// ─────────────────────────────────────────────
export function getSectorRotationSignals(marketContext = {}) {
  const signals = [];
  const sector_recommendations = {};

  const { usdInr, brent, niftyChange } = marketContext;
  const usdInrChange = safeNum(marketContext?.usdInrChange, 0);
  const brentChange = safeNum(marketContext?.brentChange, 0);
  const niftyChangePct = safeNum(niftyChange, 0);

  // USD/INR impact
  if (usdInrChange > 0.5) {
    // INR weakening (USD strengthening)
    sector_recommendations["IT"] = { signal: "BULLISH", reason: "USD strength boosts IT export revenue in INR terms", score: 75 };
    sector_recommendations["Pharma"] = { signal: "BULLISH", reason: "Pharma exports benefit from INR weakness", score: 70 };
    sector_recommendations["Auto"] = { signal: "BEARISH", reason: "INR weakness raises import cost of components", score: 35 };
    signals.push("INR weakening — favor IT and Pharma exporters over importers");
  } else if (usdInrChange < -0.5) {
    // INR strengthening
    sector_recommendations["IT"] = { signal: "CAUTIOUS", reason: "INR strengthening reduces IT export revenue in INR", score: 45 };
    sector_recommendations["Consumer"] = { signal: "BULLISH", reason: "Stronger INR reduces import costs — good for FMCG", score: 65 };
    signals.push("INR strengthening — domestic-facing sectors preferred");
  }

  // Brent Oil impact
  if (brentChange > 3) {
    sector_recommendations["Energy"] = { signal: "BULLISH", reason: "Rising oil = OMC and oil producer benefit", score: 72 };
    sector_recommendations["Aviation"] = { signal: "BEARISH", reason: "Jet fuel cost rise pressures aviation margins", score: 30 };
    sector_recommendations["FMCG"] = { signal: "CAUTIOUS", reason: "Input cost pressure on FMCG raw materials", score: 45 };
    signals.push("Oil rising — Energy/OMC bullish, Aviation/FMCG under pressure");
  } else if (brentChange < -3) {
    sector_recommendations["Aviation"] = { signal: "BULLISH", reason: "Cheaper jet fuel improves airline margins", score: 70 };
    sector_recommendations["FMCG"] = { signal: "BULLISH", reason: "Lower input costs boost FMCG margins", score: 65 };
    signals.push("Oil falling — Aviation and FMCG margin expansion");
  }

  // Market direction
  if (niftyChangePct > 0) {
    sector_recommendations["Banks"] = { signal: "BULLISH", reason: "Banks lead in risk-on markets", score: 68 };
  } else if (niftyChangePct < -1) {
    sector_recommendations["FMCG"] = { ...sector_recommendations["FMCG"], signal: "DEFENSIVE", reason: "FMCG — bear market shelter" };
    sector_recommendations["Pharma"] = { ...sector_recommendations["Pharma"], signal: "DEFENSIVE", reason: "Pharma — defensive sector" };
    signals.push("Market falling — rotate to defensives: FMCG, Pharma, Utilities");
  }

  // Month-based seasonal patterns
  const month = new Date().getMonth() + 1;
  const seasonalSectors = getSeasonalSectors(month);
  if (seasonalSectors) {
    sector_recommendations[seasonalSectors.sector] = {
      signal: "SEASONAL_BULLISH",
      reason: seasonalSectors.reason,
      score: 60,
    };
    signals.push(`Seasonal play: ${seasonalSectors.reason}`);
  }

  return {
    signals,
    sectorRecommendations: sector_recommendations,
    topBullishSectors: Object.entries(sector_recommendations)
      .filter(([, v]) => v.signal === "BULLISH" || v.signal === "SEASONAL_BULLISH")
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 3)
      .map(([sector, data]) => ({ sector, ...data })),
    topBearishSectors: Object.entries(sector_recommendations)
      .filter(([, v]) => v.signal === "BEARISH")
      .map(([sector, data]) => ({ sector, ...data })),
  };
}

function getSeasonalSectors(month) {
  const patterns = {
    10: { sector: "Auto", reason: "Oct-Nov festive season peak — auto sales surge (Dhanteras, Diwali)" },
    11: { sector: "Consumer", reason: "Diwali quarter — retail, consumer goods seasonal peak" },
    12: { sector: "Infrastructure", reason: "Dec-Jan govt spending surge — infra capex deployment" },
    1: { sector: "Infrastructure", reason: "Jan — pre-budget infrastructure ordering season" },
    2: { sector: "Defense", reason: "Feb — Budget month — defense allocation announcement" },
    6: { sector: "FMCG", reason: "Jun — Early monsoon — rural stock-up demand" },
  };
  return patterns[month] || null;
}

// ─────────────────────────────────────────────
// RESULTS SEASON DETECTOR
// ─────────────────────────────────────────────
export function isInResultsSeason() {
  const month = new Date().getMonth() + 1;
  const resultMonths = [4, 5, 7, 8, 10, 11, 1, 2]; // Approx result windows
  const isInSeason = resultMonths.includes(month);
  return {
    isInSeason,
    season: getResultsSeasonLabel(month),
    tradingImplication: isInSeason
      ? "Results season active — IV elevated. Avoid naked options near company-specific results. Prefer spreads."
      : "Off-season — normal market conditions. Lower event risk.",
    ivExpansionRisk: isInSeason ? "HIGH" : "LOW",
  };
}

function getResultsSeasonLabel(month) {
  if (month === 4 || month === 5) return "Q4/FY Annual Results";
  if (month === 7 || month === 8) return "Q1 Results";
  if (month === 10 || month === 11) return "Q2 Results (Festive Quarter)";
  if (month === 1 || month === 2) return "Q3 Results";
  return "Off-season";
}

// ─────────────────────────────────────────────
// INDIA-SPECIFIC SCORE ENRICHMENT
// Combines all India signals into an additive score delta
// ─────────────────────────────────────────────
export async function enrichWithIndiaSignals(symbol, stock, marketContext = {}) {
  const signals = [];
  let indiaDelta = 0;

  try {
    // GIFT NIFTY
    const giftSignal = await getGIFTNiftySignal().catch(() => null);
    if (giftSignal?.gapType) {
      if (giftSignal.gapType === "STRONG_GAP_UP") { indiaDelta += 8; signals.push("GIFT NIFTY: Strong gap-up expected"); }
      if (giftSignal.gapType === "STRONG_GAP_DOWN") { indiaDelta -= 8; signals.push("GIFT NIFTY: Strong gap-down expected"); }
    }

    // Event calendar
    const events = getUpcomingIndianEvents();
    if (events.highestRisk?.type === "FO_EXPIRY" && events.highestRisk?.daysAway < 3) {
      signals.push("F&O expiry < 3 days — gamma risk high");
    }
    if (events.highestRisk?.type === "RBI_MPC") {
      indiaDelta -= 5; // Uncertainty before MPC
      signals.push("RBI MPC meeting this week — rate decision risk");
    }

    // Sector rotation
    const sectorRotation = getSectorRotationSignals(marketContext);
    const stockSector = stock?.sector || "";
    const sectorReco = sectorRotation.sectorRecommendations[stockSector];
    if (sectorReco) {
      if (sectorReco.signal === "BULLISH" || sectorReco.signal === "SEASONAL_BULLISH") {
        indiaDelta += 8; signals.push(`Sector rotation: ${stockSector} bullish — ${sectorReco.reason}`);
      } else if (sectorReco.signal === "BEARISH") {
        indiaDelta -= 8; signals.push(`Sector rotation: ${stockSector} headwind — ${sectorReco.reason}`);
      }
    }

    // Results season
    const resultsSeason = isInResultsSeason();
    if (resultsSeason.isInSeason) {
      signals.push(`${resultsSeason.season} active — IV expansion risk`);
    }

    return {
      indiaDelta: Math.round(indiaDelta),
      signals,
      giftNifty: giftSignal,
      upcomingEvents: events.events.slice(0, 3),
      sectorRotation: sectorRotation.topBullishSectors.slice(0, 2),
      resultsSeason,
    };
  } catch (err) {
    return { indiaDelta: 0, signals: [], error: err.message };
  }
}

// ─────────────────────────────────────────────
// BUDGET STOCK SCREENER (Ch.17)
// Pre-budget (Nov-Jan) and post-budget plays
// ─────────────────────────────────────────────
export function isBudgetSensitiveStock(symbol = "", sector = "") {
  const budgetStocks = {
    "LTIM": "Infrastructure mega-projects",
    "LT": "Infrastructure & defense",
    "HAL": "Defense production",
    "BEL": "Defense electronics",
    "IRCTC": "Railway tourism",
    "RVNL": "Railway infrastructure",
    "IRCON": "Railway construction",
    "NBCC": "CPWD/housing projects",
    "NHPC": "Renewable energy",
    "NTPC": "Power sector capex",
    "HUDCO": "Affordable housing",
    "PNBHOUSING": "Housing finance",
  };

  const budgetSectors = ["infrastructure", "defense", "railways", "utilities", "real estate"];
  const month = new Date().getMonth() + 1;
  const isPreBudgetWindow = month >= 11 || month <= 2;

  const isKnownBudgetStock = Object.keys(budgetStocks).some((s) => symbol.toUpperCase().includes(s));
  const isBudgetSector = budgetSectors.some((s) => (sector || "").toLowerCase().includes(s));

  return {
    isBudgetSensitive: isKnownBudgetStock || isBudgetSector,
    isPreBudgetWindow,
    budgetTheme: budgetStocks[symbol.toUpperCase()] || (isBudgetSector ? `${sector} budget play` : null),
    strategy: isPreBudgetWindow && (isKnownBudgetStock || isBudgetSector)
      ? "Pre-budget accumulation window — budget announcements typically boost infra/defense/railways"
      : "Budget theme not in active accumulation window",
  };
}
