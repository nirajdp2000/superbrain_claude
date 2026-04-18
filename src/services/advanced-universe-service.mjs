import { config } from "../config.mjs";
import { getDefaultWatchlist, getStockByAlias, getStockBySymbol, mapTextToSymbols, searchUniverse } from "../data/universe.mjs";
import { fetchJson } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";
import { resolveStockAny as resolveCoreStock, searchAnyUniverse as searchCoreUniverse } from "./universe-service.mjs";

const searchCache = new TTLCache(10 * 60_000);
const stockCache = new TTLCache(6 * 60 * 60_000);
const semanticCache = new TTLCache(30 * 60_000);

// Enhanced search with multiple algorithms
class AdvancedSearchEngine {
  constructor() {
    this.popularityWeights = new Map();
    this.initializePopularityWeights();
  }

  initializePopularityWeights() {
    // Popular Indian stocks get higher weights
    const popularStocks = [
      'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'HINDUNILVR', 
      'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'LT', 'WIPRO', 'AXISBANK',
      'DMART', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA', 'M&M', 'NESTLEIND'
    ];
    
    popularStocks.forEach((symbol, index) => {
      this.popularityWeights.set(symbol, 100 - index); // Higher weight for more popular stocks
    });
  }

  // Levenshtein distance for fuzzy matching
  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    return matrix[str2.length][str1.length];
  }

  // Jaccard similarity for token-based matching
  jaccardSimilarity(str1, str2) {
    const tokens1 = new Set(str1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return intersection.size / union.size;
  }

  // Phonetic similarity using Soundex-like algorithm
  phoneticSimilarity(str1, str2) {
    const soundex = (str) => {
      const code = str.toUpperCase().replace(/[^A-Z]/g, '');
      if (!code) return '';
      
      const first = code[0];
      const consonants = code.slice(1).replace(/[AEIOUYHW]/g, '');
      
      const digits = consonants.replace(/[BFPV]/g, '1')
        .replace(/[CGJKQSXZ]/g, '2')
        .replace(/[DT]/g, '3')
        .replace(/[L]/g, '4')
        .replace(/[MN]/g, '5')
        .replace(/[R]/g, '6');
      
      const compressed = digits.replace(/(.)\1+/g, '$1');
      return (first + compressed + '000').slice(0, 4);
    };
    
    return soundex(str1) === soundex(str2) ? 1 : 0;
  }

  // Enhanced scoring algorithm with multiple factors
  calculateAdvancedScore(stock, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return 0;
    
    const sym = stock.symbol.toLowerCase();
    const name = stock.name.toLowerCase();
    const aliases = Array.isArray(stock.aliases) ? stock.aliases.map(a => String(a).toLowerCase()) : [];
    
    let score = 0;
    const queryLength = q.length;

    // 1. Exact matches (highest priority)
    if (sym === q) score += 2000;
    if (name === q) score += 1800;
    if (aliases.some(a => a === q)) score += 1700;

    // 2. Symbol prefix/suffix matches
    if (sym.startsWith(q)) score += 500;
    if (sym.endsWith(q)) score += 400;
    
    // 3. Name word boundaries
    const nameWords = name.split(/\s+/);
    if (nameWords.some(w => w === q)) score += 600;
    if (nameWords.some(w => w.startsWith(q))) score += 300;
    if (nameWords.some(w => w.endsWith(q))) score += 250;

    // 4. Fuzzy matching for typos
    const symDistance = this.levenshteinDistance(sym, q);
    const nameDistance = this.levenshteinDistance(name, q);
    
    if (symDistance <= 1 && queryLength > 2) score += 400;
    if (symDistance <= 2 && queryLength > 3) score += 200;
    if (nameDistance <= 2 && queryLength > 3) score += 150;

    // 5. Semantic similarity
    const jaccardScore = this.jaccardSimilarity(name, q);
    score += jaccardScore * 200;

    // 6. Phonetic matching
    if (this.phoneticSimilarity(sym, q)) score += 300;
    if (this.phoneticSimilarity(name, q)) score += 200;

    // 7. Acronym matching (e.g., "L&T" -> "Larsen & Toubro")
    const nameAcronym = nameWords.map(w => w[0]).join('').toLowerCase();
    if (nameAcronym === q.replace(/[^a-z]/g, '')) score += 800;

    // 8. Partial matches with position weighting
    const symIndex = sym.indexOf(q);
    const nameIndex = name.indexOf(q);
    
    if (symIndex > 0) score += Math.max(0, 200 - symIndex * 10);
    if (nameIndex > 0) score += Math.max(0, 150 - nameIndex * 10);

    // 9. Multi-word query handling
    const qWords = q.split(/\s+/).filter(w => w.length >= 2);
    if (qWords.length > 1) {
      let wordMatchScore = 0;
      for (const word of qWords) {
        if (sym.includes(word)) wordMatchScore += 50;
        if (name.includes(word)) wordMatchScore += 40;
        if (aliases.some(a => a.includes(word))) wordMatchScore += 30;
      }
      score += wordMatchScore * (qWords.length / q.length);
    }

    // 10. Popularity boost
    const popularityBoost = this.popularityWeights.get(stock.symbol.toUpperCase()) || 0;
    score += popularityBoost;

    // 11. Sector relevance bonus for sector-specific queries
    if (stock.sector && stock.sector.toLowerCase().includes(q)) {
      score += 100;
    }

    // 12. Length penalty (prefer shorter matches for same score)
    score -= Math.min(50, sym.length * 2 + name.length);

    // 13. Source quality bonus
    if (stock.source === "shared-universe") score += 50;
    if (stock.source === "nse") score += 30;
    if (stock.source === "bse") score += 30;

    return Math.max(0, Math.round(score));
  }

  // Semantic search using keyword expansion
  expandQuery(query) {
    const expansions = {
      'bank': ['banking', 'finance', 'financial', 'finserv'],
      'tech': ['technology', 'software', 'it', 'infotech', 'digital'],
      'pharma': ['pharmaceutical', 'healthcare', 'medical', 'life'],
      'auto': ['automobile', 'motor', 'car', 'vehicle'],
      'steel': ['metal', 'iron', 'materials', 'mining'],
      'power': ['energy', 'electric', 'utility', 'renewable'],
      'telecom': ['communication', 'wireless', 'network'],
      'oil': ['petroleum', 'gas', 'energy', 'crude'],
      'retail': ['consumer', 'fmcg', 'goods', 'shopping'],
      'infra': ['infrastructure', 'construction', 'engineering', 'industrial']
    };

    const q = query.toLowerCase();
    const expanded = [query];
    
    for (const [key, values] of Object.entries(expansions)) {
      if (q.includes(key)) {
        expanded.push(...values);
      }
    }

    return [...new Set(expanded)];
  }

  // Advanced search with multiple algorithms
  async advancedSearch(stocks, query, limit = 20) {
    const expandedQueries = this.expandQuery(query);
    const scored = [];

    for (const stock of stocks) {
      let maxScore = 0;
      
      // Test against original and expanded queries
      for (const q of expandedQueries) {
        const score = this.calculateAdvancedScore(stock, q);
        maxScore = Math.max(maxScore, score);
      }

      if (maxScore > 0) {
        scored.push({ stock, score: maxScore });
      }
    }

    // Sort by score and apply diversity boost
    scored.sort((a, b) => b.score - a.score);
    
    // Apply diversity: ensure different sectors are represented
    const diverse = [];
    const sectorCounts = new Map();
    
    for (const item of scored) {
      const sector = item.stock.sector;
      const count = sectorCounts.get(sector) || 0;
      
      // Allow max 3 stocks per sector in top results
      if (count < 3 || diverse.length < limit * 0.7) {
        diverse.push(item);
        sectorCounts.set(sector, count + 1);
        
        if (diverse.length >= limit) break;
      }
    }

    return diverse.slice(0, limit);
  }
}

const searchEngine = new AdvancedSearchEngine();

function getSharedUniverseBaseUrl() {
  return (config.upstoxProxyUrl || "").replace(/\/+$/, "");
}

function canUseSharedUniverse() {
  return Boolean(getSharedUniverseBaseUrl());
}

function dedupeAliases(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
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

  const symbol = String(row.symbol || "").trim().toUpperCase();
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

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function mergeStockGroups(groups = []) {
  return groups.reduce((merged, group) => mergeStocks(merged, group), []);
}

function buildQueryVariants(query = "") {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return [];
  }

  const collapsed = trimmed.replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim();
  const tokens = collapsed.split(" ").filter((token) => token.length >= 2);
  const variants = [
    trimmed,
    collapsed,
    tokens.join(" "),
    ...tokens,
  ];

  if (tokens.length >= 2) {
    variants.push(tokens.slice(0, 2).join(" "));
  }

  return [...new Set(variants.map((value) => String(value || "").trim()).filter(Boolean))];
}

// Legacy scoring for backward compatibility
function scoreStockQuery(stock, query = "") {
  return searchEngine.calculateAdvancedScore(stock, query);
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

// Enhanced search with advanced algorithms
export async function searchAnyUniverse(query = "", limit = 20) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return getDefaultWatchlist()
      .map((symbol) => getStockBySymbol(symbol))
      .filter(Boolean)
      .slice(0, limit);
  }

  const localRows = searchUniverse(trimmed, limit * 3);
  const remoteRows = await searchCoreUniverse(trimmed, limit * 4);
  const allStocks = mergeStocks(localRows, remoteRows);
  
  // Use advanced search engine
  const results = await searchEngine.advancedSearch(allStocks, trimmed, limit);
  return results.map(r => r.stock);
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

  // 3. Local search fallback with fuzzy matching
  const localFuzzy = searchUniverse(symbol, 5);
  if (localFuzzy.length === 1) return localFuzzy[0];
  if (localFuzzy.length > 0) {
    const exact = localFuzzy.find(s => s.symbol === symbol);
    if (exact) return exact;
    
    // Use advanced scoring to find best match
    const scored = localFuzzy.map(stock => ({
      stock,
      score: searchEngine.calculateAdvancedScore(stock, symbol)
    }));
    scored.sort((a, b) => b.score - a.score);
    
    if (scored[0].score > 500) return scored[0].stock; // High confidence match
  }

  // 4. Cache check
  const cached = stockCache.get(symbol);
  if (cached) return cached;

  // 5. Remote search
  const resolved = await resolveCoreStock(symbol);
  if (resolved) {
    stockCache.set(symbol, resolved);
  }
  return resolved;
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

// New advanced search endpoints
export async function semanticSearch(query = "", limit = 20) {
  const cacheKey = `semantic:${query.toLowerCase()}:${limit}`;
  const cached = semanticCache.get(cacheKey);
  if (cached) return cached;

  const expanded = searchEngine.expandQuery(query);
  const allResults = [];

  for (const q of expanded) {
    const results = await searchAnyUniverse(q, Math.ceil(limit / expanded.length));
    allResults.push(...results);
  }

  const unique = mergeStocks(allResults);
  const scored = await searchEngine.advancedSearch(unique, query, limit);
  
  return semanticCache.set(cacheKey, scored.map(r => r.stock));
}

export async function fuzzySearch(query = "", limit = 20, tolerance = 2) {
  const variants = buildQueryVariants(query);
  if (!variants.length) {
    return [];
  }

  const remoteGroups = await Promise.all(
    variants.map((variant) => searchCoreUniverse(variant, Math.max(limit * 8, 20))),
  );

  const localGroups = variants.map((variant) => searchUniverse(variant, Math.max(limit * 4, 12)));
  const allStocks = mergeStockGroups([...localGroups, ...remoteGroups]);

  const filtered = allStocks.filter(stock => {
    const symDist = searchEngine.levenshteinDistance(stock.symbol.toLowerCase(), query.toLowerCase());
    const nameDist = searchEngine.levenshteinDistance(stock.name.toLowerCase(), query.toLowerCase());
    return symDist <= tolerance || nameDist <= tolerance;
  });

  const scored = await searchEngine.advancedSearch(filtered, query, limit);
  return scored.map(r => r.stock);
}

export async function suggestCorrections(query = "", limit = 5) {
  const variants = buildQueryVariants(query);
  if (!variants.length) {
    return [];
  }

  const remoteGroups = await Promise.all(
    variants.map((variant) => searchCoreUniverse(variant, Math.max(limit * 8, 20))),
  );
  const localGroups = variants.map((variant) => searchUniverse(variant, Math.max(limit * 4, 12)));
  const allStocks = mergeStockGroups([...localGroups, ...remoteGroups]);

  const suggestions = [];

  for (const stock of allStocks.slice(0, 200)) { // Limit for performance
    const symScore = searchEngine.calculateAdvancedScore(stock, query);
    if (symScore > 100) { // Reasonable match threshold
      suggestions.push({ stock, score: symScore });
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, limit).map(s => s.stock);
}
