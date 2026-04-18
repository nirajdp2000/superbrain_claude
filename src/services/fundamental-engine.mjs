/**
 * Superbrain Fundamental Intelligence Engine
 * Phase 3: QGLP (Agrawal), Coffee Can (Mukherjea), SMILE (Kedia),
 *           Economic Moat (Buffett), Reverse DCF (Damodaran),
 *           Peter Lynch Categories, Accounting Red Flags
 * Source: Indian Stock Market Master Manual Ch.2
 */

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = safeNum(v);
  return n !== null ? Math.round(n * 100) / 100 : null;
}

// ─────────────────────────────────────────────
// QGLP FRAMEWORK (Raamdeo Agrawal, Motilal Oswal)
// Quality + Growth + Longevity + Price
// ─────────────────────────────────────────────
export function scoreQGLP(fundamentals = {}, stock = {}) {
  const scores = {};
  const signals = [];
  let totalScore = 0;

  // Q = Quality (ROE > 15%, clean governance, ROCE > 15%)
  const roe = safeNum(fundamentals.roe, 0);
  const roce = safeNum(fundamentals.roce, 0);
  const de = safeNum(fundamentals.debtToEquity, 99);
  const promoterHolding = safeNum(fundamentals.promoterHolding, 0);

  let qScore = 0;
  if (roe >= 20) { qScore += 40; signals.push("ROE > 20% — excellent quality"); }
  else if (roe >= 15) { qScore += 25; signals.push("ROE > 15% — quality threshold met"); }
  else if (roe >= 10) { qScore += 10; }
  else { signals.push("ROE < 10% — quality concern"); }

  if (roce >= 20) { qScore += 30; signals.push("ROCE > 20% — capital efficient"); }
  else if (roce >= 15) { qScore += 20; }
  if (de < 0.5) { qScore += 20; signals.push("Low debt — financial strength"); }
  else if (de > 2) { signals.push("High D/E > 2 — leverage risk"); qScore -= 10; }
  if (promoterHolding > 50) { qScore += 10; signals.push("Strong promoter conviction"); }
  scores.quality = Math.min(100, Math.max(0, qScore));

  // G = Growth (Revenue + Profit > 20% YoY)
  const salesGrowth = safeNum(fundamentals.salesGrowth3yr, 0);
  const profitGrowth = safeNum(fundamentals.profitGrowth3yr, 0);
  let gScore = 0;
  const avgGrowth = (salesGrowth + profitGrowth) / 2;
  if (avgGrowth >= 25) { gScore = 90; signals.push(`Growth ${Math.round(avgGrowth)}% — fast grower`); }
  else if (avgGrowth >= 20) { gScore = 75; signals.push("20%+ growth — Lynch Fast Grower territory"); }
  else if (avgGrowth >= 15) { gScore = 60; }
  else if (avgGrowth >= 10) { gScore = 40; }
  else { gScore = 20; signals.push("Sub-10% growth — stalwart at best"); }
  scores.growth = gScore;

  // L = Longevity (consistency proxy — requires 10yr data; use available fields as proxy)
  let lScore = 50; // Default — no 10yr history available
  if (salesGrowth > 10 && profitGrowth > 10) { lScore = 70; signals.push("Multi-year growth consistency indicated"); }
  if (roe > 15 && salesGrowth > 15) { lScore = 80; signals.push("Quality + Growth combo suggests durability"); }
  if (de < 0.3 && roe > 15) { lScore += 10; }
  scores.longevity = Math.min(100, lScore);

  // P = Price (PEG, EV/EBITDA proxy via PE vs growth)
  const pe = safeNum(fundamentals.pe, 25);
  let pScore = 0;
  const peg = avgGrowth > 0 ? pe / avgGrowth : 99;
  if (peg < 1) { pScore = 90; signals.push(`PEG ${round2(peg)} < 1 — excellent GARP value`); }
  else if (peg < 1.5) { pScore = 70; signals.push(`PEG ${round2(peg)} — reasonable growth price`); }
  else if (peg < 2) { pScore = 50; }
  else { pScore = 25; signals.push(`PEG ${round2(peg)} > 2 — expensive for growth`); }
  scores.price = pScore;

  totalScore = Math.round((scores.quality * 0.3) + (scores.growth * 0.3) + (scores.longevity * 0.2) + (scores.price * 0.2));

  return {
    framework: "QGLP",
    totalScore,
    scores,
    signals,
    verdict: totalScore >= 75 ? "STRONG_BUY_FUNDAMENTAL" : totalScore >= 60 ? "BUY_FUNDAMENTAL" : totalScore >= 45 ? "HOLD" : "AVOID",
    peg: round2(peg),
    interpretation: `QGLP: Q=${scores.quality} G=${scores.growth} L=${scores.longevity} P=${scores.price} → ${totalScore}/100`,
  };
}

// ─────────────────────────────────────────────
// COFFEE CAN FRAMEWORK (Saurabh Mukherjea)
// Revenue > 10% for 10yr AND ROCE > 15% for 10yr
// ─────────────────────────────────────────────
export function scoreCoffeeCan(fundamentals = {}, stock = {}) {
  // Without 10-year data we use available fields as proxy
  const salesGrowth = safeNum(fundamentals.salesGrowth3yr, 0);
  const profitGrowth = safeNum(fundamentals.profitGrowth3yr, 0);
  const roce = safeNum(fundamentals.roce, 0);
  const de = safeNum(fundamentals.debtToEquity, 99);
  const promoterHolding = safeNum(fundamentals.promoterHolding, 0);
  const dividendYield = safeNum(fundamentals.dividendYield, 0);

  const criteria = {
    revenueGrowth10pct: salesGrowth >= 10,
    profitGrowth10pct: profitGrowth >= 10,
    roce15pct: roce >= 15,
    cleanBalance: de < 2,
    promoterConviction: promoterHolding >= 40,
  };

  const metCount = Object.values(criteria).filter(Boolean).length;
  const score = Math.round((metCount / 5) * 100);
  const signals = [];
  if (criteria.revenueGrowth10pct) signals.push("✓ Revenue growth ≥ 10%");
  if (criteria.profitGrowth10pct) signals.push("✓ Profit growth ≥ 10%");
  if (criteria.roce15pct) signals.push("✓ ROCE ≥ 15%");
  if (criteria.cleanBalance) signals.push("✓ Clean balance sheet");
  if (criteria.promoterConviction) signals.push("✓ Strong promoter holding");
  if (!criteria.revenueGrowth10pct) signals.push("✗ Revenue growth < 10%");
  if (!criteria.roce15pct) signals.push("✗ ROCE < 15%");

  return {
    framework: "COFFEE_CAN",
    score,
    metCount,
    totalCriteria: 5,
    criteria,
    signals,
    isCandidate: metCount >= 4,
    verdict: metCount >= 5 ? "COFFEE_CAN_COMPLIANT" : metCount >= 4 ? "NEAR_COFFEE_CAN" : "DOES_NOT_QUALIFY",
    interpretation: `Coffee Can: ${metCount}/5 criteria met. ${metCount >= 4 ? "Hold forever candidate." : "Not a 10-year compounder yet."}`,
  };
}

// ─────────────────────────────────────────────
// SMILE FRAMEWORK (Vijay Kedia) — Multi-baggers
// Small size, Medium experience, large In aspiration,
// Large market, Elephant returns
// ─────────────────────────────────────────────
export function scoreSMILE(stock = {}, fundamentals = {}, marketCap = null) {
  const scores = {};
  const signals = [];
  let totalScore = 0;

  // S = Small in Size (market cap < 5000 Cr)
  const cap = safeNum(marketCap, null);
  if (cap !== null) {
    if (cap < 1000) { scores.small = 100; signals.push("Micro-cap — maximum upside potential"); }
    else if (cap < 5000) { scores.small = 80; signals.push("Small-cap — multi-bagger potential"); }
    else if (cap < 20000) { scores.small = 50; signals.push("Mid-cap — moderate upside headroom"); }
    else { scores.small = 20; signals.push("Large-cap — limited SMILE upside"); }
  } else {
    scores.small = 50;
  }

  // M = Medium experience (proxy: company age inferred from data availability)
  scores.mediumExperience = 60; // Default — age data not available in current fundamentals
  signals.push("Management experience: requires manual verification");

  // I = Large Aspiration (proxy: sales growth + capex signals)
  const salesGrowth = safeNum(fundamentals.salesGrowth3yr, 0);
  if (salesGrowth >= 25) { scores.aspiration = 90; signals.push("High growth ambition — 25%+ revenue growth"); }
  else if (salesGrowth >= 15) { scores.aspiration = 70; signals.push("Growing ambition — 15%+ revenue"); }
  else { scores.aspiration = 40; }

  // L = Large Market Potential (sector-based proxy)
  const sector = (stock.sector || "").toLowerCase();
  const highTailwindSectors = ["technology", "it", "healthcare", "pharma", "defense", "fintech", "consumer", "fmcg"];
  const isHighTailwind = highTailwindSectors.some((s) => sector.includes(s));
  scores.market = isHighTailwind ? 80 : 50;
  if (isHighTailwind) signals.push(`Sector "${stock.sector}" has India tailwind`);

  // E = Elephant returns (10x potential proxy — requires P/E vs growth room)
  const pe = safeNum(fundamentals.pe, 25);
  const profitGrowth = safeNum(fundamentals.profitGrowth3yr, 0);
  const growthMultiple = profitGrowth > 0 ? pe / profitGrowth : 99;
  if (growthMultiple < 1 && cap && cap < 5000) {
    scores.elephant = 95; signals.push("10x potential — high growth + low valuation + small cap");
  } else if (growthMultiple < 2) {
    scores.elephant = 70; signals.push("Strong return potential relative to growth");
  } else {
    scores.elephant = 40;
  }

  totalScore = Math.round(
    (scores.small * 0.25) + (scores.mediumExperience * 0.1) +
    (scores.aspiration * 0.25) + (scores.market * 0.2) + (scores.elephant * 0.2)
  );

  return {
    framework: "SMILE",
    totalScore,
    scores,
    signals,
    verdict: totalScore >= 70 ? "MULTI_BAGGER_CANDIDATE" : totalScore >= 55 ? "WATCHLIST" : "DOES_NOT_FIT",
    interpretation: `SMILE Score: ${totalScore}/100. ${totalScore >= 70 ? "Strong multi-bagger candidate per Vijay Kedia framework." : "Does not meet all SMILE criteria."}`,
  };
}

// ─────────────────────────────────────────────
// ECONOMIC MOAT CLASSIFIER (Warren Buffett, Ch.2.5)
// Brand, Network, Cost Advantage, Switching Cost, Regulatory
// ─────────────────────────────────────────────
export function detectMoat(fundamentals = {}, stock = {}) {
  const sector = (stock.sector || "").toLowerCase();
  const name = (stock.name || "").toLowerCase();
  const roe = safeNum(fundamentals.roe, 0);
  const roce = safeNum(fundamentals.roce, 0);
  const grossMarginProxy = roe; // Proxy — actual gross margin not in current data

  const moatSignals = [];
  let moatScore = 0;
  let moatType = "NONE";

  // Brand moat: high ROE, consumer sector
  const brandSectors = ["consumer", "fmcg", "retail", "auto"];
  if (brandSectors.some((s) => sector.includes(s)) && roe > 20) {
    moatScore += 30; moatType = "BRAND"; moatSignals.push("Brand moat — pricing power (consumer + high ROE)");
  }

  // Network effect: IT, fintech, platform
  const networkSectors = ["technology", "it", "fintech", "platform", "digital"];
  if (networkSectors.some((s) => sector.includes(s)) && salesGrowthProxy(fundamentals) > 15) {
    moatScore += 25; moatType = moatType === "NONE" ? "NETWORK_EFFECT" : moatType;
    moatSignals.push("Network effect moat — IT/platform business with scaling growth");
  }

  // Switching cost: IT services (TCS, Infosys pattern)
  if (sector.includes("it") || sector.includes("technology")) {
    moatScore += 20; moatSignals.push("Switching cost moat — deep IT integration");
  }

  // Regulatory moat: defense, utilities, infrastructure
  const regSectors = ["defense", "utilities", "infrastructure", "telecom", "pharma"];
  if (regSectors.some((s) => sector.includes(s)) && roce > 12) {
    moatScore += 25; moatType = "REGULATORY"; moatSignals.push("Regulatory/license moat — protected market position");
  }

  // Cost advantage: consistent margin maintenance
  if (roe > 15 && roce > 15) {
    moatScore += 20; moatSignals.push("Cost efficiency sustained → possible cost advantage");
  }

  // No moat signals
  if (roe < 10) moatSignals.push("Low ROE may indicate no durable moat");

  const moatWidth = moatScore >= 60 ? "WIDE" : moatScore >= 35 ? "NARROW" : "NONE";

  return {
    moatType: moatScore >= 35 ? moatType : "NONE",
    moatWidth,
    moatScore,
    moatSignals,
    interpretation: `${moatWidth} moat — ${moatScore >= 60 ? "Durable competitive advantage. Buffett-quality business." : moatScore >= 35 ? "Some competitive protection but not impenetrable." : "No clear moat identified."}`,
  };
}

function salesGrowthProxy(fundamentals) {
  return safeNum(fundamentals.salesGrowth3yr, 0);
}

// ─────────────────────────────────────────────
// PETER LYNCH CATEGORY CLASSIFIER (Ch.2.4)
// Slow Grower / Stalwart / Fast Grower / Cyclical / Turnaround / Asset Play
// ─────────────────────────────────────────────
export function classifyLynchCategory(fundamentals = {}, stock = {}) {
  const salesGrowth = safeNum(fundamentals.salesGrowth3yr, 0);
  const profitGrowth = safeNum(fundamentals.profitGrowth3yr, 0);
  const de = safeNum(fundamentals.debtToEquity, 0);
  const roe = safeNum(fundamentals.roe, 0);
  const pe = safeNum(fundamentals.pe, 20);
  const sector = (stock.sector || "").toLowerCase();
  const avgGrowth = (salesGrowth + profitGrowth) / 2;

  // Cyclical sectors
  const cyclicals = ["auto", "metals", "steel", "real estate", "energy", "cement"];
  const isCyclical = cyclicals.some((s) => sector.includes(s));

  let category, strategy, signal;

  if (isCyclical) {
    category = "CYCLICAL";
    strategy = "Buy when sector is hated, P/E is minimal or loss-making. Sell when analysts turn bullish.";
    signal = roe < 5 ? "Sector in downturn — potential contrarian buy" : "Sector performing — watch for peak";
  } else if (avgGrowth >= 20) {
    category = "FAST_GROWER";
    strategy = "Lynch's favourite — potential 10-bagger. Buy and hold through volatility. Sell when growth decelerates below 15%.";
    signal = "Fast Grower — look for simple scalable business, large TAM, low competition";
  } else if (avgGrowth >= 10 && avgGrowth < 20) {
    category = "STALWART";
    strategy = "Solid 10-15% grower. Expect 30-60% gains per cycle. Sell when P/E exceeds 1.5x historical average.";
    signal = "Stalwart — dependable blue chip. Buy at below-average P/E.";
  } else if (avgGrowth < 7 && avgGrowth >= 0) {
    category = "SLOW_GROWER";
    strategy = "Hold for dividends and stability. Bear market shelter. Sell when P/E spikes or dividend is cut.";
    signal = "Slow Grower — GDP-rate compounder. Own for income, not growth.";
  } else if (de > 1.5 && roe < 8) {
    category = "TURNAROUND";
    strategy = "High risk, high reward. Identify specific catalyst — debt reduction, new management, asset sale. Time horizon: 2-3 years.";
    signal = "Turnaround candidate — debt burden + low ROE. Needs credible recovery plan.";
  } else {
    category = "ASSET_PLAY";
    strategy = "Sum-of-parts value exceeds market cap. Patience required — value unlock via demerger/sale/buyback.";
    signal = "Possible hidden value in assets/investments/subsidiaries";
  }

  return {
    category,
    strategy,
    signal,
    avgGrowth: round2(avgGrowth),
    interpretation: `Peter Lynch: ${category}. ${signal}`,
  };
}

// ─────────────────────────────────────────────
// REVERSE DCF (Damodaran Method)
// What growth is the current price implying?
// ─────────────────────────────────────────────
export function reverseDAF(currentPrice, eps, pe) {
  if (!currentPrice || !eps || !pe) return null;

  // India risk-free rate (approximate 10Y G-Sec yield)
  const riskFreeRate = 7.2;
  const equityRiskPremium = 5.5;
  const betaProxy = 1.0;
  const wacc = riskFreeRate + betaProxy * equityRiskPremium; // ~12.7%

  // Implied growth: using simplified Gordon Growth Model inversion
  // P = EPS * (1 + g) / (WACC - g)
  // Solving for g: g = (P * WACC - EPS) / (P + EPS)
  const waccDecimal = wacc / 100;
  const impliedGrowth = ((currentPrice * waccDecimal) - eps) / (currentPrice + eps);
  const impliedGrowthPct = round2(impliedGrowth * 100);

  let signal, interpretation;
  if (impliedGrowthPct > 25) {
    signal = "OVERVALUED";
    interpretation = `Market pricing in ${impliedGrowthPct}% perpetual growth — almost certainly overvalued for most businesses`;
  } else if (impliedGrowthPct > 18) {
    signal = "RICHLY_VALUED";
    interpretation = `Market implies ${impliedGrowthPct}% growth — high expectations baked in`;
  } else if (impliedGrowthPct > 10) {
    signal = "FAIR_VALUE";
    interpretation = `Market implies ${impliedGrowthPct}% growth — reasonable expectation for quality business`;
  } else {
    signal = "UNDERVALUED";
    interpretation = `Market implies only ${impliedGrowthPct}% growth — low bar to beat for good businesses`;
  }

  return {
    impliedGrowthPct,
    wacc,
    signal,
    interpretation,
    message: `At ₹${currentPrice} the market is pricing in ${impliedGrowthPct}% perpetual growth. Compare to historical growth to judge valuation.`,
  };
}

// ─────────────────────────────────────────────
// ACCOUNTING RED FLAGS (Ch.2.10)
// ─────────────────────────────────────────────
export function detectAccountingRedFlags(fundamentals = {}, stock = {}) {
  const flags = [];
  const warnings = [];
  let severity = 0;

  const salesGrowth = safeNum(fundamentals.salesGrowth3yr, 0);
  const profitGrowth = safeNum(fundamentals.profitGrowth3yr, 0);
  const de = safeNum(fundamentals.debtToEquity, 0);
  const roe = safeNum(fundamentals.roe, 0);
  const roce = safeNum(fundamentals.roce, 0);

  // Revenue growing but profits not keeping up
  if (salesGrowth > 15 && profitGrowth < salesGrowth * 0.5) {
    flags.push("Revenue growing faster than profits — margin compression or aggressive recognition");
    severity += 20;
  }

  // High debt with low returns
  if (de > 2 && roce < 12) {
    flags.push("High D/E > 2 with ROCE < 12% — possible debt trap");
    severity += 25;
  }

  // ROE much higher than ROCE (debt-inflated ROE)
  if (roe > 0 && roce > 0 && roe > roce * 1.5) {
    flags.push("ROE significantly > ROCE — debt inflating return metrics");
    warnings.push("Cross-check: Is ROE artificially high due to leverage?");
    severity += 15;
  }

  // Very high debt in non-infrastructure sector
  const sector = (stock.sector || "").toLowerCase();
  const infraSectors = ["infrastructure", "utilities", "real estate", "telecom"];
  if (de > 3 && !infraSectors.some((s) => sector.includes(s))) {
    flags.push("D/E > 3 in non-infrastructure company — high financial risk");
    severity += 30;
  }

  // Profit without sales growth
  if (profitGrowth > 20 && salesGrowth < 5) {
    flags.push("Profit growth without revenue growth — possible cost-cutting or one-time gains");
    severity += 15;
  }

  const riskLevel = severity >= 50 ? "HIGH" : severity >= 25 ? "MEDIUM" : "LOW";

  return {
    flags,
    warnings,
    severity,
    riskLevel,
    count: flags.length,
    interpretation: flags.length > 0
      ? `${flags.length} accounting flag(s) detected. Risk: ${riskLevel}. Verify annual report before entry.`
      : "No major accounting red flags detected from available data.",
  };
}

// ─────────────────────────────────────────────
// MASTER FUNDAMENTAL SCORER
// Combines all frameworks into one score with breakdown
// ─────────────────────────────────────────────
export function computeEnhancedFundamentalScore(fundamentals = {}, stock = {}, strategy = "swing") {
  if (!fundamentals || fundamentals.source === "UNAVAILABLE") {
    return {
      enhancedScore: 50,
      available: false,
      reason: "Fundamentals unavailable",
    };
  }

  const qglp = scoreQGLP(fundamentals, stock);
  const coffeeCan = scoreCoffeeCan(fundamentals, stock);
  const moat = detectMoat(fundamentals, stock);
  const lynch = classifyLynchCategory(fundamentals, stock);
  const redFlags = detectAccountingRedFlags(fundamentals, stock);

  // Blend by strategy
  let blendedScore;
  if (strategy === "longterm") {
    blendedScore = (qglp.totalScore * 0.35) + (coffeeCan.score * 0.25) + (moat.moatScore * 0.25) + (50 * 0.15);
  } else if (strategy === "position") {
    blendedScore = (qglp.totalScore * 0.45) + (coffeeCan.score * 0.15) + (moat.moatScore * 0.2) + (50 * 0.2);
  } else {
    // swing/intraday — fundamentals are context only
    blendedScore = (qglp.totalScore * 0.5) + (coffeeCan.score * 0.1) + (moat.moatScore * 0.15) + (50 * 0.25);
  }

  // Red flag penalty
  blendedScore = Math.max(0, blendedScore - redFlags.severity * 0.3);

  return {
    enhancedScore: Math.round(Math.min(100, blendedScore)),
    available: true,
    qglp,
    coffeeCan,
    moat,
    lynch,
    redFlags,
    fundamentalQuality: blendedScore >= 70 ? "HIGH" : blendedScore >= 50 ? "MEDIUM" : "LOW",
    topSignals: [
      ...qglp.signals.slice(0, 2),
      moat.moatWidth !== "NONE" ? `${moat.moatWidth} moat: ${moat.moatType}` : null,
      redFlags.flags[0] || null,
    ].filter(Boolean).slice(0, 4),
  };
}
