const DEFAULT_WATCHLIST = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "HINDUNILVR",
  "SBIN",
  "BHARTIARTL",
  "KOTAKBANK",
  "LT",
  "SUNPHARMA",
  "MARUTI",
];

const RAW_UNIVERSE = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", aliases: ["ril", "reliance industries"] },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "Technology", aliases: ["tata consultancy", "tata consultancy services"] },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Financials", aliases: ["hdfc bank"] },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Financials", aliases: ["icici bank"] },
  { symbol: "INFY", name: "Infosys", sector: "Technology", aliases: ["infosys limited"] },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "Consumer", aliases: ["hul", "hindustan unilever"] },
  { symbol: "SBIN", name: "State Bank of India", sector: "Financials", aliases: ["sbi", "state bank"] },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", aliases: ["airtel", "bharti airtel"] },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Financials", aliases: ["kotak", "kotak bank", "kotak mahindra"] },
  { symbol: "LT", name: "Larsen and Toubro", sector: "Industrials", aliases: ["larsen and toubro", "l and t", "l&t"] },
  { symbol: "WIPRO", name: "Wipro", sector: "Technology", aliases: [] },
  { symbol: "AXISBANK", name: "Axis Bank", sector: "Financials", aliases: ["axis bank"] },
  { symbol: "DMART", name: "Avenue Supermarts", sector: "Consumer", aliases: ["avenue supermarts", "d mart", "dmart"] },
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Materials", aliases: ["asian paints"] },
  { symbol: "MARUTI", name: "Maruti Suzuki India", sector: "Auto", aliases: ["maruti suzuki"] },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries", sector: "Healthcare", aliases: ["sun pharma", "sun pharmaceutical"] },
  { symbol: "APOLLO", name: "Apollo Micro Systems", sector: "Industrials", aliases: ["apollo micro", "apollo micro systems", "apollo microsystems", "apollo microsystem", "apollo micro systems limited"] },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals Enterprise", sector: "Healthcare", aliases: ["apollo hospitals", "apollo hospitals enterprise", "apollo hosp"] },
  { symbol: "APOLLOTYRE", name: "Apollo Tyres", sector: "Auto", aliases: ["apollo tyres", "apollo tyre"] },
  { symbol: "M&M", name: "Mahindra and Mahindra", sector: "Auto", aliases: ["m and m", "m&m", "mahindra", "mahindra and mahindra"] },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "Consumer", aliases: ["nestle", "nestle india"] },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Materials", aliases: ["ultratech", "ultra tech cement"] },
  { symbol: "TITAN", name: "Titan Company", sector: "Consumer", aliases: ["titan company"] },
  { symbol: "GRASIM", name: "Grasim Industries", sector: "Materials", aliases: ["grasim industries"] },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Financials", aliases: ["bajaj finance"] },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv", sector: "Financials", aliases: ["bajaj finserv"] },
  { symbol: "DRREDDY", name: "Dr Reddy's Laboratories", sector: "Healthcare", aliases: ["dr reddy", "dr reddys", "dr reddy's"] },
  { symbol: "CIPLA", name: "Cipla", sector: "Healthcare", aliases: [] },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp", sector: "Auto", aliases: ["hero motocorp", "hero moto corp"] },
  { symbol: "DIVISLAB", name: "Divi's Laboratories", sector: "Healthcare", aliases: ["divis lab", "divis laboratories", "divi's"] },
  { symbol: "COALINDIA", name: "Coal India", sector: "Energy", aliases: ["coal india"] },
  { symbol: "BPCL", name: "Bharat Petroleum Corporation", sector: "Energy", aliases: ["bharat petroleum", "bharat petroleum corporation"] },
  { symbol: "ONGC", name: "Oil and Natural Gas Corporation", sector: "Energy", aliases: ["oil and natural gas corporation"] },
  { symbol: "GAIL", name: "GAIL India", sector: "Energy", aliases: ["gail india"] },
  { symbol: "NTPC", name: "NTPC", sector: "Utilities", aliases: ["ntpc limited"] },
  { symbol: "POWERGRID", name: "Power Grid Corporation of India", sector: "Utilities", aliases: ["power grid", "powergrid"] },
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Materials", aliases: ["tata steel"] },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Materials", aliases: ["jsw steel"] },
  { symbol: "VEDL", name: "Vedanta", sector: "Materials", aliases: [] },
  { symbol: "HINDALCO", name: "Hindalco Industries", sector: "Materials", aliases: ["hindalco industries"] },
  { symbol: "HCLTECH", name: "HCL Technologies", sector: "Technology", aliases: ["hcl tech", "hcl technologies"] },
  { symbol: "TECHM", name: "Tech Mahindra", sector: "Technology", aliases: ["tech mahindra"] },
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Industrials", aliases: ["adani enterprises"] },
  { symbol: "ADANIPORTS", name: "Adani Ports and Special Economic Zone", sector: "Industrials", aliases: ["adani ports", "adani ports sez"] },
  { symbol: "UPL", name: "UPL", sector: "Materials", aliases: ["united phosphorous", "upl limited"] },
  { symbol: "DABUR", name: "Dabur India", sector: "Consumer", aliases: ["dabur"] },
  { symbol: "BRITANNIA", name: "Britannia Industries", sector: "Consumer", aliases: ["britannia"] },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto", aliases: ["eicher motors"] },
  { symbol: "MCDOWELL-N", name: "United Spirits", sector: "Consumer", aliases: ["united spirits", "mcdowell", "mcdowell n"] },
  { symbol: "GODREJCP", name: "Godrej Consumer Products", sector: "Consumer", aliases: ["godrej cp", "godrej consumer"] },
  { symbol: "PGHH", name: "P and G Hygiene and Health Care", sector: "Consumer", aliases: ["procter and gamble hygiene", "pghh"] },
  { symbol: "COLPAL", name: "Colgate-Palmolive India", sector: "Consumer", aliases: ["colgate palmolive", "colpal"] },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", sector: "Financials", aliases: ["hdfc life"] },
  { symbol: "SBILIFE", name: "SBI Life Insurance", sector: "Financials", aliases: ["sbi life"] },
  { symbol: "ICICIGI", name: "ICICI Lombard General Insurance", sector: "Financials", aliases: ["icici lombard", "icici gi"] },
  { symbol: "HDFCAMC", name: "HDFC Asset Management Company", sector: "Financials", aliases: ["hdfc amc"] },
  { symbol: "NAM-INDIA", name: "Nippon Life India Asset Management", sector: "Financials", aliases: ["nam india", "nippon india mutual fund"] },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", sector: "Consumer", aliases: ["tata consumer"] },
  { symbol: "TATAMOTORS", name: "Tata Motors", sector: "Auto", aliases: ["tata motors"] },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", sector: "Financials", aliases: ["indusind bank"] },
  { symbol: "FEDERALBNK", name: "Federal Bank", sector: "Financials", aliases: ["federal bank"] },
  { symbol: "BANKBARODA", name: "Bank of Baroda", sector: "Financials", aliases: ["bank of baroda", "bob"] },
  { symbol: "PNB", name: "Punjab National Bank", sector: "Financials", aliases: ["punjab national bank"] },
  { symbol: "CANBK", name: "Canara Bank", sector: "Financials", aliases: ["canara bank"] },
  { symbol: "RBLBANK", name: "RBL Bank", sector: "Financials", aliases: ["rbl bank"] },
  { symbol: "AUBANK", name: "AU Small Finance Bank", sector: "Financials", aliases: ["au bank", "au small finance bank"] },
  { symbol: "CHOLAFIN", name: "Cholamandalam Investment and Finance", sector: "Financials", aliases: ["cholamandalam finance", "chola fin"] },
  { symbol: "AARTIDRUGS", name: "Aarti Drugs", sector: "Healthcare", aliases: ["aarti drugs"] },
  { symbol: "LUPIN", name: "Lupin", sector: "Healthcare", aliases: [] },
  { symbol: "TORNTPHARM", name: "Torrent Pharmaceuticals", sector: "Healthcare", aliases: ["torrent pharma", "torrent pharmaceuticals"] },
  { symbol: "ALKEM", name: "Alkem Laboratories", sector: "Healthcare", aliases: ["alkem laboratories", "alkem"] },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma", sector: "Healthcare", aliases: ["aurobindo pharma", "auro pharma"] },
  { symbol: "PEL", name: "Piramal Enterprises", sector: "Financials", aliases: ["piramal enterprises"] },
  { symbol: "CROMPTON", name: "Crompton Greaves Consumer Electricals", sector: "Consumer", aliases: ["crompton"] },
  { symbol: "SIEMENS", name: "Siemens India", sector: "Industrials", aliases: ["siemens"] },
  { symbol: "ABB", name: "ABB India", sector: "Industrials", aliases: ["abb india"] },
  { symbol: "SCHNEIDER", name: "Schneider Electric Infrastructure", sector: "Industrials", aliases: ["schneider electric"] },
  { symbol: "THERMAX", name: "Thermax", sector: "Industrials", aliases: [] },
  { symbol: "BHEL", name: "Bharat Heavy Electricals", sector: "Industrials", aliases: ["bharat heavy electricals"] },
  { symbol: "SUZLON", name: "Suzlon Energy", sector: "Utilities", aliases: ["suzlon"] },
];

function normalizeSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function normalizeAlias(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildAliases(stock) {
  const simplifiedName = stock.name
    .replace(/\b(limited|india|industries|corporation|company|group|products|services|technologies|laboratories|laboratory)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return unique([
    normalizeAlias(stock.symbol),
    normalizeAlias(stock.symbol.replace(/[^A-Z0-9]+/g, "")),
    normalizeAlias(stock.name),
    normalizeAlias(simplifiedName),
    ...stock.aliases.map((alias) => normalizeAlias(alias)),
  ]);
}

const UNIVERSE = RAW_UNIVERSE.map((stock) => ({
  symbol: stock.symbol,
  name: stock.name,
  sector: stock.sector,
  exchange: "NSE",
  instrumentKey: "",
  source: "local-universe",
  aliases: buildAliases(stock),
}));

const SYMBOL_INDEX = new Map(UNIVERSE.map((stock) => [normalizeSymbol(stock.symbol), stock]));
const ALIAS_INDEX = new Map();

for (const stock of UNIVERSE) {
  for (const alias of stock.aliases) {
    if (!ALIAS_INDEX.has(alias)) {
      ALIAS_INDEX.set(alias, stock.symbol);
    }
  }
}

function scoreStock(stock, query) {
  if (!query) {
    return 0;
  }

  const symbol = normalizeAlias(stock.symbol);
  const name = normalizeAlias(stock.name);
  let score = 0;

  if (symbol === query) score += 1000;
  if (name === query) score += 900;
  if (stock.aliases.includes(query)) score += 850;

  if (symbol.startsWith(query)) score += 260;
  if (name.startsWith(query)) score += 180;
  if (stock.aliases.some((alias) => alias.startsWith(query))) score += 140;

  if (symbol.includes(query)) score += 90;
  if (name.includes(query)) score += 70;
  if (stock.aliases.some((alias) => alias.includes(query))) score += 55;

  if (query.split(" ").length > 1) {
    const matches = query.split(" ").filter((token) => token && name.includes(token)).length;
    score += matches * 20;
  }

  return score;
}

function textContainsAlias(text, alias) {
  if (!text || !alias) {
    return false;
  }

  if (alias.length <= 2) {
    return text.split(" ").includes(alias);
  }

  return text.includes(alias);
}

export function getUniverse() {
  return UNIVERSE.slice();
}

export function getDefaultWatchlist() {
  return DEFAULT_WATCHLIST.slice();
}

export function getStockBySymbol(symbol = "") {
  return SYMBOL_INDEX.get(normalizeSymbol(symbol)) || null;
}

export function getStockByAlias(alias = "") {
  const direct = getStockBySymbol(alias);
  if (direct) {
    return direct;
  }

  const normalized = normalizeAlias(alias);
  const symbol = ALIAS_INDEX.get(normalized);
  return symbol ? SYMBOL_INDEX.get(symbol) || null : null;
}

export function searchUniverse(query = "", limit = 20) {
  const normalized = normalizeAlias(query);
  if (!normalized) {
    return UNIVERSE.slice(0, limit);
  }

  return UNIVERSE
    .map((stock) => ({ stock, score: scoreStock(stock, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.stock.symbol.localeCompare(right.stock.symbol))
    .slice(0, limit)
    .map((entry) => entry.stock);
}

export function mapTextToSymbols(text = "") {
  const normalized = normalizeAlias(text);
  if (!normalized) {
    return [];
  }

  const hits = [];
  for (const stock of UNIVERSE) {
    if (textContainsAlias(normalized, normalizeAlias(stock.symbol))) {
      hits.push(stock.symbol);
      continue;
    }
    if (stock.aliases.some((alias) => textContainsAlias(normalized, alias))) {
      hits.push(stock.symbol);
    }
  }

  return unique(hits);
}
