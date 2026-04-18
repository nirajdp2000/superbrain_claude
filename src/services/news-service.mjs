import { getStockBySymbol, getUniverse } from "../data/universe.mjs";
import { fetchText } from "../utils/http.mjs";
import { TTLCache } from "../utils/ttl-cache.mjs";

const newsCache = new TTLCache(5 * 60_000);
const MAX_ITEM_AGE_HOURS = 10 * 24;
const COMPANY_NEWS_WINDOW_DAYS = 7;
const DEFAULT_TARGETED_SYMBOL_LIMIT = 8;

const COMPANY_STOPWORDS = new Set([
  "limited",
  "ltd",
  "india",
  "industries",
  "industry",
  "company",
  "enterprise",
  "enterprises",
  "corporation",
  "corp",
  "services",
  "systems",
  "holdings",
  "group",
]);

const NEWS_SOURCES = [
  { name: "Economic Times Markets", url: "https://economictimes.indiatimes.com/markets/rss.cms", credibility: 0.93, tier: "market" },
  { name: "Moneycontrol", url: "https://www.moneycontrol.com/rss/latestnews.xml", credibility: 0.9, tier: "market" },
  { name: "LiveMint Markets", url: "https://www.livemint.com/rss/markets", credibility: 0.89, tier: "market" },
  { name: "LiveMint Companies", url: "https://www.livemint.com/rss/companies", credibility: 0.88, tier: "market" },
  { name: "LiveMint Politics", url: "https://www.livemint.com/rss/politics", credibility: 0.86, tier: "market" },
  { name: "Business Standard Markets", url: "https://www.business-standard.com/rss/markets-106.rss", credibility: 0.9, tier: "market" },
  { name: "Financial Express Markets", url: "https://www.financialexpress.com/market/feed/", credibility: 0.84, tier: "market" },
  { name: "RBI Press Releases", url: "https://www.rbi.org.in/rss/PressReleaseRss.xml", credibility: 0.98, tier: "official" },
  { name: "SEBI Updates", url: "https://www.sebi.gov.in/sebirss.xml", credibility: 0.97, tier: "official" },
  { name: "PIB Economy", url: "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3", credibility: 0.95, tier: "official" },
  { name: "NSE Corporate Announcements", url: "https://www.nseindia.com/rss/corporate-announcements.xml", credibility: 0.98, tier: "official" },
  { name: "BSE Corporate Announcements", url: "https://www.bseindia.com/xml-data/rss/ann.aspx", credibility: 0.97, tier: "official" },
];

const PUBLISHER_CREDIBILITY = new Map([
  ["Reuters", 0.99],
  ["Bloomberg", 0.98],
  ["Business Standard", 0.91],
  ["Economic Times", 0.93],
  ["The Economic Times", 0.93],
  ["ETMarkets.com", 0.93],
  ["Mint", 0.89],
  ["LiveMint", 0.89],
  ["Moneycontrol.com", 0.9],
  ["Moneycontrol", 0.9],
  ["Financial Express", 0.84],
  ["CNBCTV18", 0.9],
  ["CNBC-TV18", 0.9],
  ["The Hindu BusinessLine", 0.9],
  ["BusinessLine", 0.9],
  ["Upstox", 0.88],
  ["NDTV Profit", 0.88],
  ["Zee Business", 0.82],
  ["Times Now", 0.8],
  ["Markets Mojo", 0.8],
  ["StockEdge", 0.79],
  ["PTI", 0.88],
]);

const NEWS_SYMBOL_CATALOG = getUniverse();

const POSITIVE_WORDS = new Set([
  "surge", "rally", "gain", "record", "upgrade", "strong", "robust", "order", "deal",
  "beat", "profit", "growth", "expansion", "approval", "buyback", "dividend", "inflow",
  "boost", "bullish", "recovery", "capex", "wins", "contract", "eases", "cooling",
  "accumulate", "outperform", "overweight", "deleveraging", "cashflow", "moat", "guidance raise",
]);

const NEGATIVE_WORDS = new Set([
  "fall", "drop", "decline", "downgrade", "probe", "fraud", "penalty", "debt", "default",
  "warning", "miss", "slowdown", "outflow", "sell", "lawsuit", "weak", "loss", "cuts",
  "slump", "war", "conflict", "attack", "disruption", "flood", "cyclone", "earthquake",
  "pledge", "resignation", "underperform", "governance", "dilution", "scrutiny", "target cut",
]);

const EVENT_RULES = [
  { tag: "war", keywords: ["war", "missile", "drone strike", "conflict", "military", "attack", "ceasefire"], geopolitical: true, macro: true },
  { tag: "oil_shock", keywords: ["opec", "brent", "crude", "oil price", "diesel", "petrol"], geopolitical: true, macro: true },
  { tag: "shipping_risk", keywords: ["red sea", "shipping", "freight", "shipping lane", "supply chain", "container"], geopolitical: true, macro: true },
  { tag: "sanctions", keywords: ["sanction", "embargo", "export curb", "tariff", "trade war"], geopolitical: true, macro: true },
  { tag: "rates_hike", keywords: ["rate hike", "repo hike", "tightening", "hawkish"], macro: true, policy: true },
  { tag: "rates_cut", keywords: ["rate cut", "repo cut", "easing", "dovish"], macro: true, policy: true },
  { tag: "inflation", keywords: ["inflation", "cpi", "wpi", "price rise", "sticky prices"], macro: true },
  { tag: "currency_pressure", keywords: ["rupee", "usdinr", "currency", "dollar index"], macro: true },
  { tag: "budget_policy", keywords: ["budget", "union budget", "gst", "tax", "policy support", "fiscal"], macro: true, policy: true },
  { tag: "regulation", keywords: ["sebi", "rbi", "regulatory", "compliance", "circular", "framework"], macro: true, policy: true },
  { tag: "natural_disaster", keywords: ["earthquake", "flood", "cyclone", "wildfire", "landslide", "drought", "storm"], macro: true },
  { tag: "monsoon", keywords: ["monsoon", "rainfall", "heatwave", "el nino"], macro: true },
  { tag: "cyber_risk", keywords: ["cyber", "ransomware", "data breach", "outage", "hack"], macro: true },
  { tag: "earnings", keywords: ["results", "earnings", "quarter", "guidance", "ebitda", "revenue"], company: true },
  { tag: "order_win", keywords: ["order win", "wins order", "wins contract", "deal win", "large order", "bagged contract"], company: true },
  { tag: "default_risk", keywords: ["default", "insolvency", "bankruptcy", "downgrade", "stress", "slippages"], company: true },
  { tag: "investigation", keywords: ["probe", "investigation", "fraud", "whistleblower", "scam"], company: true },
  { tag: "fda_risk", keywords: ["usfda", "warning letter", "483 observation"], company: true },
  { tag: "buyback", keywords: ["buyback", "share repurchase", "repurchase"], company: true },
  { tag: "dividend", keywords: ["dividend", "special dividend"], company: true },
  { tag: "capex", keywords: ["capex", "investment plan", "expansion plan", "new plant", "new facility"], company: true },
  { tag: "rating_upgrade", keywords: ["outperform", "overweight", "strong buy", "buy rating", "target raised", "initiates buy"], company: true },
  { tag: "rating_downgrade", keywords: ["underperform", "sell rating", "target cut", "target lowered", "downgrade"], company: true },
  { tag: "governance", keywords: ["pledge", "corporate governance", "auditor resignation", "resignation", "governance"], company: true },
];

const MACRO_TAGS = new Set([
  "war",
  "oil_shock",
  "shipping_risk",
  "sanctions",
  "rates_hike",
  "rates_cut",
  "inflation",
  "currency_pressure",
  "budget_policy",
  "regulation",
  "natural_disaster",
  "monsoon",
  "cyber_risk",
]);

const OFFICIAL_SIGNAL_HINTS = [
  "board meeting",
  "press release",
  "policy",
  "circular",
  "framework",
  "guideline",
  "consultation",
  "market",
  "repo",
  "inflation",
  "liquidity",
  "mutual fund",
  "ipo",
  "disclosure",
  "settlement",
  "surveillance",
];

const TAG_BIAS = {
  order_win: 5,
  earnings: 2,
  rates_cut: 4,
  budget_policy: 2,
  buyback: 4,
  dividend: 3,
  capex: 3,
  rating_upgrade: 3,
  rating_downgrade: -4,
  governance: -7,
  default_risk: -8,
  investigation: -8,
  fda_risk: -6,
  war: -5,
  oil_shock: -4,
  shipping_risk: -4,
  sanctions: -4,
  rates_hike: -4,
  inflation: -4,
  currency_pressure: -2,
  regulation: -2,
  natural_disaster: -5,
  cyber_risk: -5,
  monsoon: -2,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function cleanText(value = "") {
  return decodeHtmlEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<img[\s\S]*?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:src|alt|title|width|height|border|align|hspace|vspace)=["'][^"']*["']/gi, " ")
    .replace(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)\S*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublisher(value = "") {
  return cleanText(value)
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

function normalizeHeadline(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceTierLabel(score = 0) {
  if (score >= 0.96) return "official";
  if (score >= 0.91) return "primary";
  if (score >= 0.85) return "market";
  return "secondary";
}

function credibilityLabel(score = 0) {
  if (score >= 0.96) return "Very high";
  if (score >= 0.91) return "High";
  if (score >= 0.85) return "Good";
  return "Medium";
}

function parsePublishedAt(value = "") {
  const parsed = new Date(cleanText(value || new Date().toISOString()));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function getAgeHours(isoValue) {
  const publishedTime = new Date(isoValue).getTime();
  if (!Number.isFinite(publishedTime)) {
    return 999;
  }
  return Math.max(0, (Date.now() - publishedTime) / (60 * 60 * 1000));
}

function getFreshnessScore(isoValue) {
  const ageHours = getAgeHours(isoValue);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.92;
  if (ageHours <= 48) return 0.82;
  if (ageHours <= 72) return 0.72;
  if (ageHours <= 120) return 0.58;
  if (ageHours <= 168) return 0.44;
  if (ageHours <= MAX_ITEM_AGE_HOURS) return 0.3;
  return 0.12;
}

function parseFeed(xml) {
  const blocks = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;

  for (const regex of [itemRegex, entryRegex]) {
    let match;
    while ((match = regex.exec(xml)) !== null) {
      blocks.push(match[0]);
    }
  }

  return blocks.map((block) => ({
    title: cleanText(extractTag(block, "title")),
    description: cleanText(extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content")),
    link: cleanText(extractTag(block, "link")) || (decodeHtmlEntities(block.match(/href="([^"]+)"/)?.[1] || "").trim()),
    publishedAt: parsePublishedAt(extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated")),
  })).filter((item) => item.title.length > 10);
}

function extractPublisherFromHeadline(title = "") {
  const cleaned = cleanText(title);
  const parts = cleaned.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return {
      headline: cleaned,
      publisher: "",
    };
  }

  return {
    headline: parts.slice(0, -1).join(" - ").trim(),
    publisher: normalizePublisher(parts[parts.length - 1]),
  };
}

function inferPublisherCredibility(publisher = "", fallback = 0.78) {
  const normalized = normalizePublisher(publisher);
  if (!normalized) {
    return fallback;
  }

  if (PUBLISHER_CREDIBILITY.has(normalized)) {
    return PUBLISHER_CREDIBILITY.get(normalized);
  }

  for (const [name, score] of PUBLISHER_CREDIBILITY.entries()) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return score;
    }
  }

  return fallback;
}

function analyzeSentiment(text) {
  const tokens = cleanText(text).toLowerCase().split(/\W+/);
  let positive = 0;
  let negative = 0;

  for (const token of tokens) {
    if (POSITIVE_WORDS.has(token)) positive += 1;
    if (NEGATIVE_WORDS.has(token)) negative += 1;
  }

  if (positive === negative) {
    return { label: "NEUTRAL", score: 0 };
  }

  const score = (positive - negative) / Math.max(positive + negative, 1);
  return {
    label: score > 0 ? "POSITIVE" : "NEGATIVE",
    score: Number(score.toFixed(2)),
  };
}

function classifyTags(text) {
  const lower = cleanText(text).toLowerCase();
  const tags = [];

  for (const rule of EVENT_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      tags.push(rule.tag);
    }
  }

  return tags;
}

function summarizeTagBias(tags = []) {
  return tags.reduce((sum, tag) => sum + (TAG_BIAS[tag] || 0), 0);
}

function significantCompanyTokens(name = "") {
  return cleanText(name)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3 && !COMPANY_STOPWORDS.has(token));
}

function mapNewsSymbols(text = "") {
  const normalized = cleanText(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  const hits = [];

  for (const stock of NEWS_SYMBOL_CATALOG) {
    const companyName = cleanText(stock.name || "").toLowerCase();
    const aliasMatches = (stock.aliases || [])
      .map((alias) => cleanText(alias).toLowerCase())
      .filter(Boolean)
      .filter((alias) => alias.includes(" ") || alias.length >= 8)
      .some((alias) => normalized.includes(alias));
    const nameTokens = significantCompanyTokens(stock.name || "");
    const tokenMatches = nameTokens.filter((token) => normalized.includes(token)).length;

    if (
      (companyName && normalized.includes(companyName))
      || aliasMatches
      || tokenMatches >= Math.min(2, nameTokens.length)
    ) {
      hits.push(stock.symbol);
    }
  }

  return [...new Set(hits)];
}

function companyNewsQuery(stock) {
  const name = cleanText(stock?.name || stock?.symbol || "");
  const symbol = cleanText(String(stock?.symbol || "").replace(/[^A-Z0-9]+/gi, " "));
  if (!name) {
    return "";
  }

  const symbolClause = symbol && symbol.length >= 4 ? ` OR "${symbol}"` : "";
  return `"${name}"${symbolClause} stock india when:${COMPANY_NEWS_WINDOW_DAYS}d`;
}

function matchesStockNews(text = "", stock = null) {
  if (!stock) {
    return false;
  }

  const lower = cleanText(text).toLowerCase();
  const companyName = cleanText(stock.name || "").toLowerCase();
  const symbol = String(stock.symbol || "").toLowerCase();
  const tokens = significantCompanyTokens(companyName);
  const canUseRawSymbol = symbol.length >= 4 && tokens.length <= 1;

  if (companyName && lower.includes(companyName)) {
    return true;
  }

  if (canUseRawSymbol && lower.includes(symbol)) {
    return true;
  }

  const matchedTokens = tokens.filter((token) => lower.includes(token));
  return matchedTokens.length >= Math.min(2, tokens.length);
}

function enrichItem(base) {
  return {
    ...base,
    sourceTier: base.sourceTier || sourceTierLabel(base.credibility),
    credibilityLabel: credibilityLabel(base.credibility),
    realTime: (base.ageHours || 999) <= 6,
    companySpecific: Boolean(base.companySpecific),
    publisher: base.publisher || base.source,
  };
}

function buildVerificationKey(item) {
  return normalizeHeadline(item.title)
    .split(" ")
    .filter(Boolean)
    .slice(0, 10)
    .join(" ");
}

function priorityScore(item) {
  return Number((
    item.credibility
    * item.freshnessScore
    * (item.verified ? 1.2 : 1)
    * (item.official ? 1.16 : 1)
    * (item.companySpecific ? 1.12 : 1)
    * (item.realTime ? 1.06 : 1)
    * (item.geopolitical || item.macro ? 1.08 : 1)
  ).toFixed(4));
}

function isRelevantOfficialSignal(sourceName, combined, url, tags = [], mappedSymbols = []) {
  const lower = cleanText(combined).toLowerCase();
  const lowerUrl = String(url || "").toLowerCase();

  if (sourceName === "SEBI Updates") {
    if (
      lower.includes("recovery certificate")
      || lower.includes("completion order")
      || lower.includes("defaulter")
      || lower.includes("release order")
      || lower.includes("adjudication order")
      || lowerUrl.includes("/recovery-proceedings/")
      || lowerUrl.includes("/enforcement/orders/")
    ) {
      return false;
    }
  }

  if (mappedSymbols.length > 0 || tags.some((tag) => MACRO_TAGS.has(tag))) {
    return true;
  }

  return OFFICIAL_SIGNAL_HINTS.some((hint) => lower.includes(hint) || lowerUrl.includes(hint.replace(/\s+/g, "-")));
}

async function fetchSource(source) {
  try {
    const xml = await fetchText(source.url, {
      headers: {
        accept: "application/rss+xml,application/xml,text/xml,text/html,*/*",
      },
    });

    return parseFeed(xml)
      .map((item, index) => {
        const combined = `${item.title} ${item.description}`.trim();
        const tags = classifyTags(combined);
        const sentiment = analyzeSentiment(combined);
        const mappedSymbols = mapNewsSymbols(combined);
        const freshnessScore = getFreshnessScore(item.publishedAt);
        const ageHours = Number(getAgeHours(item.publishedAt).toFixed(1));
        const official = source.tier === "official";
        const macroTagMatch = tags.some((tag) => MACRO_TAGS.has(tag));
        const geopolitical = tags.some((tag) => ["war", "oil_shock", "shipping_risk", "sanctions"].includes(tag));
        const macro = geopolitical || macroTagMatch || (!official && mappedSymbols.length === 0);

        if (official && !isRelevantOfficialSignal(source.name, combined, item.link, tags, mappedSymbols)) {
          return null;
        }

        return {
          id: `${source.name}-${index}-${item.publishedAt}`,
          headline: item.title,
          summary: item.description,
          url: item.link,
          source: source.name,
          publisher: source.name,
          publishedAt: item.publishedAt,
          ageHours,
          freshnessScore,
          symbols: mappedSymbols,
          verificationKey: buildVerificationKey(item),
          sentiment,
          credibility: source.credibility,
          sourceTier: source.tier === "official" ? "official" : sourceTierLabel(source.credibility),
          official,
          geopolitical,
          macro,
          companySpecific: mappedSymbols.length > 0,
          tags,
          tagBias: summarizeTagBias(tags),
        };
      })
      .filter((item) => item && item.ageHours <= MAX_ITEM_AGE_HOURS && item.headline.length > 12)
      .map(enrichItem);
  } catch {
    return [];
  }
}

function dedupeAndVerify(rawItems = [], limit = 180) {
  const verificationMap = new Map();

  for (const item of rawItems) {
    if (!item?.verificationKey) {
      continue;
    }
    if (!verificationMap.has(item.verificationKey)) {
      verificationMap.set(item.verificationKey, new Set());
    }
    verificationMap.get(item.verificationKey).add(item.source);
  }

  const dedupedMap = new Map();
  for (const item of rawItems) {
    const key = `${item.source}:${item.verificationKey}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  }

  return [...dedupedMap.values()]
    .map((item) => enrichItem({
      ...item,
      verified: (verificationMap.get(item.verificationKey)?.size || 0) >= 2,
      verificationCount: verificationMap.get(item.verificationKey)?.size || 1,
    }))
    .sort((left, right) => priorityScore(right) - priorityScore(left))
    .slice(0, limit);
}

async function fetchCompanyNews(stock, forceRefresh = false) {
  const symbol = String(stock?.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return [];
  }

  const cacheKey = `company-news:${symbol}`;
  const cached = newsCache.get(cacheKey);
  if (cached && !forceRefresh) {
    return cached;
  }

  const query = companyNewsQuery(stock);
  if (!query) {
    return [];
  }

  try {
    const xml = await fetchText("https://news.google.com/rss/search", {
      params: {
        q: query,
        hl: "en-IN",
        gl: "IN",
        ceid: "IN:en",
      },
      headers: {
        accept: "application/rss+xml,application/xml,text/xml,text/html,*/*",
      },
      timeoutMs: 4200,
    });

    const items = parseFeed(xml)
      .map((item, index) => {
        const parsed = extractPublisherFromHeadline(item.title);
        const headline = parsed.headline || item.title;
        const publisher = parsed.publisher || "Google News";
        const combined = `${headline} ${item.description}`.trim();

        if (!matchesStockNews(combined, stock)) {
          return null;
        }

        const tags = classifyTags(combined);
        const sentiment = analyzeSentiment(combined);
        const freshnessScore = getFreshnessScore(item.publishedAt);
        const ageHours = Number(getAgeHours(item.publishedAt).toFixed(1));
        const credibility = inferPublisherCredibility(publisher, 0.78);

        return enrichItem({
          id: `google-news-${symbol}-${index}-${item.publishedAt}`,
          headline,
          summary: item.description,
          url: item.link,
          source: publisher,
          publisher,
          publishedAt: item.publishedAt,
          ageHours,
          freshnessScore,
          symbols: [symbol],
          verificationKey: buildVerificationKey({ title: headline }),
          sentiment,
          credibility,
          sourceTier: sourceTierLabel(credibility),
          official: false,
          geopolitical: tags.some((tag) => ["war", "oil_shock", "shipping_risk", "sanctions"].includes(tag)),
          macro: false,
          companySpecific: true,
          tags,
          tagBias: summarizeTagBias(tags),
        });
      })
      .filter((item) => item && item.ageHours <= MAX_ITEM_AGE_HOURS)
      .slice(0, 8);

    return newsCache.set(cacheKey, items);
  } catch {
    return [];
  }
}

function buildEventRadar(items = []) {
  const counts = new Map();

  for (const item of items) {
    for (const tag of item.tags || []) {
      const entry = counts.get(tag) || { tag, count: 0, score: 0, officialCount: 0 };
      entry.count += 1;
      entry.score += item.freshnessScore * item.credibility;
      if (item.official) {
        entry.officialCount += 1;
      }
      counts.set(tag, entry);
    }
  }

  return [...counts.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => ({
      tag: entry.tag,
      count: entry.count,
      officialCount: entry.officialCount,
      score: Number(entry.score.toFixed(2)),
    }));
}

export async function getNewsIntelligence(forceRefresh = false) {
  const cached = newsCache.get("bundle");
  if (cached && !forceRefresh) {
    return cached;
  }

  const rawItems = (await Promise.all(NEWS_SOURCES.map(fetchSource))).flat();
  const items = dedupeAndVerify(rawItems, 180);

  const official = items.filter((item) => item.official && (item.macro || item.geopolitical)).slice(0, 30);
  const geopolitical = items.filter((item) => item.geopolitical).slice(0, 24);
  const macro = items.filter((item) => item.macro).slice(0, 40);

  return newsCache.set("bundle", {
    fetchedAt: new Date().toISOString(),
    items,
    official,
    macro,
    geopolitical,
    eventRadar: buildEventRadar([...macro, ...official, ...geopolitical]),
  });
}

function resolveNewsStocks(symbols = [], stockHints = []) {
  const hintMap = new Map();

  for (const hint of stockHints) {
    const symbol = String(hint?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      continue;
    }
    hintMap.set(symbol, {
      symbol,
      name: hint.name || hint.companyName || symbol,
      sector: hint.sector || "Unknown",
    });
  }

  return symbols
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean)
    .map((symbol) => hintMap.get(symbol) || getStockBySymbol(symbol) || { symbol, name: symbol, sector: "Unknown" });
}

export async function getNewsForSymbols(symbols = [], stockHints = [], options = {}) {
  const bundle = await getNewsIntelligence(Boolean(options.forceRefresh));
  const lookup = new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()));
  const baseItems = bundle.items.filter((item) => item.symbols.some((symbol) => lookup.has(symbol)));

  if (!lookup.size || options.includeTargeted === false) {
    return baseItems;
  }

  const targetedLimit = Math.max(0, Number(options.targetedLimit ?? DEFAULT_TARGETED_SYMBOL_LIMIT));
  const stocks = resolveNewsStocks(symbols, stockHints).slice(0, targetedLimit);
  if (!stocks.length) {
    return baseItems;
  }

  const targetedItems = (await Promise.all(stocks.map((stock) => fetchCompanyNews(stock, Boolean(options.forceRefresh))))).flat();
  return dedupeAndVerify([...baseItems, ...targetedItems], 220)
    .filter((item) => item.symbols.some((symbol) => lookup.has(symbol)));
}

function evidenceGrade(summary = {}) {
  const verified = Number(summary.verifiedCount || 0);
  const official = Number(summary.officialCount || 0);
  const highCred = Number(summary.highCredibilityCount || 0);
  const realTime = Number(summary.realTimeCount || 0);
  const avgCred = Number(summary.avgCredibility || 0);

  if ((official >= 1 && realTime >= 1) || (verified >= 2 && avgCred >= 0.9)) return "A";
  if ((verified >= 1 && highCred >= 2) || (realTime >= 2 && avgCred >= 0.88)) return "B";
  if (summary.newsCount >= 1 && avgCred >= 0.82) return "C";
  return "D";
}

function evidenceNote(summary = {}) {
  if ((summary.newsCount || 0) === 0) {
    return "No company-specific real-time headline cluster was found. Lean more on price, fundamentals, and macro context.";
  }
  if (summary.evidenceGrade === "A") {
    return "Coverage is strong, recent, and backed by high-credibility or official sources.";
  }
  if (summary.evidenceGrade === "B") {
    return "Coverage is usable, with at least some timely or cross-checked reporting, but still needs execution discipline.";
  }
  if (summary.evidenceGrade === "C") {
    return "Coverage exists, but it is light or thinly verified. Treat it as directional, not decisive.";
  }
  return "Coverage is weak or low-confidence. Do not anchor the call on the current news flow alone.";
}

export function summarizeSymbolNews(symbol, items = []) {
  const relevant = items
    .filter((item) => item.symbols.includes(symbol))
    .sort((left, right) => priorityScore(right) - priorityScore(left));

  if (relevant.length === 0) {
    return {
      score: 50,
      verifiedCount: 0,
      officialCount: 0,
      newsCount: 0,
      companySpecificCount: 0,
      highCredibilityCount: 0,
      realTimeCount: 0,
      avgCredibility: 0,
      latestPublishedAt: null,
      evidenceGrade: "D",
      credibilityNote: "No company-specific real-time headline cluster was found. Lean more on price, fundamentals, and macro context.",
      signalBalance: 0,
      freshnessScore: 0,
      dominantTags: [],
      sourceCoverage: [],
      bullishHeadlines: [],
      bearishHeadlines: [],
      headlines: [],
    };
  }

  let score = 50;
  let positiveCount = 0;
  let negativeCount = 0;
  const tagCounts = new Map();
  const sourceCounts = new Map();
  const bullishHeadlines = [];
  const bearishHeadlines = [];
  const avgCredibility = relevant.reduce((sum, item) => sum + Number(item.credibility || 0), 0) / relevant.length;
  const highCredibilityCount = relevant.filter((item) => Number(item.credibility || 0) >= 0.9).length;
  const realTimeCount = relevant.filter((item) => item.realTime).length;
  const companySpecificCount = relevant.filter((item) => item.companySpecific).length;

  for (const item of relevant.slice(0, 8)) {
    const weight =
      item.freshnessScore
      * item.credibility
      * (item.verified ? 1.16 : 0.98)
      * (item.official ? 1.12 : 1);

    score += (item.sentiment.score * 18 + item.tagBias) * weight;

    if (item.sentiment.score > 0.12) {
      positiveCount += 1;
    } else if (item.sentiment.score < -0.12) {
      negativeCount += 1;
    }

    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);

    if (item.sentiment.score > 0.12 && bullishHeadlines.length < 2) {
      bullishHeadlines.push(item);
    }
    if (item.sentiment.score < -0.12 && bearishHeadlines.length < 2) {
      bearishHeadlines.push(item);
    }
  }

  const summary = {
    score: clamp(Number(score.toFixed(1))),
    verifiedCount: relevant.filter((item) => item.verified).length,
    officialCount: relevant.filter((item) => item.official).length,
    newsCount: relevant.length,
    companySpecificCount,
    highCredibilityCount,
    realTimeCount,
    avgCredibility: Number(avgCredibility.toFixed(2)),
    latestPublishedAt: relevant[0]?.publishedAt || null,
    signalBalance: positiveCount - negativeCount,
    freshnessScore: Number((relevant.slice(0, 6).reduce((sum, item) => sum + item.freshnessScore, 0) / Math.min(relevant.length, 6)).toFixed(2)),
    dominantTags: [...tagCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([tag]) => tag),
    sourceCoverage: [...sourceCounts.entries()].sort((left, right) => right[1] - left[1]).map(([source, count]) => ({ source, count })).slice(0, 5),
    bullishHeadlines: bullishHeadlines.map((item) => ({
      headline: item.headline,
      source: item.source,
      publishedAt: item.publishedAt,
      verified: item.verified,
      summary: item.summary,
      url: item.url,
    })),
    bearishHeadlines: bearishHeadlines.map((item) => ({
      headline: item.headline,
      source: item.source,
      publishedAt: item.publishedAt,
      verified: item.verified,
      summary: item.summary,
      url: item.url,
    })),
    headlines: relevant.slice(0, 5),
  };

  summary.evidenceGrade = evidenceGrade(summary);
  summary.credibilityNote = evidenceNote(summary);

  return summary;
}
