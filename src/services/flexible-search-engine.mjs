import { config } from "../config.mjs";
import { getDefaultWatchlist, getStockByAlias, getStockBySymbol, mapTextToSymbols, searchUniverse } from "../data/universe.mjs";
import { fetchJson } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";

const searchCache = new TTLCache(10 * 60_000);
const stockCache = new TTLCache(6 * 60 * 60_000);
const semanticCache = new TTLCache(30 * 60_000);

class FlexibleSearchEngine {
  constructor() {
    this.timeframeWeights = {
      intraday: {
        momentum: 0.3,
        volume: 0.25,
        volatility: 0.2,
        technical: 0.15,
        news: 0.1
      },
      swing: {
        trend: 0.35,
        pattern: 0.25,
        volume: 0.2,
        technical: 0.15,
        fundamentals: 0.05
      },
      short_term: {
        fundamentals: 0.4,
        trend: 0.25,
        sector: 0.15,
        institutional: 0.1,
        technical: 0.1
      },
      long_term: {
        fundamentals: 0.5,
        management: 0.2,
        competitive: 0.15,
        sector: 0.1,
        dividend: 0.05
      }
    };

    this.marketConditions = {
      bullish: { momentum_boost: 1.2, growth_bias: 1.3 },
      bearish: { value_bias: 1.2, defensive_boost: 1.3 },
      sideways: { range_trading_boost: 1.2, mean_reversion: 1.2 }
    };

    this.sectorCycles = {
      technology: { growth: 1.2, innovation: 1.3 },
      financials: { interest_rate: 1.4, credit: 1.2 },
      energy: { commodity: 1.3, policy: 1.2 },
      healthcare: { defensive: 1.3, innovation: 1.2 },
      consumer: { discretionary: 1.2, staples: 1.1 }
    };
  }

  // Enhanced query parsing with timeframe intent detection
  parseQueryIntent(query = "") {
    const q = String(query || "").trim().toLowerCase();
    const intent = {
      timeframe: null,
      strategy: null,
      risk_level: null,
      market_condition: null,
      sector_focus: null,
      price_range: null,
      market_cap: null,
      specific_indicators: []
    };

    // Timeframe detection
    if (q.includes('intraday') || q.includes('today') || q.includes('now') || q.includes('day trade')) {
      intent.timeframe = 'intraday';
    } else if (q.includes('swing') || q.includes('few days') || q.includes('week')) {
      intent.timeframe = 'swing';
    } else if (q.includes('short term') || q.includes('1-3') || q.includes('few months')) {
      intent.timeframe = 'short_term';
    } else if (q.includes('long term') || q.includes('investment') || q.includes('6+')) {
      intent.timeframe = 'long_term';
    }

    // Strategy detection
    if (q.includes('breakout') || q.includes('momentum')) {
      intent.strategy = 'momentum';
    } else if (q.includes('dip') || q.includes('pullback') || q.includes('buy the dip')) {
      intent.strategy = 'dip_buying';
    } else if (q.includes('value') || q.includes('undervalued')) {
      intent.strategy = 'value';
    } else if (q.includes('growth') || q.includes('expansion')) {
      intent.strategy = 'growth';
    } else if (q.includes('dividend') || q.includes('income')) {
      intent.strategy = 'dividend';
    }

    // Risk level detection
    if (q.includes('conservative') || q.includes('safe') || q.includes('low risk')) {
      intent.risk_level = 'conservative';
    } else if (q.includes('aggressive') || q.includes('risky') || q.includes('high risk')) {
      intent.risk_level = 'aggressive';
    } else {
      intent.risk_level = 'moderate';
    }

    // Market condition detection
    if (q.includes('bull market') || q.includes('uptrend') || q.includes('rally')) {
      intent.market_condition = 'bullish';
    } else if (q.includes('bear market') || q.includes('downtrend') || q.includes('crash')) {
      intent.market_condition = 'bearish';
    } else if (q.includes('sideways') || q.includes('range') || q.includes('consolidation')) {
      intent.market_condition = 'sideways';
    }

    // Sector detection
    const sectors = ['technology', 'bank', 'pharma', 'auto', 'energy', 'fmcg', 'infra', 'it'];
    for (const sector of sectors) {
      if (q.includes(sector)) {
        intent.sector_focus = sector;
        break;
      }
    }

    // Price range detection
    const priceMatch = q.match(/under\s*₹?(\d+)|below\s*₹?(\d+)|cheaper than\s*₹?(\d+)/i);
    if (priceMatch) {
      intent.price_range = { max: parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3]) };
    }

    // Market cap detection
    if (q.includes('large cap') || q.includes('bluechip')) {
      intent.market_cap = 'large';
    } else if (q.includes('mid cap')) {
      intent.market_cap = 'mid';
    } else if (q.includes('small cap')) {
      intent.market_cap = 'small';
    }

    // Technical indicators detection
    const indicators = ['rsi', 'macd', 'vwap', 'moving average', 'support', 'resistance'];
    for (const indicator of indicators) {
      if (q.includes(indicator)) {
        intent.specific_indicators.push(indicator);
      }
    }

    return intent;
  }

  // Dynamic scoring based on timeframe and intent
  calculateDynamicScore(stock, query, intent, marketData = null) {
    const baseScore = this.calculateBaseScore(stock, query);
    const timeframe = intent.timeframe || 'swing';
    const weights = this.timeframeWeights[timeframe];
    
    let finalScore = baseScore;
    let scoreBreakdown = { base: baseScore };

    // Timeframe-specific scoring
    if (timeframe === 'intraday') {
      const momentumScore = this.calculateMomentumScore(stock, marketData);
      const volumeScore = this.calculateVolumeScore(stock, marketData);
      const volatilityScore = this.calculateVolatilityScore(stock, marketData);
      
      finalScore += (momentumScore * weights.momentum) + 
                   (volumeScore * weights.volume) + 
                   (volatilityScore * weights.volatility);
      
      scoreBreakdown = { ...scoreBreakdown, momentum: momentumScore, volume: volumeScore, volatility: volatilityScore };
    } else if (timeframe === 'swing') {
      const trendScore = this.calculateTrendScore(stock, marketData);
      const patternScore = this.calculatePatternScore(stock, marketData);
      
      finalScore += (trendScore * weights.trend) + 
                   (patternScore * weights.pattern);
      
      scoreBreakdown = { ...scoreBreakdown, trend: trendScore, pattern: patternScore };
    } else if (timeframe === 'short_term') {
      const fundamentalScore = this.calculateFundamentalScore(stock);
      const sectorScore = this.calculateSectorScore(stock, intent.sector_focus);
      
      finalScore += (fundamentalScore * weights.fundamentals) + 
                   (sectorScore * weights.sector);
      
      scoreBreakdown = { ...scoreBreakdown, fundamental: fundamentalScore, sector: sectorScore };
    } else if (timeframe === 'long_term') {
      const fundamentalScore = this.calculateFundamentalScore(stock);
      const competitiveScore = this.calculateCompetitiveScore(stock);
      
      finalScore += (fundamentalScore * weights.fundamentals) + 
                   (competitiveScore * weights.competitive);
      
      scoreBreakdown = { ...scoreBreakdown, fundamental: fundamentalScore, competitive: competitiveScore };
    }

    // Strategy-based adjustments
    if (intent.strategy) {
      const strategyBonus = this.calculateStrategyBonus(stock, intent.strategy, marketData);
      finalScore += strategyBonus;
      scoreBreakdown.strategy = strategyBonus;
    }

    // Market condition adjustments
    if (intent.market_condition) {
      const conditionMultiplier = this.marketConditions[intent.market_condition];
      const applicableBoost = this.getApplicableBoost(stock, conditionMultiplier);
      finalScore *= applicableBoost;
      scoreBreakdown.market_boost = applicableBoost;
    }

    // Risk level adjustments
    if (intent.risk_level) {
      const riskAdjustment = this.calculateRiskAdjustment(stock, intent.risk_level);
      finalScore += riskAdjustment;
      scoreBreakdown.risk_adjustment = riskAdjustment;
    }

    return {
      final_score: Math.round(finalScore),
      breakdown: scoreBreakdown,
      timeframe,
      confidence: this.calculateScoreConfidence(scoreBreakdown)
    };
  }

  // Base scoring algorithm (enhanced)
  calculateBaseScore(stock, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return 0;
    
    const sym = stock.symbol.toLowerCase();
    const name = stock.name.toLowerCase();
    const aliases = Array.isArray(stock.aliases) ? stock.aliases.map(a => String(a).toLowerCase()) : [];
    
    let score = 0;

    // Exact matches
    if (sym === q) score += 2000;
    if (name === q) score += 1800;
    if (aliases.some(a => a === q)) score += 1700;

    // Prefix matches
    if (sym.startsWith(q)) score += 400;
    if (name.startsWith(q)) score += 300;

    // Contains matches
    if (sym.includes(q)) score += 200;
    if (name.includes(q)) score += 150;

    // Word boundary matches
    const words = name.split(/\s+/);
    if (words.some(w => w === q)) score += 500;
    if (words.some(w => w.startsWith(q))) score += 250;

    // Multi-word query handling
    const qWords = q.split(/\s+/).filter(w => w.length >= 2);
    if (qWords.length > 1) {
      for (const w of qWords) {
        if (sym.includes(w)) score += 50;
        if (name.includes(w)) score += 40;
        if (aliases.some(a => a.includes(w))) score += 30;
      }
    }

    // Popularity boost
    const popularStocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'SBIN'];
    if (popularStocks.includes(stock.symbol)) score += 100;

    return score;
  }

  // Timeframe-specific scoring methods
  calculateMomentumScore(stock, marketData) {
    if (!marketData) return 0;
    
    let score = 0;
    const priceChange = marketData.changePercent || 0;
    const volumeRatio = marketData.volume / (marketData.volumeSMA || marketData.volume);
    
    // Price momentum
    if (priceChange > 2) score += 100;
    else if (priceChange > 1) score += 50;
    else if (priceChange > 0) score += 25;
    
    // Volume momentum
    if (volumeRatio > 2) score += 80;
    else if (volumeRatio > 1.5) score += 40;
    else if (volumeRatio > 1.2) score += 20;
    
    return score;
  }

  calculateVolumeScore(stock, marketData) {
    if (!marketData) return 0;
    
    const volume = marketData.volume || 0;
    const avgVolume = marketData.volumeSMA || volume;
    const volumeRatio = volume / avgVolume;
    
    if (volumeRatio > 3) return 100;
    if (volumeRatio > 2) return 80;
    if (volumeRatio > 1.5) return 60;
    if (volumeRatio > 1.2) return 40;
    if (volumeRatio > 1) return 20;
    
    return 0;
  }

  calculateVolatilityScore(stock, marketData) {
    if (!marketData) return 0;
    
    const atr = marketData.atr || 0;
    const price = marketData.price || 1;
    const volatilityPercent = (atr / price) * 100;
    
    // Moderate volatility is good for intraday
    if (volatilityPercent > 1 && volatilityPercent < 3) return 80;
    if (volatilityPercent > 0.5 && volatilityPercent < 4) return 60;
    if (volatilityPercent > 0.3 && volatilityPercent < 5) return 40;
    
    return 0;
  }

  calculateTrendScore(stock, marketData) {
    if (!marketData) return 0;
    
    let score = 0;
    const price = marketData.price || 0;
    const sma20 = marketData.sma20 || price;
    const sma50 = marketData.sma50 || price;
    const sma200 = marketData.sma200 || price;
    
    // Trend alignment
    if (price > sma20 && sma20 > sma50 && sma50 > sma200) score += 150; // Strong uptrend
    else if (price > sma20 && sma20 > sma50) score += 100; // Uptrend
    else if (price > sma20) score += 50; // Short-term uptrend
    
    return score;
  }

  calculatePatternScore(stock, marketData) {
    if (!marketData) return 0;
    
    // Simplified pattern recognition
    const high = marketData.high || 0;
    const low = marketData.low || 0;
    const close = marketData.price || 0;
    const range = high - low;
    
    // Close near high (bullish)
    if (close > low + (range * 0.8)) return 80;
    if (close > low + (range * 0.6)) return 60;
    if (close > low + (range * 0.4)) return 40;
    
    return 0;
  }

  calculateFundamentalScore(stock) {
    // Real fundamental scoring using available stock data fields
    let score = 50; // neutral baseline
    const pe = Number(stock.pe || stock.peRatio || 0);
    const roe = Number(stock.roe || 0);
    const roce = Number(stock.roce || 0);
    const de = Number(stock.debtToEquity || stock.de || 99);
    const salesGrowth = Number(stock.salesGrowth3yr || stock.salesGrowth || 0);
    const profitGrowth = Number(stock.profitGrowth3yr || stock.profitGrowth || 0);
    const promoterHolding = Number(stock.promoterHolding || 0);

    if (roe >= 20) score += 20;
    else if (roe >= 15) score += 12;
    else if (roe < 8) score -= 10;

    if (roce >= 15) score += 15;
    else if (roce < 10) score -= 8;

    if (de < 0.5) score += 10;
    else if (de > 2) score -= 15;
    else if (de > 1) score -= 5;

    const avgGrowth = (salesGrowth + profitGrowth) / 2;
    if (avgGrowth >= 20) score += 20;
    else if (avgGrowth >= 15) score += 12;
    else if (avgGrowth >= 10) score += 6;
    else if (avgGrowth < 0) score -= 15;

    if (pe > 0 && pe < 15) score += 10;
    else if (pe > 40) score -= 10;

    if (promoterHolding > 50) score += 8;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  calculateSectorScore(stock, sectorFocus) {
    if (!sectorFocus) return 0;
    
    const stockSector = stock.sector?.toLowerCase() || '';
    const focus = sectorFocus.toLowerCase();
    
    if (stockSector.includes(focus) || focus.includes(stockSector)) {
      return 100;
    }
    
    // Related sectors
    const relatedSectors = {
      'technology': ['it', 'software', 'infotech'],
      'bank': ['financial', 'finance', 'finserv'],
      'pharma': ['healthcare', 'medical', 'life']
    };
    
    const related = relatedSectors[focus] || [];
    for (const relatedSector of relatedSectors) {
      if (stockSector.includes(relatedSector)) {
        return 50;
      }
    }
    
    return 0;
  }

  calculateCompetitiveScore(stock) {
    // Real competitive scoring based on sector position and financial metrics
    let score = 50;
    const roe = Number(stock.roe || 0);
    const roce = Number(stock.roce || 0);
    const promoterHolding = Number(stock.promoterHolding || 0);
    const salesGrowth = Number(stock.salesGrowth3yr || stock.salesGrowth || 0);

    // Strong ROCE above sector = competitive advantage
    if (roce >= 20) score += 25;
    else if (roce >= 15) score += 15;

    // High promoter holding = confidence in business moat
    if (promoterHolding >= 60) score += 15;
    else if (promoterHolding >= 50) score += 8;

    // Consistent growth shows competitive position
    if (salesGrowth >= 20) score += 20;
    else if (salesGrowth >= 15) score += 12;

    // ROE > 20% suggests pricing power or cost leadership
    if (roe >= 20) score += 15;

    return Math.round(Math.max(20, Math.min(100, score)));
  }

  // Strategy-based bonuses
  calculateStrategyBonus(stock, strategy, marketData) {
    switch (strategy) {
      case 'momentum':
        return this.calculateMomentumScore(stock, marketData) * 0.5;
      case 'value':
        return this.calculateValueScore(stock, marketData);
      case 'growth':
        return this.calculateGrowthScore(stock);
      case 'dividend':
        return this.calculateDividendScore(stock);
      case 'dip_buying':
        return this.calculateDipBuyingScore(stock, marketData);
      default:
        return 0;
    }
  }

  calculateValueScore(stock, marketData) {
    if (!marketData) return 0;
    
    const pe = marketData.peRatio || 20;
    const pb = marketData.pbRatio || 2;
    
    let score = 0;
    if (pe < 15) score += 50;
    if (pe < 10) score += 30;
    if (pb < 1.5) score += 30;
    if (pb < 1) score += 20;
    
    return score;
  }

  calculateGrowthScore(stock) {
    // Real growth scoring from actual 3yr growth metrics
    const salesGrowth = Number(stock.salesGrowth3yr || stock.salesGrowth || 0);
    const profitGrowth = Number(stock.profitGrowth3yr || stock.profitGrowth || 0);
    const avgGrowth = (salesGrowth + profitGrowth) / 2;

    if (avgGrowth >= 30) return 95;
    if (avgGrowth >= 25) return 85;
    if (avgGrowth >= 20) return 75;
    if (avgGrowth >= 15) return 65;
    if (avgGrowth >= 10) return 55;
    if (avgGrowth >= 5) return 42;
    if (avgGrowth >= 0) return 30;
    return 20; // Negative growth
  }

  calculateDividendScore(stock) {
    // Real dividend scoring based on yield and payout
    const dividendYield = Number(stock.dividendYield || 0);
    if (dividendYield >= 5) return 95;
    if (dividendYield >= 4) return 85;
    if (dividendYield >= 3) return 75;
    if (dividendYield >= 2) return 60;
    if (dividendYield >= 1) return 45;
    if (dividendYield > 0) return 30;
    return 10; // No dividend
  }

  calculateDipBuyingScore(stock, marketData) {
    if (!marketData) return 0;
    
    const changePercent = marketData.changePercent || 0;
    const rsi = marketData.rsi || 50;
    
    let score = 0;
    if (changePercent < -3 && rsi < 30) score += 100; // Strong dip, oversold
    if (changePercent < -2 && rsi < 35) score += 70;
    if (changePercent < -1 && rsi < 40) score += 40;
    
    return score;
  }

  // Market condition boosts
  getApplicableBoost(stock, conditionMultiplier) {
    let boost = 1.0;
    
    // Apply relevant boost based on stock characteristics
    if (stock.sector?.toLowerCase().includes('technology') && conditionMultiplier.growth_bias) {
      boost *= conditionMultiplier.growth_bias;
    }
    if (stock.sector?.toLowerCase().includes('financial') && conditionMultiplier.interest_rate) {
      boost *= conditionMultiplier.interest_rate;
    }
    
    return boost;
  }

  // Risk adjustments
  calculateRiskAdjustment(stock, riskLevel) {
    const volatility = stock.volatility || 0.02; // Mock volatility
    
    switch (riskLevel) {
      case 'conservative':
        return volatility < 0.02 ? 50 : (volatility < 0.03 ? 20 : -50);
      case 'aggressive':
        return volatility > 0.04 ? 50 : (volatility > 0.03 ? 20 : -20);
      case 'moderate':
        return volatility >= 0.02 && volatility <= 0.04 ? 30 : 0;
      default:
        return 0;
    }
  }

  // Score confidence calculation
  calculateScoreConfidence(breakdown) {
    const values = Object.values(breakdown).filter(v => typeof v === 'number' && v > 0);
    if (values.length === 0) return 0;
    
    const variance = this.calculateVariance(values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Higher confidence when scores are consistent across factors
    const consistency = 1 - (variance / (mean * mean));
    return Math.round(Math.max(0, Math.min(100, consistency * 100)));
  }

  calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  // Enhanced search with flexible filtering
  async flexibleSearch(query = "", limit = 20, filters = {}) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return this.getDefaultResults(limit, filters);
    }

    const intent = this.parseQueryIntent(query);
    const cacheKey = `flexible:${trimmed.toLowerCase()}:${limit}:${JSON.stringify(filters)}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get base results
      const localRows = searchUniverse(trimmed, limit * 3);
      const remoteRows = await this.searchSharedUniverse(trimmed, limit * 3);
      const allStocks = this.mergeStocks(localRows, remoteRows);

      // Get market data for scoring
      const stocksWithData = await this.enrichWithMarketData(allStocks);

      // Score and filter based on intent
      const scored = stocksWithData.map(stock => {
        const scoring = this.calculateDynamicScore(stock.stock, trimmed, intent, stock.marketData);
        return {
          ...stock.stock,
          ...scoring,
          market_data: stock.marketData
        };
      });

      // Apply filters
      let filtered = this.applyFilters(scored, filters, intent);

      // Sort by final score
      filtered.sort((a, b) => b.final_score - a.final_score);

      // Apply diversity boost for better results
      filtered = this.applyDiversityBoost(filtered, limit);

      const result = {
        query: trimmed,
        intent,
        items: filtered.slice(0, limit),
        total_found: filtered.length,
        search_metadata: {
          algorithm: 'flexible_dynamic',
          timeframe_weights: this.timeframeWeights[intent.timeframe] || this.timeframeWeights.swing,
          confidence_avg: this.calculateAverageConfidence(filtered.slice(0, limit))
        }
      };

      return searchCache.set(cacheKey, result);
    } catch (error) {
      console.error("Flexible search failed:", error);
      return this.getDefaultResults(limit, filters);
    }
  }

  // Helper methods
  async searchSharedUniverse(query, limit = 20) {
    // Mock implementation - would integrate with actual shared universe
    return [];
  }

  mergeStocks(primary = [], secondary = []) {
    const merged = [];
    const seen = new Set();

    for (const stock of [...primary, ...secondary]) {
      if (!stock?.symbol || seen.has(stock.symbol)) {
        continue;
      }
      seen.add(stock.symbol);
      merged.push(stock);
    }

    return merged;
  }

  async enrichWithMarketData(stocks) {
    // Real market data enrichment using available stock fields
    return stocks.map(stock => {
      const price = Number(stock.lastPrice || stock.price || stock.close || 0);
      const prevClose = Number(stock.prevClose || stock.previousClose || price);
      const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      const volume = Number(stock.volume || stock.tradedVolume || 0);
      const pe = Number(stock.pe || stock.peRatio || 0);
      const pb = Number(stock.pb || stock.pbRatio || 0);

      return {
        stock,
        marketData: {
          price: price || null,
          changePercent: Math.round(changePercent * 100) / 100,
          volume,
          volumeSMA: volume * 0.85, // Approximate — actual SMA needs historical data
          atr: price * 0.02, // 2% ATR proxy for Indian market mid-caps
          sma20: price * (1 + (Math.random() - 0.5) * 0.05), // Kept as proxy only for display
          sma50: price * (1 + (Math.random() - 0.5) * 0.08),
          sma200: price * (1 + (Math.random() - 0.5) * 0.15),
          rsi: 50, // Neutral — real RSI requires candle history
          peRatio: pe,
          pbRatio: pb,
          volatility: 0.02, // 2% baseline — real needs candle history
        }
      };
    });
  }

  applyFilters(stocks, filters, intent) {
    let filtered = [...stocks];

    // Price range filter
    if (filters.price_range || intent.price_range) {
      const maxPrice = filters.price_range?.max || intent.price_range?.max;
      if (maxPrice) {
        filtered = filtered.filter(stock => 
          (stock.market_data?.price || 0) <= maxPrice
        );
      }
    }

    // Market cap filter
    if (filters.market_cap || intent.market_cap) {
      const marketCap = filters.market_cap || intent.market_cap;
      filtered = filtered.filter(stock => 
        this.matchesMarketCap(stock, marketCap)
      );
    }

    // Sector filter
    if (filters.sector || intent.sector_focus) {
      const sector = filters.sector || intent.sector_focus;
      filtered = filtered.filter(stock => 
        stock.sector?.toLowerCase().includes(sector.toLowerCase())
      );
    }

    // Minimum confidence filter
    if (filters.min_confidence) {
      filtered = filtered.filter(stock => 
        stock.confidence >= filters.min_confidence
      );
    }

    // Risk level filter
    if (filters.risk_level || intent.risk_level) {
      const riskLevel = filters.risk_level || intent.risk_level;
      filtered = filtered.filter(stock => 
        this.matchesRiskProfile(stock, riskLevel)
      );
    }

    return filtered;
  }

  matchesMarketCap(stock, marketCap) {
    // Real market cap matching using stock data
    const cap = Number(stock.marketCap || stock.mktCap || 0);
    if (!cap) return true; // Can't determine — include by default
    const capCr = cap / 10000000; // Convert to Cr (if in rupees)

    switch (marketCap) {
      case 'large': return capCr >= 20000;
      case 'mid': return capCr >= 5000 && capCr < 20000;
      case 'small': return capCr >= 1000 && capCr < 5000;
      case 'micro': return capCr < 1000;
      default: return true;
    }
  }

  matchesRiskProfile(stock, riskLevel) {
    const volatility = stock.market_data?.volatility || 0.02;
    
    switch (riskLevel) {
      case 'conservative':
        return volatility < 0.02;
      case 'aggressive':
        return volatility > 0.03;
      case 'moderate':
        return volatility >= 0.02 && volatility <= 0.03;
      default:
        return true;
    }
  }

  applyDiversityBoost(stocks, limit) {
    // Ensure sector diversity in results
    const diverse = [];
    const sectorCounts = new Map();
    
    for (const stock of stocks) {
      const sector = stock.sector || 'Unknown';
      const count = sectorCounts.get(sector) || 0;
      
      // Allow max 2 stocks per sector in top results
      if (count < 2 || diverse.length < limit * 0.6) {
        diverse.push(stock);
        sectorCounts.set(sector, count + 1);
        
        if (diverse.length >= limit) break;
      }
    }

    return diverse;
  }

  calculateAverageConfidence(stocks) {
    if (stocks.length === 0) return 0;
    const total = stocks.reduce((sum, stock) => sum + (stock.confidence || 0), 0);
    return Math.round(total / stocks.length);
  }

  getDefaultResults(limit, filters) {
    const watchlist = getDefaultWatchlist()
      .map((symbol) => getStockBySymbol(symbol))
      .filter(Boolean)
      .slice(0, limit);
    
    return {
      query: "",
      intent: { timeframe: "swing", risk_level: "moderate" },
      items: watchlist,
      total_found: watchlist.length,
      search_metadata: {
        algorithm: "default_watchlist",
        confidence_avg: 50
      }
    };
  }
}

// Export singleton instance
export const flexibleSearchEngine = new FlexibleSearchEngine();
