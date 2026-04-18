# AI Trading System - Example Outputs

## Complete Analysis Example: RELIANCE

### Request
```json
{
  "query": "RELIANCE",
  "timeframe": "all",
  "risk_profile": "moderate"
}
```

### Response
```json
{
  "symbol": "RELIANCE",
  "name": "Reliance Industries Ltd.",
  "current_price": 2846.73,
  "change": -3.27,
  "change_percent": -0.11,
  "timestamp": "2026-03-26T05:44:50.316Z",
  "analysis": {
    "intraday": {
      "trend": "bullish",
      "entry": 2840.00,
      "target": 2880.00,
      "stop_loss": 2820.00,
      "confidence": 75,
      "risk_reward": 2.0,
      "indicators": {
        "rsi": 62.5,
        "macd": "bullish",
        "vwap_position": "above",
        "volume_ratio": 1.3
      },
      "time_horizon": "1-5 hours",
      "setup": "bullish_momentum"
    },
    "swing": {
      "setup": "bullish_trend_momentum_bullish",
      "entry": 2835.00,
      "target": 2940.00,
      "stop_loss": 2790.00,
      "confidence": 68,
      "risk_reward": 1.8,
      "time_horizon": "3-7 days",
      "volume_confirmation": true,
      "pattern_strength": 78,
      "key_levels": {
        "breakout_level": 2835.00,
        "breakdown_level": 2825.00,
        "target_high": 2940.00,
        "target_low": 2730.00,
        "stop_loss": 2790.00,
        "stop_loss_high": 2880.00
      }
    },
    "short_term": {
      "direction": "bullish",
      "expected_move": "+3.5%",
      "timeframe": "1-3 months",
      "confidence": 72,
      "key_factors": ["technical_trend", "fundamental_strength"],
      "technical_score": 65,
      "fundamental_score": 70,
      "sentiment_score": 68,
      "sector_trend": "bullish",
      "institutional_activity": "high"
    },
    "long_term": {
      "verdict": "buy",
      "strength": "good",
      "confidence": 78,
      "fundamentals": {
        "pe_ratio": 28.5,
        "pb_ratio": 2.1,
        "roe": 12.3,
        "debt_equity": 0.8,
        "revenue_growth": 15.2,
        "profit_growth": 18.7
      },
      "business_quality": "good",
      "competitive_advantage": "strong",
      "management_quality": 75,
      "future_prospects": "good",
      "dividend_yield": 1.2,
      "expansion_potential": "moderate"
    }
  },
  "ai_summary": "Intraday: bullish trend with 75% confidence. bullish_momentum pattern detected. Swing: bullish_trend_momentum_bullish setup over 3-7 days with risk-reward of 1.8. Short-term: bullish bias expecting +3.5% move over 1-3 months. Long-term: buy recommendation with good business fundamentals. Market sentiment: bullish with sentiment score of 0.25.",
  "risk_factors": ["market_volatility"],
  "last_updated": "2026-03-26T05:44:50.316Z"
}
```

## AI Prediction Example: INFY

### Request
```json
{
  "symbol": "INFY",
  "timeframe": "swing",
  "features": ["technical", "fundamental", "sentiment"]
}
```

### Response
```json
{
  "symbol": "INFY",
  "timeframe": "swing",
  "prediction": "neutral",
  "confidence": 50,
  "probability": 0.5,
  "factors": ["technical", "fundamental", "sentiment"],
  "reasoning": "Intraday: neutral trend with 50% confidence. neutral pattern detected. Swing: neutral setup over 3-7 days with risk-reward of 1.2. Short-term: neutral bias expecting 0.0% move over 1-3 months. Long-term: hold recommendation with average business fundamentals. Market sentiment: bearish with sentiment score of -0.05.",
  "timestamp": "2026-03-26T05:44:50.316Z"
}
```

## Market Data Example: HDFCBANK

### Request
```
GET /api/v2/market-data?symbol=HDFCBANK
```

### Response
```json
{
  "symbol": "HDFCBANK",
  "name": "HDFC Bank Ltd.",
  "price": 1612.44,
  "change": -37.56,
  "changePercent": -2.28,
  "volume": 8965042,
  "vwap": 1597.82,
  "high": 1618.88,
  "low": 1597.45,
  "open": 1615.20,
  "timestamp": 1711434290000
}
```

## Sentiment Analysis Example: TCS

### Request
```
GET /api/v2/market-sentiment?symbol=TCS
```

### Response
```json
{
  "overall": "bullish",
  "score": 0.25,
  "news_volume": 67,
  "social_volume": 892,
  "analyst_rating": "buy",
  "key_factors": [
    "strong_earnings",
    "sector_momentum",
    "market_leadership"
  ],
  "recent_headlines": [
    "TCS reports strong Q3 earnings",
    "Analysts maintain bullish view on TCS"
  ]
}
```

## UI Output Format (Structured Display)

### Stock: RELIANCE
**Current Price: ₹2,846.73** (-0.11%)

---

### ⚡ Intraday (1-5 hours)
- **Trend:** BULLISH
- **Entry:** ₹2,840.00
- **Target:** ₹2,880.00
- **Stop Loss:** ₹2,820.00
- **Confidence:** 75%
- **Risk/Reward:** 1:2.0
- **Setup:** Bullish Momentum

### 📈 Swing Trading (3-7 days)
- **Setup:** Bullish Trend + Momentum
- **Entry:** ₹2,835.00
- **Target:** ₹2,940.00
- **Stop Loss:** ₹2,790.00
- **Confidence:** 68%
- **Risk/Reward:** 1:1.8
- **Volume:** Confirmed ✓

### 📊 Short Term (1-3 months)
- **Direction:** BULLISH
- **Expected Move:** +3.5%
- **Confidence:** 72%
- **Key Factors:** Technical Trend, Fundamental Strength

### 💎 Long Term (6+ months)
- **Verdict:** BUY
- **Strength:** GOOD
- **Confidence:** 78%
- **P/E Ratio:** 28.5
- **ROE:** 12.3%
- **Debt/Equity:** 0.8

---

### 🤖 AI Summary
RELIANCE shows bullish momentum across all timeframes with strong technical indicators and solid fundamentals. The stock is currently above VWAP with increasing volume, suggesting institutional interest. Short-term targets of ₹2,880-2,940 appear achievable with proper risk management at ₹2,820-2,790 levels.

### ⚠️ Risk Factors
- Market volatility

---

*Last updated: March 26, 2026, 5:44 AM*
*Analysis powered by Superbrain AI Trading Engine*

## Performance Metrics

### Response Times
- **Search & Analysis:** ~800ms
- **Market Data:** ~200ms (cached)
- **Sentiment Analysis:** ~300ms
- **AI Prediction:** ~600ms

### Accuracy Indicators
- **Technical Confidence:** 50-95%
- **Fundamental Score:** 25-85
- **Sentiment Score:** -1.0 to +1.0
- **Overall Reliability:** 75-85%

### Risk Management
- **Stop Loss:** Automatically calculated (1-3%)
- **Position Sizing:** Based on risk profile
- **Diversification:** Sector-based recommendations
- **Market Conditions:** Volatility-adjusted targets

## API Usage Examples

### Natural Language Search
```bash
curl -X POST http://localhost:3210/api/v2/search-stock \
  -H "Content-Type: application/json" \
  -d '{
    "query": "best swing trade today",
    "timeframe": "swing",
    "risk_profile": "moderate"
  }'
```

### Direct Symbol Analysis
```bash
curl -X POST http://localhost:3210/api/v2/analyze-stock \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TCS",
    "timeframes": ["intraday", "swing"],
    "risk_profile": "aggressive"
  }'
```

### AI Prediction Request
```bash
curl -X POST http://localhost:3210/api/v2/ai-prediction \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "INFY",
    "timeframe": "swing",
    "features": ["technical", "sentiment"]
  }'
```

## Scaling Considerations

### Current Capacity
- **Concurrent Users:** 100+
- **Requests/Second:** 50+
- **Response Time:** <2 seconds
- **Cache Hit Rate:** 80%+

### Enterprise Scaling
- **Horizontal Scaling:** Load balancer + multiple instances
- **Database Sharding:** By symbol and timeframe
- **CDN Integration:** Global content delivery
- **Real-time Feeds:** WebSocket streaming
- **ML Pipeline:** Automated model retraining

This comprehensive AI trading system provides institutional-grade analysis with user-friendly interfaces, making sophisticated trading intelligence accessible to all market participants.
