/**
 * Superbrain Advanced Technical Engine
 * Phase 2: ADX, Supertrend, Volume Profile (VPVR), Elliott Wave,
 *           Wyckoff Phase Classifier, Chart Pattern Recognition
 * Source: Indian Stock Market Master Manual Ch.3,5,6,12,14
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
// ADX – Average Directional Index (Ch.5.3)
// ADX < 20 = no trend; ADX > 25 = trend confirmed; ADX > 40 = strong trend
// ─────────────────────────────────────────────
export function computeADX(candles = [], period = 14) {
  if (candles.length < period + 2) return { adx: null, diPlus: null, diMinus: null, signal: "INSUFFICIENT_DATA" };

  const highs = candles.map((c) => safeNum(c[1]) || safeNum(c.high));
  const lows = candles.map((c) => safeNum(c[2]) || safeNum(c.low));
  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close));

  const trList = [];
  const dmPlus = [];
  const dmMinus = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trList.push(tr);
    dmPlus.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    dmMinus.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
  }

  // Wilder smoothing
  function wilderSmooth(data, n) {
    const result = [];
    let sum = data.slice(0, n).reduce((a, b) => a + b, 0);
    result.push(sum);
    for (let i = n; i < data.length; i++) {
      sum = sum - sum / n + data[i];
      result.push(sum);
    }
    return result;
  }

  const atr = wilderSmooth(trList, period);
  const sDMPlus = wilderSmooth(dmPlus, period);
  const sDMMinus = wilderSmooth(dmMinus, period);

  const diPlus = sDMPlus.map((v, i) => (atr[i] > 0 ? (v / atr[i]) * 100 : 0));
  const diMinus = sDMMinus.map((v, i) => (atr[i] > 0 ? (v / atr[i]) * 100 : 0));
  const dx = diPlus.map((p, i) => {
    const m = diPlus[i] + diMinus[i];
    return m > 0 ? (Math.abs(diPlus[i] - diMinus[i]) / m) * 100 : 0;
  });

  const adxValues = wilderSmooth(dx.slice(period - 1), period);
  // wilderSmooth initialises with the raw SUM (not average) of the first `period` values.
  // DI+/DI- are unaffected because both numerator and denominator are scaled equally.
  // ADX operates on DX (already 0–100), so the output is inflated by `period` — divide it out.
  const rawADX = adxValues[adxValues.length - 1];
  const latestADX = rawADX != null ? rawADX / period : null;
  const latestDIPlus = diPlus[diPlus.length - 1] || null;
  const latestDIMinus = diMinus[diMinus.length - 1] || null;

  return {
    adx: round2(latestADX),
    diPlus: round2(latestDIPlus),
    diMinus: round2(latestDIMinus),
    signal: classifyADX(latestADX, latestDIPlus, latestDIMinus),
    trendStrength: latestADX < 20 ? "RANGING" : latestADX < 30 ? "WEAK_TREND" : latestADX < 40 ? "TREND" : "STRONG_TREND",
  };
}

function classifyADX(adx, diPlus, diMinus) {
  if (!adx) return "UNKNOWN";
  if (adx < 20) return "RANGE_BOUND";
  if (adx > 25 && diPlus > diMinus) return "UPTREND_CONFIRMED";
  if (adx > 25 && diMinus > diPlus) return "DOWNTREND_CONFIRMED";
  return "WEAK_TREND";
}

// ─────────────────────────────────────────────
// SUPERTREND (Ch.5.3 — "India's favourite trend tool")
// Period 10, Multiplier 3 (standard Indian market settings)
// ─────────────────────────────────────────────
export function computeSupertrend(candles = [], period = 10, multiplier = 3) {
  if (candles.length < period + 1) return { value: null, direction: null, signal: "INSUFFICIENT_DATA" };

  const highs = candles.map((c) => safeNum(c[1]) || safeNum(c.high));
  const lows = candles.map((c) => safeNum(c[2]) || safeNum(c.low));
  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close));

  // Compute ATR (True Range Wilder smoothing)
  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trValues.push(tr);
  }

  let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrSeries = [atr];
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    atrSeries.push(atr);
  }

  const startIdx = period;
  const hl2 = highs.map((h, i) => (h + lows[i]) / 2);
  const supertrend = [];
  let prevUpper = 0, prevLower = 0, prevST = 0, prevDir = 1;

  for (let i = startIdx; i < candles.length; i++) {
    const atrVal = atrSeries[i - startIdx];
    const hl2Val = hl2[i];
    const upper = hl2Val + multiplier * atrVal;
    const lower = hl2Val - multiplier * atrVal;

    const finalUpper = upper < prevUpper || closes[i - 1] > prevUpper ? upper : prevUpper;
    const finalLower = lower > prevLower || closes[i - 1] < prevLower ? lower : prevLower;

    let dir;
    if (closes[i] > finalUpper) dir = 1;       // Bullish
    else if (closes[i] < finalLower) dir = -1; // Bearish
    else dir = prevDir;

    const stValue = dir === 1 ? finalLower : finalUpper;
    supertrend.push({ value: stValue, direction: dir });
    prevUpper = finalUpper;
    prevLower = finalLower;
    prevST = stValue;
    prevDir = dir;
  }

  const last = supertrend[supertrend.length - 1];
  const prev = supertrend[supertrend.length - 2];
  const justFlipped = prev && prev.direction !== last?.direction;

  return {
    value: round2(last?.value),
    direction: last?.direction === 1 ? "BULLISH" : "BEARISH",
    signal: justFlipped
      ? last?.direction === 1 ? "JUST_TURNED_BULLISH" : "JUST_TURNED_BEARISH"
      : last?.direction === 1 ? "BULLISH" : "BEARISH",
    priceVsSupertrend: closes[closes.length - 1] > (last?.value || 0) ? "ABOVE" : "BELOW",
    justFlipped,
  };
}

// ─────────────────────────────────────────────
// VOLUME PROFILE / VPVR (Ch.3.4, Ch.14)
// Finds Point of Control (POC), HVN, LVN
// ─────────────────────────────────────────────
export function computeVolumeProfile(candles = [], buckets = 20) {
  if (candles.length < 5) return { poc: null, hvn: [], lvn: [], source: "INSUFFICIENT_DATA" };

  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const volumes = candles.map((c) => safeNum(c[5]) || safeNum(c.volume) || 0);
  const highs = candles.map((c) => safeNum(c[1]) || safeNum(c.high)).filter(Boolean);
  const lows = candles.map((c) => safeNum(c[2]) || safeNum(c.low)).filter(Boolean);

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  const bucketSize = (priceMax - priceMin) / buckets;
  if (bucketSize <= 0) return { poc: null, hvn: [], lvn: [] };

  const volumeAtPrice = new Array(buckets).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const vol = volumes[i];
    if (!high || !low || !vol) continue;
    const candleRange = high - low || bucketSize;
    for (let b = 0; b < buckets; b++) {
      const bucketLow = priceMin + b * bucketSize;
      const bucketHigh = bucketLow + bucketSize;
      const overlap = Math.max(0, Math.min(high, bucketHigh) - Math.max(low, bucketLow));
      volumeAtPrice[b] += vol * (overlap / candleRange);
    }
  }

  const maxVol = Math.max(...volumeAtPrice);
  if (maxVol === 0) return { poc: null, hvn: [], lvn: [] };

  const pocIdx = volumeAtPrice.indexOf(maxVol);
  const poc = round2(priceMin + (pocIdx + 0.5) * bucketSize);

  const threshold70 = maxVol * 0.7;
  const threshold30 = maxVol * 0.3;

  const hvn = [];
  const lvn = [];
  for (let b = 0; b < buckets; b++) {
    const mid = round2(priceMin + (b + 0.5) * bucketSize);
    if (volumeAtPrice[b] >= threshold70) hvn.push({ price: mid, volume: Math.round(volumeAtPrice[b]) });
    if (volumeAtPrice[b] <= threshold30 && volumeAtPrice[b] > 0) lvn.push({ price: mid, volume: Math.round(volumeAtPrice[b]) });
  }

  return {
    poc,
    hvn: hvn.sort((a, b) => b.volume - a.volume).slice(0, 5),
    lvn: lvn.sort((a, b) => a.volume - b.volume).slice(0, 5),
    priceMin: round2(priceMin),
    priceMax: round2(priceMax),
    signal: buildVolumeProfileSignal(poc, closes[closes.length - 1], hvn, lvn),
  };
}

function buildVolumeProfileSignal(poc, currentPrice, hvn, lvn) {
  if (!poc || !currentPrice) return "UNKNOWN";
  const pct = ((currentPrice - poc) / poc) * 100;
  if (Math.abs(pct) < 0.5) return "AT_POC"; // Price at highest volume node = equilibrium
  if (pct > 2) return "ABOVE_POC_LVN_RISK"; // Price in low-volume zone above POC — easy to reverse
  if (pct < -2) return "BELOW_POC_LVN_RISK";
  return "NEAR_POC";
}

// ─────────────────────────────────────────────
// WYCKOFF PHASE CLASSIFIER (Ch.12)
// ─────────────────────────────────────────────
export function classifyWyckoffPhase(candles = []) {
  if (candles.length < 40) return { phase: "UNKNOWN", event: null, bias: "NEUTRAL", confidence: 0 };

  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const volumes = candles.map((c) => safeNum(c[5]) || safeNum(c.volume) || 0);
  const highs = candles.map((c) => safeNum(c[1]) || safeNum(c.high));
  const lows = candles.map((c) => safeNum(c[2]) || safeNum(c.low));

  const len = closes.length;
  const recent20 = closes.slice(-20);
  const recent40 = closes.slice(-40);
  const recentVol = volumes.slice(-20);
  const olderVol = volumes.slice(-40, -20);

  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));
  const rangeWidth = recentHigh - recentLow;
  const rangeWidthPct = recentLow > 0 ? (rangeWidth / recentLow) * 100 : 0;

  const avgRecentVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
  const avgOlderVol = olderVol.reduce((a, b) => a + b, 0) / olderVol.length;
  const volRatio = avgOlderVol > 0 ? avgRecentVol / avgOlderVol : 1;

  // Price trend over 40 bars
  const trend40 = len > 40 ? ((closes[len - 1] - closes[len - 40]) / closes[len - 40]) * 100 : 0;
  const trend20 = len > 20 ? ((closes[len - 1] - closes[len - 20]) / closes[len - 20]) * 100 : 0;

  // Tight consolidation (small range, decreasing volume = Spring/UTAD territory)
  const isConsolidating = rangeWidthPct < 5 && volRatio < 0.8;
  const isExpandingUp = trend20 > 5 && volRatio > 1.2;
  const isExpandingDown = trend20 < -5 && volRatio > 1.2;
  const isRetracing = trend40 > 10 && trend20 < 0 && trend20 > -8;

  let phase, event, bias, confidence;

  if (isConsolidating && trend40 < -10) {
    phase = "ACCUMULATION";
    event = detectAccumulationEvent(candles);
    bias = "BULLISH";
    confidence = 65;
  } else if (isConsolidating && trend40 > 10) {
    phase = "DISTRIBUTION";
    event = "CONSOLIDATION_NEAR_TOP";
    bias = "BEARISH";
    confidence = 60;
  } else if (isExpandingUp && trend40 > 0) {
    phase = "MARKUP";
    event = "MARKUP_UPTREND";
    bias = "BULLISH";
    confidence = 70;
  } else if (isExpandingDown && trend40 < 0) {
    phase = "MARKDOWN";
    event = "MARKDOWN_DOWNTREND";
    bias = "BEARISH";
    confidence = 70;
  } else if (isRetracing) {
    phase = "REACCUMULATION";
    event = "PULLBACK_IN_UPTREND";
    bias = "BULLISH";
    confidence = 55;
  } else {
    phase = "UNCLEAR";
    event = null;
    bias = "NEUTRAL";
    confidence = 30;
  }

  return {
    phase,
    event,
    bias,
    confidence,
    rangeWidthPct: round2(rangeWidthPct),
    volumeTrend: volRatio > 1.2 ? "EXPANDING" : volRatio < 0.8 ? "CONTRACTING" : "STABLE",
    priceTrend40d: round2(trend40),
    priceTrend20d: round2(trend20),
    interpretation: wyckoffInterpretation(phase, event),
  };
}

function detectAccumulationEvent(candles) {
  const lows = candles.slice(-40).map((c) => safeNum(c[2]) || safeNum(c.low));
  const closes = candles.slice(-40).map((c) => safeNum(c[4]) || safeNum(c.close));
  const volumes = candles.slice(-40).map((c) => safeNum(c[5]) || safeNum(c.volume) || 0);

  // Spring: sharp dip below support then sharp recovery on high volume
  const recentLow = Math.min(...lows.slice(-10));
  const priorLow = Math.min(...lows.slice(0, -10));
  const currentClose = closes[closes.length - 1];
  const springVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  if (recentLow < priorLow && currentClose > priorLow && springVol > avgVol * 1.5) {
    return "SPRING"; // Most bullish Wyckoff signal
  }
  return "POSSIBLE_ACCUMULATION";
}

function wyckoffInterpretation(phase, event) {
  const map = {
    SPRING: "SPRING detected — smart money tested supply, found it lacking. High-conviction long entry. Classic Wyckoff BUY signal.",
    MARKUP_UPTREND: "MARKUP phase — institutional buying complete. Trend well underway. Buy pullbacks to rising support.",
    DISTRIBUTION: "DISTRIBUTION phase — smart money distributing to retail. Reduce longs. Prepare for markdown.",
    MARKDOWN_DOWNTREND: "MARKDOWN phase — selling pressure dominant. Avoid longs. Short rallies.",
    PULLBACK_IN_UPTREND: "REACCUMULATION — healthy pullback in uptrend. Potential LPS (Last Point of Support). Buy the dip.",
    POSSIBLE_ACCUMULATION: "Possible accumulation underway. Watch for Spring + volume surge as confirmation.",
  };
  return map[event] || "Wyckoff phase unclear — needs more data.";
}

// ─────────────────────────────────────────────
// ELLIOTT WAVE STRUCTURE DETECTOR (Ch.12)
// ─────────────────────────────────────────────
export function detectElliottWaveStructure(candles = []) {
  if (candles.length < 50) return { wavePosition: "UNKNOWN", confidence: 0 };

  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const len = closes.length;

  // Find significant pivots (simplified swing high/low detection)
  const pivots = findSignificantPivots(closes, 5);
  if (pivots.length < 5) return { wavePosition: "INSUFFICIENT_PIVOTS", confidence: 0 };

  // Check for 5-wave impulse structure
  const lastFive = pivots.slice(-5);
  const wave1 = lastFive[1].price - lastFive[0].price;
  const wave2 = lastFive[2].price - lastFive[1].price;
  const wave3 = lastFive[3].price - lastFive[2].price;
  const wave4 = lastFive[4].price - lastFive[3].price;

  const isImpulse = (
    Math.sign(wave1) === Math.sign(wave3) &&
    Math.sign(wave2) !== Math.sign(wave1) &&
    Math.sign(wave4) !== Math.sign(wave3)
  );

  const wave3AbsLargest = Math.abs(wave3) > Math.abs(wave1) && Math.abs(wave3) > Math.abs(wave2);

  // Fibonacci ratios
  const wave3To1Ratio = wave1 !== 0 ? Math.abs(wave3 / wave1) : 0;
  const wave2Retracement = wave1 !== 0 ? Math.abs(wave2 / wave1) : 0;

  let wavePosition = "UNCLEAR";
  let confidence = 0;
  let projection = null;

  if (isImpulse && wave3AbsLargest) {
    // Likely completing wave 4 or in wave 5
    const wave4Retracement = wave3 !== 0 ? Math.abs(wave4 / wave3) : 0;

    if (wave4Retracement > 0.2 && wave4Retracement < 0.7) {
      wavePosition = wave1 > 0 ? "WAVE_4_CORRECTION_BULLISH" : "WAVE_4_CORRECTION_BEARISH";
      confidence = 55;
      // Wave 5 target = wave 1 start + (wave 1 length * 1.618 or 1.0)
      const wave1Length = Math.abs(wave1);
      const targetMultiple = wave3To1Ratio > 1.5 ? 1.0 : 1.618;
      const wave5Target = lastFive[4].price + (wave1 > 0 ? 1 : -1) * wave1Length * targetMultiple;
      projection = { wave5Target: round2(wave5Target), fib: targetMultiple === 1.618 ? "1.618x W1" : "1.0x W1" };
    } else {
      wavePosition = wave1 > 0 ? "POSSIBLE_WAVE_3_BULLISH" : "POSSIBLE_WAVE_3_BEARISH";
      confidence = 45;
    }
  }

  // Check for corrective ABC
  if (wavePosition === "UNCLEAR" && pivots.length >= 3) {
    const lastThree = pivots.slice(-3);
    const a = lastThree[1].price - lastThree[0].price;
    const b = lastThree[2].price - lastThree[1].price;
    if (Math.sign(a) !== Math.sign(b)) {
      const bRet = Math.abs(b / a);
      if (bRet > 0.5 && bRet < 0.9) {
        wavePosition = a < 0 ? "ABC_CORRECTION_BULLISH_C_AHEAD" : "ABC_CORRECTION_BEARISH_C_AHEAD";
        confidence = 40;
      }
    }
  }

  return {
    wavePosition,
    confidence,
    projection,
    fibRatios: {
      wave3to1: round2(wave3To1Ratio),
      wave2Retracement: round2(wave2Retracement),
    },
    interpretation: elliottInterpretation(wavePosition, projection),
  };
}

function findSignificantPivots(closes, lookback = 5) {
  const pivots = [];
  for (let i = lookback; i < closes.length - lookback; i++) {
    const window = closes.slice(i - lookback, i + lookback + 1);
    const val = closes[i];
    if (val === Math.max(...window)) pivots.push({ idx: i, price: val, type: "HIGH" });
    if (val === Math.min(...window)) pivots.push({ idx: i, price: val, type: "LOW" });
  }
  // Deduplicate consecutive same-type pivots
  return pivots.filter((p, i) => i === 0 || pivots[i - 1].type !== p.type);
}

function elliottInterpretation(pos, projection) {
  const map = {
    WAVE_4_CORRECTION_BULLISH: `Wave 4 correction — normal retracement in uptrend. BULLISH setup: Wave 5 ahead.${projection ? ` Target ~${projection.wave5Target} (${projection.fib} wave 1)` : ""}`,
    WAVE_4_CORRECTION_BEARISH: `Wave 4 correction — normal retracement in downtrend. Wave 5 down ahead.${projection ? ` Target ~${projection.wave5Target}` : ""}`,
    POSSIBLE_WAVE_3_BULLISH: "Possible Wave 3 underway — longest, strongest wave. High momentum entry. Do not miss.",
    POSSIBLE_WAVE_3_BEARISH: "Possible Wave 3 down — momentum sell signal. Avoid longs.",
    ABC_CORRECTION_BULLISH_C_AHEAD: "ABC correction — Wave C up likely. Potential buying opportunity at A low.",
    ABC_CORRECTION_BEARISH_C_AHEAD: "ABC correction — Wave C down likely. Risk of further decline.",
    UNCLEAR: "Wave structure not clear enough for high-confidence label.",
    UNKNOWN: "Insufficient data for Elliott Wave analysis.",
  };
  return map[pos] || "Pattern unclassified.";
}

// ─────────────────────────────────────────────
// CHART PATTERN RECOGNITION (Ch.6)
// Detects: H&S, Double Top/Bottom, Triangle, Flag, Wedge
// ─────────────────────────────────────────────
export function detectChartPatterns(candles = []) {
  if (candles.length < 20) return { patterns: [], primaryPattern: null };

  const closes = candles.map((c) => safeNum(c[4]) || safeNum(c.close)).filter(Boolean);
  const highs = candles.map((c) => safeNum(c[1]) || safeNum(c.high)).filter(Boolean);
  const lows = candles.map((c) => safeNum(c[2]) || safeNum(c.low)).filter(Boolean);
  const volumes = candles.map((c) => safeNum(c[5]) || safeNum(c.volume) || 0);

  const detected = [];

  // Double Top Detection
  const doubleTop = detectDoubleTop(highs, closes, volumes);
  if (doubleTop) detected.push(doubleTop);

  // Double Bottom Detection
  const doubleBottom = detectDoubleBottom(lows, closes, volumes);
  if (doubleBottom) detected.push(doubleBottom);

  // Head & Shoulders
  const hns = detectHeadAndShoulders(highs, lows, closes);
  if (hns) detected.push(hns);

  // Triangle (Ascending/Descending/Symmetrical)
  const triangle = detectTriangle(highs, lows, closes);
  if (triangle) detected.push(triangle);

  // Flag Pattern
  const flag = detectFlag(closes, volumes);
  if (flag) detected.push(flag);

  // Bull/Bear Wedge
  const wedge = detectWedge(highs, lows, closes);
  if (wedge) detected.push(wedge);

  // Sort by confidence
  detected.sort((a, b) => b.confidence - a.confidence);
  const primaryPattern = detected[0] || null;

  return {
    patterns: detected,
    primaryPattern,
    patternBias: primaryPattern ? primaryPattern.bias : "NEUTRAL",
  };
}

function detectDoubleTop(highs, closes, volumes) {
  const n = highs.length;
  if (n < 20) return null;
  const lookback = Math.min(n, 40);
  const slice = highs.slice(-lookback);
  const max1Idx = slice.indexOf(Math.max(...slice));
  const max1 = slice[max1Idx];
  // Find second peak after valley
  const afterMax1 = slice.slice(max1Idx + 5);
  if (afterMax1.length < 5) return null;
  const max2 = Math.max(...afterMax1);
  const tolerance = 0.02;
  if (Math.abs(max2 - max1) / max1 <= tolerance && max2 > 0.95 * max1) {
    return {
      pattern: "DOUBLE_TOP",
      bias: "BEARISH",
      confidence: 65,
      description: `Double Top at ~${Math.round(max1)}. Classic reversal signal. Neckline breakdown = strong sell.`,
      target: round2(max1 * 0.92),
    };
  }
  return null;
}

function detectDoubleBottom(lows, closes, volumes) {
  const n = lows.length;
  if (n < 20) return null;
  const lookback = Math.min(n, 40);
  const slice = lows.slice(-lookback);
  const min1Idx = slice.indexOf(Math.min(...slice));
  const min1 = slice[min1Idx];
  const afterMin1 = slice.slice(min1Idx + 5);
  if (afterMin1.length < 5) return null;
  const min2 = Math.min(...afterMin1);
  const tolerance = 0.02;
  if (Math.abs(min2 - min1) / min1 <= tolerance && min2 < 1.05 * min1) {
    return {
      pattern: "DOUBLE_BOTTOM",
      bias: "BULLISH",
      confidence: 68,
      description: `Double Bottom at ~${Math.round(min1)}. Reversal pattern. Neckline breakout = strong buy.`,
      target: round2(min1 * 1.08),
    };
  }
  return null;
}

function detectHeadAndShoulders(highs, lows, closes) {
  const n = highs.length;
  if (n < 30) return null;
  const slice = highs.slice(-30);
  // Find 3 peaks
  const peaks = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i] > slice[i - 1] && slice[i] > slice[i - 2] &&
        slice[i] > slice[i + 1] && slice[i] > slice[i + 2]) {
      peaks.push({ idx: i, val: slice[i] });
    }
  }
  if (peaks.length >= 3) {
    const [l, h, r] = peaks.slice(-3);
    const shoulderTolerance = 0.05;
    if (h.val > l.val && h.val > r.val &&
        Math.abs(l.val - r.val) / l.val < shoulderTolerance) {
      return {
        pattern: "HEAD_AND_SHOULDERS",
        bias: "BEARISH",
        confidence: 72,
        description: "Head & Shoulders top detected. Bearish reversal. Neckline break triggers measured move down.",
        target: round2(closes[closes.length - 1] * 0.88),
      };
    }
  }
  return null;
}

function detectTriangle(highs, lows, closes) {
  if (closes.length < 20) return null;
  const slice20h = highs.slice(-20);
  const slice20l = lows.slice(-20);
  const highTrend = slice20h[19] - slice20h[0];
  const lowTrend = slice20l[19] - slice20l[0];

  if (highTrend < -1 && lowTrend > 1) {
    return {
      pattern: "SYMMETRICAL_TRIANGLE",
      bias: "NEUTRAL",
      confidence: 58,
      description: "Symmetrical Triangle — coiling energy. Breakout direction will be decisive. Watch for volume surge at breakout.",
    };
  }
  if (Math.abs(highTrend) < highs[0] * 0.01 && lowTrend > 1) {
    return {
      pattern: "ASCENDING_TRIANGLE",
      bias: "BULLISH",
      confidence: 65,
      description: "Ascending Triangle — flat resistance with rising lows. Bullish breakout expected. Buy on close above resistance.",
    };
  }
  if (highTrend < -1 && Math.abs(lowTrend) < lows[0] * 0.01) {
    return {
      pattern: "DESCENDING_TRIANGLE",
      bias: "BEARISH",
      confidence: 65,
      description: "Descending Triangle — declining highs with flat support. Bearish breakdown expected.",
    };
  }
  return null;
}

function detectFlag(closes, volumes) {
  if (closes.length < 15) return null;
  const recent5 = closes.slice(-5);
  const prior10 = closes.slice(-15, -5);
  const poleMove = Math.abs(prior10[9] - prior10[0]) / prior10[0];
  const flagRange = (Math.max(...recent5) - Math.min(...recent5)) / Math.min(...recent5);

  if (poleMove > 0.05 && flagRange < 0.03) {
    const isBullish = prior10[9] > prior10[0];
    return {
      pattern: isBullish ? "BULL_FLAG" : "BEAR_FLAG",
      bias: isBullish ? "BULLISH" : "BEARISH",
      confidence: 60,
      description: `${isBullish ? "Bull" : "Bear"} Flag — strong pole followed by tight consolidation. High-probability continuation pattern.`,
      target: isBullish
        ? round2(closes[closes.length - 1] * (1 + poleMove))
        : round2(closes[closes.length - 1] * (1 - poleMove)),
    };
  }
  return null;
}

function detectWedge(highs, lows, closes) {
  if (closes.length < 15) return null;
  const slice = closes.slice(-15);
  const trend = slice[14] - slice[0];
  const highRange = Math.max(...highs.slice(-15)) - Math.min(...highs.slice(-15));
  const lowRange = Math.max(...lows.slice(-15)) - Math.min(...lows.slice(-15));
  const isConverging = highRange < highs[0] * 0.05 && lowRange < lows[0] * 0.05;

  if (isConverging) {
    if (trend > 0) {
      return {
        pattern: "RISING_WEDGE",
        bias: "BEARISH",
        confidence: 55,
        description: "Rising Wedge — price rising but narrowing. Bearish reversal pattern. Breakdown imminent.",
      };
    } else {
      return {
        pattern: "FALLING_WEDGE",
        bias: "BULLISH",
        confidence: 58,
        description: "Falling Wedge — price falling but narrowing. Bullish reversal. Breakout to upside expected.",
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// COMBINED TECHNICAL SCORE ENHANCER
// Integrates all new indicators into a score delta
// ─────────────────────────────────────────────
export function computeEnhancedTechnicalScore(candles = [], baseScore = 50) {
  if (!candles || candles.length < 20) {
    return { enhancedScore: baseScore, delta: 0, signals: [] };
  }

  const signals = [];
  let delta = 0;

  // ADX
  const adx = computeADX(candles);
  if (adx.adx !== null) {
    if (adx.trendStrength === "RANGING") {
      delta -= 5; signals.push({ indicator: "ADX", value: adx.adx, signal: "RANGE_BOUND — reduce trend signals" });
    } else if (adx.signal === "UPTREND_CONFIRMED") {
      delta += 10; signals.push({ indicator: "ADX", value: adx.adx, signal: "Uptrend confirmed by ADX" });
    } else if (adx.signal === "DOWNTREND_CONFIRMED") {
      delta -= 10; signals.push({ indicator: "ADX", value: adx.adx, signal: "Downtrend confirmed by ADX" });
    }
  }

  // Supertrend
  const st = computeSupertrend(candles);
  if (st.direction) {
    if (st.signal === "JUST_TURNED_BULLISH") {
      delta += 15; signals.push({ indicator: "Supertrend", signal: "JUST TURNED BULLISH — strong buy signal" });
    } else if (st.signal === "JUST_TURNED_BEARISH") {
      delta -= 15; signals.push({ indicator: "Supertrend", signal: "JUST TURNED BEARISH — strong sell signal" });
    } else if (st.direction === "BULLISH") {
      delta += 7; signals.push({ indicator: "Supertrend", signal: "Bullish trend intact" });
    } else {
      delta -= 7; signals.push({ indicator: "Supertrend", signal: "Bearish trend" });
    }
  }

  // Wyckoff
  const wyckoff = classifyWyckoffPhase(candles);
  if (wyckoff.event === "SPRING") {
    delta += 18; signals.push({ indicator: "Wyckoff", signal: "SPRING detected — institutional accumulation" });
  } else if (wyckoff.phase === "MARKUP") {
    delta += 10; signals.push({ indicator: "Wyckoff", signal: "Markup phase — uptrend underway" });
  } else if (wyckoff.phase === "DISTRIBUTION") {
    delta -= 12; signals.push({ indicator: "Wyckoff", signal: "Distribution phase — caution" });
  }

  // Elliott Wave
  const ew = detectElliottWaveStructure(candles);
  if (ew.wavePosition === "WAVE_4_CORRECTION_BULLISH") {
    delta += 12; signals.push({ indicator: "Elliott Wave", signal: "Wave 4 — Wave 5 up ahead" });
  } else if (ew.wavePosition === "POSSIBLE_WAVE_3_BULLISH") {
    delta += 8; signals.push({ indicator: "Elliott Wave", signal: "Possible Wave 3 up — high momentum" });
  } else if (ew.wavePosition?.includes("BEARISH")) {
    delta -= 8; signals.push({ indicator: "Elliott Wave", signal: "Bearish wave structure" });
  }

  // Chart Patterns
  const patterns = detectChartPatterns(candles);
  if (patterns.primaryPattern) {
    const p = patterns.primaryPattern;
    const pDelta = p.bias === "BULLISH" ? p.confidence * 0.15 : p.bias === "BEARISH" ? -p.confidence * 0.15 : 0;
    delta += pDelta;
    signals.push({ indicator: "Pattern", signal: `${p.pattern}: ${p.bias}` });
  }

  const enhancedScore = Math.max(0, Math.min(100, baseScore + delta));

  return {
    enhancedScore: Math.round(enhancedScore),
    delta: Math.round(delta),
    signals,
    adx,
    supertrend: st,
    wyckoff,
    elliottWave: ew,
    chartPatterns: patterns,
    volumeProfile: computeVolumeProfile(candles),
  };
}
