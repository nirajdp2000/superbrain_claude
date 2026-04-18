import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { config, hasAdminToken, resolveAllowedOrigin } from "./config.mjs";
import { getDefaultWatchlist } from "./data/universe.mjs";
import { analyzeMarket, askSuperbrain, buildDashboard, getStockIntelligence } from "./services/analysis-service.mjs";
import { getMarketContext } from "./services/market-service.mjs";
import { getNewsForSymbols, getNewsIntelligence } from "./services/news-service.mjs";
import { buildAuthorizationUrl, exchangeAuthorizationCode, fetchUpstoxProfile, getUpstoxConnectionInfo, getUpstoxQuickConnect, getUpstoxStatus, isUpstoxConfigured, storeManualToken } from "./services/upstox-service.mjs";
import { getOptionsChain, getIndiaVix, enrichWithOptionsData, recommendOptionsStrategy } from "./services/options-service.mjs";
import { computeEnhancedTechnicalScore } from "./services/technical-engine.mjs";
import { computeEnhancedFundamentalScore, scoreQGLP, scoreCoffeeCan, scoreSMILE, detectMoat, reverseDAF, classifyLynchCategory } from "./services/fundamental-engine.mjs";
import { getUpcomingIndianEvents, getSectorRotationSignals, isInResultsSeason, getGIFTNiftySignal, isBudgetSensitiveStock } from "./services/india-intelligence.mjs";
import { searchAnyUniverse } from "./services/universe-service.mjs";
import { semanticSearch, fuzzySearch, suggestCorrections } from "./services/advanced-universe-service.mjs";
import { tradingEngine } from "./services/trading-analysis-engine.mjs";
import { flexibleSearchEngine } from "./services/flexible-search-engine.mjs";
import { topSignalsService } from "./services/top-signals-service.mjs";
import { startScheduler } from "./services/scheduler.mjs";
import { renderCallbackError, renderCallbackSuccess, renderConfigMissingPage, renderConnectedPage, renderConnectPage } from "./services/connect-page.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");
const sdkDir = path.resolve(__dirname, "..", "sdk");
const appOrigin = `http://localhost:${config.port}`;

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[ext] || "application/octet-stream";

  response.writeHead(200, {
    "content-type": contentType,
  });
  response.end(fs.readFileSync(filePath));
}

function applyCors(request, response) {
  const origin = resolveAllowedOrigin(request.headers.origin || "");
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-superbrain-admin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function ensureAdmin(request) {
  if (!hasAdminToken()) {
    return true;
  }
  return request.headers["x-superbrain-admin"] === config.adminToken;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function notFound(response) {
  json(response, 404, { error: "Not found" });
}

function getLocalUpstoxCallbackTarget() {
  try {
    const redirectUrl = new URL(config.upstox.redirectUri);
    const port = Number(redirectUrl.port || (redirectUrl.protocol === "https:" ? 443 : 80));
    if (!Number.isFinite(port) || port === config.port) {
      return null;
    }
    if (redirectUrl.protocol !== "http:") {
      return null;
    }
    if (!["localhost", "127.0.0.1"].includes(redirectUrl.hostname)) {
      return null;
    }
    return {
      origin: redirectUrl.origin,
      pathname: redirectUrl.pathname,
      port,
    };
  } catch {
    return null;
  }
}

function getRequestProtocol(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.split(",")[0].trim();
  }
  return "http";
}

function getRequestHost(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim()) {
    return forwardedHost.split(",")[0].trim();
  }
  return request.headers.host || `127.0.0.1:${config.port}`;
}

function serveStatic(response, pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    sendFile(response, path.join(publicDir, "index.html"));
    return true;
  }
  if (pathname.startsWith("/sdk/")) {
    const target = path.join(sdkDir, pathname.replace("/sdk/", ""));
    if (fs.existsSync(target)) {
      sendFile(response, target);
      return true;
    }
  }

  const target = path.join(publicDir, pathname.replace(/^\//, ""));
  if (target.startsWith(publicDir) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    sendFile(response, target);
    return true;
  }

  return false;
}

function requestHandler() {
  return async (request, response) => {
    applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const { pathname, searchParams } = url;
    const siteOrigin = `${getRequestProtocol(request)}://${getRequestHost(request)}`;
    const callbackUrl = config.upstox.redirectUri || `${siteOrigin}/api/upstox/callback`;
    const connectPageOptions = {
      deploymentMode: "local",
      siteOrigin,
      callbackUrl,
    };

    try {
      if (request.method === "GET" && serveStatic(response, pathname)) {
        return;
      }

      if (request.method === "GET" && pathname === "/api/health") {
        const upstox = await getUpstoxStatus();
        json(response, 200, {
          ok: true,
          service: "superbrain-india",
          market: "INDIAN_STOCKS",
          defaultWatchlist: getDefaultWatchlist(),
          upstox,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/universe") {
        const q = searchParams.get("q") || "";
        const limit = Number(searchParams.get("limit") || 20);
        json(response, 200, { items: await searchAnyUniverse(q, limit) });
        return;
      }

      // Advanced Search Endpoints
      if (request.method === "GET" && pathname === "/api/search/semantic") {
        const q = searchParams.get("q") || "";
        const limit = Number(searchParams.get("limit") || 20);
        json(response, 200, { items: await semanticSearch(q, limit) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/search/fuzzy") {
        const q = searchParams.get("q") || "";
        const limit = Number(searchParams.get("limit") || 20);
        const tolerance = Number(searchParams.get("tolerance") || 2);
        json(response, 200, { items: await fuzzySearch(q, limit, tolerance) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/search/suggestions") {
        const q = searchParams.get("q") || "";
        const limit = Number(searchParams.get("limit") || 5);
        json(response, 200, { items: await suggestCorrections(q, limit) });
        return;
      }

      // Enhanced Flexible Search Endpoints
      if (request.method === "POST" && pathname === "/api/v2/flexible-search") {
        const body = await readJsonBody(request);
        const { query, limit = 20, filters = {}, timeframe = "swing" } = body;
        
        if (!query) {
          json(response, 400, { error: "Query is required" });
          return;
        }

        try {
          const enhancedFilters = { ...filters, timeframe };
          const results = await flexibleSearchEngine.flexibleSearch(query, limit, enhancedFilters);
          json(response, 200, results);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "GET" && pathname === "/api/v2/intent-search") {
        const q = searchParams.get("q") || "";
        const limit = Number(searchParams.get("limit") || 20);
        const timeframe = searchParams.get("timeframe") || "swing";
        const risk_level = searchParams.get("risk_level") || "moderate";
        
        if (!q) {
          json(response, 400, { error: "Query is required" });
          return;
        }

        try {
          const filters = { timeframe, risk_level };
          const results = await flexibleSearchEngine.flexibleSearch(q, limit, filters);
          json(response, 200, results);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/v2/timeframe-search") {
        const body = await readJsonBody(request);
        const { query, timeframe, filters = {} } = body;
        
        if (!query || !timeframe) {
          json(response, 400, { error: "Query and timeframe are required" });
          return;
        }

        try {
          const enhancedFilters = { ...filters, timeframe };
          const results = await flexibleSearchEngine.flexibleSearch(query, 50, enhancedFilters);
          
          // Group results by confidence and score
          const grouped = {
            high_confidence: results.items.filter(item => item.confidence >= 70).slice(0, 10),
            medium_confidence: results.items.filter(item => item.confidence >= 40 && item.confidence < 70).slice(0, 10),
            low_confidence: results.items.filter(item => item.confidence < 40).slice(0, 5)
          };

          json(response, 200, {
            query,
            timeframe,
            intent: results.intent,
            results: grouped,
            metadata: results.search_metadata
          });
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/v2/strategy-search") {
        const body = await readJsonBody(request);
        const { query, strategy, risk_level = "moderate", timeframe = "swing" } = body;
        
        if (!query || !strategy) {
          json(response, 400, { error: "Query and strategy are required" });
          return;
        }

        try {
          const filters = { strategy, risk_level, timeframe };
          const results = await flexibleSearchEngine.flexibleSearch(query, 30, filters);
          
          // Sort by strategy-specific score
          const strategyResults = results.items
            .map(item => ({
              ...item,
              strategy_score: item.breakdown?.strategy || 0
            }))
            .sort((a, b) => b.strategy_score - a.strategy_score)
            .slice(0, 20);

          json(response, 200, {
            query,
            strategy,
            results: strategyResults,
            intent: results.intent,
            metadata: results.search_metadata
          });
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      // AI Trading Analysis Endpoints
      if (request.method === "POST" && pathname === "/api/v2/search-stock") {
        const body = await readJsonBody(request);
        const { query, timeframe = "all", risk_profile = "moderate" } = body;
        
        if (!query) {
          json(response, 400, { error: "Query is required" });
          return;
        }

        try {
          // Extract symbol from query using smart search
          const searchResults = await searchAnyUniverse(query, 1);
          if (searchResults.length === 0) {
            json(response, 404, { error: "Stock not found" });
            return;
          }

          const symbol = searchResults[0].symbol;
          const timeframes = timeframe === "all" 
            ? ["intraday", "swing", "short_term", "long_term"]
            : [timeframe];

          const analysis = await tradingEngine.analyzeStock(symbol, timeframes, risk_profile);
          json(response, 200, analysis);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/v2/analyze-stock") {
        const body = await readJsonBody(request);
        const { symbol, timeframes = ["intraday", "swing", "short_term", "long_term"], risk_profile = "moderate" } = body;
        
        if (!symbol) {
          json(response, 400, { error: "Symbol is required" });
          return;
        }

        try {
          const analysis = await tradingEngine.analyzeStock(symbol.toUpperCase(), timeframes, risk_profile);
          json(response, 200, analysis);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "GET" && pathname === "/api/v2/market-data") {
        const symbol = searchParams.get("symbol");
        if (!symbol) {
          json(response, 400, { error: "Symbol is required" });
          return;
        }

        try {
          const marketData = await tradingEngine.getMarketData(symbol.toUpperCase());
          json(response, 200, marketData);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/v2/ai-prediction") {
        const body = await readJsonBody(request);
        const { symbol, timeframe = "swing", features = ["technical", "fundamental", "sentiment"] } = body;
        
        if (!symbol) {
          json(response, 400, { error: "Symbol is required" });
          return;
        }

        try {
          const analysis = await tradingEngine.analyzeStock(
            symbol.toUpperCase(), 
            [timeframe], 
            "moderate"
          );
          
          const prediction = {
            symbol,
            timeframe,
            prediction: analysis[timeframe]?.trend || analysis[timeframe]?.direction || "neutral",
            confidence: analysis[timeframe]?.confidence || 50,
            probability: (analysis[timeframe]?.confidence || 50) / 100,
            factors: features,
            reasoning: analysis.ai_summary,
            timestamp: analysis.timestamp
          };

          json(response, 200, prediction);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "GET" && pathname === "/api/v2/market-sentiment") {
        const symbol = searchParams.get("symbol");
        if (!symbol) {
          json(response, 400, { error: "Symbol is required" });
          return;
        }

        try {
          const sentiment = await tradingEngine.getMarketSentiment(symbol);
          json(response, 200, sentiment);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      // Top Signals API Endpoints
      if (request.method === "GET" && pathname === "/api/v2/market-signals") {
        try {
          const overview = await topSignalsService.getMarketOverview();
          json(response, 200, overview);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }

      if (request.method === "GET" && pathname === "/api/v2/top-signals") {
        const type = searchParams.get("type") || "bullish";
        const timeframe = searchParams.get("timeframe") || "swing";
        const limit = parseInt(searchParams.get("limit") || "10");

        if (!["bullish", "bearish"].includes(type)) {
          json(response, 400, { error: "Type must be 'bullish' or 'bearish'" });
          return;
        }

        if (!["intraday", "swing", "short_term", "long_term"].includes(timeframe)) {
          json(response, 400, { error: "Invalid timeframe" });
          return;
        }

        if (limit < 1 || limit > 50) {
          json(response, 400, { error: "Limit must be between 1 and 50" });
          return;
        }

        try {
          let result;
          if (type === "bullish") {
            result = await topSignalsService.getTopBullishStocks(timeframe, limit);
          } else {
            result = await topSignalsService.getTopBearishStocks(timeframe, limit);
          }
          json(response, 200, result);
        } catch (error) {
          json(response, 500, { error: error.message });
        }
        return;
      }
      if (request.method === "GET" && pathname === "/api/intelligence") {
        const intelligence = await getStockIntelligence({
          symbol: searchParams.get("symbol") || "",
          strategy: searchParams.get("strategy") || "swing",
          horizonDays: searchParams.get("horizonDays") || undefined,
          strictVerification: searchParams.get("strictVerification") !== "false",
        });
        json(response, 200, intelligence);
        return;
      }

      if (request.method === "GET" && pathname === "/api/dashboard") {
        const dashboard = await buildDashboard({
          symbols: searchParams.get("symbols") || "",
          strategy: searchParams.get("strategy") || "swing",
          horizonDays: searchParams.get("horizonDays") || undefined,
          strictVerification: searchParams.get("strictVerification") || undefined,
        });
        json(response, 200, dashboard);
        return;
      }

      if (request.method === "POST" && pathname === "/api/analyze") {
        const body = await readJsonBody(request);
        const analysis = await analyzeMarket(body);
        json(response, 200, analysis);
        return;
      }

      if (request.method === "POST" && pathname === "/api/ask") {
        const body = await readJsonBody(request);
        const answer = await askSuperbrain(body);
        json(response, 200, answer);
        return;
      }

      if (request.method === "GET" && pathname === "/api/news") {
        const symbol = searchParams.get("symbol");
        if (symbol) {
          const items = await getNewsForSymbols([symbol.toUpperCase()]);
          json(response, 200, { symbol: symbol.toUpperCase(), items });
          return;
        }
        const bundle = await getNewsIntelligence();
        json(response, 200, bundle);
        return;
      }

      if (request.method === "GET" && pathname === "/api/macro") {
        const macro = await getMarketContext();
        const news = await getNewsIntelligence();
        json(response, 200, {
          ...macro,
          macroHeadlines: news.macro.slice(0, 8),
          geopoliticalHeadlines: news.geopolitical.slice(0, 8),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/upstox/status") {
        json(response, 200, await getUpstoxStatus());
        return;
      }

      if (request.method === "GET" && pathname === "/api/upstox/connection-info") {
        json(response, 200, await getUpstoxConnectionInfo());
        return;
      }

      if (request.method === "GET" && pathname === "/api/upstox/quick-connect") {
        json(response, 200, await getUpstoxQuickConnect());
        return;
      }

      if (request.method === "GET" && pathname === "/upstox/connect") {
        const status = await getUpstoxStatus();
        if (status.connected) {
          let userInfo = null;
          try { userInfo = await fetchUpstoxProfile(); } catch { /* ignore */ }
          html(response, 200, renderConnectedPage(userInfo, connectPageOptions));
          return;
        }
        if (!isUpstoxConfigured(callbackUrl)) {
          html(response, 200, renderConfigMissingPage(connectPageOptions));
          return;
        }
        const authUrl = buildAuthorizationUrl("superbrain-india", callbackUrl);
        html(response, 200, renderConnectPage(authUrl, connectPageOptions));
        return;
      }

      if (request.method === "POST" && pathname === "/api/upstox/token") {
        if (!ensureAdmin(request)) {
          json(response, 401, { error: "Missing or invalid admin token" });
          return;
        }

        const body = await readJsonBody(request);
        if (!body.accessToken) {
          json(response, 400, { error: "accessToken is required" });
          return;
        }

        const stored = await storeManualToken(body);
        json(response, 200, {
          ok: true,
          expiresAt: stored.expiresAt,
          tokenSource: "db",
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/upstox/connect") {
        const target = buildAuthorizationUrl("superbrain-india", callbackUrl);
        response.writeHead(302, { location: target });
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/api/upstox/callback") {
        const code = searchParams.get("code");
        if (!code) {
          html(response, 400, renderCallbackError("Upstox did not return an authorization code."));
          return;
        }
        try {
          await exchangeAuthorizationCode(code, callbackUrl);
          let userInfo = null;
          try { userInfo = await fetchUpstoxProfile(); } catch { /* ignore */ }
          html(response, 200, renderCallbackSuccess(userInfo, connectPageOptions));
        } catch (err) {
          html(response, 500, renderCallbackError(err.message));
        }
        return;
      }

      // ── NEW: Phase 1 — Options chain endpoint ──
      if (request.method === "GET" && pathname === "/api/options") {
        const symbol = url.searchParams.get("symbol") || "NIFTY";
        try {
          const chain = await getOptionsChain(symbol.toUpperCase());
          json(response, 200, chain);
        } catch (err) {
          json(response, 500, { error: err.message });
        }
        return;
      }

      // ── NEW: India VIX endpoint ──
      if (request.method === "GET" && pathname === "/api/vix") {
        try {
          const vix = await getIndiaVix();
          json(response, 200, vix);
        } catch (err) {
          json(response, 500, { error: err.message });
        }
        return;
      }

      // ── NEW: Phase 3 — Fundamental frameworks endpoint ──
      if (request.method === "POST" && pathname === "/api/fundamental-intel") {
        try {
          const body = await readJsonBody(request);
          const { symbol, fundamentals = {}, stock = {} } = body;
          const strategy = body.strategy || "swing";
          const result = {
            symbol,
            qglp: scoreQGLP(fundamentals, stock),
            coffeeCan: scoreCoffeeCan(fundamentals, stock),
            smile: scoreSMILE(stock, fundamentals, body.marketCap),
            moat: detectMoat(fundamentals, stock),
            lynch: classifyLynchCategory(fundamentals, stock),
            reverseDCF: fundamentals.pe && body.eps
              ? reverseDAF(body.currentPrice, body.eps, fundamentals.pe)
              : null,
            enhanced: computeEnhancedFundamentalScore(fundamentals, stock, strategy),
          };
          json(response, 200, result);
        } catch (err) {
          json(response, 500, { error: err.message });
        }
        return;
      }

      // ── NEW: Phase 5 — India market intelligence endpoint ──
      if (request.method === "GET" && pathname === "/api/india-intel") {
        try {
          const [events, giftNifty, resultsSeason] = await Promise.allSettled([
            Promise.resolve(getUpcomingIndianEvents()),
            getGIFTNiftySignal(),
            Promise.resolve(isInResultsSeason()),
          ]);
          const marketCtx = await getMarketContext().catch(() => ({}));
          const sectorRotation = getSectorRotationSignals(marketCtx);
          json(response, 200, {
            events: events.status === "fulfilled" ? events.value : null,
            giftNifty: giftNifty.status === "fulfilled" ? giftNifty.value : null,
            resultsSeason: resultsSeason.status === "fulfilled" ? resultsSeason.value : null,
            sectorRotation,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          json(response, 500, { error: err.message });
        }
        return;
      }

      // ── NEW: Options strategy recommender ──
      if (request.method === "POST" && pathname === "/api/options-strategy") {
        try {
          const body = await readJsonBody(request);
          const { bias, ivRank, daysToExpiry, riskProfile } = body;
          const strategies = recommendOptionsStrategy({ bias, ivRank, daysToExpiry, riskProfile });
          json(response, 200, { strategies, bias, ivRank });
        } catch (err) {
          json(response, 500, { error: err.message });
        }
        return;
      }

      // ── NEW: Budget-sensitive stock check ──
      if (request.method === "GET" && pathname === "/api/budget-check") {
        const symbol = url.searchParams.get("symbol") || "";
        const sector = url.searchParams.get("sector") || "";
        json(response, 200, isBudgetSensitiveStock(symbol, sector));
        return;
      }

      notFound(response);
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error",
      });
    }
  };
}

export function createSuperbrainServer() {
  return http.createServer(requestHandler());
}

export function createUpstoxCallbackBridge() {
  const target = getLocalUpstoxCallbackTarget();
  if (!target) {
    return null;
  }

  return http.createServer(async (request, response) => {
    applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, target.origin);
    if (request.method !== "GET" || url.pathname !== target.pathname) {
      notFound(response);
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      html(
        response,
        400,
        renderCallbackError("Upstox did not return an authorization code.", {
          retryUrl: `${appOrigin}/upstox/connect`,
          redirectUrl: `${appOrigin}/upstox/connect`,
        }),
      );
      return;
    }

    try {
      await exchangeAuthorizationCode(code);
      let userInfo = null;
      try { userInfo = await fetchUpstoxProfile(); } catch { /* ignore */ }
      html(
        response,
        200,
        renderCallbackSuccess(userInfo, {
          dashboardUrl: `${appOrigin}/`,
          redirectUrl: `${appOrigin}/`,
        }),
      );
    } catch (error) {
      html(
        response,
        500,
        renderCallbackError(error instanceof Error ? error.message : "Authorization failed.", {
          retryUrl: `${appOrigin}/upstox/connect`,
          redirectUrl: `${appOrigin}/upstox/connect`,
        }),
      );
    }
  });
}

export function startSuperbrainServer() {
  const server = createSuperbrainServer();
  const bridge = createUpstoxCallbackBridge();
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Superbrain India listening on http://localhost:${config.port}`);
    if (bridge) {
      const target = getLocalUpstoxCallbackTarget();
      bridge.on("error", (error) => {
        console.error(`[Upstox] Callback bridge failed: ${error.message}`);
      });
      bridge.listen(target.port, () => {
        console.log(`Upstox callback bridge listening on ${config.upstox.redirectUri}`);
      });
    }
    startScheduler();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startSuperbrainServer();
}
