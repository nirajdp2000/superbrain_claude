import { analyzeMarket } from "./analysis-service.mjs";
import { getQuotes } from "./market-service.mjs";
import { getBroadEquityUniverse } from "./broad-universe-service.mjs";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : 0;
}

class TopSignalsService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 3 * 60 * 1000;
    this.deepDivePerSide = 40;
  }

  mapTimeframeToStrategy(timeframe = "swing") {
    if (timeframe === "intraday") return "intraday";
    if (timeframe === "short_term") return "position";
    if (timeframe === "long_term") return "longterm";
    return "swing";
  }

  async getScanUniverse() {
    return getBroadEquityUniverse();
  }

  quickScore(quote, strategy = "swing") {
    const price = Number(quote?.price || 0);
    const open = Number(quote?.open || price || 0);
    const high = Number(quote?.high || price || 0);
    const low = Number(quote?.low || price || 0);
    const changePct = Number(quote?.changePct || 0);
    const openMovePct = open > 0 ? ((price - open) / open) * 100 : changePct;
    const rangePosition = high > low ? (price - low) / (high - low) : 0.5;

    const weight = strategy === "intraday"
      ? { change: 8.5, open: 5.2, range: 32 }
      : strategy === "position"
        ? { change: 4.4, open: 2.7, range: 20 }
        : strategy === "longterm"
          ? { change: 3.6, open: 2.1, range: 16 }
          : { change: 6.4, open: 3.8, range: 26 };

    return clamp(
      50
      + changePct * weight.change
      + openMovePct * weight.open
      + (rangePosition - 0.5) * weight.range,
    );
  }

  quickRankUniverse(stocks = [], quotes = [], strategy = "swing") {
    const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const rows = [];
    const deduped = new Map();

    for (const stock of stocks) {
      const quote = quoteMap.get(stock.symbol);
      if (!quote?.price) {
        continue;
      }

      const row = {
        stock,
        quote,
        quickScore: Number(this.quickScore(quote, strategy).toFixed(1)),
        turnover: round(Number(quote?.price || 0) * Number(quote?.volume || 0), 0),
      };
      row.tradeabilityScore = this.tradeabilityScore(row);

      const existing = deduped.get(stock.symbol);
      if (
        !existing
        || row.quickScore > existing.quickScore
        || row.tradeabilityScore > existing.tradeabilityScore
        || Number(row.quote?.volume || 0) > Number(existing.quote?.volume || 0)
      ) {
        deduped.set(stock.symbol, row);
      }
    }

    rows.push(...deduped.values());
    return rows.sort((left, right) => right.quickScore - left.quickScore);
  }

  tradeabilityScore(row) {
    const price = Number(row.quote?.price || 0);
    const volume = Number(row.quote?.volume || 0);
    const turnover = Number(row.turnover || price * volume);
    const changePct = Math.abs(Number(row.quote?.changePct || 0));
    let score = 0;

    if (row.stock?.sector && row.stock.sector !== "Unknown") score += 8;
    else score -= 8;

    if (price >= 100) score += 4;
    else if (price >= 20) score += 3;
    else if (price >= 10) score += 1;
    else if (price < 5) score -= 8;
    else score -= 2;

    if (turnover >= 2e8) score += 16;
    else if (turnover >= 5e7) score += 12;
    else if (turnover >= 1e7) score += 8;
    else if (turnover >= 2e6) score += 4;
    else score -= 6;

    if (volume >= 500000) score += 6;
    else if (volume >= 100000) score += 4;
    else if (volume >= 30000) score += 2;
    else if (volume < 10000) score -= 5;

    if (changePct >= 12) score -= 4;
    else if (changePct >= 8) score -= 2;

    return round(score, 1);
  }

  shortlistPriority(row, side = "bullish") {
    const tradeability = Number(row.tradeabilityScore ?? this.tradeabilityScore(row));
    const directional = side === "bullish" ? row.quickScore : 100 - row.quickScore;
    const momentumMove = Math.abs(Number(row.quote?.changePct || 0));
    const cappedMove = Math.min(momentumMove, 6);
    const exhaustionPenalty = momentumMove > 10 ? (momentumMove - 10) * 1.6 : 0;
    return round(directional * 0.72 + tradeability * 1.45 + cappedMove * 0.9 - exhaustionPenalty, 2);
  }

  passesShortlistFloor(row, side = "bullish") {
    const price = Number(row.quote?.price || 0);
    const volume = Number(row.quote?.volume || 0);
    const turnover = Number(row.turnover || price * volume);
    const tradeability = Number(row.tradeabilityScore ?? this.tradeabilityScore(row));

    if (price < 2 || volume < 5000 || turnover < 5e5 || tradeability < -4) {
      return false;
    }

    return side === "bullish" ? row.quickScore >= 54 : row.quickScore <= 46;
  }

  buildDirectionalShortlist(rankings = [], side = "bullish") {
    const primary = rankings
      .filter((row) => this.passesShortlistFloor(row, side))
      .map((row) => ({ ...row, shortlistPriority: this.shortlistPriority(row, side) }))
      .sort((left, right) =>
        right.shortlistPriority - left.shortlistPriority
        || Number(right.tradeabilityScore || 0) - Number(left.tradeabilityScore || 0)
        || (side === "bullish" ? right.quickScore - left.quickScore : left.quickScore - right.quickScore));

    if (primary.length >= Math.ceil(this.deepDivePerSide / 2)) {
      return primary.slice(0, this.deepDivePerSide);
    }

    return rankings
      .filter((row) => {
        if (side === "bullish") {
          return row.quickScore >= 52 && Number(row.tradeabilityScore ?? this.tradeabilityScore(row)) >= -2;
        }

        return row.quickScore <= 48 && Number(row.tradeabilityScore ?? this.tradeabilityScore(row)) >= -2;
      })
      .map((row) => ({ ...row, shortlistPriority: this.shortlistPriority(row, side) }))
      .sort((left, right) =>
        right.shortlistPriority - left.shortlistPriority
        || Number(right.tradeabilityScore || 0) - Number(left.tradeabilityScore || 0)
        || (side === "bullish" ? right.quickScore - left.quickScore : left.quickScore - right.quickScore))
      .slice(0, this.deepDivePerSide);
  }

  buildShortlist(rankings = []) {
    const bullish = this.buildDirectionalShortlist(rankings, "bullish");
    const bearish = this.buildDirectionalShortlist(rankings, "bearish");
    const merged = new Map();

    for (const item of [...bullish, ...bearish]) {
      merged.set(item.stock.symbol, item.stock);
    }

    return [...merged.values()];
  }

  attachPreScanContext(results = [], rankings = []) {
    const rankingMap = new Map(rankings.map((row) => [row.stock.symbol, row]));

    return results.map((row) => {
      const ranking = rankingMap.get(row.symbol);
      if (!ranking) {
        return row;
      }

      const tradeabilityScore = Number(ranking.tradeabilityScore ?? this.tradeabilityScore(ranking));
      const turnover = Number(ranking.turnover || Number(ranking.quote?.price || 0) * Number(ranking.quote?.volume || 0));

      return {
        ...row,
        preScan: {
          quickScore: Number(ranking.quickScore || 0),
          tradeabilityScore: round(tradeabilityScore, 1),
          turnover: round(turnover, 0),
          bullishPriority: this.shortlistPriority(ranking, "bullish"),
          bearishPriority: this.shortlistPriority(ranking, "bearish"),
        },
      };
    });
  }

  resolveQuickScore(row) {
    if (Number.isFinite(Number(row.preScan?.quickScore))) {
      return Number(row.preScan.quickScore);
    }

    if (row.quote?.price) {
      return Number(this.quickScore(row.quote, row.strategy).toFixed(1));
    }

    return 50;
  }

  resolveTurnover(row) {
    if (Number.isFinite(Number(row.preScan?.turnover))) {
      return Number(row.preScan.turnover);
    }

    const price = Number(row.quote?.price || 0);
    const volume = Number(row.quote?.volume || 0);
    return round(price * volume, 0);
  }

  resolveTradeabilityScore(row) {
    if (Number.isFinite(Number(row.preScan?.tradeabilityScore))) {
      return Number(row.preScan.tradeabilityScore);
    }

    return Number(this.tradeabilityScore({
      stock: { sector: row.sector },
      quote: row.quote,
      turnover: this.resolveTurnover(row),
    }));
  }

  hasValidCandle(row, direction) {
    const candlestick = row.candlestickAnalysis || row.decisionEngine?.candlestickAnalysis || {};
    return candlestick.validity === "Valid" && candlestick.direction === direction;
  }

  bullishRadarConfluence(row) {
    const adjustedScore = Number(row.adjustedScore || row.score || 0);
    const technical = Number(row.scoreBreakdown?.technical || 0);
    const macro = Number(row.scoreBreakdown?.macro || 50);
    const risk = Number(row.scoreBreakdown?.risk || 100);
    const confidence = Number(row.confidence || 0);
    const quickScore = this.resolveQuickScore(row);
    const tradeability = this.resolveTradeabilityScore(row);
    const evidenceGrade = row.verification?.evidenceGrade || "D";
    const supportCount = [
      Number(row.scoreBreakdown?.events || 50) >= 40,
      Number(row.scoreBreakdown?.news || 50) >= 45,
      ["A", "B", "C"].includes(evidenceGrade),
      this.hasValidCandle(row, "bullish"),
      Number(row.longTermView?.score || 0) >= 58,
    ].filter(Boolean).length;
    const momentumSupport = quickScore >= 67 && tradeability >= 8;

    return adjustedScore >= 50
      && technical >= 62
      && macro >= 35
      && risk <= 62
      && confidence >= 40
      && quickScore >= 58
      && tradeability >= 2
      && (supportCount >= 1 || momentumSupport);
  }

  bearishRadarConfluence(row) {
    const adjustedScore = Number(row.adjustedScore || row.score || 0);
    const technical = Number(row.scoreBreakdown?.technical || 100);
    const macro = Number(row.scoreBreakdown?.macro || 50);
    const risk = Number(row.scoreBreakdown?.risk || 0);
    const confidence = Number(row.confidence || 0);
    const quickScore = this.resolveQuickScore(row);
    const tradeability = this.resolveTradeabilityScore(row);
    const evidenceGrade = row.verification?.evidenceGrade || "D";
    const supportCount = [
      Number(row.scoreBreakdown?.events || 50) <= 48,
      Number(row.scoreBreakdown?.news || 50) <= 45,
      ["A", "B", "C"].includes(evidenceGrade),
      this.hasValidCandle(row, "bearish"),
      Number(row.longTermView?.score || 0) <= 45,
    ].filter(Boolean).length;
    const momentumSupport = quickScore <= 33 && tradeability >= 8;

    return adjustedScore <= 50
      && technical <= 48
      && confidence >= 48
      && quickScore <= 40
      && tradeability >= 2
      && (risk >= 48 || macro <= 46)
      && (supportCount >= 1 || momentumSupport);
  }

  bullishRadarScore(row) {
    const quickScore = this.resolveQuickScore(row);
    const tradeabilityScore = this.resolveTradeabilityScore(row);
    const turnover = this.resolveTurnover(row);
    const turnoverScore = turnover >= 2e8 ? 8 : turnover >= 5e7 ? 6 : turnover >= 1e7 ? 4 : turnover >= 2e6 ? 2 : 0;
    let score = 0;

    score += Math.max(0, Number(row.adjustedScore || 0) - 48) * 1.15;
    score += Math.max(0, Number(row.scoreBreakdown?.technical || 0) - 60) * 0.82;
    score += Math.max(0, Number(row.scoreBreakdown?.fundamentals || 0) - 52) * 0.16;
    score += Math.max(0, Number(row.scoreBreakdown?.macro || 0) - 45) * 0.18;
    score += Math.max(0, Number(row.scoreBreakdown?.events || 0) - 40) * 0.16;
    score += Math.max(0, Number(row.confidence || 0) - 50) * 0.22;
    score += Math.max(0, quickScore - 58) * 0.8;
    score += Math.max(0, tradeabilityScore) * 0.7;
    score += turnoverScore;
    score -= Math.max(0, Number(row.scoreBreakdown?.risk || 0) - 57) * 0.7;

    if (row.verdict === "STRONG_BUY") score += 22;
    else if (row.verdict === "BUY") score += 16;
    else if (row.verdict === "HOLD") score += 4;

    if (this.hasValidCandle(row, "bullish")) score += 4;
    if (this.hasValidCandle(row, "bearish")) score -= 6;

    if (row.verdict === "HOLD" && this.bullishRadarConfluence(row)) {
      score += 10;
    }

    return round(score, 2);
  }

  bearishRadarScore(row) {
    const quickScore = this.resolveQuickScore(row);
    const tradeabilityScore = this.resolveTradeabilityScore(row);
    const turnover = this.resolveTurnover(row);
    const turnoverScore = turnover >= 2e8 ? 8 : turnover >= 5e7 ? 6 : turnover >= 1e7 ? 4 : turnover >= 2e6 ? 2 : 0;
    let score = 0;

    score += Math.max(0, 52 - Number(row.adjustedScore || 0)) * 1.15;
    score += Math.max(0, 50 - Number(row.scoreBreakdown?.technical || 0)) * 0.82;
    score += Math.max(0, 48 - Number(row.scoreBreakdown?.macro || 0)) * 0.18;
    score += Math.max(0, Number(row.scoreBreakdown?.risk || 0) - 50) * 0.7;
    score += Math.max(0, 48 - Number(row.scoreBreakdown?.events || 0)) * 0.16;
    score += Math.max(0, Number(row.confidence || 0) - 48) * 0.2;
    score += Math.max(0, 42 - quickScore) * 0.8;
    score += Math.max(0, tradeabilityScore) * 0.55;
    score += turnoverScore;

    if (row.verdict === "STRONG_SELL") score += 22;
    else if (row.verdict === "SELL") score += 16;
    else if (row.verdict === "HOLD") score += 4;

    if (this.hasValidCandle(row, "bearish")) score += 4;
    if (this.hasValidCandle(row, "bullish")) score -= 6;

    if (row.verdict === "HOLD" && this.bearishRadarConfluence(row)) {
      score += 10;
    }

    return round(score, 2);
  }

  radarVerdict(row, side = "bullish") {
    const score = side === "bullish" ? this.bullishRadarScore(row) : this.bearishRadarScore(row);

    if (side === "bullish") {
      if (row.verdict === "STRONG_BUY" || (this.bullishRadarConfluence(row) && score >= 100)) return "STRONG_BUY";
      if (row.verdict === "BUY" || (this.bullishRadarConfluence(row) && score >= 58)) return "BUY";
      return "IGNORE";
    }

    if (row.verdict === "STRONG_SELL" || (this.bearishRadarConfluence(row) && score >= 82)) return "STRONG_SELL";
    if (row.verdict === "SELL" || (this.bearishRadarConfluence(row) && score >= 56)) return "SELL";
    return "IGNORE";
  }

  buildOverviewFromPreScan(rankings = [], totalUniverse = 0) {
    const bullishCount = rankings.filter((row) => row.quickScore >= 62).length;
    const bearishCount = rankings.filter((row) => row.quickScore <= 38).length;
    const neutralCount = Math.max(0, totalUniverse - bullishCount - bearishCount);
    const averageScore = rankings.length
      ? Math.round(rankings.reduce((sum, row) => sum + row.quickScore, 0) / rankings.length)
      : 0;

    return {
      totalStocks: totalUniverse,
      totalAnalyzed: totalUniverse,
      bullishCount,
      bearishCount,
      neutralCount,
      averageScore,
      marketSentiment: bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral",
      lastUpdated: new Date().toISOString(),
    };
  }

  buildSectorRotation(rankings = []) {
    const sectorMap = new Map();

    for (const row of rankings) {
      const sector = row.stock?.sector || "Other";
      const bucket = sectorMap.get(sector) || {
        sector,
        count: 0,
        scoreTotal: 0,
        bullish: 0,
        bearish: 0,
      };

      bucket.count += 1;
      bucket.scoreTotal += Number(row.quickScore || 0);
      if (row.quickScore >= 62) bucket.bullish += 1;
      if (row.quickScore <= 38) bucket.bearish += 1;
      sectorMap.set(sector, bucket);
    }

    return [...sectorMap.values()]
      .map((bucket) => ({
        sector: bucket.sector,
        count: bucket.count,
        averageScore: bucket.count ? Number((bucket.scoreTotal / bucket.count).toFixed(1)) : 0,
        bullishShare: bucket.count ? Number(((bucket.bullish / bucket.count) * 100).toFixed(1)) : 0,
        bearishShare: bucket.count ? Number(((bucket.bearish / bucket.count) * 100).toFixed(1)) : 0,
      }))
      .sort((left, right) => right.averageScore - left.averageScore);
  }

  buildUnusualActivity(rankings = [], limit = 6) {
    return rankings
      .filter((row) =>
        Math.abs(Number(row.quote?.changePct || 0)) >= 4
        || Number(row.quote?.volume || 0) > 0 && Number(row.quickScore || 0) >= 68
        || Number(row.quote?.volume || 0) > 0 && Number(row.quickScore || 0) <= 32)
      .sort((left, right) =>
        Math.abs(Number(right.quote?.changePct || 0)) - Math.abs(Number(left.quote?.changePct || 0))
        || Math.abs(Number(right.quickScore || 0) - 50) - Math.abs(Number(left.quickScore || 0) - 50))
      .slice(0, limit)
      .map((row) => ({
        symbol: row.stock.symbol,
        companyName: row.stock.name,
        sector: row.stock.sector,
        changePercent: Number(row.quote?.changePct || 0),
        price: Number(row.quote?.price || 0),
        quickScore: Number(row.quickScore || 0),
        note: Math.abs(Number(row.quote?.changePct || 0)) >= 4
          ? `Price is moving ${Math.abs(Number(row.quote?.changePct || 0)).toFixed(1)}% in a single session.`
          : `Ranking dispersion is unusually wide for ${row.stock.symbol}.`,
      }));
  }

  async runScan(strategy = "swing") {
    const cacheKey = `scan:${strategy}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    const broadUniverse = await this.getScanUniverse();
    const quotes = await getQuotes(broadUniverse);
    const minimumCoverage = Math.min(250, Math.max(25, Math.round(broadUniverse.length * 0.02)));

    if (quotes.length < minimumCoverage) {
      throw new Error("Broad market quote sweep is unavailable. Reconnect Upstox to restore 5000+ stock scanning.");
    }

    const rankings = this.quickRankUniverse(broadUniverse, quotes, strategy);
    const shortlist = this.buildShortlist(rankings);
    const overview = this.buildOverviewFromPreScan(rankings, broadUniverse.length);
    overview.sectorRotation = this.buildSectorRotation(rankings);
    overview.unusualActivity = this.buildUnusualActivity(rankings, 8);
    const analysis = shortlist.length ? await analyzeMarket({
      strategy,
      stocks: shortlist,
      strictVerification: true,
      includeTargetedNews: false,
      newsTargetedLimit: 0,
    }) : {
      generatedAt: new Date().toISOString(),
      results: [],
    };
    const enrichedResults = this.attachPreScanContext(analysis.results || [], rankings);

    const data = {
      strategy,
      generatedAt: analysis.generatedAt || new Date().toISOString(),
      universeCount: broadUniverse.length,
      deepAnalyzed: shortlist.length,
      overview,
      results: enrichedResults,
    };

    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  buildSignalRow(row, side = "bullish") {
    const radarVerdict = this.radarVerdict(row, side);
    const radarScore = side === "bullish" ? this.bullishRadarScore(row) : this.bearishRadarScore(row);
    const direction = side === "bullish" ? "bullish" : "bearish";
    const radarReason = radarVerdict !== "IGNORE" && row.verdict === "HOLD"
      ? `${row.symbol} is surfacing as a ${radarVerdict.replaceAll("_", " ")} radar candidate because price structure and tradeability are strong enough, even though the stricter single-stock engine is still waiting for fuller confirmation.`
      : row.recommendation?.summary || row.thesis || `${row.symbol} is under review.`;

    return {
      symbol: row.symbol,
      name: row.companyName,
      score: radarScore,
      baseScore: Number(row.adjustedScore || row.score || 0),
      radarScore,
      radarVerdict,
      direction,
      price: row.quote?.price || 0,
      changePercent: row.quote?.changePct || 0,
      reason: radarReason,
      sector: row.sector,
      confidence: row.confidence,
      evidenceGrade: row.verification?.evidenceGrade || "D",
      verifiedCount: row.verification?.verifiedHeadlineCount || 0,
      realTimeCount: row.verification?.realTimeHeadlineCount || 0,
      officialCount: row.verification?.officialHeadlineCount || 0,
      marketSource: row.verification?.marketSource || row.quote?.source || "",
      riskScore: row.scoreBreakdown?.risk || 0,
      quickScore: this.resolveQuickScore(row),
      tradeabilityScore: this.resolveTradeabilityScore(row),
      riskReward: row.tradeDecision?.riskReward ?? null,
      executionReadiness: row.tradeDecision?.status || "WAIT - CONDITIONS NOT MET",
      strictVerdict: row.verdict,
      targetPct: row.targets?.targetPct ?? null,
      supportLevel: row.targets?.stopLoss ?? null,
      resistanceLevel: row.targets?.targetPrice ?? null,
      lastUpdated: row.quote?.asOf || row.marketContext?.generatedAt || new Date().toISOString(),
    };
  }

  async getMarketOverview() {
    try {
      const scan = await this.runScan("swing");
      return {
        ...scan.overview,
        deepAnalyzed: scan.deepAnalyzed,
        scanStrategy: scan.strategy,
      };
    } catch (error) {
      return {
        totalStocks: 0,
        totalAnalyzed: 0,
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        averageScore: 0,
        marketSentiment: "unavailable",
        lastUpdated: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  async getOpportunitySnapshot(timeframe = "swing", limit = 3) {
    const strategy = this.mapTimeframeToStrategy(timeframe);
    const scan = await this.runScan(strategy);
    const bullish = await this.getTopBullishStocks(timeframe, limit);
    const bearish = await this.getTopBearishStocks(timeframe, limit);
    const sectorRotation = Array.isArray(scan.overview?.sectorRotation) ? scan.overview.sectorRotation : [];
    const unusualActivity = Array.isArray(scan.overview?.unusualActivity) ? scan.overview.unusualActivity : [];

    return {
      timeframe,
      generatedAt: scan.generatedAt || new Date().toISOString(),
      totalStocks: scan.universeCount,
      deepAnalyzed: scan.deepAnalyzed,
      strongest: bullish.stocks || [],
      weakest: bearish.stocks || [],
      unusualActivity,
      sectorRotation: {
        leaders: sectorRotation.slice(0, 3),
        laggards: [...sectorRotation].reverse().slice(0, 3),
      },
    };
  }

  async getTopBullishStocks(timeframe = "swing", limit = 10) {
    const strategy = this.mapTimeframeToStrategy(timeframe);

    try {
      const scan = await this.runScan(strategy);
      const rows = (scan.results || [])
        .map((row) => ({
          row,
          radarVerdict: this.radarVerdict(row, "bullish"),
          radarScore: this.bullishRadarScore(row),
        }))
        .filter((item) => item.radarVerdict === "BUY" || item.radarVerdict === "STRONG_BUY")
        .sort((left, right) =>
          right.radarScore - left.radarScore
          || (right.row.adjustedScore || right.row.score || 0) - (left.row.adjustedScore || left.row.score || 0)
          || right.row.confidence - left.row.confidence)
        .slice(0, limit)
        .map((item) => this.buildSignalRow(item.row, "bullish"));

      return {
        stocks: rows,
        timeframe,
        totalAnalyzed: scan.universeCount,
        deepAnalyzed: scan.deepAnalyzed,
        bullishFound: rows.length,
        averageScore: rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.score, 0) / rows.length) : 0,
        lastUpdated: scan.generatedAt || new Date().toISOString(),
      };
    } catch (error) {
      return {
        stocks: [],
        timeframe,
        totalAnalyzed: 0,
        bullishFound: 0,
        averageScore: 0,
        lastUpdated: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  async getTopBearishStocks(timeframe = "swing", limit = 10) {
    const strategy = this.mapTimeframeToStrategy(timeframe);

    try {
      const scan = await this.runScan(strategy);
      const rows = (scan.results || [])
        .map((row) => ({
          row,
          radarVerdict: this.radarVerdict(row, "bearish"),
          radarScore: this.bearishRadarScore(row),
        }))
        .filter((item) => item.radarVerdict === "SELL" || item.radarVerdict === "STRONG_SELL")
        .sort((left, right) =>
          right.radarScore - left.radarScore
          || (left.row.adjustedScore || left.row.score || 0) - (right.row.adjustedScore || right.row.score || 0)
          || (right.row.scoreBreakdown?.risk || 0) - (left.row.scoreBreakdown?.risk || 0))
        .slice(0, limit)
        .map((item) => this.buildSignalRow(item.row, "bearish"));

      return {
        stocks: rows,
        timeframe,
        totalAnalyzed: scan.universeCount,
        deepAnalyzed: scan.deepAnalyzed,
        bearishFound: rows.length,
        averageScore: rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.score, 0) / rows.length) : 0,
        lastUpdated: scan.generatedAt || new Date().toISOString(),
      };
    } catch (error) {
      return {
        stocks: [],
        timeframe,
        totalAnalyzed: 0,
        bearishFound: 0,
        averageScore: 0,
        lastUpdated: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const topSignalsService = new TopSignalsService();
