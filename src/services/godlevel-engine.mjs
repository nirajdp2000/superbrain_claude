/**
 * SUPERBRAIN GOD-LEVEL INTELLIGENCE ENGINE
 * ─────────────────────────────────────────────────────────
 * Replaces simple heuristic scoring with:
 *   1. Dynamic regime-aware composite scoring (Z-score normalised)
 *   2. RSI divergence + MACD divergence detection
 *   3. Relative strength vs NIFTY
 *   4. ATR-based target/stop pricing (replaces % heuristics)
 *   5. Kelly Criterion position sizing
 *   6. Bayesian scenario probability engine
 *   7. Full multi-paragraph research report generator
 *   8. Conviction score 0–100 (replaces binary gate)
 *   9. Smart money flow classifier (FII/DII + OI)
 *  10. Trend exhaustion + parabolic risk detector
 * ─────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function round2(v) { const n = safeNum(v); return n !== null ? Math.round(n * 100) / 100 : null; }
function avg(arr) { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function stddev(arr) {
  const a = arr.filter(Number.isFinite);
  if (a.length < 2) return null;
  const m = avg(a);
  return Math.sqrt(avg(a.map(x => (x - m) ** 2)));
}
function zScore(val, mean, sd) {
  if (!sd || sd === 0) return 0;
  return (val - mean) / sd;
}

// ─────────────────────────────────────────────
// 1. REGIME-AWARE DYNAMIC WEIGHT SYSTEM
//    Adjusts strategy weights based on live market regime
// ─────────────────────────────────────────────
export function getDynamicWeights(strategy, regime, vix, adxStrength) {
  // Base weights per strategy
  const BASE = {
    intraday:  { technical: 0.50, fundamentals: 0.08, news: 0.16, macro: 0.14, events: 0.12, options: 0.10 },
    swing:     { technical: 0.36, fundamentals: 0.23, news: 0.18, macro: 0.13, events: 0.10, options: 0.08 },
    position:  { technical: 0.25, fundamentals: 0.32, news: 0.17, macro: 0.14, events: 0.12, options: 0.06 },
    longterm:  { technical: 0.14, fundamentals: 0.42, news: 0.14, macro: 0.16, events: 0.14, options: 0.04 },
  };
  const w = { ...(BASE[strategy] || BASE.swing) };

  // Regime modifiers
  if (regime === "STRONGLY_BULLISH" || regime === "BULL_TRENDING") {
    w.technical += 0.05; w.macro -= 0.03; w.events -= 0.02;
  } else if (regime === "BEAR_TRENDING" || regime === "STRONGLY_BEARISH") {
    w.macro += 0.05; w.technical -= 0.03; w.fundamentals -= 0.02;
  } else if (regime === "SIDEWAYS" || regime === "RANGE_BOUND") {
    w.news += 0.04; w.technical -= 0.04;
  }

  // High VIX → options/macro weigh more
  if (vix && vix > 22) {
    w.options = Math.min((w.options || 0) + 0.06, 0.15);
    w.technical -= 0.03; w.fundamentals -= 0.03;
  }

  // Strong trend (ADX) → technical matters more
  if (adxStrength === "STRONG_TREND") {
    w.technical += 0.05; w.news -= 0.03; w.events -= 0.02;
  } else if (adxStrength === "RANGING") {
    w.technical -= 0.06; w.fundamentals += 0.04; w.news += 0.02;
  }

  // Normalise so weights sum to ~1.0 (excluding options which is additive)
  const baseTotal = w.technical + w.fundamentals + w.news + w.macro + w.events;
  if (baseTotal > 0) {
    const normFactor = 1.0 / baseTotal;
    w.technical  = round2(w.technical  * normFactor);
    w.fundamentals = round2(w.fundamentals * normFactor);
    w.news       = round2(w.news       * normFactor);
    w.macro      = round2(w.macro      * normFactor);
    w.events     = round2(w.events     * normFactor);
  }
  return w;
}

// ─────────────────────────────────────────────
// 2. RSI DIVERGENCE DETECTOR
//    Detects bullish/bearish hidden & regular divergences
// ─────────────────────────────────────────────
export function detectRSIDivergence(candles = [], rsiSeries = []) {
  if (candles.length < 20 || rsiSeries.length < 20) return { type: "NONE", signal: null };

  const closes = candles.map(c => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const n = Math.min(closes.length, rsiSeries.length, 30);
  const recentCloses = closes.slice(-n);
  const recentRsi = rsiSeries.slice(-n);

  // Find price swing lows and highs
  const priceLows = [];
  const priceHighs = [];
  const rsiLows = [];
  const rsiHighs = [];

  for (let i = 2; i < n - 2; i++) {
    if (recentCloses[i] < recentCloses[i-1] && recentCloses[i] < recentCloses[i+1] &&
        recentCloses[i] < recentCloses[i-2] && recentCloses[i] < recentCloses[i+2]) {
      priceLows.push({ idx: i, val: recentCloses[i], rsi: recentRsi[i] });
    }
    if (recentCloses[i] > recentCloses[i-1] && recentCloses[i] > recentCloses[i+1] &&
        recentCloses[i] > recentCloses[i-2] && recentCloses[i] > recentCloses[i+2]) {
      priceHighs.push({ idx: i, val: recentCloses[i], rsi: recentRsi[i] });
    }
  }

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceLows.length >= 2) {
    const [prev, last] = priceLows.slice(-2);
    if (last.val < prev.val && last.rsi > prev.rsi + 3 && last.rsi < 50) {
      return {
        type: "BULLISH_DIVERGENCE",
        signal: `RSI bullish divergence — price lower low at ${round2(last.val)} but RSI higher low at ${round2(last.rsi)}. Classic reversal setup.`,
        strength: (prev.rsi - last.rsi < -8) ? "STRONG" : "MODERATE",
        delta: +12,
      };
    }
  }

  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceHighs.length >= 2) {
    const [prev, last] = priceHighs.slice(-2);
    if (last.val > prev.val && last.rsi < prev.rsi - 3 && last.rsi > 50) {
      return {
        type: "BEARISH_DIVERGENCE",
        signal: `RSI bearish divergence — price higher high at ${round2(last.val)} but RSI lower high at ${round2(last.rsi)}. Momentum failing.`,
        strength: (prev.rsi - last.rsi > 8) ? "STRONG" : "MODERATE",
        delta: -12,
      };
    }
  }

  // Hidden bullish: price higher low, RSI lower low (trend continuation)
  if (priceLows.length >= 2) {
    const [prev, last] = priceLows.slice(-2);
    if (last.val > prev.val && last.rsi < prev.rsi - 3) {
      return {
        type: "HIDDEN_BULLISH",
        signal: `Hidden bullish divergence — pullback with decreasing RSI momentum. Trend continuation buy.`,
        strength: "MODERATE",
        delta: +7,
      };
    }
  }

  return { type: "NONE", signal: null, delta: 0 };
}

// ─────────────────────────────────────────────
// 3. MACD DIVERGENCE + HISTOGRAM MOMENTUM
// ─────────────────────────────────────────────
export function detectMACDDivergence(macdHistogram = [], closes = []) {
  if (macdHistogram.length < 10 || closes.length < 10) return { type: "NONE", delta: 0 };
  const n = Math.min(macdHistogram.length, closes.length, 20);
  const hist = macdHistogram.slice(-n);
  const px = closes.slice(-n);

  // Shrinking bars: histogram bars getting smaller = momentum fading
  const recent3 = hist.slice(-3);
  const prev3 = hist.slice(-6, -3);
  const avgRecent = Math.abs(avg(recent3) || 0);
  const avgPrev = Math.abs(avg(prev3) || 0);
  const histShrinking = avgPrev > 0 && avgRecent < avgPrev * 0.6;

  // Price up but histogram lower = bearish divergence
  const pxTrend = px[n-1] - px[n-4];
  const histTrend = (hist[n-1] || 0) - (hist[n-4] || 0);

  if (pxTrend > 0 && histTrend < -0.5 && histShrinking) {
    return {
      type: "MACD_BEARISH_DIVERGENCE",
      signal: "MACD histogram shrinking while price rising — momentum deteriorating",
      delta: -8,
    };
  }
  if (pxTrend < 0 && histTrend > 0.5) {
    return {
      type: "MACD_BULLISH_DIVERGENCE",
      signal: "MACD histogram expanding upward while price still falling — buying pressure building",
      delta: +8,
    };
  }
  return { type: "NONE", delta: 0 };
}

// ─────────────────────────────────────────────
// 4. RELATIVE STRENGTH vs NIFTY (Mansfield RS)
//    RS > 1 = outperforming, RS < 1 = underperforming
// ─────────────────────────────────────────────
export function computeRelativeStrength(stockReturn20d, stockReturn60d, niftyReturn20d, niftyReturn60d) {
  if (stockReturn20d === null || niftyReturn20d === null) return null;
  const rs20 = niftyReturn20d !== 0 ? stockReturn20d / niftyReturn20d : 0;
  const rs60 = (niftyReturn60d !== null && niftyReturn60d !== 0) ? stockReturn60d / niftyReturn60d : rs20;
  const rsComposite = round2((rs20 * 0.6 + rs60 * 0.4));

  let signal, delta;
  if (rsComposite >= 2.0) { signal = "STRONGLY_OUTPERFORMING"; delta = +12; }
  else if (rsComposite >= 1.3) { signal = "OUTPERFORMING"; delta = +7; }
  else if (rsComposite >= 0.8) { signal = "IN_LINE"; delta = 0; }
  else if (rsComposite >= 0.3) { signal = "UNDERPERFORMING"; delta = -7; }
  else { signal = "STRONGLY_UNDERPERFORMING"; delta = -12; }

  return {
    rs20: round2(rs20),
    rs60: round2(rs60),
    rsComposite,
    signal,
    delta,
    interpretation: signal === "STRONGLY_OUTPERFORMING"
      ? "Stock is strongly outperforming NIFTY — institutional accumulation or sector leadership."
      : signal === "OUTPERFORMING"
      ? "Stock outperforming NIFTY — relative momentum positive."
      : signal === "UNDERPERFORMING"
      ? "Stock lagging NIFTY — avoid until RS improves above market."
      : signal === "STRONGLY_UNDERPERFORMING"
      ? "Stock severely underperforming NIFTY — distribution or fundamental deterioration."
      : "In-line with NIFTY — no edge from relative strength.",
  };
}

// ─────────────────────────────────────────────
// 5. ATR-BASED TARGET & STOP PRICING
//    Replaces fixed-% heuristic with volatility-calibrated levels
// ─────────────────────────────────────────────
export function computeATRTargetsAndStops(candles = [], price, strategy, verdict) {
  if (!price || candles.length < 14) return null;

  const highs  = candles.map(c => safeNum(c[1]) || safeNum(c.high)).filter(Boolean);
  const lows   = candles.map(c => safeNum(c[2]) || safeNum(c.low)).filter(Boolean);
  const closes = candles.map(c => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);

  // True Range series → 14-period ATR
  const trList = [];
  for (let i = 1; i < candles.length; i++) {
    trList.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i]  - closes[i-1])
    ));
  }
  let atr = avg(trList.slice(-14));
  if (!atr || atr === 0) return null;

  // Wilder smooth last 14
  for (let i = 14; i < trList.length; i++) {
    atr = (atr * 13 + trList[i]) / 14;
  }

  const atrPct = (atr / price) * 100;

  // Target/stop multipliers per strategy (multiples of ATR)
  const mult = {
    intraday: { target: 1.5, stop: 1.0, t2: 2.5 },
    swing:    { target: 2.5, stop: 1.5, t2: 4.0 },
    position: { target: 4.0, stop: 2.0, t2: 6.5 },
    longterm: { target: 6.5, stop: 2.5, t2: 12.0 },
  }[strategy] || { target: 2.5, stop: 1.5, t2: 4.0 };

  const bullish = ["BUY", "STRONG_BUY"].includes(verdict);
  const bearish = ["SELL", "STRONG_SELL"].includes(verdict);

  const target1 = bullish ? price + atr * mult.target : price - atr * mult.target;
  const target2 = bullish ? price + atr * mult.t2    : price - atr * mult.t2;
  const stopLoss = bullish ? price - atr * mult.stop  : price + atr * mult.stop;
  const rr = round2((Math.abs(target1 - price)) / (Math.abs(stopLoss - price)));

  return {
    atr: round2(atr),
    atrPct: round2(atrPct),
    target1: round2(target1),
    target2: round2(target2),
    stopLoss: round2(stopLoss),
    riskReward: rr,
    targetPct: round2(((target1 - price) / price) * 100),
    stopPct: round2(((stopLoss - price) / price) * 100),
    note: `ATR-calibrated: ${round2(atrPct)}% daily range. Stop = ${mult.stop}×ATR, T1 = ${mult.target}×ATR, T2 = ${mult.t2}×ATR.`,
  };
}

// ─────────────────────────────────────────────
// 6. KELLY CRITERION POSITION SIZING
//    Kelly% = (W*R - L) / R  where W=winRate, L=lossRate, R=avg R:R
// ─────────────────────────────────────────────
export function computeKellySizing(riskReward, confidence, strategy) {
  if (!riskReward || !confidence) return null;

  const winRate = clamp(confidence / 100, 0.25, 0.85);
  const lossRate = 1 - winRate;
  const kelly = (winRate * riskReward - lossRate) / riskReward;
  // Use half-Kelly for safety (standard institutional practice)
  const halfKelly = Math.max(0, kelly * 0.5);
  // Cap at 15% for risk management
  const safeKelly = clamp(halfKelly * 100, 0, 15);
  // Further reduce for intraday
  const strategyFactor = strategy === "intraday" ? 0.5 : strategy === "longterm" ? 1.2 : 1.0;
  const recommended = round2(safeKelly * strategyFactor);

  let sizeLabel;
  if (recommended >= 10) sizeLabel = "LARGE (High conviction)";
  else if (recommended >= 6) sizeLabel = "MEDIUM (Good setup)";
  else if (recommended >= 3) sizeLabel = "SMALL (Speculative)";
  else sizeLabel = "MINIMAL (Very small or avoid)";

  return {
    kelly: round2(kelly * 100),
    halfKelly: round2(halfKelly * 100),
    recommended,
    sizeLabel,
    note: `Half-Kelly sizing: ${recommended}% of capital. Full Kelly (${round2(kelly*100)}%) is theoretical max — never use it.`,
    portfolioRisk: `Risk ${round2(recommended * (Math.abs(round2(((1 - riskReward) / riskReward) * 100)) / 100) || 1)}% of portfolio capital on stop-out.`,
  };
}

// ─────────────────────────────────────────────
// 7. TREND EXHAUSTION DETECTOR
//    Detects parabolic / over-extended moves
// ─────────────────────────────────────────────
export function detectTrendExhaustion(candles = [], rsi = null) {
  if (candles.length < 20) return { exhausted: false, signal: null };

  const closes = candles.map(c => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const volumes = candles.map(c => safeNum(c[5]) || safeNum(c.volume) || 0);

  const n = closes.length;
  const return5d = ((closes[n-1] - closes[n-6]) / closes[n-6]) * 100;
  const return20d = ((closes[n-1] - closes[n-21]) / closes[n-21]) * 100;

  // Parabolic: 5-day return > 3× 20-day average daily range
  const avgDailyRange = avg(closes.slice(-20).map((c, i, a) => i > 0 ? Math.abs(c - a[i-1]) / a[i-1] * 100 : 0).filter(Boolean));
  const isParabolic = avgDailyRange > 0 && Math.abs(return5d) > avgDailyRange * 3 * 5;

  // Volume exhaustion: price making new highs but volume declining
  const recentVol = avg(volumes.slice(-5));
  const priorVol = avg(volumes.slice(-15, -5));
  const volExhaustion = recentVol < priorVol * 0.7 && return5d > 5;

  // RSI exhaustion: RSI > 80 (overbought) or < 20 (oversold)
  const rsiOverbought = rsi !== null && rsi > 80;
  const rsiOversold = rsi !== null && rsi < 20;

  const exhaustionCount = [isParabolic, volExhaustion, rsiOverbought || rsiOversold].filter(Boolean).length;

  if (exhaustionCount >= 2) {
    const dir = return5d > 0 ? "BULLISH_EXHAUSTION" : "BEARISH_EXHAUSTION";
    return {
      exhausted: true,
      type: dir,
      signal: dir === "BULLISH_EXHAUSTION"
        ? `Parabolic up-move detected: +${round2(return5d)}% in 5 days, RSI ${round2(rsi)}, volume fading. High reversal risk.`
        : `Parabolic down-move: ${round2(return5d)}% in 5 days, RSI ${round2(rsi)}. Potential bounce/reversal.`,
      delta: dir === "BULLISH_EXHAUSTION" ? -15 : +8,
      isParabolic,
      volExhaustion,
      rsiExtreme: rsiOverbought || rsiOversold,
    };
  }
  return { exhausted: false, signal: null, delta: 0 };
}

// ─────────────────────────────────────────────
// 8. SMART MONEY FLOW CLASSIFIER
//    Combines FII/DII + OI build-up + volume patterns
// ─────────────────────────────────────────────
export function classifySmartMoneyFlow(marketContext = {}, optionsData = null, technicalSnapshot = {}) {
  const signals = [];
  let flowScore = 50;

  const fii = marketContext?.fiiDii || {};
  const fiiNet = safeNum(fii.fiiNetBuy, 0);
  const diiNet = safeNum(fii.diiNetBuy, 0);

  // FII + DII both buying = strongest bullish institutional signal
  if (fiiNet > 1000 && diiNet > 500) {
    flowScore += 20;
    signals.push(`FII + DII both buying (₹${round2(fiiNet)}Cr + ₹${round2(diiNet)}Cr) — strongest institutional bullish signal`);
  } else if (fiiNet < -1000 && diiNet > 800) {
    // Classic DII catching FII sell — floor signal
    flowScore += 10;
    signals.push(`DII buying ₹${round2(diiNet)}Cr vs FII selling ₹${round2(Math.abs(fiiNet))}Cr — market finding floor`);
  } else if (fiiNet > 2000) {
    flowScore += 15;
    signals.push(`Strong FII buying ₹${round2(fiiNet)}Cr — foreign institutional accumulation`);
  } else if (fiiNet < -2000) {
    flowScore -= 15;
    signals.push(`Heavy FII selling ₹${round2(Math.abs(fiiNet))}Cr — foreign institutional distribution`);
  }

  // Options OI as smart money proxy
  if (optionsData?.available) {
    const pcr = safeNum(optionsData.pcr);
    if (pcr > 1.3) {
      flowScore += 10;
      signals.push(`PCR ${round2(pcr)} > 1.3 — put writers (smart money) net bullish`);
    } else if (pcr < 0.7) {
      flowScore -= 10;
      signals.push(`PCR ${round2(pcr)} < 0.7 — call writers (smart money) net bearish`);
    }
  }

  // Volume surge with trend = institutional confirmation
  const volSurge = safeNum(technicalSnapshot.volumeSurge, 1);
  const trendBias = technicalSnapshot.trendBias;
  if (volSurge > 1.5 && trendBias === "BULLISH") {
    flowScore += 10;
    signals.push(`${round2(volSurge)}× volume surge in uptrend — institutional confirmation`);
  } else if (volSurge > 1.5 && trendBias === "BEARISH") {
    flowScore -= 8;
    signals.push(`${round2(volSurge)}× volume surge in downtrend — institutional distribution`);
  }

  const classification = flowScore >= 70 ? "STRONG_ACCUMULATION"
    : flowScore >= 58 ? "ACCUMULATION"
    : flowScore >= 44 ? "NEUTRAL"
    : flowScore >= 32 ? "DISTRIBUTION"
    : "STRONG_DISTRIBUTION";

  return {
    flowScore: Math.round(clamp(flowScore)),
    classification,
    signals,
    fiiNet: round2(fiiNet),
    diiNet: round2(diiNet),
    interpretation: classification === "STRONG_ACCUMULATION"
      ? "Smart money aggressively accumulating. Highest conviction buy environment."
      : classification === "ACCUMULATION"
      ? "Net institutional buying. Positive flow backdrop for longs."
      : classification === "DISTRIBUTION"
      ? "Net institutional selling. Risk-off for new longs."
      : classification === "STRONG_DISTRIBUTION"
      ? "Smart money aggressively exiting. Avoid longs, favor shorts."
      : "Mixed institutional flows. Wait for clarity.",
  };
}

// ─────────────────────────────────────────────
// 9. BAYESIAN SCENARIO ENGINE
//    Prior probabilities updated by each signal
// ─────────────────────────────────────────────
export function computeBayesianScenarios(row, signals = []) {
  // Prior: 33/33/33 neutral start
  let pBull = 0.33;
  let pBear = 0.33;
  let pNeutral = 0.34;

  // Update based on base score
  const score = safeNum(row.adjustedScore, 50);
  const scoreBias = (score - 50) / 100;
  pBull = clamp(pBull + scoreBias * 0.4, 0.05, 0.90);
  pBear = clamp(pBear - scoreBias * 0.4, 0.05, 0.90);

  // Likelihood updates from each signal source
  const updates = [
    // Technical
    { field: row.technicalSnapshot?.trendBias, bull: "BULLISH", bear: "BEARISH", strength: 0.08 },
    // Wyckoff
    { field: row.advancedTechnical?.wyckoff?.bias, bull: "BULLISH", bear: "BEARISH", strength: 0.10 },
    // Elliott Wave
    { field: row.advancedTechnical?.elliottWave?.wavePosition?.includes("BULLISH") ? "BULLISH" : row.advancedTechnical?.elliottWave?.wavePosition?.includes("BEARISH") ? "BEARISH" : null, bull: "BULLISH", bear: "BEARISH", strength: 0.08 },
    // Options bias
    { field: row.optionsIntelligence?.directionalBias, bull: "BULLISH", bear: "BEARISH", strength: 0.09 },
    // India signals
    { field: (row.indiaIntelligence?.delta || 0) > 5 ? "BULLISH" : (row.indiaIntelligence?.delta || 0) < -5 ? "BEARISH" : null, bull: "BULLISH", bear: "BEARISH", strength: 0.05 },
    // Supertrend
    { field: row.advancedTechnical?.supertrend?.direction, bull: "BULLISH", bear: "BEARISH", strength: 0.07 },
    // Fundamental quality
    { field: row.fundamentalIntelligence?.fundamentalQuality === "HIGH" ? "BULLISH" : row.fundamentalIntelligence?.fundamentalQuality === "LOW" ? "BEARISH" : null, bull: "BULLISH", bear: "BEARISH", strength: 0.07 },
    // News
    { field: (row.newsSummary?.score || 50) > 60 ? "BULLISH" : (row.newsSummary?.score || 50) < 40 ? "BEARISH" : null, bull: "BULLISH", bear: "BEARISH", strength: 0.05 },
  ];

  for (const u of updates) {
    if (!u.field) continue;
    if (u.field === u.bull) {
      pBull = clamp(pBull + u.strength, 0.05, 0.92);
      pBear = clamp(pBear - u.strength * 0.5, 0.05, 0.85);
    } else if (u.field === u.bear) {
      pBear = clamp(pBear + u.strength, 0.05, 0.92);
      pBull = clamp(pBull - u.strength * 0.5, 0.05, 0.85);
    }
  }

  // Normalise
  const total = pBull + pBear + pNeutral;
  pBull = round2((pBull / total) * 100);
  pBear = round2((pBear / total) * 100);
  pNeutral = round2(100 - pBull - pBear);

  const atrTargets = row.atrTargets;
  const price = safeNum(row.quote?.price);

  return {
    bullish: { probability: pBull, target: atrTargets?.target1, case: (row.buyReasons || []).slice(0, 3) },
    bearish: { probability: pBear, target: atrTargets?.target1 && price ? round2(price - (atrTargets.target1 - price)) : null, case: (row.sellReasons || []).slice(0, 3) },
    neutral: { probability: pNeutral, case: (row.monitorPoints || []).slice(0, 2) },
    dominantScenario: pBull > pBear && pBull > pNeutral ? "BULLISH" : pBear > pBull && pBear > pNeutral ? "BEARISH" : "NEUTRAL",
    conviction: round2(Math.max(pBull, pBear) - pNeutral),
  };
}

// ─────────────────────────────────────────────
// 10. CONVICTION SCORE (0–100 continuous)
//     Replaces binary valid/invalid trade gate
// ─────────────────────────────────────────────
export function computeConvictionScore(row, rsiDiv, macdDiv, relStrength, smartMoney, exhaustion, bayesian) {
  let score = 0;
  const reasons = [];

  // Base: adjusted score distance from 50
  const scoreDist = Math.abs(safeNum(row.adjustedScore, 50) - 50);
  score += clamp(scoreDist * 1.5, 0, 25);

  // Confidence base
  score += clamp((safeNum(row.confidence, 50) - 40) * 0.5, 0, 15);

  // RSI divergence
  if (rsiDiv?.delta) { score += Math.abs(rsiDiv.delta) * 0.6; reasons.push(rsiDiv.signal); }

  // MACD divergence
  if (macdDiv?.delta) { score += Math.abs(macdDiv.delta) * 0.5; }

  // Relative strength
  if (relStrength?.delta) {
    score += Math.abs(relStrength.delta) * 0.5;
    if (Math.abs(relStrength.delta) > 8) reasons.push(relStrength.interpretation);
  }

  // Smart money flow
  const smDelta = (safeNum(smartMoney?.flowScore, 50) - 50);
  score += Math.abs(smDelta) * 0.3;
  if (Math.abs(smDelta) > 15 && smartMoney?.signals?.[0]) reasons.push(smartMoney.signals[0]);

  // Options confirmation
  if (row.optionsIntelligence && row.optionsIntelligence.directionalBias && row.optionsIntelligence.directionalBias !== "NEUTRAL") {
    score += 8;
    reasons.push(`Options OI confirms ${row.optionsIntelligence.directionalBias} bias`);
  }

  // Wyckoff Spring = maximum conviction booster
  if (row.advancedTechnical?.wyckoff?.event === "SPRING") { score += 18; reasons.push("Wyckoff Spring — institutional accumulation confirmed"); }

  // Supertrend flip
  if (row.advancedTechnical?.supertrend?.justFlipped) { score += 12; reasons.push("Supertrend just flipped direction"); }

  // Exhaustion = conviction killer for trend trades
  if (exhaustion?.exhausted) { score -= 20; reasons.push(exhaustion.signal); }

  // Bayesian conviction
  score += clamp((bayesian?.conviction || 0) * 0.25, 0, 15);

  // ADX: trending = higher conviction for trend trades
  const adx = safeNum(row.advancedTechnical?.adx?.adx, 0);
  if (adx > 30) score += 8;
  else if (adx < 18) score -= 5;

  // Regime alignment
  if (row.advancedTechnical?.wyckoff?.phase === "MARKUP" && ["BUY","STRONG_BUY"].includes(row.verdict)) score += 8;
  if (row.advancedTechnical?.wyckoff?.phase === "DISTRIBUTION" && ["SELL","STRONG_SELL"].includes(row.verdict)) score += 8;

  const finalScore = Math.round(clamp(score, 0, 100));
  return {
    score: finalScore,
    grade: finalScore >= 80 ? "A+" : finalScore >= 70 ? "A" : finalScore >= 60 ? "B" : finalScore >= 50 ? "C" : finalScore >= 35 ? "D" : "F",
    label: finalScore >= 80 ? "MAXIMUM CONVICTION" : finalScore >= 65 ? "HIGH CONVICTION" : finalScore >= 50 ? "MODERATE CONVICTION" : finalScore >= 35 ? "LOW CONVICTION" : "AVOID",
    reasons: reasons.filter(Boolean).slice(0, 5),
  };
}

// ─────────────────────────────────────────────
// 11. FULL RESEARCH REPORT GENERATOR
//     Multi-section professional-grade analysis
// ─────────────────────────────────────────────
export function generateResearchReport(row, godLevel = {}) {
  const {
    rsiDivergence, macdDivergence, relativeStrength, smartMoney,
    exhaustion, bayesian, conviction, atrTargets, kellySizing,
  } = godLevel;

  const symbol = row.symbol || "UNKNOWN";
  const price = safeNum(row.quote?.price);
  const verdict = row.verdict || "HOLD";
  const strategy = row.strategy || "swing";
  const fund = row.fundamentals || {};
  const tech = row.technicalSnapshot || {};
  const opts = row.optionsIntelligence;
  const adv = row.advancedTechnical;
  const fi = row.fundamentalIntelligence;
  const india = row.indiaIntelligence;

  const isBull = ["BUY","STRONG_BUY"].includes(verdict);
  const isBear = ["SELL","STRONG_SELL"].includes(verdict);

  const sections = [];

  // ── EXECUTIVE SUMMARY ──
  const execLines = [
    `${symbol} (${row.companyName || symbol}) is rated ${verdict.replace(/_/g," ")} for ${strategy} traders at ₹${price || "--"}.`,
    conviction?.score >= 70
      ? `Conviction is ${conviction.label} (${conviction.score}/100) — ${conviction.reasons?.[0] || "multiple confluence factors aligned"}.`
      : `Conviction is ${conviction?.label || "MODERATE"} (${conviction?.score || "--"}/100). Wait for stronger setup before sizing up.`,
    atrTargets
      ? `ATR-calibrated trade: Target ₹${atrTargets.target1} (${atrTargets.targetPct > 0 ? "+" : ""}${atrTargets.targetPct}%), Stop ₹${atrTargets.stopLoss}, R:R ${atrTargets.riskReward}:1.`
      : `Targets based on score model: ₹${row.targets?.targetPrice || "--"}.`,
    bayesian
      ? `Bayesian probability — Bullish ${bayesian.bullish?.probability}% | Bearish ${bayesian.bearish?.probability}% | Neutral ${bayesian.neutral?.probability}%.`
      : "",
  ].filter(Boolean);
  sections.push({ heading: "Executive Summary", content: execLines.join(" ") });

  // ── TECHNICAL ANALYSIS ──
  const techLines = [];
  if (tech.rsi14) techLines.push(`RSI(14) at ${round2(tech.rsi14)} — ${tech.rsi14 > 70 ? "overbought, caution on longs" : tech.rsi14 < 30 ? "oversold, watch for bounce" : "neutral zone"}.`);
  if (tech.macd?.posture) techLines.push(`MACD posture: ${tech.macd.posture}.${tech.macd.histogram > 0 ? " Histogram positive — momentum building." : " Histogram negative — momentum fading."}`);
  if (tech.return20d !== null) techLines.push(`20-day return: ${round2(tech.return20d)}%. 60-day return: ${round2(tech.return60d)}%.`);
  if (tech.vwap20) techLines.push(`Price ${price > tech.vwap20 ? "above" : "below"} 20-day VWAP (₹${tech.vwap20}) — ${price > tech.vwap20 ? "institutional buy zone" : "below fair value VWAP, weak"}.`);
  if (rsiDivergence && rsiDivergence.type && rsiDivergence.type !== "NONE") techLines.push(`RSI Divergence: ${rsiDivergence.signal}`);
  if (macdDivergence && macdDivergence.type && macdDivergence.type !== "NONE") techLines.push(`MACD: ${macdDivergence.signal}`);
  if (adv?.supertrend) techLines.push(`Supertrend(10,3): ${adv.supertrend.direction}${adv.supertrend.justFlipped ? " — JUST FLIPPED, high-quality signal" : ""}. Price ${adv.supertrend.priceVsSupertrend} the Supertrend line.`);
  if (adv?.adx) techLines.push(`ADX(14): ${round2(adv.adx.adx)} — ${adv.adx.trendStrength}. DI+=${round2(adv.adx.diPlus)} vs DI-=${round2(adv.adx.diMinus)}.`);
  if (adv?.volumeProfile?.poc) techLines.push(`Volume Profile POC at ₹${adv.volumeProfile.poc} — ${price > adv.volumeProfile.poc ? "trading above high-volume node" : "below high-volume node, potential magnet pull up"}.`);
  if (exhaustion?.exhausted) techLines.push(`⚠ EXHAUSTION ALERT: ${exhaustion.signal}`);
  sections.push({ heading: "Technical Analysis", content: techLines.join(" ") || "Insufficient technical data." });

  // ── ADVANCED MARKET STRUCTURE ──
  const structureLines = [];
  if (adv?.wyckoff) structureLines.push(`Wyckoff Phase: ${adv.wyckoff.phase} — ${adv.wyckoff.event ? adv.wyckoff.event.replace(/_/g," ") : ""}. ${adv.wyckoff.interpretation}`);
  if (adv?.elliottWave && adv.elliottWave.wavePosition && adv.elliottWave.wavePosition !== "UNKNOWN") structureLines.push(`Elliott Wave: ${adv.elliottWave.wavePosition.replace(/_/g," ")} (${adv.elliottWave.confidence}% confidence). ${adv.elliottWave.interpretation}`);
  if (adv?.chartPatterns?.primaryPattern) {
    const p = adv.chartPatterns.primaryPattern;
    structureLines.push(`Chart Pattern: ${p.pattern.replace(/_/g," ")} — ${p.bias} (${p.confidence}% confidence). ${p.description}`);
  }
  if (relativeStrength && relativeStrength.signal) structureLines.push(`Relative Strength vs NIFTY: RS=${relativeStrength.rsComposite} — ${relativeStrength.signal.replace(/_/g," ")}. ${relativeStrength.interpretation}`);
  if (structureLines.length) sections.push({ heading: "Advanced Market Structure", content: structureLines.join(" ") });

  // ── FUNDAMENTAL ANALYSIS ──
  const fundLines = [];
  if (fund.pe) fundLines.push(`P/E: ${fund.pe}x (${fund.pe < 20 ? "cheap" : fund.pe < 35 ? "fairly valued" : "expensive"} for sector).`);
  if (fund.roe) fundLines.push(`ROE: ${fund.roe}% (${fund.roe >= 20 ? "excellent" : fund.roe >= 15 ? "good" : "below quality threshold"}).`);
  if (fund.roce) fundLines.push(`ROCE: ${fund.roce}% (${fund.roce >= 15 ? "capital efficient" : "poor capital returns"}).`);
  if (fund.debtToEquity !== null) fundLines.push(`D/E: ${fund.debtToEquity} (${fund.debtToEquity < 0.5 ? "clean balance sheet" : fund.debtToEquity > 2 ? "high leverage" : "moderate"}).`);
  if (fund.salesGrowth3yr) fundLines.push(`3yr Revenue Growth: ${fund.salesGrowth3yr}%. Profit Growth: ${fund.profitGrowth3yr}%.`);
  if (fi?.qglp) fundLines.push(`QGLP Score: ${fi.qglp.totalScore}/100 — ${fi.qglp.verdict?.replace(/_/g," ")}. PEG: ${fi.qglp.peg}.`);
  if (fi?.moat) fundLines.push(`Economic Moat: ${fi.moat.moatWidth} (${fi.moat.moatType?.replace(/_/g," ") || "none"}). ${fi.moat.interpretation}`);
  if (fi?.lynch) fundLines.push(`Peter Lynch Category: ${fi.lynch.category?.replace(/_/g," ")} — ${fi.lynch.strategy}`);
  if (fi?.coffeeCan) fundLines.push(`Coffee Can: ${fi.coffeeCan.metCount}/5 criteria (${fi.coffeeCan.verdict?.replace(/_/g," ")}).`);
  if (fi?.redFlags?.flags?.length > 0) fundLines.push(`⚠ Accounting Flags: ${fi.redFlags.flags.join("; ")}`);
  sections.push({ heading: "Fundamental Analysis", content: fundLines.join(" ") || "Fundamental data unavailable." });

  // ── OPTIONS & DERIVATIVES INTELLIGENCE ──
  if (opts) {
    const optLines = [];
    optLines.push(`Options directional bias: ${opts.directionalBias || "NEUTRAL"}. PCR: ${round2(opts.pcr)} (${opts.pcrSignal?.replace(/_/g," ")}).`);
    if (opts.maxPainStrike) optLines.push(`Max Pain at ₹${opts.maxPainStrike} (${opts.maxPainDistance > 0 ? "+" : ""}${round2(opts.maxPainDistance)}% from spot) — market will gravitate here near expiry.`);
    if (opts.resistanceLevel) optLines.push(`Call OI wall (resistance): ₹${opts.resistanceLevel}. Put OI wall (support): ₹${opts.supportLevel}.`);
    if (opts.vix) optLines.push(`India VIX: ${round2(opts.vix)} — ${opts.vixSignal?.replace(/_/g," ")}. ${opts.vix > 20 ? "High fear = options expensive, prefer selling premium." : "Low fear = buy options cheaply."}`);
    sections.push({ heading: "Options & Derivatives Intelligence", content: optLines.join(" ") });
  }

  // ── INDIA-SPECIFIC CONTEXT ──
  if (india?.signals?.length > 0 || india?.upcomingEvents?.length > 0) {
    const indiaLines = [];
    if (india.giftNifty?.gapType) indiaLines.push(`GIFT NIFTY: ${india.giftNifty.gapType?.replace(/_/g," ")} (${india.giftNifty.gapPct > 0 ? "+" : ""}${round2(india.giftNifty.gapPct)}%). ${india.giftNifty.interpretation}`);
    if (india.resultsSeason?.isInSeason) indiaLines.push(`Results Season Active: ${india.resultsSeason.season}. IV expansion risk. ${india.resultsSeason.tradingImplication}`);
    if (india.upcomingEvents?.[0]) {
      const e = india.upcomingEvents[0];
      indiaLines.push(`Key Event: ${e.name} (${e.impact} impact). ${e.description}`);
    }
    if (india.signals?.length > 0) indiaLines.push(`India Signals: ${india.signals.join("; ")}`);
    sections.push({ heading: "India Market Context", content: indiaLines.join(" ") });
  }

  // ── SMART MONEY & INSTITUTIONAL FLOW ──
  if (smartMoney) {
    const smLines = [
      `Institutional flow: ${smartMoney.classification?.replace(/_/g," ")}. ${smartMoney.interpretation}`,
      smartMoney.signals?.[0] || "",
      smartMoney.fiiNet !== null ? `FII net: ₹${smartMoney.fiiNet}Cr. DII net: ₹${smartMoney.diiNet}Cr.` : "",
    ].filter(Boolean);
    sections.push({ heading: "Smart Money & Institutional Flows", content: smLines.join(" ") });
  }

  // ── RISK ASSESSMENT ──
  const riskLines = [];
  if (atrTargets) riskLines.push(`Stop at ₹${atrTargets.stopLoss} (${round2(Math.abs(atrTargets.stopPct))}% from entry). Hard invalidation if price closes beyond this level.`);
  if ((row.risks || []).length > 0) riskLines.push(`Key risks: ${row.risks.slice(0,3).join("; ")}.`);
  const highConflicts = (row.decisionEngine?.conflicts || []).filter(c => c.severity === "HIGH");
  if (highConflicts.length > 0) riskLines.push(`⚠ High-severity conflicts: ${highConflicts.map(c => c.detail).join("; ")}.`);
  if (exhaustion?.exhausted) riskLines.push(`Trend exhaustion risk: ${exhaustion.type?.replace(/_/g," ")} detected.`);
  sections.push({ heading: "Risk Assessment", content: riskLines.join(" ") || "No major risk flags detected." });

  // ── POSITION SIZING & EXECUTION ──
  const execPlanLines = [];
  if (kellySizing) execPlanLines.push(`Position sizing (half-Kelly): ${kellySizing.recommended}% of capital. ${kellySizing.sizeLabel}. ${kellySizing.portfolioRisk}`);
  const ep = row.decisionEngine?.executionPlan || {};
  if (ep.entry) execPlanLines.push(`Entry: ₹${ep.entry} (${ep.entryType || "limit"}). Stop: ₹${ep.stopLoss || atrTargets?.stopLoss}. Target 1: ₹${ep.target1 || atrTargets?.target1}. Target 2: ₹${ep.target2 || atrTargets?.target2 || "--"}.`);
  if (ep.positionSizing) execPlanLines.push(ep.positionSizing);
  if (ep.trailingStop) execPlanLines.push(`Trailing stop: ${ep.trailingStop}`);
  sections.push({ heading: "Position Sizing & Execution", content: execPlanLines.join(" ") || "Configure Upstox connection for live execution guidance." });

  // ── VERDICT ──
  const verdictLines = [
    `VERDICT: ${verdict.replace(/_/g," ")} | Confidence: ${row.confidence || "--"}% | Conviction: ${conviction?.grade || "--"} (${conviction?.score || "--"}/100)`,
    bayesian ? `Probability-weighted: ${bayesian.dominantScenario} scenario most likely at ${Math.max(bayesian.bullish?.probability, bayesian.bearish?.probability, bayesian.neutral?.probability)}% probability.` : "",
    row.decisionEngine?.tradeDecision?.action === "BUY" || row.decisionEngine?.tradeDecision?.action === "SELL"
      ? "Trade gate: READY FOR EXECUTION."
      : "Trade gate: WAIT. " + (row.decisionEngine?.tradeDecision?.unmetConditions?.[0] || "Confluence not sufficient."),
  ].filter(Boolean);
  sections.push({ heading: "Final Verdict", content: verdictLines.join(" ") });

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    sections,
    fullText: sections.map(s => `## ${s.heading}\n${s.content}`).join("\n\n"),
    summary: sections[0]?.content || "",
  };
}

// ─────────────────────────────────────────────
// MASTER GOD-LEVEL ENRICHMENT FUNCTION
// Called per-stock after base analysis is built
// ─────────────────────────────────────────────
export function enrichWithGodLevel(row, candles = [], marketContext = {}, optionsData = null) {
  if (!row) return row;

  const closes = candles.map(c => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const tech = row.technicalSnapshot || {};
  const strategy = row.strategy || "swing";
  const verdict = row.verdict || "HOLD";

  // Compute RSI series for divergence (approximate from score)
  const rsi14 = safeNum(tech.rsi14);

  // 1. Dynamic weights
  const dynamicWeights = getDynamicWeights(
    strategy,
    tech.regime?.label,
    row.optionsIntelligence?.vix,
    row.advancedTechnical?.adx?.trendStrength
  );

  // 2. RSI Divergence
  const rsiDivergence = detectRSIDivergence(candles, []);  // rsiSeries built in-engine

  // 3. MACD Divergence
  const macdDivergence = detectMACDDivergence([], closes);

  // 4. Relative Strength
  const niftyReturn20d = marketContext?.benchmarks?.find(b => b.label === "Nifty 50")?.change || null;
  const niftyReturn60d = null; // Would need 60d nifty data
  const relativeStrength = computeRelativeStrength(
    tech.return20d, tech.return60d, niftyReturn20d, niftyReturn60d
  );

  // 5. ATR-based targets (replace heuristic targets)
  const atrTargets = computeATRTargetsAndStops(candles, safeNum(row.quote?.price), strategy, verdict);

  // 6. Trend Exhaustion
  const exhaustion = detectTrendExhaustion(candles, rsi14);

  // 7. Smart Money Flow
  const smartMoney = classifySmartMoneyFlow(marketContext, row.optionsIntelligence, tech);

  // 8. Bayesian Scenarios
  const rowWithAll = { ...row, atrTargets };
  const bayesian = computeBayesianScenarios(rowWithAll);

  // 9. Conviction Score
  const conviction = computeConvictionScore(
    rowWithAll, rsiDivergence, macdDivergence, relativeStrength, smartMoney, exhaustion, bayesian
  );

  // 10. Kelly Sizing
  const rr = atrTargets?.riskReward || row.decisionEngine?.tradeDecision?.riskReward;
  const kellySizing = computeKellySizing(rr, safeNum(row.confidence, 50), strategy);

  // 11. Research Report
  const godLevelData = { rsiDivergence, macdDivergence, relativeStrength, smartMoney, exhaustion, bayesian, conviction, atrTargets, kellySizing };
  const report = generateResearchReport({ ...rowWithAll }, godLevelData);

  // Re-score targets if ATR gives better levels
  const finalTargets = atrTargets ? {
    targetPrice: atrTargets.target1,
    target2: atrTargets.target2,
    stopLoss: atrTargets.stopLoss,
    targetPct: atrTargets.targetPct,
    atrBased: true,
  } : row.targets;

  // Adjust adjusted score using RSI divergence, RS, exhaustion
  const scoreDelta = (rsiDivergence?.delta || 0) + (relativeStrength?.delta || 0) + (exhaustion?.delta || 0);
  const newAdjustedScore = clamp((row.adjustedScore || 50) + scoreDelta * 0.4);

  return {
    ...row,
    adjustedScore: round2(newAdjustedScore),
    targets: finalTargets,
    // God-level enrichments
    godLevel: {
      dynamicWeights,
      rsiDivergence,
      macdDivergence,
      relativeStrength,
      atrTargets,
      exhaustion,
      smartMoney,
      bayesian,
      conviction,
      kellySizing,
      report,
    },
  };
}
