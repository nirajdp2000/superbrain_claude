import { config } from "../config.mjs";
import { getDefaultWatchlist, getStockByAlias, getStockBySymbol, mapTextToSymbols, searchUniverse } from "../data/universe.mjs";
import { fetchJson } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";

const searchCache = new TTLCache(10 * 60_000);
const stockCache = new TTLCache(6 * 60 * 60_000);

function getSharedUniverseBaseUrl() {
  return (config.upstoxProxyUrl || "").replace(/\/+$/, "");
}

function canUseSharedUniverse() {
  return Boolean(getSharedUniverseBaseUrl());
}

function dedupeAliases(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
}

function baseTickerSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");
}

function inferSector(symbol = "", name = "", fallback = "Unknown") {
  const text = `${symbol} ${name}`.toLowerCase();
  if (fallback && fallback !== "Diversified") {
    return fallback;
  }
  if (/\b(bank|finance|finserv|insurance|capital|credit)\b/.test(text)) return "Financials";
  if (/\b(soft|tech|technology|infotech|software|digital)\b/.test(text)) return "Technology";
  if (/\b(pharma|hospital|health|life|labs|medical)\b/.test(text)) return "Healthcare";
  if (/\b(tyre|motors|auto|maruti|hero|eicher)\b/.test(text)) return "Auto";
  if (/\b(steel|cement|pipes|tubes|paint|chem|metal|mining)\b/.test(text)) return "Materials";
  if (/\b(power|grid|electric|utility)\b/.test(text)) return "Utilities";
  if (/\b(telecom|airtel|communication)\b/.test(text)) return "Telecom";
  if (/\b(oil|gas|energy|coal|petro)\b/.test(text)) return "Energy";
  if (/\b(consum|foods|retail|fashion|hospitality|travel)\b/.test(text)) return "Consumer";
  if (/\b(engineering|infrastructure|micro systems|ports|defence|defense|industrial)\b/.test(text)) return "Industrials";
  return fallback || "Unknown";
}

function normalizeStock(row) {
  if (!row) {
    return null;
  }

  const symbol = baseTickerSymbol(row.symbol || "");
  if (!symbol) {
    return null;
  }

  const name = String(row.name || row.companyName || symbol).trim();
  const aliases = dedupeAliases([
    symbol,
    name,
    name.replace(/\b(limited|ltd|enter\.?|enterprises?|company|co)\b/gi, " ").replace(/\s+/g, " ").trim(),
    row.exchange ? `${symbol} ${row.exchange}` : "",
    ...(Array.isArray(row.aliases) ? row.aliases : row.aliases ? [row.aliases] : []),
  ]);

  return {
    symbol,
    name,
    sector: inferSector(symbol, name, String(row.sector || "").trim() || "Unknown"),
    instrumentKey: row.instrumentKey || row.key || "",
    exchange: row.exchange || "NSE",
    aliases,
    source: row.source || "shared-universe",
  };
}

function isIndianListedQuote(row) {
  if (!row || String(row.quoteType || "").toUpperCase() !== "EQUITY") {
    return false;
  }

  const symbol = String(row.symbol || "").toUpperCase();
  const exchange = String(row.exchange || "").toUpperCase();
  const exchangeDisplay = String(row.exchDisp || "").toUpperCase();

  return (
    symbol.endsWith(".NS")
    || symbol.endsWith(".BO")
    || exchange === "NSI"
    || exchange === "NSE"
    || exchange === "BSE"
    || exchangeDisplay.includes("NSE")
    || exchangeDisplay.includes("BOMBAY")
    || exchangeDisplay.includes("BSE")
  );
}

function normalizePublicQuote(row) {
  if (!isIndianListedQuote(row)) {
    return null;
  }

  const symbol = baseTickerSymbol(row.symbol || "");
  if (!symbol) {
    return null;
  }

  const exchange = String(row.symbol || "").toUpperCase().endsWith(".BO")
    || String(row.exchange || "").toUpperCase() === "BSE"
    || String(row.exchDisp || "").toUpperCase().includes("BOMBAY")
      ? "BSE"
      : "NSE";

  const name = String(row.longname || row.shortname || symbol).trim();

  return normalizeStock({
    symbol,
    name,
    companyName: name,
    sector: row.sectorDisp || row.sector || row.industryDisp || "Unknown",
    exchange,
    source: "yahoo-public-search",
    aliases: [
      row.shortname,
      row.longname,
      row.displayName,
      row.typeDisp,
      row.industryDisp,
      exchange === "NSE" ? `${symbol} NSE` : `${symbol} BSE`,
    ],
  });
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function scoreStockQuery(stock, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 0;
  const sym = stock.symbol.toLowerCase();
  const name = stock.name.toLowerCase();
  const aliases = Array.isArray(stock.aliases) ? stock.aliases.map(a => String(a).toLowerCase()) : [];
  let score = 0;

  // Exact matches
  if (sym === q) return 1000;
  if (name === q) return 900;
  if (aliases.some(a => a === q)) return 850;

  // Prefix
  if (sym.startsWith(q)) score += 200;
  if (name.startsWith(q)) score += 120;
  if (aliases.some(a => a.startsWith(q))) score += 100;

  // Contains
  if (sym.includes(q)) score += 60;
  if (name.includes(q)) score += 40;
  if (aliases.some(a => a.includes(q))) score += 30;

  // Word boundary
  const words = name.split(/\s+/);
  if (words.some(w => w === q)) score += 80;
  if (words.some(w => w.startsWith(q))) score += 50;

  // Multi-word query
  const qWords = q.split(/\s+/).filter(w => w.length >= 2);
  if (qWords.length > 1) {
    for (const w of qWords) {
      if (sym.includes(w)) score += 25;
      if (name.includes(w)) score += 20;
      if (aliases.some(a => a.includes(w))) score += 15;
    }
  }

  if (stock.source === "shared-universe") score += 1;
  return score;
}

function mergeStocks(primary = [], secondary = []) {
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

async function searchSharedUniverse(query, limit = 20) {
  if (!canUseSharedUniverse()) {
    return [];
  }

  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return [];
  }

  const cacheKey = `shared-search:${trimmed.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetchJson(`${getSharedUniverseBaseUrl()}/api/stocks/search`, {
      params: { q: trimmed },
      timeoutMs: 2200,
    });
    const rows = Array.isArray(response) ? response : [];
    return searchCache.set(cacheKey, rows.map(normalizeStock).filter(Boolean).slice(0, limit));
  } catch {
    return [];
  }
}

async function searchPublicUniverse(query, limit = 20) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return [];
  }

  const cacheKey = `public-search:${trimmed.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetchJson("https://query2.finance.yahoo.com/v1/finance/search", {
      params: {
        q: trimmed,
        quotesCount: Math.max(12, limit * 4),
        newsCount: 0,
      },
      timeoutMs: 2600,
    });

    const rows = Array.isArray(response?.quotes) ? response.quotes : [];
    const normalized = rows
      .map(normalizePublicQuote)
      .filter(Boolean)
      .slice(0, limit);

    return searchCache.set(cacheKey, normalized);
  } catch {
    return [];
  }
}

async function searchRemoteUniverse(query, limit = 20) {
  const [sharedRows, publicRows] = await Promise.all([
    searchSharedUniverse(query, limit * 2),
    searchPublicUniverse(query, limit * 2),
  ]);

  return mergeStocks(sharedRows, publicRows).slice(0, limit);
}

export async function searchAnyUniverse(query = "", limit = 20) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return getDefaultWatchlist()
      .map((symbol) => getStockBySymbol(symbol))
      .filter(Boolean)
      .slice(0, limit);
  }

  const localRows = searchUniverse(trimmed, limit * 2);
  const remoteRows = await searchRemoteUniverse(trimmed, limit * 3);
  return mergeStocks(localRows, remoteRows)
    .map((stock) => ({ stock, score: scoreStockQuery(stock, trimmed) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.stock)
    .slice(0, limit);
}

export async function resolveStockAny(rawSymbol) {
  const symbol = String(rawSymbol || "").trim().toUpperCase();
  if (!symbol) return null;

  // 1. Exact symbol match
  const local = getStockBySymbol(symbol);
  if (local) return local;

  // 2. Alias index O(1) — "hdfc"→HDFCBANK, "sbi"→SBIN, "ril"→RELIANCE, "l&t"→LT
  const aliasHit = getStockByAlias(symbol);
  if (aliasHit) return aliasHit;

  // 3. Local search fallback
  const localFuzzy = searchUniverse(symbol, 3);
  if (localFuzzy.length === 1) return localFuzzy[0];
  if (localFuzzy.length > 0) {
    const exact = localFuzzy.find(s => s.symbol === symbol);
    if (exact) return exact;
  }

  // 4. Cache check
  const cached = stockCache.get(symbol);
  if (cached) return cached;

  // 5. Remote search
  const matches = await searchRemoteUniverse(symbol, 8);
  const exact = matches.find(s => s.symbol === symbol)
    || matches.find(s => s.name.toUpperCase() === symbol)
    || matches[0] || null;
  if (exact) stockCache.set(symbol, exact);
  return exact;
}

export async function resolveStocksAny(symbols = []) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return getDefaultWatchlist().map((symbol) => getStockBySymbol(symbol)).filter(Boolean);
  }

  const unique = [];
  for (const raw of symbols) {
    const value = String(raw || "").trim();
    if (!value || unique.includes(value.toUpperCase())) {
      continue;
    }
    unique.push(value.toUpperCase());
  }

  const rows = await Promise.all(unique.map((symbol) => resolveStockAny(symbol)));
  return rows.filter(Boolean);
}

export async function resolveQueryCandidates(query = "", limit = 6) {
  const localMapped = mapTextToSymbols(query);
  const mappedRows = await Promise.all(localMapped.map((symbol) => resolveStockAny(symbol)));
  const searched = await searchAnyUniverse(query, limit);
  return mergeStocks(mappedRows.filter(Boolean), searched)
    .map((stock) => ({ stock, score: scoreStockQuery(stock, query) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.stock)
    .slice(0, limit);
}
