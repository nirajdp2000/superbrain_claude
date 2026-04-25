/**
 * Verdict classifier — the ONLY place in the codebase that emits verdict
 * letters (STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL / NO_CALL).
 *
 * TRANSFORMATION_ROADMAP §3.10, §3.11, Principle #8:
 *   "For a given snapshot and a given strategy, the verdict letter is
 *    computed once by src/core/verdict.mjs and every tab that renders
 *    a verdict for that strategy reads the same letter."
 *
 * Phase 1 (current): wraps current `classifyVerdict` logic extracted from
 * `analysis-service.mjs`, adds basic regime-awareness, and enforces the
 * pillar-unanimity gate when pillar data is available.
 *
 * Phase 3: fully regime-aware thresholds, isotonic-calibrated confidence.
 *
 * ESLint rule (enforced in CI): frontend/ cannot import this file.
 */

/**
 * @typedef {"STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL" | "NO_CALL"} VerdictLetter
 */

/**
 * @typedef {Object} VerdictInput
 * @property {number} adjustedScore       — 0..100 weighted pillar sum
 * @property {number} riskScore           — 0..100 risk score (higher = more risky)
 * @property {Object} [newsSummary]       — { newsCount, verifiedCount, evidenceGrade, signalBalance }
 * @property {Object} [eventExposure]     — { score } 0..100, 50 = neutral
 * @property {boolean} [strictVerification]
 * @property {Object} [regime]            — { label: "bull"|"neutral"|"bear", vixPercentile, niftyVsDma }
 * @property {Array}  [riskFlags]         — [{ code, severity: "hard"|"soft" }]
 * @property {Object} [pillarScores]      — { technical, qglp, coffeeCan, macroIndia, newsSent } each in [-2, +2]
 * @property {number} [confidence]        — 0..100 self-reported confidence
 * @property {"intraday"|"swing"|"position"|"longterm"} [strategy="swing"]
 */

/**
 * @typedef {Object} VerdictOutput
 * @property {VerdictLetter} letter
 * @property {number} confidence           — 0..100 final confidence after calibration
 * @property {string[]} reasoning          — short bullets explaining the verdict
 * @property {"hard_risk"|"timeframe_conflict"|"insufficient_evidence"|null} gate
 */

const HARD_RISK_CODES = new Set([
  "GOVERNANCE_RED",
  "AUDITOR_CHANGE_UNEXPLAINED",
  "DEFAULT_RISK",
  "INVESTIGATION",
  "SEBI_ACTION",
  "PAUL_RED_FLAG_D_E_OVER_1_5",
  "PAUL_RED_FLAG_AUDITOR_RESIGNED",
  "PAUL_RED_FLAG_PROMOTER_PLEDGE_SPIKE",
  "FNO_BAN",
  "PROMOTER_SOLD_BULK_30D",
]);

const SOFT_RISK_CODES = new Set([
  "POST_IPO_COOLOFF_12M",
  "GROWTH_TRAP",
  "CYCLICAL_TOP",
  "PLEDGE_ABOVE_30PCT",
  "MWPL_SATURATED_80_PLUS",
  "EXPIRY_WEEK_CAUTION",
]);

/** Per-strategy minimum confidence to issue a STRONG verdict. */
const STRONG_CONFIDENCE_THRESHOLD = {
  intraday: 72,
  swing: 78,
  position: 82,
  longterm: 85,
};

/** Per-strategy minimum confidence to issue any directional call (BUY/SELL). */
const DIRECTIONAL_CONFIDENCE_THRESHOLD = {
  intraday: 58,
  swing: 60,
  position: 63,
  longterm: 65,
};

/**
 * Check for hard risk-flag gate (§3.5): if any hard flag is set, verdict
 * is capped at HOLD regardless of pillar scores.
 */
function hasHardRiskFlag(riskFlags = []) {
  return riskFlags.some(
    (f) => f?.severity === "hard" || HARD_RISK_CODES.has(f?.code),
  );
}

/**
 * Pillar unanimity check (§3.11): at least ⌈0.7 × N⌉ pillars must point
 * in the same direction as the verdict for a STRONG call to stand.
 */
function pillarsUnanimous(pillarScores, direction) {
  if (!pillarScores || typeof pillarScores !== "object") return true; // no pillars yet (Phase 1) → not a block
  const values = Object.values(pillarScores).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return true;
  const agreeing = values.filter((v) => (direction > 0 ? v > 0.2 : v < -0.2)).length;
  const required = Math.ceil(0.7 * values.length);
  return agreeing >= required;
}

/**
 * Regime-aware threshold adjustment (§3.4): in bull regime the thresholds
 * shift up (harder to SELL); in bear they shift down (harder to BUY).
 *
 * Phase 1: modest ±5 nudge. Phase 3: replace with σ-based bands on
 * z-scored pillar vector + Nifty PE/VIX percentile.
 */
function regimeAdjustedThresholds(regime) {
  const base = {
    strongBuy: 78,
    buy: 64,
    holdLow: 46,
    sell: 30,
  };
  if (!regime) return base;
  if (regime.label === "bull") {
    return {
      strongBuy: base.strongBuy - 3, // easier STRONG_BUY in bull
      buy: base.buy - 3,
      holdLow: base.holdLow,
      sell: base.sell - 5, // much harder to SELL in bull
    };
  }
  if (regime.label === "bear") {
    return {
      strongBuy: base.strongBuy + 5, // harder STRONG_BUY in bear
      buy: base.buy + 3,
      holdLow: base.holdLow + 2,
      sell: base.sell + 5,
    };
  }
  return base;
}

/**
 * Main verdict classifier. Returns the single canonical verdict letter
 * for a (snapshot, strategy) pair.
 *
 * @param {VerdictInput} input
 * @returns {VerdictOutput}
 */
export function verdict(input) {
  const {
    adjustedScore = 50,
    riskScore = 50,
    newsSummary = { newsCount: 0, verifiedCount: 0, evidenceGrade: "C", signalBalance: 0 },
    eventExposure = { score: 50 },
    strictVerification = false,
    regime = { label: "neutral" },
    riskFlags = [],
    pillarScores = null,
    confidence = null,
    strategy = "swing",
  } = input || {};

  const reasoning = [];

  // ── Hard gate #1: any hard risk-flag caps at HOLD ──────────────────────
  if (hasHardRiskFlag(riskFlags)) {
    const triggers = riskFlags
      .filter((f) => f?.severity === "hard" || HARD_RISK_CODES.has(f?.code))
      .map((f) => f.code)
      .join(", ");
    reasoning.push(`Hard risk gate: ${triggers}`);
    return {
      letter: "HOLD",
      confidence: Math.min(55, confidence ?? 55),
      reasoning,
      gate: "hard_risk",
    };
  }

  // ── Hard gate #2: insufficient evidence ─────────────────────────────────
  // If news is strict-verified and we have no verified sources, block STRONG
  // but allow HOLD.
  if (strictVerification && newsSummary.newsCount > 0 && newsSummary.verifiedCount === 0 && adjustedScore >= 56) {
    reasoning.push("News present but unverified — forcing HOLD under strict-verification");
    return { letter: "HOLD", confidence: Math.min(55, confidence ?? 55), reasoning, gate: "insufficient_evidence" };
  }

  // ── Compute tentative letter from adjusted score + regime ─────────────
  const T = regimeAdjustedThresholds(regime);
  let letter;
  let tentativeConfidence = confidence ?? deriveConfidenceFromScore(adjustedScore, riskScore);

  if (adjustedScore >= T.strongBuy && riskScore <= 48 && eventExposure.score >= 52) {
    letter = "STRONG_BUY";
  } else if (adjustedScore >= T.buy && riskScore <= 62) {
    letter = "BUY";
  } else if (adjustedScore >= T.holdLow) {
    letter = "HOLD";
  } else if (adjustedScore >= T.sell && (riskScore >= 60 || eventExposure.score <= 42)) {
    letter = "SELL";
  } else if (adjustedScore < T.sell) {
    letter = "STRONG_SELL";
  } else {
    letter = "SELL";
  }

  reasoning.push(`Score ${adjustedScore} vs thresholds SB=${T.strongBuy}/B=${T.buy}/HL=${T.holdLow}/S=${T.sell} in ${regime.label} regime`);

  // ── STRONG pillar-unanimity gate (§3.11) ──────────────────────────────
  if ((letter === "STRONG_BUY" || letter === "STRONG_SELL") && pillarScores) {
    const direction = letter === "STRONG_BUY" ? 1 : -1;
    if (!pillarsUnanimous(pillarScores, direction)) {
      reasoning.push("STRONG downgraded — pillars not unanimous (⌈0.7·N⌉ required)");
      letter = direction > 0 ? "BUY" : "SELL";
    }
  }

  // ── STRONG confidence-threshold gate (§3.11 + §6.5) ────────────────────
  const strongThresh = STRONG_CONFIDENCE_THRESHOLD[strategy] ?? 78;
  if ((letter === "STRONG_BUY" || letter === "STRONG_SELL") && tentativeConfidence < strongThresh) {
    reasoning.push(`STRONG downgraded — confidence ${tentativeConfidence} < ${strongThresh} threshold for ${strategy}`);
    letter = letter === "STRONG_BUY" ? "BUY" : "SELL";
  }

  // ── Directional confidence gate → NO_CALL ─────────────────────────────
  const directionalThresh = DIRECTIONAL_CONFIDENCE_THRESHOLD[strategy] ?? 60;
  if (
    (letter === "BUY" || letter === "SELL") &&
    tentativeConfidence < directionalThresh - 10 // 10-pt buffer below threshold
  ) {
    reasoning.push(`NO_CALL — confidence ${tentativeConfidence} well below ${directionalThresh} for ${strategy}`);
    return { letter: "NO_CALL", confidence: tentativeConfidence, reasoning, gate: "insufficient_evidence" };
  }

  // ── Soft flags: reduce confidence but don't downgrade letter ──────────
  const softFlags = riskFlags.filter((f) => f?.severity === "soft" || SOFT_RISK_CODES.has(f?.code));
  if (softFlags.length) {
    tentativeConfidence = Math.max(0, tentativeConfidence - softFlags.length * 3);
    reasoning.push(`Soft flags present (${softFlags.map((f) => f.code).join(", ")}) — confidence reduced`);
  }

  return { letter, confidence: Math.round(tentativeConfidence), reasoning, gate: null };
}

/**
 * Fallback confidence when pillars haven't reported one. Roughly maps
 * score strength to a confidence value — replaced by isotonic calibration
 * in Phase 4.5.
 */
function deriveConfidenceFromScore(score, riskScore) {
  const scoreStrength = Math.abs(score - 50); // 0..50
  const riskPenalty = Math.max(0, riskScore - 50); // 0..50
  return Math.max(20, Math.min(95, 55 + scoreStrength - riskPenalty * 0.3));
}

/**
 * Compatibility shim: mimics the old `classifyVerdict` signature so
 * existing call sites in analysis-service.mjs can migrate incrementally.
 *
 * @deprecated Call `verdict(input)` directly.
 */
export function classifyVerdictLegacy(adjustedScore, riskScore, newsSummary, eventExposure, strictVerification, extra = {}) {
  return verdict({
    adjustedScore,
    riskScore,
    newsSummary,
    eventExposure,
    strictVerification,
    regime: extra.regime,
    riskFlags: extra.riskFlags,
    pillarScores: extra.pillarScores,
    confidence: extra.confidence,
    strategy: extra.strategy ?? "swing",
  }).letter;
}

/**
 * Quick timeframe-conflict detector: given four per-strategy verdict
 * letters, returns a badge if intraday & longterm disagree by direction.
 * Used by the UI to show `TIMEFRAME_CONFLICT` per Principle #8.
 */
export function detectTimeframeConflict(scores) {
  if (!scores?.intraday || !scores?.longterm) return null;
  const dir = (l) =>
    l?.verdict?.startsWith("STRONG_BUY") || l?.verdict === "BUY"
      ? 1
      : l?.verdict?.startsWith("STRONG_SELL") || l?.verdict === "SELL"
        ? -1
        : 0;
  const a = dir(scores.intraday);
  const b = dir(scores.longterm);
  if (a !== 0 && b !== 0 && a !== b) {
    return {
      code: "TIMEFRAME_CONFLICT",
      explain: `Intraday says ${scores.intraday.verdict}, Longterm says ${scores.longterm.verdict} — different conviction horizons disagree.`,
    };
  }
  return null;
}
