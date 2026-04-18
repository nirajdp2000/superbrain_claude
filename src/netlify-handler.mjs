import { config, hasAdminToken, resolveAllowedOrigin } from "./config.mjs";
import { getDefaultWatchlist } from "./data/universe.mjs";
import { analyzeMarket, askSuperbrain, buildDashboard, getStockIntelligence } from "./services/analysis-service.mjs";
import { getMarketContext } from "./services/market-service.mjs";
import { getNewsForSymbols, getNewsIntelligence } from "./services/news-service.mjs";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchUpstoxProfile,
  getUpstoxConnectionInfo,
  getUpstoxQuickConnect,
  getUpstoxStatus,
  isUpstoxConfigured,
  storeManualToken,
} from "./services/upstox-service.mjs";
import { searchAnyUniverse } from "./services/universe-service.mjs";
import { semanticSearch, fuzzySearch, suggestCorrections } from "./services/advanced-universe-service.mjs";
import { tradingEngine } from "./services/trading-analysis-engine.mjs";
import { flexibleSearchEngine } from "./services/flexible-search-engine.mjs";
import { topSignalsService } from "./services/top-signals-service.mjs";
import {
  renderCallbackError,
  renderCallbackSuccess,
  renderConfigMissingPage,
  renderConnectedPage,
  renderConnectPage,
} from "./services/connect-page.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function redirectResponse(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      location,
    },
  });
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const origin = resolveAllowedOrigin(request.headers.get("origin") || "");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Headers", "content-type,x-superbrain-admin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function ensureAdmin(request) {
  if (!hasAdminToken()) {
    return true;
  }
  return request.headers.get("x-superbrain-admin") === config.adminToken;
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (!raw) {
    return {};
  }
  if (raw.length > 1_000_000) {
    throw new Error("Payload too large");
  }
  return JSON.parse(raw);
}

function notFoundResponse() {
  return jsonResponse({ error: "Not found" }, 404);
}

function resolveCallbackUrl(url) {
  const requestCallbackUrl = `${url.origin}/api/upstox/callback`;
  const isNetlifyPreview = url.hostname.endsWith(".netlify.app") && url.hostname.includes("--");
  if (isNetlifyPreview) {
    return requestCallbackUrl;
  }
  return config.upstox.redirectUri || requestCallbackUrl;
}

function getOriginFromUrl(value, fallback) {
  try {
    return new URL(value).origin;
  } catch {
    return fallback;
  }
}

export async function handleNetlifyRequest(request) {
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  const callbackUrl = resolveCallbackUrl(url);
  const siteOrigin = getOriginFromUrl(callbackUrl, config.publicSiteUrl || url.origin);
  const connectPageOptions = {
    deploymentMode: "netlify",
    siteOrigin,
    callbackUrl,
  };

  try {
    if (request.method === "GET" && pathname === "/api/health") {
      const upstox = await getUpstoxStatus();
      return withCors(request, jsonResponse({
        ok: true,
        service: "superbrain-india",
        market: "INDIAN_STOCKS",
        defaultWatchlist: getDefaultWatchlist(),
        upstox,
        generatedAt: new Date().toISOString(),
      }));
    }

    if (request.method === "GET" && pathname === "/api/universe") {
      const q = searchParams.get("q") || "";
      const limit = Number(searchParams.get("limit") || 20);
      return withCors(request, jsonResponse({ items: await searchAnyUniverse(q, limit) }));
    }

    if (request.method === "GET" && pathname === "/api/search/semantic") {
      const q = searchParams.get("q") || "";
      const limit = Number(searchParams.get("limit") || 20);
      return withCors(request, jsonResponse({ items: await semanticSearch(q, limit) }));
    }

    if (request.method === "GET" && pathname === "/api/search/fuzzy") {
      const q = searchParams.get("q") || "";
      const limit = Number(searchParams.get("limit") || 20);
      const tolerance = Number(searchParams.get("tolerance") || 2);
      return withCors(request, jsonResponse({ items: await fuzzySearch(q, limit, tolerance) }));
    }

    if (request.method === "GET" && pathname === "/api/search/suggestions") {
      const q = searchParams.get("q") || "";
      const limit = Number(searchParams.get("limit") || 5);
      return withCors(request, jsonResponse({ items: await suggestCorrections(q, limit) }));
    }

    if (request.method === "POST" && pathname === "/api/v2/flexible-search") {
      const body = await readJsonBody(request);
      const { query, limit = 20, filters = {}, timeframe = "swing" } = body;

      if (!query) {
        return withCors(request, jsonResponse({ error: "Query is required" }, 400));
      }

      try {
        const enhancedFilters = { ...filters, timeframe };
        const results = await flexibleSearchEngine.flexibleSearch(query, limit, enhancedFilters);
        return withCors(request, jsonResponse(results));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/v2/intent-search") {
      const q = searchParams.get("q") || "";
      const limit = Number(searchParams.get("limit") || 20);
      const timeframe = searchParams.get("timeframe") || "swing";
      const riskLevel = searchParams.get("risk_level") || "moderate";

      if (!q) {
        return withCors(request, jsonResponse({ error: "Query is required" }, 400));
      }

      try {
        const filters = { timeframe, risk_level: riskLevel };
        const results = await flexibleSearchEngine.flexibleSearch(q, limit, filters);
        return withCors(request, jsonResponse(results));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "POST" && pathname === "/api/v2/timeframe-search") {
      const body = await readJsonBody(request);
      const { query, timeframe, filters = {} } = body;

      if (!query || !timeframe) {
        return withCors(request, jsonResponse({ error: "Query and timeframe are required" }, 400));
      }

      try {
        const enhancedFilters = { ...filters, timeframe };
        const results = await flexibleSearchEngine.flexibleSearch(query, 50, enhancedFilters);
        const grouped = {
          high_confidence: results.items.filter((item) => item.confidence >= 70).slice(0, 10),
          medium_confidence: results.items.filter((item) => item.confidence >= 40 && item.confidence < 70).slice(0, 10),
          low_confidence: results.items.filter((item) => item.confidence < 40).slice(0, 5),
        };

        return withCors(request, jsonResponse({
          query,
          timeframe,
          intent: results.intent,
          results: grouped,
          metadata: results.search_metadata,
        }));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "POST" && pathname === "/api/v2/strategy-search") {
      const body = await readJsonBody(request);
      const { query, strategy, risk_level: riskLevel = "moderate", timeframe = "swing" } = body;

      if (!query || !strategy) {
        return withCors(request, jsonResponse({ error: "Query and strategy are required" }, 400));
      }

      try {
        const filters = { strategy, risk_level: riskLevel, timeframe };
        const results = await flexibleSearchEngine.flexibleSearch(query, 30, filters);
        const strategyResults = results.items
          .map((item) => ({
            ...item,
            strategy_score: item.breakdown?.strategy || 0,
          }))
          .sort((left, right) => right.strategy_score - left.strategy_score)
          .slice(0, 20);

        return withCors(request, jsonResponse({
          query,
          strategy,
          results: strategyResults,
          intent: results.intent,
          metadata: results.search_metadata,
        }));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "POST" && pathname === "/api/v2/search-stock") {
      const body = await readJsonBody(request);
      const { query, timeframe = "all", risk_profile: riskProfile = "moderate" } = body;

      if (!query) {
        return withCors(request, jsonResponse({ error: "Query is required" }, 400));
      }

      try {
        const searchResults = await searchAnyUniverse(query, 1);
        if (searchResults.length === 0) {
          return withCors(request, jsonResponse({ error: "Stock not found" }, 404));
        }

        const symbol = searchResults[0].symbol;
        const timeframes = timeframe === "all"
          ? ["intraday", "swing", "short_term", "long_term"]
          : [timeframe];

        const analysis = await tradingEngine.analyzeStock(symbol, timeframes, riskProfile);
        return withCors(request, jsonResponse(analysis));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "POST" && pathname === "/api/v2/analyze-stock") {
      const body = await readJsonBody(request);
      const { symbol, timeframes = ["intraday", "swing", "short_term", "long_term"], risk_profile: riskProfile = "moderate" } = body;

      if (!symbol) {
        return withCors(request, jsonResponse({ error: "Symbol is required" }, 400));
      }

      try {
        const analysis = await tradingEngine.analyzeStock(symbol.toUpperCase(), timeframes, riskProfile);
        return withCors(request, jsonResponse(analysis));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/v2/market-data") {
      const symbol = searchParams.get("symbol");
      if (!symbol) {
        return withCors(request, jsonResponse({ error: "Symbol is required" }, 400));
      }

      try {
        const marketData = await tradingEngine.getMarketData(symbol.toUpperCase());
        return withCors(request, jsonResponse(marketData));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "POST" && pathname === "/api/v2/ai-prediction") {
      const body = await readJsonBody(request);
      const { symbol, timeframe = "swing", features = ["technical", "fundamental", "sentiment"] } = body;

      if (!symbol) {
        return withCors(request, jsonResponse({ error: "Symbol is required" }, 400));
      }

      try {
        const analysis = await tradingEngine.analyzeStock(symbol.toUpperCase(), [timeframe], "moderate");
        const prediction = {
          symbol,
          timeframe,
          prediction: analysis[timeframe]?.trend || analysis[timeframe]?.direction || "neutral",
          confidence: analysis[timeframe]?.confidence || 50,
          probability: (analysis[timeframe]?.confidence || 50) / 100,
          factors: features,
          reasoning: analysis.ai_summary,
          timestamp: analysis.timestamp,
        };

        return withCors(request, jsonResponse(prediction));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/v2/market-sentiment") {
      const symbol = searchParams.get("symbol");
      if (!symbol) {
        return withCors(request, jsonResponse({ error: "Symbol is required" }, 400));
      }

      try {
        const sentiment = await tradingEngine.getMarketSentiment(symbol);
        return withCors(request, jsonResponse(sentiment));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/v2/market-signals") {
      try {
        const overview = await topSignalsService.getMarketOverview();
        return withCors(request, jsonResponse(overview));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/v2/top-signals") {
      const type = searchParams.get("type") || "bullish";
      const timeframe = searchParams.get("timeframe") || "swing";
      const limit = parseInt(searchParams.get("limit") || "10", 10);

      if (!["bullish", "bearish"].includes(type)) {
        return withCors(request, jsonResponse({ error: "Type must be 'bullish' or 'bearish'" }, 400));
      }

      if (!["intraday", "swing", "short_term", "long_term"].includes(timeframe)) {
        return withCors(request, jsonResponse({ error: "Invalid timeframe" }, 400));
      }

      if (limit < 1 || limit > 50) {
        return withCors(request, jsonResponse({ error: "Limit must be between 1 and 50" }, 400));
      }

      try {
        const result = type === "bullish"
          ? await topSignalsService.getTopBullishStocks(timeframe, limit)
          : await topSignalsService.getTopBearishStocks(timeframe, limit);

        return withCors(request, jsonResponse(result));
      } catch (error) {
        return withCors(request, jsonResponse({ error: error.message }, 500));
      }
    }

    if (request.method === "GET" && pathname === "/api/intelligence") {
      const intelligence = await getStockIntelligence({
        symbol: searchParams.get("symbol") || "",
        strategy: searchParams.get("strategy") || "swing",
        horizonDays: searchParams.get("horizonDays") || undefined,
        strictVerification: searchParams.get("strictVerification") !== "false",
      });
      return withCors(request, jsonResponse(intelligence));
    }

    if (request.method === "GET" && pathname === "/api/dashboard") {
      const dashboard = await buildDashboard({
        symbols: searchParams.get("symbols") || "",
        strategy: searchParams.get("strategy") || "swing",
        horizonDays: searchParams.get("horizonDays") || undefined,
        strictVerification: searchParams.get("strictVerification") || undefined,
      });
      return withCors(request, jsonResponse(dashboard));
    }

    if (request.method === "POST" && pathname === "/api/analyze") {
      const analysis = await analyzeMarket(await readJsonBody(request));
      return withCors(request, jsonResponse(analysis));
    }

    if (request.method === "POST" && pathname === "/api/ask") {
      const answer = await askSuperbrain(await readJsonBody(request));
      return withCors(request, jsonResponse(answer));
    }

    if (request.method === "GET" && pathname === "/api/news") {
      const symbol = searchParams.get("symbol");
      if (symbol) {
        const items = await getNewsForSymbols([symbol.toUpperCase()]);
        return withCors(request, jsonResponse({ symbol: symbol.toUpperCase(), items }));
      }
      return withCors(request, jsonResponse(await getNewsIntelligence()));
    }

    if (request.method === "GET" && pathname === "/api/macro") {
      const macro = await getMarketContext();
      const news = await getNewsIntelligence();
      return withCors(request, jsonResponse({
        ...macro,
        macroHeadlines: news.macro.slice(0, 8),
        geopoliticalHeadlines: news.geopolitical.slice(0, 8),
      }));
    }

    if (request.method === "GET" && pathname === "/api/upstox/status") {
      return withCors(request, jsonResponse(await getUpstoxStatus()));
    }

    if (request.method === "GET" && pathname === "/api/upstox/connection-info") {
      return withCors(request, jsonResponse(await getUpstoxConnectionInfo()));
    }

    if (request.method === "GET" && pathname === "/api/upstox/quick-connect") {
      return withCors(request, jsonResponse(await getUpstoxQuickConnect()));
    }

    if (request.method === "GET" && pathname === "/upstox/connect") {
      const status = await getUpstoxStatus();
      if (status.connected) {
        let userInfo = null;
        try {
          userInfo = await fetchUpstoxProfile();
        } catch {
          userInfo = null;
        }
        return withCors(request, htmlResponse(renderConnectedPage(userInfo, connectPageOptions)));
      }

      if (!isUpstoxConfigured(callbackUrl)) {
        return withCors(request, htmlResponse(renderConfigMissingPage(connectPageOptions)));
      }

      return withCors(request, htmlResponse(renderConnectPage(buildAuthorizationUrl("superbrain-india", callbackUrl), connectPageOptions)));
    }

    if (request.method === "POST" && pathname === "/api/upstox/token") {
      if (!ensureAdmin(request)) {
        return withCors(request, jsonResponse({ error: "Missing or invalid admin token" }, 401));
      }

      const body = await readJsonBody(request);
      if (!body.accessToken) {
        return withCors(request, jsonResponse({ error: "accessToken is required" }, 400));
      }

      const stored = await storeManualToken(body);
      return withCors(request, jsonResponse({
        ok: true,
        expiresAt: stored.expiresAt,
        tokenSource: "db",
      }));
    }

    if (request.method === "GET" && pathname === "/api/upstox/connect") {
      return withCors(request, redirectResponse(buildAuthorizationUrl("superbrain-india", callbackUrl)));
    }

    if (request.method === "GET" && pathname === "/api/upstox/callback") {
      const code = searchParams.get("code");
      if (!code) {
        return withCors(request, htmlResponse(renderCallbackError("Upstox did not return an authorization code."), 400));
      }

      try {
        await exchangeAuthorizationCode(code, callbackUrl);
        let userInfo = null;
        try {
          userInfo = await fetchUpstoxProfile();
        } catch {
          userInfo = null;
        }
        return withCors(request, htmlResponse(renderCallbackSuccess(userInfo, connectPageOptions)));
      } catch (error) {
        return withCors(request, htmlResponse(renderCallbackError(error.message), 500));
      }
    }

    return withCors(request, notFoundResponse());
  } catch (error) {
    return withCors(request, jsonResponse({
      error: error instanceof Error ? error.message : "Unknown server error",
    }, 500));
  }
}
