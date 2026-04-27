import { useEffect, useRef, useState } from "react";
import TopSignalsTab from "./TopSignalsTab.jsx";
import "./styles.css";

const RECENT_ASKS_KEY = "superbrain_recent_asks_v5";
const DEFAULT_WATCHLIST = "RELIANCE,TCS,HDFCBANK,ICICIBANK,INFY,SUNPHARMA,LT,BHARTIARTL";
const DEFAULT_QUERY = "Analyze RELIANCE across all strategies with full evidence";
const DEFAULT_QUICK = ["RELIANCE", "TCS", "HDFCBANK", "APOLLO", "APOLLOHOSP", "INFY", "SUNPHARMA", "LT", "BHARTIARTL", "ICICIBANK", "WIPRO", "AXISBANK"];

function fmt(value, suffix = "", digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function timeAgo(value) {
  if (!value) {
    return "--";
  }
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function fmtTag(value = "") {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function fmtVerdict(value = "") {
  return String(value || "").replaceAll("_", " ");
}

function fmtSource(value = "") {
  return String(value || "--").replaceAll("_", " ");
}

function fmtStrategy(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "position") return "Short Term";
  if (normalized === "longterm") return "Long Term";
  if (normalized === "intraday") return "Intraday";
  if (normalized === "swing") return "Swing";
  return fmtTag(value || "--");
}

function fmtAnalysisTimeframe(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "--";
  if (normalized === "daily" || normalized === "1d") return "Daily";
  if (normalized === "weekly" || normalized === "1w") return "Weekly";
  if (normalized === "monthly" || normalized === "1mo") return "Monthly";
  if (normalized === "intraday" || normalized === "1m" || normalized === "5m" || normalized === "15m" || normalized === "1h") return "Intraday";
  return fmtTag(value);
}

// Format an ISO timestamp as HH:MM:SS IST (UTC+5:30).
function fmtAsOf(isoStr) {
  if (!isoStr) return "--";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "--";
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const hh = String(ist.getUTCHours()).padStart(2, "0");
    const mm = String(ist.getUTCMinutes()).padStart(2, "0");
    const ss = String(ist.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss} IST`;
  } catch {
    return "--";
  }
}

function candlestickQualityColor(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ultra") return "cyan";
  if (normalized === "high" || normalized === "strong") return "green";
  if (normalized === "moderate") return "amber";
  return "red";
}

function candlestickPatternLabel(candlestick = {}) {
  const timeframe = fmtAnalysisTimeframe(candlestick?.analysisTimeframes?.pattern || candlestick?.timeframe || "daily");
  const pattern = candlestick?.detectedPattern || "No high-quality pattern";
  return `${timeframe}: ${pattern}`;
}

function getFundamentalsAvailability(focus) {
  if (!focus) {
    return {
      label: "--",
      detail: "--",
      discipline: "Fundamentals: --",
    };
  }

  const fundamentals = focus?.fundamentals || {};
  const source = focus?.verification?.fundamentalsSource || fundamentals.source;

  if (source && source !== "UNAVAILABLE") {
    const label = fmtSource(source);
    return {
      label,
      detail: fundamentals.symbol || "--",
      discipline: `Fundamentals: ${label}`,
    };
  }

  const reason = fundamentals.reason || "Screener public source is unreachable right now.";
  return {
    label: "Source issue",
    detail: reason,
    discipline: `Fundamentals: Source issue (${reason})`,
  };
}

function getCandlestickAnalysisStatus(focus) {
  const status = focus?.candlestickStatus || focus?.decisionEngine?.candlestickStatus;
  if (status === "ACTIVE" || status === "INACTIVE") {
    return status;
  }

  const raw = focus?.technicalSnapshot?.candlestick || {};
  const summary = String(raw.summary || focus?.candlestickAnalysis?.summary || "");
  const insufficientHistory = /not enough candle history/i.test(summary);
  const trend = String(raw.context?.trend || focus?.candlestickAnalysis?.context?.trend || "").toUpperCase();
  const location = String(raw.context?.location || focus?.candlestickAnalysis?.context?.location || "").toUpperCase();
  const hasEvaluatedContext = Boolean(raw.detectedPattern || focus?.candlestickAnalysis?.detectedPattern)
    && trend !== "UNKNOWN"
    && location !== "UNKNOWN";

  return !insufficientHistory && hasEvaluatedContext ? "ACTIVE" : "INACTIVE";
}

function verdictColor(value = "") {
  if (value.includes("BUY")) {
    return "green";
  }
  if (value.includes("SELL")) {
    return "red";
  }
  return "amber";
}

function tradeDecisionColor(value = "") {
  if (value === "BUY") return "green";
  if (value === "SELL") return "red";
  return "amber";
}

function safeUrl(value = "") {
  try {
    const url = new URL(value, location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return "#";
  }
  return "#";
}

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_ASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(items) {
  try {
    localStorage.setItem(RECENT_ASKS_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    // Ignore localStorage failures.
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Ignore JSON parsing errors.
    }
    throw new Error(message);
  }
  return response.json();
}

function credibilityInsight(focus) {
  const verification = focus?.verification || {};
  const newsSummary = focus?.newsSummary || {};
  const verified = Number(verification.verifiedHeadlineCount || newsSummary.verifiedCount || 0);
  const official = Number(verification.officialHeadlineCount || newsSummary.officialCount || 0);
  const headlines = Number(verification.headlineCount || newsSummary.newsCount || 0);
  const realTime = Number(verification.realTimeHeadlineCount || newsSummary.realTimeCount || 0);
  const grade = verification.evidenceGrade || newsSummary.evidenceGrade || "";
  const note = focus?.evidence?.note || newsSummary.credibilityNote;

  if (grade === "A" || grade === "B") {
    return note || `Evidence grade ${grade} with ${realTime} real-time headline${realTime === 1 ? "" : "s"} in scope.`;
  }

  if (official > 0) {
    return `${official} official source${official === 1 ? "" : "s"} support this view.`;
  }
  if (verified >= 2) {
    return `${verified} headlines are cross-verified, which improves confidence in the narrative.`;
  }
  if (headlines > 0) {
    return "Relevant headlines exist, but they are mostly single-source, so treat them as directional rather than final proof.";
  }
  return note || "No fresh company-specific headline cluster was found, so conviction leans more on price, fundamentals, and macro context.";
}

function sourceDiscipline(focus) {
  const verification = focus?.verification || {};
  const newsSummary = focus?.newsSummary || {};
  const fundamentalsInfo = getFundamentalsAvailability(focus);
  return [
    `Price feed: ${fmtSource(verification.marketSource || focus?.quote?.source)}`,
    fundamentalsInfo.discipline,
    `Evidence grade: ${verification.evidenceGrade || newsSummary.evidenceGrade || "--"}`,
    `Real-time headlines: ${Number(verification.realTimeHeadlineCount || newsSummary.realTimeCount || 0)}`,
    `High-credibility sources: ${Number(verification.highCredibilityCount || newsSummary.highCredibilityCount || 0)}`,
    `Verified headlines: ${Number(verification.verifiedHeadlineCount || newsSummary.verifiedCount || 0)}`,
    `Official disclosures: ${Number(verification.officialHeadlineCount || newsSummary.officialCount || 0)}`,
  ];
}

function marketPlaybook(score) {
  if (score <= -1) {
    return [
      "Reduce position size and demand cleaner setups before acting.",
      "Prefer names with stronger balance-sheet support and smaller drawdowns.",
      "Treat unverified headlines as context only, not execution triggers.",
    ];
  }

  if (score >= 1) {
    return [
      "Momentum conditions are friendlier, but the stock still needs its own catalyst.",
      "Favor leaders with rising relative strength and clean risk controls.",
      "Use breadth and verification to avoid chasing crowded moves.",
    ];
  }

  return [
    "The market is mixed, so weight conviction toward stock-specific evidence.",
    "Prefer setups with balanced technical, fundamental, and news support.",
    "Use macro tags as guardrails rather than as standalone trade triggers.",
  ];
}

function Kicker({ children }) {
  return <span className="kicker">{children}</span>;
}

function Badge({ children, color = "default" }) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}

function Pill({ children, color = "default" }) {
  return <span className={`pill pill-${color}`}>{children}</span>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function ScoreBar({ value = 0, color = "green" }) {
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-track">
        <div
          className={`score-bar-fill score-fill-${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span>{fmt(value, "", 0)}</span>
    </div>
  );
}

function StatBox({ label, value, sub, color }) {
  return (
    <div className="stat-box">
      <span className="stat-label">{label}</span>
      <strong className={`stat-value ${color || ""}`}>{value}</strong>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

function ConnectionBanner({ info, quickConnect }) {
  if (!info) {
    return null;
  }

  const connected = Boolean(info.connected);
  return (
    <div className={`conn-banner ${connected ? "conn-live" : "conn-off"}`}>
      <div className="conn-dot" />
      <div className="conn-copy">
        <strong>{connected ? "Upstox connected" : "Public market data"}</strong>
        <span>{connected ? info.userInfo?.userName || "Live session active" : quickConnect?.message || info.message || "Connect Upstox for live feeds"}</span>
      </div>
      {!connected ? (
        <a href={quickConnect?.action?.url || quickConnect?.connectUrl || "/upstox/connect"} className="conn-btn">
          Connect
        </a>
      ) : (
        <span className="conn-source">Live</span>
      )}
    </div>
  );
}

// Phase 1.7 — snapshot freshness banner.
// Shows when data was captured, the short snapshot ID, and a ⟳ Refresh button.
function AsOfBanner({ asOf, snapshotId, onRefresh, loading }) {
  if (!asOf) return null;
  return (
    <div className="aof-banner" aria-label="Data freshness">
      <span className="aof-time">Data as of {fmtAsOf(asOf)}</span>
      {snapshotId
        ? <span className="aof-snap">· Snapshot {String(snapshotId).slice(-7)}</span>
        : null}
      <button
        type="button"
        className="aof-refresh"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh data"
      >
        {loading ? "…" : "⟳ Refresh"}
      </button>
    </div>
  );
}

function SearchBar({ onSubmitRef, loading, recentAsks = [] }) {
  const [text, setText] = useState(DEFAULT_QUERY);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [mode, setMode] = useState("smart"); // smart | symbol | strategy | compare
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  SearchBar._setTextRef = setText;

  const SLASH_COMMANDS = [
    { cmd: "/intraday", desc: "Today's top intraday setups", query: "Show me the best intraday trades right now with high conviction" },
    { cmd: "/swing", desc: "Swing trade opportunities", query: "Best swing trading setups for 5-10 day horizon" },
    { cmd: "/longterm", desc: "Long-term compounders", query: "Identify Coffee Can candidates with wide moat" },
    { cmd: "/contrarian", desc: "Oversold quality stocks", query: "Oversold quality stocks with strong fundamentals for contrarian buy" },
    { cmd: "/breakout", desc: "Stocks near breakout", query: "Stocks near technical breakout with volume confirmation" },
    { cmd: "/divergence", desc: "RSI divergence signals", query: "Stocks showing RSI bullish divergence on daily chart" },
    { cmd: "/options", desc: "High IV options plays", query: "NIFTY and BANKNIFTY options analysis with PCR and max pain" },
  ];

  useEffect(() => {
    const handleMouseDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
        setHighlightIdx(-1);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      clearTimeout(timerRef.current);
    };
  }, []);

  const isSlashMode = text.startsWith("/");

  const activeSuggestions = isSlashMode
    ? SLASH_COMMANDS.filter(c => c.cmd.includes(text.toLowerCase())).map(c => ({
        symbol: c.cmd, companyName: c.desc, sector: "Quick command", _isSlash: true, query: c.query
      }))
    : suggestions;

  async function performSearch(query) {
    const trimmed = String(query || "").trim();
    if (!trimmed || trimmed.startsWith("/")) {
      setSuggestions([]);
      return;
    }
    const semanticEndpoint = `/api/search/semantic?q=${encodeURIComponent(trimmed)}&limit=8`;
    const directEndpoint = `/api/universe?q=${encodeURIComponent(trimmed)}&limit=8`;
    const fuzzyEndpoint = `/api/search/fuzzy?q=${encodeURIComponent(trimmed)}&limit=8&tolerance=2`;

    try {
      const useSemanticFirst = /\s/.test(trimmed) || trimmed.length > 4;
      const primary = await apiFetch(useSemanticFirst ? semanticEndpoint : directEndpoint);
      let items = primary.items || [];
      if (!items.length && useSemanticFirst) {
        const fallback = await apiFetch(directEndpoint);
        items = fallback.items || [];
      }
      if (!items.length && trimmed.length >= 3) {
        const fuzzy = await apiFetch(fuzzyEndpoint);
        items = fuzzy.items || [];
      }
      setSuggestions(items);
      setOpen(true);
      setHighlightIdx(items.length ? 0 : -1);
    } catch {
      setSuggestions([]);
      setOpen(true);
    }
  }

  function handleChange(value) {
    setText(value);
    clearTimeout(timerRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      setOpen(false);
      setHighlightIdx(-1);
      return;
    }
    setOpen(true);
    if (value.startsWith("/")) {
      setHighlightIdx(0);
      return;
    }
    timerRef.current = setTimeout(() => performSearch(value), 180);
  }

  function submitQuery(nextQuery) {
    const query = String(nextQuery ?? text).trim();
    if (!query) return;
    setOpen(false);
    setSuggestions([]);
    setHighlightIdx(-1);
    onSubmitRef.current(query);
  }

  function pickSuggestion(item) {
    if (item._isSlash) {
      setText(item.query);
      setOpen(false);
      onSubmitRef.current(item.query);
      return;
    }
    const query = `Analyze ${item.symbol}${item.companyName ? ` (${item.companyName})` : ""} across all strategies with full evidence`;
    setText(query);
    setOpen(false);
    setSuggestions([]);
    onSubmitRef.current(query, item.symbol, item.companyName);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && activeSuggestions[highlightIdx]) {
        pickSuggestion(activeSuggestions[highlightIdx]);
      } else {
        submitQuery();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx(i => Math.min(i + 1, activeSuggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, -1));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
      return;
    }
    if (e.key === "Tab" && activeSuggestions[0]) {
      e.preventDefault();
      pickSuggestion(activeSuggestions[0]);
    }
  }

  function clearSearch() {
    setText("");
    setSuggestions([]);
    setOpen(false);
    setHighlightIdx(-1);
    inputRef.current?.focus();
  }

  return (
    <div className="search-wrap search-wrap-pro" ref={wrapRef}>
      <div className="search-box search-box-pro">
        <div className="search-mode-chips">
          {["smart", "symbol", "compare"].map(m => (
            <button
              key={m}
              type="button"
              className={`search-mode-chip ${mode === m ? "active" : ""}`}
              onClick={() => setMode(m)}
              title={m === "smart" ? "Natural language AI search" : m === "symbol" ? "Direct symbol lookup" : "Compare two stocks"}
            >
              {m === "smart" ? "AI" : m === "symbol" ? "#" : "⇄"}
            </button>
          ))}
        </div>
        <div className="search-input-wrap">
          <input
            id="query-input"
            ref={inputRef}
            className="search-input search-input-pro"
            value={text}
            placeholder={mode === "compare" ? "Compare TCS vs INFY across all strategies" : mode === "symbol" ? "Type a symbol: RELIANCE, TCS, HDFCBANK..." : "Ask anything — type / for quick commands"}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => { if (text.trim()) setOpen(true); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck="false"
          />
          {text && !loading ? (
            <button type="button" className="search-clear" onClick={clearSearch} title="Clear">✕</button>
          ) : null}
          <kbd className="search-kbd-hint">↵</kbd>
        </div>
        <button className="search-btn search-btn-pro" type="button" onClick={() => submitQuery()} disabled={loading}>
          {loading ? <span className="spinner" /> : <><span className="search-btn-label">Analyze</span><span className="search-btn-arrow">→</span></>}
        </button>
      </div>

      {!open && !isSlashMode && recentAsks.length ? (
        <div className="search-quick-chips">
          <span className="search-quick-label">Quick start:</span>
          {SLASH_COMMANDS.slice(0, 5).map(c => (
            <button
              key={c.cmd}
              type="button"
              className="search-quick-chip"
              onClick={() => { setText(c.query); submitQuery(c.query); }}
            >
              {c.cmd}
            </button>
          ))}
        </div>
      ) : null}

      {open && (text.trim() || isSlashMode) ? (
        <div className="search-dropdown search-dropdown-pro">
          <div className="search-results-header">
            <span className="search-results-count">
              {isSlashMode
                ? `${activeSuggestions.length} quick command${activeSuggestions.length === 1 ? "" : "s"}`
                : activeSuggestions.length
                  ? `${activeSuggestions.length} symbol match${activeSuggestions.length === 1 ? "" : "es"}`
                  : "Press Enter to analyze the full question"}
            </span>
            <div className="search-results-hints">
              <kbd>↑↓</kbd><span>navigate</span>
              <kbd>↵</kbd><span>select</span>
              <kbd>Esc</kbd><span>close</span>
            </div>
          </div>
          {activeSuggestions.length ? (
            activeSuggestions.map((item, idx) => (
              <button
                key={item.symbol}
                className={`search-suggestion ${idx === highlightIdx ? "search-suggestion-active" : ""}`}
                type="button"
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(event) => { event.preventDefault(); pickSuggestion(item); }}
              >
                {item._isSlash ? <span className="search-slash-icon">⌘</span> : null}
                <strong>{item.symbol}</strong>
                <span className="search-suggestion-name">{item.companyName || item.name}</span>
                <Badge color={item._isSlash ? "amber" : undefined}>{item.sector || "--"}</Badge>
              </button>
            ))
          ) : (
            <div className="search-empty-state">
              <div className="search-empty-icon">?</div>
              <p>No symbol matched. Press <kbd>Enter</kbd> to let Superbrain interpret this question.</p>
              <button className="btn-secondary" type="button" onClick={() => submitQuery()}>Analyze this question</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConsensusBanner({ consensus, selection }) {
  if (!consensus) {
    return null;
  }

  return (
    <div className="consensus-banner">
      <div>
        <Kicker>Cross-Strategy Read</Kicker>
        <div className="consensus-title">{consensus.alignment}</div>
        <p className="muted">{consensus.summary}</p>
      </div>
      <div className="consensus-metrics">
        <div className="consensus-chip">
          <span>Bullish</span>
          <strong>{consensus.bullishCount}</strong>
        </div>
        <div className="consensus-chip">
          <span>Neutral</span>
          <strong>{consensus.neutralCount}</strong>
        </div>
        <div className="consensus-chip">
          <span>Bearish</span>
          <strong>{consensus.bearishCount}</strong>
        </div>
        <div className="consensus-chip consensus-chip-focus">
          <span>{selection?.mode === "explicit" ? "Requested Focus" : "Lead View"}</span>
          <strong>{selection?.primaryLabel || "--"}</strong>
        </div>
      </div>
    </div>
  );
}

function StrategyEvidenceCard({ item, selection }) {
  const itemColor = verdictColor(item.verdict || "");
  const supportive = (item.evidenceFor || []).length ? item.evidenceFor : (item.catalysts || []);
  const caution = (item.evidenceAgainst || []).length ? item.evidenceAgainst : (item.risks || []);
  const topDrivers = item.topDrivers || [];
  const sourceCoverage = item.verification?.sourceCoverage || [];

  return (
    <div className={`timeframe-card timeframe-${itemColor}`}>
      <div className="timeframe-top">
        <strong>{item.label || fmtStrategy(item.strategy)}</strong>
        {item.isPrimary ? (
          <Badge color="cyan">{selection?.mode === "explicit" ? "Requested focus" : "Lead view"}</Badge>
        ) : null}
      </div>

      <div className={`timeframe-verdict verdict-${itemColor}`}>{fmtVerdict(item.verdict || "HOLD")}</div>
      <p className="timeframe-summary">{item.recommendationSummary || item.thesis || "No strategy-specific summary is available yet."}</p>

      <div className="timeframe-badges">
        <Badge color={item.verification?.evidenceGrade === "A" || item.verification?.evidenceGrade === "B" ? "green" : "amber"}>
          Evidence {item.verification?.evidenceGrade || "--"}
        </Badge>
        <Badge>{item.verification?.verifiedHeadlineCount || 0} verified</Badge>
        <Badge>{item.verification?.headlineCount || 0} headlines</Badge>
        {item.dataCoverage?.coverageScore != null ? <Badge>Coverage {fmt(item.dataCoverage.coverageScore, "%", 0)}</Badge> : null}
      </div>

      <div className="timeframe-meta">
        <span>Confidence {fmt(item.confidence, "%", 0)}</span>
        <span>Score {fmt(item.adjustedScore, "", 1)}</span>
        <span>Action {fmtVerdict(item.tradeDecision?.action || "NO_TRADE")}</span>
        <span>Target {fmt(item.targets?.targetPrice)}</span>
        <span>Stop {fmt(item.targets?.stopLoss)}</span>
        <span>{fmtSource(item.verification?.marketSource)}</span>
      </div>

      <div className="timeframe-columns">
        <div className="timeframe-list-block">
          <span>Evidence for</span>
          <ul className="signal-list">
            {supportive.length ? supportive.slice(0, 3).map((entry) => <li key={entry}>{entry}</li>) : <li>No strong supportive cluster is active.</li>}
          </ul>
        </div>
        <div className="timeframe-list-block">
          <span>Watch-outs</span>
          <ul className="signal-list">
            {caution.length ? caution.slice(0, 3).map((entry) => <li key={entry}>{entry}</li>) : <li>No material counter-signal is active.</li>}
          </ul>
        </div>
      </div>

      {topDrivers.length ? (
        <div className="timeframe-driver-strip">
          {topDrivers.slice(0, 2).map((driver) => (
            <div key={driver.key || driver.title} className="timeframe-driver-chip">
              <strong>{driver.title}</strong>
              <p>{driver.signal}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="timeframe-foot">
        <span>{item.tradeDecision?.status || "WAIT - CONDITIONS NOT MET"}</span>
        <span>{candlestickPatternLabel(item.candlestick)}</span>
        {sourceCoverage[0] ? <span>{sourceCoverage[0].source} x{sourceCoverage[0].count}</span> : null}
      </div>
    </div>
  );
}

function SearchVisualPanel({ dashboard, focus }) {
  const regime = dashboard?.marketContext?.regime || "SYNCING";
  const evidenceGrade = focus?.verification?.evidenceGrade || "--";
  const coverage = dashboard?.summary?.totalCovered || 0;
  const focusSymbol = focus?.symbol || "SUPERBRAIN";
  const conviction = focus?.recommendation?.conviction || "Institutional scan online";
  const tiles = [
    { label: "Focus", value: focusSymbol, tone: "cyan" },
    { label: "Regime", value: regime, tone: dashboard?.marketContext?.riskOnScore >= 0 ? "green" : "red" },
    { label: "Evidence", value: evidenceGrade, tone: evidenceGrade === "A" || evidenceGrade === "B" ? "green" : "amber" },
    { label: "Coverage", value: coverage ? `${coverage} names` : "Syncing", tone: "amber" },
  ];

  return (
    <div className="search-visual-panel">
      <div className="search-visual-ring search-ring-outer" />
      <div className="search-visual-ring search-ring-mid" />
      <div className="search-visual-ring search-ring-inner" />
      <div className="search-visual-grid" />

      <div className="search-visual-core">
        <span className="search-visual-label">AI Core</span>
        <strong>{focusSymbol}</strong>
        <small>{conviction}</small>
      </div>

      <div className="search-visual-wave" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} />
        ))}
      </div>

      <div className="search-visual-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={`search-visual-tile search-tile-${tile.tone}`}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketGraphic({ dashboard, focus }) {
  const benchmarks = (dashboard?.marketContext?.benchmarks || []).slice(0, 5);
  const fallback = [
    { label: "Nifty 50", changePct: 0.8 },
    { label: "Sensex", changePct: 0.4 },
    { label: "USDINR", changePct: -0.3 },
    { label: "Brent", changePct: 1.1 },
    { label: "Gold", changePct: -0.4 },
  ];
  const rawSeries = benchmarks.length ? benchmarks : fallback;
  const maxAbs = Math.max(0.01, ...rawSeries.map((item) => Math.abs(Number(item.changePct || 0))));
  const regime = dashboard?.marketContext?.regime || "Loading";
  const riskOn = dashboard?.marketContext?.riskOnScore;
  const regimeColor = riskOn >= 0 ? "green" : "red";

  return (
    <div className="hero-card hero-card-chart">
      <div className="hero-card-head">
        <div>
          <Kicker>Market Pulse</Kicker>
          <h3 style={{marginTop:"2px"}}>Benchmarks &amp; Regime</h3>
        </div>
        <div className={`mg-regime-badge mg-regime-${regimeColor}`}>{regime}</div>
      </div>
      <div className="mg-bench-list">
        {rawSeries.map((item) => {
          const val = Number(item.changePct || 0);
          const pct = Math.abs(val) / maxAbs * 100;
          const pos = val >= 0;
          return (
            <div key={item.label} className="mg-bench-row">
              <span className="mg-bench-label">{item.label}</span>
              <div className="mg-bench-bar-wrap">
                <div className={`mg-bench-bar ${pos ? "mg-bench-bar-pos" : "mg-bench-bar-neg"}`} style={{width:`${Math.max(4, pct)}%`}} />
              </div>
              <span className={`mg-bench-val ${pos ? "mg-bench-pos" : "mg-bench-neg"}`}>{pos ? "+" : ""}{val.toFixed(2)}%</span>
            </div>
          );
        })}
      </div>
      <div className="mg-footer">
        <div className="mg-focus-row">
          <span className="mg-focus-sym">{focus?.symbol || dashboard?.focus?.symbol || "—"}</span>
          {focus?.verdict && <div className={`do-verdict-pill do-verdict-${verdictColor(focus.verdict)}`} style={{fontSize:"10px",padding:"2px 8px"}}>{fmtVerdict(focus.verdict)}</div>}
          <span className="mg-cov">{dashboard?.summary?.totalCovered || 0} covered</span>
        </div>
      </div>
    </div>
  );
}

function ResearchQualityCard({ focus, dashboard }) {
  const verification = focus?.verification || {};
  const newsSummary = focus?.newsSummary || {};
  const fundamentalsInfo = getFundamentalsAvailability(focus);
  const verified = (verification.verifiedHeadlineCount ?? newsSummary.verifiedCount ?? 0);
  const headlines = (verification.headlineCount ?? newsSummary.newsCount ?? 0);
  const official = (verification.officialHeadlineCount ?? newsSummary.officialCount ?? 0);
  const sources = newsSummary.sourceCoverage?.length || 0;
  const trustColor = verified > 0 || official > 0 ? "green" : "amber";

  return (
    <div className="rq-strip">
      <div className="rq-label">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{flexShrink:0}}>
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6.5 4v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="6.5" cy="9.5" r="0.6" fill="currentColor"/>
        </svg>
        Research Quality
      </div>
      <div className="rq-items">
        <div className="rq-item">
          <span className="rq-val">{fmtSource(verification.marketSource || focus?.quote?.source)}</span>
          <span className="rq-sub">feed {focus?.quote?.asOf ? timeAgo(focus.quote.asOf) : "--"}</span>
        </div>
        <div className="rq-divider" />
        <div className="rq-item">
          <span className="rq-val">{fundamentalsInfo.label}</span>
          <span className="rq-sub">{fundamentalsInfo.detail}</span>
        </div>
        <div className="rq-divider" />
        <div className="rq-item">
          <span className="rq-val">{headlines}</span>
          <span className="rq-sub">{verified} verified</span>
        </div>
        <div className="rq-divider" />
        <div className="rq-item">
          <span className="rq-val">{official}</span>
          <span className="rq-sub">{sources} sources</span>
        </div>
      </div>
      <Badge color={trustColor} style={{flexShrink:0}}>{trustColor === "green" ? "✓ Verified" : "Unverified"}</Badge>
    </div>
  );
}

function VerdictCard({ focus, answer, disclaimer, allStrategies = [], strategyConsensus = null, strategySelection = null }) {
  if (!focus) {
    return <Empty text="Ask Superbrain about any Indian stock to see the verdict." />;
  }

  const color = verdictColor(focus.verdict);
  const changePct = Number(focus.quote?.changePct || 0);
  const lastQuoteUpdate = focus.quote?.asOf ? timeAgo(focus.quote.asOf) : "--";
  const tradeDecision = focus.tradeDecision || focus.decisionEngine?.tradeDecision || {};
  const executionPlan = focus.executionPlan || focus.decisionEngine?.executionPlan || {};
  const topDrivers = focus.decisionEngine?.topMarketDrivers || [];
  const candlestick = focus.candlestickAnalysis || focus.decisionEngine?.candlestickAnalysis || {};
  const candlestickStatus = getCandlestickAnalysisStatus(focus);
  const strategyCards = Array.isArray(allStrategies) && allStrategies.length
    ? allStrategies
    : [{
      strategy: focus.strategy,
      label: fmtStrategy(focus.strategy),
      isPrimary: true,
      verdict: focus.verdict,
      confidence: focus.confidence,
      adjustedScore: focus.adjustedScore || focus.score,
      targets: focus.targets,
      tradeDecision: {
        action: tradeDecision.action || "NO_TRADE",
        status: tradeDecision.status || "WAIT - CONDITIONS NOT MET",
        riskReward: tradeDecision.riskReward ?? null,
      },
    }];

  return (
    <div className="verdict-card">
      <div className="verdict-top">
        <div>
          <div className="verdict-symbol-row">
            <span className="verdict-symbol">{focus.symbol}</span>
            <span className="verdict-company">{focus.companyName}</span>
            {focus.sector ? <Pill color={color}>{focus.sector}</Pill> : null}
          </div>
          <div className={`verdict-action verdict-${color}`}>{fmtVerdict(focus.verdict)}</div>
          <p className="verdict-thesis">{answer || focus.recommendation?.summary || focus.thesis}</p>
        </div>
        <div className={`verdict-score-box score-${color}`}>
          <span>Confidence</span>
          <strong>{fmt(focus.confidence, "%", 0)}</strong>
          <span>{focus.recommendation?.conviction || "Measured"}</span>
        </div>
      </div>
      <div className="verdict-stats">
        <StatBox label="Price" value={fmt(focus.quote?.price)} sub={changePct >= 0 ? `+${fmt(changePct, "%")}` : fmt(changePct, "%")} color={changePct >= 0 ? "green" : "red"} />
        <StatBox label="Score" value={fmt(focus.adjustedScore || focus.score, "", 1)} sub={fmtStrategy(focus.strategy)} />
        <StatBox label="Target" value={fmt(focus.targets?.targetPrice)} sub={fmt(focus.targets?.targetPct, "%")} color="green" />
        <StatBox label="Stop" value={fmt(focus.targets?.stopLoss)} sub={focus.eventExposure?.pressure || "Mixed"} color="red" />
        <StatBox label="Risk" value={fmt(focus.scoreBreakdown?.risk, "", 0)} sub="risk score" />
        <StatBox label="Last Quote" value={lastQuoteUpdate} sub={fmtSource(focus.verification?.marketSource || focus.quote?.source)} />
      </div>
      <ConsensusBanner consensus={strategyConsensus} selection={strategySelection} />
      <div className="timeframe-section">
        <div className="timeframe-head">
          <Kicker>All Timeframe Recommendations</Kicker>
          <Badge>Intraday, Swing, Short Term, Long Term</Badge>
        </div>
        <div className="timeframe-grid">
          {strategyCards.map((item) => (
            <StrategyEvidenceCard key={item.strategy || item.label} item={item} selection={strategySelection} />
          ))}
        </div>
      </div>
      <div className="verdict-bars">
        {[
          ["Technical", focus.scoreBreakdown?.technical, "green"],
          ["Fundamentals", focus.scoreBreakdown?.fundamentals, "green"],
          ["News", focus.scoreBreakdown?.news, "amber"],
          ["Macro", focus.scoreBreakdown?.macro, "amber"],
          ["Events", focus.scoreBreakdown?.events, "amber"],
          focus.scoreBreakdown?.options != null ? ["Options OI", focus.scoreBreakdown.options, "green"] : null,
          focus.scoreBreakdown?.india != null ? ["India Signal", 50 + (focus.scoreBreakdown.india || 0), "amber"] : null,
        ].filter(Boolean).map(([label, value, colorKey]) => (
          <div key={label} className="bar-row">
            <span>{label}</span>
            <ScoreBar value={value} color={colorKey} />
          </div>
        ))}
      </div>
      <div className="detail-grid">
        <div className="detail-card">
          <Kicker>Catalysts</Kicker>
          <ul className="signal-list">
            {(focus.catalysts || []).length ? (focus.catalysts || []).slice(0, 4).map((entry) => <li key={entry}>{entry}</li>) : <li>No strong catalyst cluster is active.</li>}
          </ul>
        </div>
        <div className="detail-card">
          <Kicker>Risk Flags</Kicker>
          <ul className="signal-list">
            {(focus.risks || []).length ? (focus.risks || []).slice(0, 4).map((entry) => <li key={entry}>{entry}</li>) : <li>No major risk flags are available.</li>}
          </ul>
        </div>
        <div className="detail-card">
          <Kicker>Trade Decision</Kicker>
          <ul className="signal-list">
            <li>Decision: {fmtVerdict(tradeDecision.action || "NO_TRADE")}</li>
            <li>Status: {tradeDecision.status || "WAIT - CONDITIONS NOT MET"}</li>
            <li>Reward to risk: {tradeDecision.riskReward ? `${tradeDecision.riskReward}:1` : "--"}</li>
            <li>Entry type: {executionPlan.entryType || "Wait"}</li>
            <li>Entry: {fmt(executionPlan.entry)}</li>
            <li>Stop loss: {fmt(executionPlan.stopLoss || focus.recommendation?.stopLoss || focus.targets?.stopLoss)}</li>
          </ul>
        </div>
        <div className="detail-card">
          <Kicker>Candlestick Analysis Status</Kicker>
          <div className={`lt-stance lt-${candlestickStatus === "ACTIVE" ? "green" : "red"}`}>{candlestickStatus}</div>
          <div className="news-tags">
            <Badge color={candlestickQualityColor(candlestick.signalQuality || candlestick.strength)}>{candlestick.signalQuality || candlestick.strength || "Weak"}</Badge>
            <Badge>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.pattern || candlestick.timeframe || "daily")} chart</Badge>
            <Badge>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.trend || "weekly")} filter</Badge>
          </div>
        </div>
        <div className="detail-card">
          <Kicker>Candlestick Context</Kicker>
          <div className="coverage-list">
            <span>Pattern {candlestick.detectedPattern || "No high-quality pattern"}</span>
            <span>Type {candlestick.kind || "--"}</span>
            <span>Pattern chart {fmtAnalysisTimeframe(candlestick.analysisTimeframes?.pattern || candlestick.timeframe || "daily")}</span>
            <span>Trend filter {fmtAnalysisTimeframe(candlestick.analysisTimeframes?.trend || "weekly")}</span>
            <span>Signal quality {candlestick.signalQuality || "--"}</span>
            <span>Quality score {fmt(candlestick.qualityScore, "", 1)}</span>
          </div>
          <ul className="signal-list">
            <li>Trend: {candlestick.context?.trend || "--"}</li>
            <li>Higher-timeframe bias: {candlestick.context?.higherTimeframeTrend || "--"}</li>
            <li>Location: {candlestick.context?.location || "--"}</li>
            <li>Strength: {candlestick.strength || "Weak"}</li>
            <li>Validity: {candlestick.validity || "Ignore"}</li>
          </ul>
          <p className="muted">{candlestick.summary || "Candlestick analysis will appear here when enough daily history is available."}</p>
          <ul className="signal-list">
            <li>Volume confirmation: {candlestick.context?.volumeConfirmation || "--"}</li>
            <li>Market structure: {candlestick.context?.marketStructure || "--"}</li>
            <li>Regime: {candlestick.context?.regime || "--"}</li>
            <li>Trigger: {candlestick.trigger || "Wait for stronger candle confirmation before using it as a trigger."}</li>
            {(candlestick.notes || []).slice(0, 2).map((note) => <li key={note}>{note}</li>)}
            <li>{candlestick.trapText || "No active trap signature is standing out."}</li>
          </ul>
        </div>
        <div className="detail-card">
          <Kicker>Source Discipline</Kicker>
          <ul className="signal-list">{sourceDiscipline(focus).map((entry) => <li key={entry}>{entry}</li>)}</ul>
          <p className="muted">{disclaimer || credibilityInsight(focus)}</p>
        </div>
      </div>
      {topDrivers.length ? (
        <div className="institutional-panel">
          <div className="institutional-head">
            <Kicker>Top 3 Market Drivers</Kicker>
            <Badge color={tradeDecisionColor(tradeDecision.action || "NO_TRADE")}>{tradeDecision.status || "Decision engine active"}</Badge>
          </div>
          <div className="driver-grid">
            {topDrivers.map((driver) => (
              <div key={driver.key || driver.title} className="reason-card driver-card">
                <strong>{driver.title}</strong>
                <div className="news-tags">
                  <Badge color={driver.direction === "bullish" ? "green" : driver.direction === "bearish" ? "red" : "amber"}>{driver.direction}</Badge>
                  <Badge>{driver.impactLevel}</Badge>
                </div>
                <p>{driver.signal}</p>
                <ul className="signal-list">
                  <li>{driver.what}</li>
                  <li>{driver.why}</li>
                  <li>{driver.impact}</li>
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="verdict-tags">
        {focus.longTermView ? <Badge color={verdictColor(focus.longTermView.stance)}>LT: {fmtVerdict(focus.longTermView.stance)}</Badge> : null}
        {focus.peerComparison?.position ? <Badge>{fmtTag(focus.peerComparison.position)}</Badge> : null}
        <Badge>{fmtSource(focus.verification?.marketSource || focus.quote?.source)}</Badge>
      </div>
    </div>
  );
}

function ReasonPanel({ focus, answer, allStrategies = [], strategyConsensus = null, strategySelection = null }) {
  if (!focus) {
    return <Empty text="Ask for a stock to unlock the evidence engine." />;
  }

  const peer = focus.peerComparison;
  const newsSummary = focus.newsSummary || {};
  const sourceCoverage = newsSummary.sourceCoverage || [];
  const decisionEngine = focus.decisionEngine || {};
  const scenarios = decisionEngine.scenarioAnalysis || [];
  const conflicts = decisionEngine.conflicts || [];
  const dataCoverage = decisionEngine.dataCoverage || {};
  const marketWide = decisionEngine.marketWideOpportunities || {};
  const candlestick = focus.candlestickAnalysis || decisionEngine.candlestickAnalysis || {};

  return (
    <div className="reason-grid">
      {allStrategies.length ? (
        <div className="reason-card reason-card-wide">
          <Kicker>Cross-Strategy Evidence Map</Kicker>
          {strategyConsensus ? <p>{strategyConsensus.summary}</p> : null}
          <div className="strategy-evidence-grid">
            {allStrategies.map((item) => (
              <div key={item.strategy} className="strategy-evidence-block">
                <div className="strategy-evidence-top">
                  <strong>{item.label}</strong>
                  <Badge color={verdictColor(item.verdict || "")}>{fmtVerdict(item.verdict || "HOLD")}</Badge>
                  {item.isPrimary ? <Badge color="cyan">{strategySelection?.mode === "explicit" ? "Requested focus" : "Lead view"}</Badge> : null}
                </div>
                <p>{item.recommendationSummary || item.thesis || "No strategy-specific summary is available yet."}</p>
                <div className="coverage-list">
                  <span>Confidence {fmt(item.confidence, "%", 0)}</span>
                  <span>Evidence {item.verification?.evidenceGrade || "--"}</span>
                  <span>{item.verification?.verifiedHeadlineCount || 0} verified</span>
                  <span>Coverage {fmt(item.dataCoverage?.coverageScore, "%", 0)}</span>
                </div>
                <div className="strategy-evidence-columns">
                  <ul className="signal-list">
                    {(((item.evidenceFor || []).length ? item.evidenceFor : item.catalysts || []).length
                      ? ((item.evidenceFor || []).length ? item.evidenceFor : item.catalysts || []).slice(0, 2).map((entry) => <li key={entry}>{entry}</li>)
                      : <li>No strong supportive cluster is active.</li>)}
                  </ul>
                  <ul className="signal-list">
                    {(((item.evidenceAgainst || []).length ? item.evidenceAgainst : item.risks || []).length
                      ? ((item.evidenceAgainst || []).length ? item.evidenceAgainst : item.risks || []).slice(0, 2).map((entry) => <li key={entry}>{entry}</li>)
                      : <li>No material counter-signal is active.</li>)}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="reason-card">
        <Kicker>Top 3 Market Drivers</Kicker>
        <ul className="signal-list">
          {(decisionEngine.topMarketDrivers || []).length ? (
            (decisionEngine.topMarketDrivers || []).map((driver) => (
              <li key={driver.key || driver.title}>
                <strong>{driver.title}:</strong> {driver.signal}
              </li>
            ))
          ) : (
            <li>No ranked market drivers are available yet.</li>
          )}
        </ul>
      </div>
      <div className="reason-card">
        <Kicker>Scenario Analysis</Kicker>
        <div className="scenario-list">
          {scenarios.length ? scenarios.map((scenario) => (
            <div key={scenario.name} className="scenario-item">
              <div className="scenario-top">
                <strong>{scenario.name}</strong>
                <Badge color={scenario.name === "Bullish" ? "green" : scenario.name === "Bearish" ? "red" : "amber"}>{scenario.probability}%</Badge>
              </div>
              <ul className="signal-list">
                {(scenario.case || []).map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </div>
          )) : <p className="muted">Scenario engine is not ready yet.</p>}
        </div>
      </div>
      <div className="reason-card">
        <Kicker>AI Thesis</Kicker>
        <strong>{focus.symbol} - {fmtVerdict(focus.verdict)}</strong>
        <p>{answer || focus.recommendation?.summary || focus.thesis}</p>
      </div>
      <div className="reason-card">
        <Kicker>Evidence For The Case</Kicker>
        <ul className="signal-list">{(focus.buyReasons || []).length ? (focus.buyReasons || []).map((entry) => <li key={entry}>{entry}</li>) : <li>No strong bullish evidence cluster is active.</li>}</ul>
      </div>
      <div className="reason-card">
        <Kicker>Evidence Against The Case</Kicker>
        <ul className="signal-list">{(focus.sellReasons || []).length ? (focus.sellReasons || []).map((entry) => <li key={entry}>{entry}</li>) : <li>No major bearish evidence cluster is active.</li>}</ul>
      </div>
      <div className="reason-card">
        <Kicker>What Would Change The Call</Kicker>
        <ul className="signal-list">{(focus.monitorPoints || []).length ? (focus.monitorPoints || []).map((entry) => <li key={entry}>{entry}</li>) : <li>No explicit invalidation points are available for this setup.</li>}</ul>
      </div>
      <div className="reason-card">
        <Kicker>Candlestick Analysis</Kicker>
        <div className="coverage-list">
          <span>{candlestick.detectedPattern || "No pattern"}</span>
          <span>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.pattern || candlestick.timeframe || "daily")} chart</span>
          <span>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.trend || "weekly")} filter</span>
          <span>{candlestick.kind || "--"}</span>
          <span>{candlestick.context?.trend || "--"}</span>
          <span>{candlestick.context?.location || "--"}</span>
          <span>{candlestick.signalQuality || candlestick.strength || "Weak"}</span>
          <span>{candlestick.validity || "Ignore"}</span>
          <span>Score {fmt(candlestick.qualityScore, "", 1)}</span>
        </div>
        <div className="news-tags">
          <Badge color={candlestickQualityColor(candlestick.signalQuality || candlestick.strength)}>{candlestick.signalQuality || candlestick.strength || "Weak"}</Badge>
          <Badge>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.pattern || candlestick.timeframe || "daily")} pattern</Badge>
          <Badge>{fmtAnalysisTimeframe(candlestick.analysisTimeframes?.trend || "weekly")} confirmation</Badge>
        </div>
        <p>{candlestick.summary || "Candlestick context is not available yet."}</p>
        <ul className="signal-list">
          <li>Higher-timeframe bias: {candlestick.context?.higherTimeframeTrend || "--"}</li>
          <li>Volume confirmation: {candlestick.context?.volumeConfirmation || "--"}</li>
          <li>Market structure: {candlestick.context?.marketStructure || "--"}</li>
          <li>Regime: {candlestick.context?.regime || "--"}</li>
          <li>Trigger: {candlestick.trigger || "Wait for stronger candle confirmation before using it as a trigger."}</li>
          {(candlestick.notes || []).slice(0, 3).map((note) => <li key={note}>{note}</li>)}
          <li>{candlestick.trapText || "No active trap signature is standing out."}</li>
        </ul>
        {(candlestick.candidates || []).length > 1 ? (
          <div className="coverage-list">
            {(candlestick.candidates || []).slice(1, 3).map((entry) => (
              <span key={entry.pattern}>{entry.pattern} ({entry.signalQuality || entry.strength || "Weak"})</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="reason-card">
        <Kicker>Conflict Detection</Kicker>
        <ul className="signal-list">
          {conflicts.length ? conflicts.map((entry) => (
            <li key={entry.title}>
              <strong>{entry.severity}:</strong> {entry.title}. {entry.detail}
            </li>
          )) : <li>No material signal conflicts are active.</li>}
        </ul>
      </div>
      <div className="reason-card">
        <Kicker>Macro And Event Drivers</Kicker>
        <div className="headline-rail">
          {(focus.macroDrivers || []).length ? (
            (focus.macroDrivers || []).slice(0, 4).map((entry) => (
              <a key={`${entry.source}-${entry.headline}`} className="headline-link-card" href={safeUrl(entry.url)} target="_blank" rel="noreferrer">
                <div className="news-meta">
                  <span>{entry.source}</span>
                  <span className="muted">{timeAgo(entry.publishedAt)}</span>
                </div>
                <strong>{entry.headline}</strong>
                <p>{entry.summary}</p>
                <div className="news-tags">
                  <Badge color={entry.impact >= 0 ? "green" : "red"}>{entry.impact >= 0 ? "Positive impact" : "Negative impact"}</Badge>
                  {(entry.tags || []).slice(0, 2).map((tag) => <Badge key={tag}>{fmtTag(tag)}</Badge>)}
                </div>
              </a>
            ))
          ) : (
            <p className="muted">No macro-driver stack is available right now.</p>
          )}
        </div>
      </div>
      <div className="reason-card">
        <Kicker>News Verification</Kicker>
        <div className="coverage-list">
          <span>Grade {newsSummary.evidenceGrade || focus?.verification?.evidenceGrade || "--"}</span>
          <span>{newsSummary.newsCount || 0} headlines in scope</span>
          <span>{newsSummary.realTimeCount || focus?.verification?.realTimeHeadlineCount || 0} real-time</span>
          <span>{newsSummary.verifiedCount || 0} cross-verified</span>
          <span>{newsSummary.officialCount || 0} official</span>
          <span>{sourceCoverage.length || 0} source groups</span>
        </div>
        <p className="muted">{credibilityInsight(focus)}</p>
        <ul className="signal-list">{sourceCoverage.length ? sourceCoverage.map((entry) => <li key={entry.source}>{entry.source}: {entry.count}</li>) : <li>No meaningful source clustering is available yet.</li>}</ul>
      </div>
      <div className="reason-card">
        <Kicker>Data Coverage</Kicker>
        <div className="coverage-list">
          <span>{(dataCoverage.available || []).length} inputs live</span>
          <span>{(dataCoverage.missingCritical || []).length} critical gaps</span>
          <span>{(dataCoverage.missingSupporting || []).length} supporting gaps</span>
          <span>Coverage {fmt(dataCoverage.coverageScore, "%", 0)}</span>
        </div>
        <ul className="signal-list">
          {(dataCoverage.available || []).slice(0, 4).map((entry) => <li key={entry}>{entry}</li>)}
          {(dataCoverage.missingCritical || []).slice(0, 3).map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      </div>
      <div className="reason-card">
        <Kicker>Peer Context</Kicker>
        {peer?.available ? (
          <>
            <strong>{fmtTag(peer.position || "mixed")}</strong>
            <p>{peer.summary}</p>
            <ul className="signal-list">
              {(peer.advantages || []).slice(0, 2).map((entry) => <li key={entry}>{entry}</li>)}
              {(peer.disadvantages || []).slice(0, 3).map((entry) => <li key={entry}>{entry}</li>)}
            </ul>
          </>
        ) : (
          <p className="muted">Peer comparison is not available for this name yet.</p>
        )}
      </div>
      <div className="reason-card">
        <Kicker>Market-Wide Opportunities</Kicker>
        <div className="split-grid">
          <div className="split-card compact">
            <strong>Strongest</strong>
            <ul className="signal-list">
              {(marketWide.strongest || []).length ? (marketWide.strongest || []).map((entry) => <li key={entry.symbol}>{entry.symbol}: {entry.reason}</li>) : <li>No leaders surfaced.</li>}
            </ul>
          </div>
          <div className="split-card compact">
            <strong>Weakest</strong>
            <ul className="signal-list">
              {(marketWide.weakest || []).length ? (marketWide.weakest || []).map((entry) => <li key={entry.symbol}>{entry.symbol}: {entry.reason}</li>) : <li>No laggards surfaced.</li>}
            </ul>
          </div>
        </div>
        <ul className="signal-list">
          {(marketWide.unusualActivity || []).slice(0, 3).map((entry) => <li key={entry.symbol}>{entry.symbol}: {entry.note}</li>)}
        </ul>
      </div>
      <div className="reason-card">
        <Kicker>Self-Critique</Kicker>
        <ul className="signal-list">
          {(decisionEngine.selfCritique?.whatCouldBeWrong || []).length ? (
            (decisionEngine.selfCritique?.whatCouldBeWrong || []).map((entry) => <li key={entry}>{entry}</li>)
          ) : (
            <li>No explicit critique points were generated.</li>
          )}
          {decisionEngine.selfCritique?.highestUncertainty ? <li>Highest uncertainty: {decisionEngine.selfCritique.highestUncertainty}</li> : null}
        </ul>
      </div>
    </div>
  );
}

function LongTermPanel({ focus }) {
  const longTermView = focus?.longTermView;
  const fundamentals = focus?.fundamentals;
  const fundamentalsInfo = getFundamentalsAvailability(focus);
  if (!longTermView) {
    return <Empty text="Long-horizon analysis will appear here after asking about a stock." />;
  }

  const color = longTermView.score >= 70 ? "green" : longTermView.score >= 52 ? "amber" : "red";

  return (
    <div className="lt-wrap">
      <div className="lt-head">
        <div>
          <Kicker>12-24 Month View</Kicker>
          <div className={`lt-stance lt-${color}`}>{longTermView.stance.replaceAll("_", " ")}</div>
        </div>
        <div className={`lt-score score-${color}`}>
          <span>Score</span>
          <strong>{fmt(longTermView.score, "", 1)}</strong>
          <span>{longTermView.horizon}</span>
        </div>
      </div>
      <p className="muted">{longTermView.summary}</p>
      {fundamentals?.source === "UNAVAILABLE" ? (
        <div className="quality-note">
          <strong>Fundamental data source issue</strong>
          <p>{fundamentalsInfo.detail}</p>
        </div>
      ) : null}
      <div className="verdict-stats">
        <StatBox label="P/E" value={fmt(fundamentals?.pe, "", 1)} sub="valuation" />
        <StatBox label="ROE" value={fmt(fundamentals?.roe, "%", 1)} sub="quality" color="green" />
        <StatBox label="ROCE" value={fmt(fundamentals?.roce, "%", 1)} sub="efficiency" color="green" />
        <StatBox label="3Y Sales" value={fmt(fundamentals?.salesGrowth3yr, "%", 0)} sub="growth" />
        <StatBox label="3Y Profit" value={fmt(fundamentals?.profitGrowth3yr, "%", 0)} sub="growth" />
        <StatBox label="Dividend" value={fmt(fundamentals?.dividendYield, "%", 2)} sub="yield" />
      </div>
      <div className="pillar-grid">
        {(longTermView.pillars || []).map((pillar) => (
          <div key={pillar.label} className="pillar-card">
            <span>{pillar.label}</span>
            <ScoreBar value={pillar.value} color={pillar.value >= 65 ? "green" : pillar.value >= 45 ? "amber" : "red"} />
            <p>{pillar.detail}</p>
          </div>
        ))}
      </div>
      <div className="split-grid">
        <div className="split-card">
          <Kicker>Structural Positives</Kicker>
          <ul className="signal-list">{(longTermView.opportunities || []).map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </div>
        <div className="split-card">
          <Kicker>Structural Risks</Kicker>
          <ul className="signal-list">{(longTermView.concerns || []).map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function MarketPanel({ dashboard }) {
  const regime = dashboard?.marketContext?.regime || "--";
  const riskOnScore = Number(dashboard?.marketContext?.riskOnScore || 0);
  const benchmarks = dashboard?.marketContext?.benchmarks || [];
  const events = dashboard?.eventRadar || [];
  const macroSignals = dashboard?.macroSignals || [];
  const playbook = marketPlaybook(riskOnScore);
  const marketWide = dashboard?.marketWideOpportunities || {};
  const sectorLeaders = marketWide?.sectorRotation?.leaders || [];
  const sectorLaggards = marketWide?.sectorRotation?.laggards || [];
  const unusualActivity = marketWide?.unusualActivity || [];

  return (
    <div className="market-wrap">
      <div className="market-snapshot-grid">
        <div className="stat-box">
          <span className="stat-label">Regime</span>
          <strong className={regime.includes("BULL") ? "green" : regime.includes("BEAR") || regime.includes("RISK_OFF") ? "red" : "amber"}>{regime}</strong>
          <span className="stat-sub">background condition</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Risk Score</span>
          <strong>{fmt(riskOnScore, "", 2)}</strong>
          <span className="stat-sub">market appetite</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Coverage</span>
          <strong>{dashboard?.summary?.totalCovered || 0}</strong>
          <span className="stat-sub">names reviewed</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Average Confidence</span>
          <strong>{fmt(dashboard?.summary?.avgConfidence, "%", 0)}</strong>
          <span className="stat-sub">across dashboard</span>
        </div>
      </div>
      <div className="bench-grid">
        {benchmarks.map((item) => (
          <div key={item.label} className="bench-card">
            <span>{item.label}</span>
            <strong>{fmt(item.price)}</strong>
            <span className={item.changePct >= 0 ? "green" : "red"}>
              {item.changePct >= 0 ? "+" : ""}
              {fmt(item.changePct, "%")}
            </span>
          </div>
        ))}
      </div>
      <div className="split-grid">
        <div className="split-card">
          <Kicker>Market Playbook</Kicker>
          <ul className="signal-list">{playbook.map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </div>
        <div className="split-card">
          <Kicker>Event Radar</Kicker>
          <div className="event-list event-list-compact">
            {events.slice(0, 6).map((item) => (
              <div key={item.tag} className="event-row">
                <span>{fmtTag(item.tag)}</span>
                <div className="event-right">
                  <span className="muted">{item.count} signals</span>
                  <ScoreBar value={item.score} color={item.score >= 55 ? "green" : item.score <= 44 ? "red" : "amber"} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="split-grid">
        <div className="split-card">
          <Kicker>Sector Rotation</Kicker>
          <ul className="signal-list">
            {sectorLeaders.length ? sectorLeaders.map((item) => (
              <li key={item.sector}>{item.sector}: avg score {fmt(item.averageScore, "", 1)}, bullish share {fmt(item.bullishShare, "%", 0)}</li>
            )) : <li>Sector leadership is still loading.</li>}
          </ul>
        </div>
        <div className="split-card">
          <Kicker>Sector Laggards</Kicker>
          <ul className="signal-list">
            {sectorLaggards.length ? sectorLaggards.map((item) => (
              <li key={item.sector}>{item.sector}: avg score {fmt(item.averageScore, "", 1)}, bearish share {fmt(item.bearishShare, "%", 0)}</li>
            )) : <li>Sector laggard view is still loading.</li>}
          </ul>
        </div>
      </div>
      <div className="quality-note">
        <strong>Market-wide scan</strong>
        <p>
          {marketWide?.totalStocks
            ? `The broad engine pre-scanned ${marketWide.totalStocks} Indian equities and deep-ranked ${marketWide.deepAnalyzed || 0} names for the current timeframe.`
            : "Market-wide scan metadata is not available yet."}
        </p>
      </div>
      {unusualActivity.length ? (
        <div className="split-card compact">
          <Kicker>Unusual Activity</Kicker>
          <ul className="signal-list">
            {unusualActivity.slice(0, 5).map((item) => <li key={item.symbol}>{item.symbol}: {item.note}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="news-list">
        {macroSignals.slice(0, 4).map((item) => (
          <a key={`${item.source}-${item.headline}`} className="news-card" href={safeUrl(item.url)} target="_blank" rel="noreferrer">
            <div className="news-meta">
              <span>{item.source}</span>
              <span className="muted">{timeAgo(item.publishedAt)}</span>
            </div>
            <strong>{item.headline}</strong>
            {item.summary ? <p>{item.summary}</p> : null}
            <div className="news-tags">
              {(item.tags || []).slice(0, 3).map((tag) => <Badge key={tag}>{fmtTag(tag)}</Badge>)}
              <Badge>{item.verificationCount || 0} source</Badge>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function LeadersPanel({ leaders = [], onFocus }) {
  if (!leaders.length) {
    return <Empty text="No leaderboard is available for the current dashboard selection." />;
  }

  return (
    <div className="leaders-grid">
      {leaders.map((item, index) => (
        <div key={item.symbol} className="leader-card">
          <div className="leader-card-top">
            <div>
              <div className="leader-rank-row">
                <span className="leader-rank">{index + 1}</span>
                <strong>{item.symbol}</strong>
              </div>
              <span className="leader-company">{item.companyName}</span>
            </div>
            <Pill color={verdictColor(item.verdict)}>{fmtVerdict(item.verdict)}</Pill>
          </div>

          <div className="leader-metrics">
            <div>
              <span>Price</span>
              <strong>{fmt(item.quote?.price)}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{fmt(item.confidence, "%", 0)}</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{fmt(item.adjustedScore || item.score, "", 1)}</strong>
            </div>
            <div>
              <span>Target</span>
              <strong>{fmt(item.targets?.targetPct, "%")}</strong>
            </div>
          </div>

          <p className="leader-summary">{item.recommendation?.summary || item.thesis}</p>

          <div className="news-tags">
            {item.sector ? <Badge>{item.sector}</Badge> : null}
            {item.peerComparison?.position ? <Badge>{fmtTag(item.peerComparison.position)}</Badge> : null}
            <Badge>{fmtSource(item.verification?.marketSource || item.quote?.source)}</Badge>
          </div>

          <button className="btn-primary leader-card-action" type="button" onClick={() => onFocus(item.symbol, item.companyName)}>
            Open full analysis
          </button>
        </div>
      ))}
    </div>
  );
}

function NewsPanel({ focus, dashboard }) {
  const stockNews = focus?.news || [];
  const macroSignals = dashboard?.macroSignals || [];
  const sourceCoverage = focus?.newsSummary?.sourceCoverage || [];
  const grade = focus?.verification?.evidenceGrade || focus?.newsSummary?.evidenceGrade || "--";
  const credibilityNote = focus?.evidence?.note || focus?.newsSummary?.credibilityNote;

  return (
    <div className="news-sections">
      <div className="news-section">
        <div className="hero-card-head">
          <div>
            <Kicker>{focus?.symbol ? `${focus.symbol} News` : "Company News"}</Kicker>
            <h3>Stock-specific evidence</h3>
          </div>
          <Badge color={stockNews.some((item) => item.verified || item.official) ? "green" : "amber"}>
            {stockNews.length ? `${stockNews.length} items` : "No active cluster"}
          </Badge>
        </div>
        {credibilityNote ? (
          <div className="quality-note">
            <strong>Evidence grade {grade}</strong>
            <p>{credibilityNote}</p>
          </div>
        ) : null}
        {stockNews.length ? (
          <div className="news-list">
            {stockNews.map((item) => (
              <a key={`${item.source}-${item.headline}`} className="news-card" href={safeUrl(item.url)} target="_blank" rel="noreferrer">
                <div className="news-meta">
                  <span>{item.source}</span>
                  <span className="muted">{timeAgo(item.publishedAt)}</span>
                </div>
                <strong>{item.headline}</strong>
                {item.summary ? <p>{item.summary}</p> : null}
                <div className="news-tags">
                  {item.sentiment ? <Badge color={item.sentiment === "POSITIVE" ? "green" : item.sentiment === "NEGATIVE" ? "red" : "amber"}>{fmtTag(item.sentiment)}</Badge> : null}
                  {item.realTime ? <Badge color="cyan">Real-time</Badge> : null}
                  {item.credibilityLabel ? <Badge>{item.credibilityLabel}</Badge> : null}
                  {(item.tags || []).slice(0, 3).map((tag) => <Badge key={tag}>{fmtTag(tag)}</Badge>)}
                  {item.official ? <Badge color="cyan">Official</Badge> : null}
                  {item.verified ? <Badge color="green">Verified</Badge> : <Badge>{item.verificationCount || 1} source</Badge>}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Empty text="No company-specific headline cluster was found in the current run. Use price, fundamentals, and macro context more heavily." />
        )}
        {sourceCoverage.length ? (
          <div className="quality-note">
            <strong>Source coverage</strong>
            <p>{sourceCoverage.map((entry) => `${entry.source} (${entry.count})`).join(", ")}</p>
          </div>
        ) : null}
      </div>

      <div className="news-section">
        <div className="hero-card-head">
          <div>
            <Kicker>Macro Backdrop</Kicker>
            <h3>Broad market headlines</h3>
          </div>
          <Badge>{macroSignals.length} items</Badge>
        </div>
        <div className="news-list">
          {macroSignals.slice(0, 6).map((item) => (
            <a key={`${item.source}-${item.headline}`} className="news-card" href={safeUrl(item.url)} target="_blank" rel="noreferrer">
              <div className="news-meta">
                <span>{item.source}</span>
                <span className="muted">{timeAgo(item.publishedAt)}</span>
              </div>
              <strong>{item.headline}</strong>
              {item.summary ? <p>{item.summary}</p> : null}
              <div className="news-tags">
                {(item.tags || []).slice(0, 3).map((tag) => <Badge key={tag}>{fmtTag(tag)}</Badge>)}
                {item.official ? <Badge color="cyan">Official</Badge> : null}
                <Badge>{item.verificationCount || 1} source</Badge>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResolutionPanel({ result, onFocus }) {
  if (!result) {
    return null;
  }

  const suggestions = result.suggestions || [];
  return (
    <div className="resolution-panel">
      <div className="resolution-message">{result.answer || "I could not map that query cleanly yet."}</div>
      {suggestions.length ? (
        <div className="disambig-chips">
          {suggestions.map((item) => (
            <button key={item.symbol} className="disambig-chip" type="button" onClick={() => onFocus(item.symbol, item.companyName)}>
              <strong>{item.symbol}</strong>
              <span>{item.companyName}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="resolution-hint">Try a tradable symbol such as RELIANCE, TCS, HDFCBANK, or ask a more direct question.</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GOD-LEVEL AI RESEARCH REPORT PANEL
// ═══════════════════════════════════════════════════════
function ConvictionMeter({ score, grade, label }) {
  const color = score >= 70 ? "green" : score >= 50 ? "amber" : "red";
  const pct = Math.max(4, score);
  return (
    <div style={{marginBottom:"1rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"4px"}}>
        <span style={{fontSize:"12px",color:"var(--text-muted)"}}>Conviction</span>
        <span style={{fontWeight:600,fontSize:"13px"}}>{grade} — {label}</span>
      </div>
      <div style={{height:"10px",borderRadius:"5px",background:"var(--border)",overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,borderRadius:"5px",
          background: score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444",
          transition:"width 0.6s ease"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:"var(--text-muted)",marginTop:"2px"}}>
        <span>0</span><span>Conviction Score: {score}/100</span><span>100</span>
      </div>
    </div>
  );
}

function BayesianChart({ bullish, bearish, neutral }) {
  if (!bullish || !bearish || !neutral) return null;
  const total = (bullish.probability || 0) + (bearish.probability || 0) + (neutral.probability || 0);
  return (
    <div style={{marginBottom:"1rem"}}>
      <div style={{fontSize:"12px",color:"var(--text-muted)",marginBottom:"6px"}}>Bayesian Scenario Probabilities</div>
      <div style={{display:"flex",height:"20px",borderRadius:"6px",overflow:"hidden",gap:"2px"}}>
        <div style={{width:`${bullish.probability}%`,background:"#10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#fff",fontWeight:600,minWidth:"32px"}}>
          {bullish.probability}%
        </div>
        <div style={{width:`${neutral.probability}%`,background:"#f59e0b",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#fff",fontWeight:600,minWidth:"24px"}}>
          {neutral.probability}%
        </div>
        <div style={{width:`${bearish.probability}%`,background:"#ef4444",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#fff",fontWeight:600,minWidth:"32px"}}>
          {bearish.probability}%
        </div>
      </div>
      <div style={{display:"flex",gap:"12px",marginTop:"4px",fontSize:"10px",color:"var(--text-muted)"}}>
        <span style={{color:"#10b981"}}>● Bull {bullish.probability}%</span>
        <span style={{color:"#f59e0b"}}>● Neutral {neutral.probability}%</span>
        <span style={{color:"#ef4444"}}>● Bear {bearish.probability}%</span>
      </div>
    </div>
  );
}

function GodLevelReportPanel({ focus }) {
  const gl = focus?.godLevel;
  if (!focus) return <Empty text="Search for a stock to generate the full AI research report." />;
  if (!gl) return (
    <div className="lt-wrap">
      <Kicker>AI Research Report</Kicker>
      <div className="quality-note">
        <strong>God-Level analysis generating...</strong>
        <p>The full AI report with Bayesian probabilities, RSI divergence, ATR-calibrated targets, Kelly sizing, relative strength vs NIFTY, and smart money flow is computed automatically when you search for a stock.</p>
      </div>
    </div>
  );

  const { conviction, bayesian, atrTargets, kellySizing, rsiDivergence, macdDivergence, relativeStrength, smartMoney, exhaustion, report, dynamicWeights } = gl;
  const isBull = ["BUY","STRONG_BUY"].includes(focus.verdict);
  const isBear = ["SELL","STRONG_SELL"].includes(focus.verdict);
  const vcColor = conviction?.score >= 70 ? "green" : conviction?.score >= 50 ? "amber" : "red";

  return (
    <div className="lt-wrap">
      <div className="lt-head">
        <div>
          <Kicker>AI Research Report — God-Level Intelligence</Kicker>
          <div className={`lt-stance lt-${isBull ? "green" : isBear ? "red" : "amber"}`}>
            {focus.verdict?.replace(/_/g," ")} — {focus.symbol}
          </div>
        </div>
        {conviction && (
          <div className={`lt-score score-${vcColor}`}>
            <span>Conviction</span>
            <strong>{conviction.score}</strong>
            <span>{conviction.grade}</span>
          </div>
        )}
      </div>

      {/* Conviction Meter */}
      {conviction && <ConvictionMeter score={conviction.score} grade={conviction.grade} label={conviction.label} />}

      {/* Conviction reasons */}
      {conviction?.reasons?.length > 0 && (
        <div className="quality-note" style={{marginBottom:"1rem", borderColor: conviction.score >= 65 ? "var(--green)" : "var(--amber)"}}>
          <strong>Why conviction is {conviction.label}</strong>
          <ul className="signal-list">{conviction.reasons.map((r,i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {/* Bayesian probability chart */}
      {bayesian && <BayesianChart bullish={bayesian.bullish} bearish={bayesian.bearish} neutral={bayesian.neutral} />}

      {/* ATR-calibrated targets */}
      {atrTargets && (
        <div className="detail-card" style={{marginBottom:"0.75rem"}}>
          <Kicker>ATR-Calibrated Targets (Volatility-Based)</Kicker>
          <div className="verdict-stats">
            <StatBox label="ATR" value={fmt(atrTargets.atr)} sub={`${fmt(atrTargets.atrPct)}% of price`} />
            <StatBox label="Target 1" value={fmt(atrTargets.target1)} sub={`${atrTargets.targetPct > 0 ? "+" : ""}${fmt(atrTargets.targetPct)}%`} color="green" />
            <StatBox label="Target 2" value={fmt(atrTargets.target2)} sub="extended target" color="green" />
            <StatBox label="Stop Loss" value={fmt(atrTargets.stopLoss)} sub={`${fmt(atrTargets.stopPct)}%`} color="red" />
            <StatBox label="R:R Ratio" value={`${fmt(atrTargets.riskReward, "", 1)}:1`} sub="reward to risk" color={atrTargets.riskReward >= 2 ? "green" : "red"} />
          </div>
          <p className="muted">{atrTargets.note}</p>
        </div>
      )}

      {/* Kelly Criterion sizing */}
      {kellySizing && (
        <div className="detail-card" style={{marginBottom:"0.75rem"}}>
          <Kicker>Kelly Criterion Position Sizing</Kicker>
          <div className="verdict-stats">
            <StatBox label="Recommended" value={`${fmt(kellySizing.recommended, "", 1)}%`} sub="of capital" color={kellySizing.recommended >= 6 ? "green" : "amber"} />
            <StatBox label="Half-Kelly" value={`${fmt(kellySizing.halfKelly, "", 1)}%`} sub="theoretical" />
            <StatBox label="Size" value={kellySizing.sizeLabel?.split("(")[0]?.trim() || "--"} sub="conviction tier" />
          </div>
          <p className="muted">{kellySizing.note}</p>
          <p className="muted">{kellySizing.portfolioRisk}</p>
        </div>
      )}

      {/* RSI Divergence */}
      {rsiDivergence?.type !== "NONE" && rsiDivergence?.signal && (
        <div className="detail-card" style={{marginBottom:"0.75rem", borderLeft:`3px solid ${rsiDivergence.type?.includes("BULLISH") ? "var(--green)" : "var(--red)"}`}}>
          <Kicker>RSI Divergence Detected</Kicker>
          <div className="news-tags">
            <Badge color={rsiDivergence.type?.includes("BULLISH") ? "green" : "red"}>{fmtTag(rsiDivergence.type)}</Badge>
            {rsiDivergence.strength && <Badge>{rsiDivergence.strength}</Badge>}
          </div>
          <p className="muted" style={{marginTop:"0.5rem"}}>{rsiDivergence.signal}</p>
        </div>
      )}

      {/* MACD Divergence */}
      {macdDivergence?.type !== "NONE" && macdDivergence?.signal && (
        <div className="detail-card" style={{marginBottom:"0.75rem", borderLeft:`3px solid ${macdDivergence.type?.includes("BULLISH") ? "var(--green)" : "var(--red)"}`}}>
          <Kicker>MACD Divergence</Kicker>
          <Badge color={macdDivergence.type?.includes("BULLISH") ? "green" : "red"}>{fmtTag(macdDivergence.type)}</Badge>
          <p className="muted" style={{marginTop:"0.5rem"}}>{macdDivergence.signal}</p>
        </div>
      )}

      {/* Relative Strength */}
      {relativeStrength && (
        <div className="detail-card" style={{marginBottom:"0.75rem"}}>
          <Kicker>Relative Strength vs NIFTY</Kicker>
          <div className="verdict-stats">
            <StatBox label="RS 20d" value={fmt(relativeStrength.rs20, "", 2)} sub="vs NIFTY" color={relativeStrength.rs20 > 1 ? "green" : "red"} />
            <StatBox label="RS 60d" value={fmt(relativeStrength.rs60, "", 2)} sub="vs NIFTY" color={relativeStrength.rs60 > 1 ? "green" : "red"} />
            <StatBox label="Signal" value={fmtTag(relativeStrength.signal || "")} sub="composite" color={relativeStrength.signal?.includes("OUT") ? "green" : relativeStrength.signal?.includes("UNDER") ? "red" : "amber"} />
          </div>
          <p className="muted">{relativeStrength.interpretation}</p>
        </div>
      )}

      {/* Smart Money */}
      {smartMoney && (
        <div className="detail-card" style={{marginBottom:"0.75rem"}}>
          <Kicker>Smart Money Classification</Kicker>
          <Badge color={smartMoney.classification?.includes("ACCUM") ? "green" : smartMoney.classification?.includes("DISTRIB") ? "red" : "amber"}>
            {fmtTag(smartMoney.classification || "")}
          </Badge>
          <p className="muted" style={{marginTop:"0.5rem"}}>{smartMoney.interpretation}</p>
          <ul className="signal-list" style={{marginTop:"0.25rem"}}>
            {(smartMoney.signals || []).map((s,i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* Exhaustion */}
      {exhaustion?.exhausted && (
        <div className="detail-card" style={{marginBottom:"0.75rem", borderLeft:"3px solid var(--red)"}}>
          <Kicker>Trend Exhaustion Alert</Kicker>
          <Badge color="red">{fmtTag(exhaustion.type || "")}</Badge>
          <p className="muted" style={{marginTop:"0.5rem"}}>{exhaustion.signal}</p>
        </div>
      )}

      {/* Dynamic Weights */}
      {dynamicWeights && (
        <div className="detail-card" style={{marginBottom:"0.75rem"}}>
          <Kicker>Dynamic Weight System (Regime-Adjusted)</Kicker>
          <div className="verdict-bars">
            {[
              ["Technical", dynamicWeights.technical * 100, "green"],
              ["Fundamentals", dynamicWeights.fundamentals * 100, "green"],
              ["News", dynamicWeights.news * 100, "amber"],
              ["Macro", dynamicWeights.macro * 100, "amber"],
              ["Events", dynamicWeights.events * 100, "amber"],
            ].map(([label, value, colorKey]) => (
              <div key={label} className="bar-row">
                <span>{label} {fmt(value, "%", 0)}</span>
                <ScoreBar value={value} color={colorKey} />
              </div>
            ))}
          </div>
          <p className="muted">Weights auto-adjusted for market regime, VIX level, and ADX trend strength.</p>
        </div>
      )}

      {/* Full Report */}
      {report?.sections && (
        <div style={{marginTop:"1rem"}}>
          <Kicker>Full Research Report</Kicker>
          {report.sections.map((section, i) => (
            <div key={i} className="detail-card" style={{marginBottom:"0.5rem"}}>
              <strong style={{fontSize:"12px",display:"block",marginBottom:"4px",color:"var(--text-secondary)"}}>{section.heading}</strong>
              <p className="muted" style={{fontSize:"12px",lineHeight:"1.6"}}>{section.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ADVANCED INTELLIGENCE PANEL — Unified (Phase 2·3·4·5)
// Combines: Options · Technical · Fundamentals · India
// ═══════════════════════════════════════════════════════
function AdvancedIntelPanel({ focus, dashboard }) {
  const [section, setSection] = useState("technical");

  const opts  = focus?.optionsIntelligence;
  const adv   = focus?.advancedTechnical;
  const fi    = focus?.fundamentalIntelligence;
  // Use stock-specific india intel first; fall back to global dashboard intel
  // (events, GIFT NIFTY, sector rotation available even before stock search)
  const india = focus?.indiaIntelligence || dashboard?.globalIndiaIntel || null;

  if (!focus) return (
    <Empty text="Search for any NSE stock to activate Advanced Intelligence — options chain, technical indicators, fundamental frameworks, and India-specific signals." />
  );

  const domains = [
    {
      id: "options",
      label: "Options",
      icon: "◎",
      value: opts ? (opts.directionalBias || "NEUTRAL") : "N/A",
      sub: opts ? `PCR ${opts.pcr != null ? Number(opts.pcr).toFixed(2) : "--"}` : "Geo-restricted",
      color: opts?.directionalBias === "BULLISH" ? "adv-c-green" : opts?.directionalBias === "BEARISH" ? "adv-c-red" : "adv-c-amber",
    },
    {
      id: "technical",
      label: "Technical",
      icon: "∿",
      value: adv ? (adv.supertrend?.direction || "--") : focus.technical?.score != null ? `Score ${Math.round(focus.technical.score)}` : "--",
      sub: adv ? `ADX ${adv.adx?.adx != null ? Number(adv.adx.adx).toFixed(1) : "--"}` : "Base data only",
      color: adv?.supertrend?.direction === "BULLISH" || (!adv && focus.technical?.score >= 60) ? "adv-c-green" : adv?.supertrend?.direction === "BEARISH" || (!adv && focus.technical?.score < 40) ? "adv-c-red" : "adv-c-amber",
    },
    {
      id: "fundamentals",
      label: "Fundamentals",
      icon: "◈",
      value: fi ? (fi.fundamentalQuality || "--") : focus.fundamentals?.score != null ? `Score ${Math.round(focus.fundamentals.score)}` : "--",
      sub: fi ? `QGLP ${fi.qglp?.totalScore || "--"} / 100` : "Base data only",
      color: fi?.fundamentalQuality === "HIGH" || (!fi && focus.fundamentals?.score >= 60) ? "adv-c-green" : fi?.fundamentalQuality === "LOW" || (!fi && focus.fundamentals?.score < 40) ? "adv-c-red" : "adv-c-amber",
    },
    {
      id: "india",
      label: "India Intel",
      icon: "⊕",
      value: india?.giftNifty?.gapType ? fmtTag(india.giftNifty.gapType) : india ? "Market Live" : "No data",
      sub: india ? `${(india.signals || []).length} active signal(s)` : "Loading…",
      color: india?.giftNifty?.gapType?.includes("UP") ? "adv-c-green" : india?.giftNifty?.gapType?.includes("DOWN") ? "adv-c-red" : "adv-c-amber",
    },
  ];

  /* colour helpers */
  const pcrColor     = opts?.pcrSignal?.includes("BULLISH") ? "green" : opts?.pcrSignal?.includes("BEARISH") ? "red" : "amber";
  const biasColor    = opts?.directionalBias === "BULLISH" ? "green" : opts?.directionalBias === "BEARISH" ? "red" : "amber";
  const vixColor     = opts?.vixSignal === "EXTREME_FEAR" || opts?.vixSignal === "HIGH_FEAR" ? "red" : opts?.vixSignal === "CALM" || opts?.vixSignal === "EXTREME_COMPLACENCY" ? "green" : "amber";
  const stColor      = adv?.supertrend?.direction === "BULLISH" ? "green" : "red";
  const adxColor     = adv?.adx?.trendStrength === "STRONG_TREND" || adv?.adx?.trendStrength === "TREND" ? "green" : adv?.adx?.trendStrength === "RANGING" ? "red" : "amber";
  const wyckoffColor = adv?.wyckoff?.bias === "BULLISH" ? "green" : adv?.wyckoff?.bias === "BEARISH" ? "red" : "amber";
  const ewColor      = adv?.elliottWave?.wavePosition?.includes("BULLISH") ? "green" : adv?.elliottWave?.wavePosition?.includes("BEARISH") ? "red" : "amber";
  const qglpColor    = fi?.qglp?.totalScore >= 70 ? "green" : fi?.qglp?.totalScore >= 50 ? "amber" : "red";
  const ccColor      = fi?.coffeeCan?.metCount >= 4 ? "green" : fi?.coffeeCan?.metCount >= 3 ? "amber" : "red";
  const moatColor    = fi?.moat?.moatWidth === "WIDE" ? "green" : fi?.moat?.moatWidth === "NARROW" ? "amber" : "red";
  const qualityColor = fi?.fundamentalQuality === "HIGH" ? "green" : fi?.fundamentalQuality === "MEDIUM" ? "amber" : "red";
  const impactColor  = (imp) => imp === "EXTREME" ? "red" : imp === "HIGH" ? "amber" : "green";
  const events       = india?.upcomingEvents || [];
  const giftNifty    = india?.giftNifty;
  const resultsSeason = india?.resultsSeason;
  const sectorRotation = india?.sectorRotation || [];
  const indiaSignals   = india?.signals || [];

  return (
    <div className="adv-panel">

      {/* ── Domain strip (navigation) ── */}
      <div className="adv-domain-strip">
        {domains.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`adv-domain-card${section === d.id ? " adv-domain-active" : ""}`}
            onClick={() => setSection(d.id)}
          >
            <div className="adv-domain-icon">{d.icon}</div>
            <span className="adv-domain-label">{d.label}</span>
            <span className={`adv-domain-value ${d.color}`}>{d.value}</span>
            <span className="adv-domain-sub">{d.sub}</span>
          </button>
        ))}
      </div>

      {/* ══ OPTIONS ══ */}
      {section === "options" && (
        <div className="adv-body">
          {!opts ? (
            <div className="adv-unavail">
              <div className="adv-unavail-title">⚠ Options chain unavailable</div>
              <p>NSE options chain (PCR, max pain, OI walls, India VIX) is geo-restricted from Netlify cloud. Connect via Upstox or run locally to activate full options intelligence.</p>
            </div>
          ) : (
            <div className="lt-wrap">
              <div className="lt-head">
                <div>
                  <Kicker>Options Intelligence — Phase 4</Kicker>
                  <div className={`lt-stance lt-${biasColor}`}>{opts.directionalBias || "NEUTRAL"}</div>
                </div>
                <div className={`lt-score score-${pcrColor}`}>
                  <span>PCR</span>
                  <strong>{opts.pcr != null ? Number(opts.pcr).toFixed(2) : "--"}</strong>
                  <span>{fmtTag(opts.pcrSignal || "Unknown")}</span>
                </div>
              </div>
              {opts.optionsChainAvailable === false && (
                <div className="quality-note" style={{borderColor:"var(--amber)", marginBottom:"0.75rem"}}>
                  <strong>⚠ Options chain unavailable from cloud</strong>
                  <p>NSE options chain API is geo-restricted from Netlify cloud servers. India VIX is shown below via Yahoo Finance. For full chain data (PCR, max pain, OI walls) connect via Upstox or run locally.</p>
                </div>
              )}
              {opts.optionsChainAvailable !== false && <p className="muted">{opts.summary || "Options chain analysis active."}</p>}
              {opts.vix != null && (
                <div className="quality-note" style={{borderColor: opts.vixSignal?.includes("FEAR") ? "var(--red)" : "var(--green)"}}>
                  <strong>India VIX: {Number(opts.vix).toFixed(1)}</strong>
                  <p>Signal: {fmtTag(opts.vixSignal || "Unknown")} — {opts.vixSignal === "EXTREME_FEAR" ? "Market panic — options premium very high. Sell premium." : opts.vixSignal === "CALM" ? "Low volatility — buy options cheaply. Pre-event straddles." : "VIX in normal zone."}</p>
                </div>
              )}
              <div className="verdict-stats">
                <StatBox label="PCR" value={opts.pcr != null ? Number(opts.pcr).toFixed(2) : "--"} sub={fmtTag(opts.pcrSignal || "")} color={pcrColor} />
                <StatBox label="Max Pain" value={opts.maxPainStrike || "--"} sub={opts.maxPainDistance != null ? `${opts.maxPainDistance > 0 ? "+" : ""}${Number(opts.maxPainDistance).toFixed(1)}% from spot` : "distance"} />
                <StatBox label="Put Wall" value={opts.supportLevel || "--"} sub="OI support zone" color="green" />
                <StatBox label="Call Wall" value={opts.resistanceLevel || "--"} sub="OI resistance zone" color="red" />
                <StatBox label="India VIX" value={opts.vix != null ? Number(opts.vix).toFixed(1) : "--"} sub={fmtTag(opts.vixSignal || "")} color={vixColor} />
                <StatBox label="Expiry" value={opts.expiry || "--"} sub="nearest expiry" />
              </div>
              <div className="split-grid">
                <div className="split-card">
                  <Kicker>Call OI Walls — Resistance</Kicker>
                  <ul className="signal-list">
                    {(opts.oiWalls?.call || []).slice(0, 5).map((w) => (
                      <li key={w.strike}>Strike {w.strike} — OI {(w.oi / 100).toFixed(0)}L contracts</li>
                    ))}
                    {!(opts.oiWalls?.call?.length) && <li>No significant call walls detected</li>}
                  </ul>
                </div>
                <div className="split-card">
                  <Kicker>Put OI Walls — Support</Kicker>
                  <ul className="signal-list">
                    {(opts.oiWalls?.put || []).slice(0, 5).map((w) => (
                      <li key={w.strike}>Strike {w.strike} — OI {(w.oi / 100).toFixed(0)}L contracts</li>
                    ))}
                    {!(opts.oiWalls?.put?.length) && <li>No significant put walls detected</li>}
                  </ul>
                </div>
              </div>
              <div className="detail-card" style={{marginTop:"1rem"}}>
                <Kicker>How to Use This Data</Kicker>
                <ul className="signal-list">
                  <li>PCR {opts.pcr > 1.2 ? "> 1.2 = Put writers outnumber call writers → Bullish bias" : opts.pcr < 0.8 ? "< 0.8 = Call writers outnumber put writers → Bearish bias" : "near 1.0 = Neutral market sentiment"}</li>
                  <li>Max Pain {opts.maxPainStrike} = Strike where option writers lose least. Markets often gravitate here near expiry.</li>
                  <li>Call Wall at {opts.resistanceLevel || "--"} = Heavy short positions by option writers — strong resistance.</li>
                  <li>Put Wall at {opts.supportLevel || "--"} = Heavy short positions by put writers — strong support floor.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TECHNICAL ══ */}
      {section === "technical" && (
        <div className="adv-body">
          {!adv ? (
            <div className="lt-wrap">
              <div className="quality-note" style={{borderColor:"var(--amber)"}}>
                <strong>Advanced indicators unavailable</strong>
                <p>ADX, Supertrend, Wyckoff, and Elliott Wave require ≥20 days of candle history. Showing base technical data below.</p>
              </div>
              {focus.technical && (
                <div className="verdict-stats" style={{marginTop:"1rem"}}>
                  <StatBox label="RSI (14)" value={focus.technical.rsi14 != null ? Number(focus.technical.rsi14).toFixed(1) : "--"} sub={focus.technical.rsi14 > 70 ? "Overbought" : focus.technical.rsi14 < 30 ? "Oversold" : "Neutral"} color={focus.technical.rsi14 > 70 ? "red" : focus.technical.rsi14 < 30 ? "green" : "amber"} />
                  <StatBox label="20d Return" value={focus.technical.return20d != null ? `${focus.technical.return20d > 0 ? "+" : ""}${Number(focus.technical.return20d).toFixed(1)}%` : "--"} color={focus.technical.return20d > 0 ? "green" : "red"} />
                  <StatBox label="60d Return" value={focus.technical.return60d != null ? `${focus.technical.return60d > 0 ? "+" : ""}${Number(focus.technical.return60d).toFixed(1)}%` : "--"} color={focus.technical.return60d > 0 ? "green" : "red"} />
                  <StatBox label="Vol Surge" value={focus.technical.volumeSurge != null ? `${Number(focus.technical.volumeSurge).toFixed(2)}x` : "--"} color={focus.technical.volumeSurge > 1.5 ? "green" : "amber"} />
                  <StatBox label="Tech Score" value={focus.technical.score != null ? Number(focus.technical.score).toFixed(0) : "--"} sub="/ 100" color={focus.technical.score >= 60 ? "green" : focus.technical.score >= 40 ? "amber" : "red"} />
                </div>
              )}
            </div>
          ) : (
            <div className="lt-wrap">
              <div className="lt-head">
                <div>
                  <Kicker>Advanced Technical Analysis — Phase 2</Kicker>
                  <div className={`lt-stance lt-${stColor}`}>
                    Supertrend: {adv.supertrend?.direction || "--"}
                    {adv.supertrend?.justFlipped ? " ★ JUST FLIPPED" : ""}
                  </div>
                </div>
                <div className={`lt-score score-${adxColor}`}>
                  <span>ADX</span>
                  <strong>{adv.adx?.adx != null ? Number(adv.adx.adx).toFixed(1) : "--"}</strong>
                  <span>{fmtTag(adv.adx?.trendStrength || "")}</span>
                </div>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>ADX — Trend Strength</Kicker>
                <div className="verdict-stats">
                  <StatBox label="ADX" value={adv.adx?.adx != null ? Number(adv.adx.adx).toFixed(1) : "--"} sub={fmtTag(adv.adx?.trendStrength || "")} color={adxColor} />
                  <StatBox label="DI+" value={adv.adx?.diPlus != null ? Number(adv.adx.diPlus).toFixed(1) : "--"} sub="bullish force" color="green" />
                  <StatBox label="DI-" value={adv.adx?.diMinus != null ? Number(adv.adx.diMinus).toFixed(1) : "--"} sub="bearish force" color="red" />
                </div>
                <p className="muted">
                  {adv.adx?.trendStrength === "RANGING" ? "ADX < 20: Market is range-bound. Avoid breakout trades. Mean-reversion preferred." :
                   adv.adx?.trendStrength === "STRONG_TREND" ? "ADX > 40: Very strong trend. Ride it — do not fade." :
                   adv.adx?.signal === "UPTREND_CONFIRMED" ? "ADX confirms uptrend with DI+ dominant. Trend-following longs valid." :
                   adv.adx?.signal === "DOWNTREND_CONFIRMED" ? "ADX confirms downtrend with DI- dominant. Trend-following shorts valid." : "Weak trend — trade with caution."}
                </p>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Supertrend — India Favourite</Kicker>
                <div className="coverage-list">
                  <span>Direction {adv.supertrend?.direction || "--"}</span>
                  <span>Level {adv.supertrend?.value != null ? Number(adv.supertrend.value).toFixed(1) : "--"}</span>
                  <span>Price vs ST {adv.supertrend?.priceVsSupertrend || "--"}</span>
                  <span>Signal {fmtTag(adv.supertrend?.signal || "")}</span>
                </div>
                {adv.supertrend?.justFlipped && (
                  <div className="quality-note" style={{borderColor: adv.supertrend.direction === "BULLISH" ? "var(--green)" : "var(--red)"}}>
                    <strong>Supertrend just flipped {adv.supertrend.direction}</strong>
                    <p>Direction change — one of the highest-quality reversal signals in Indian markets.</p>
                  </div>
                )}
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Wyckoff Phase</Kicker>
                <div className={`lt-stance lt-${wyckoffColor}`} style={{fontSize:"14px", marginBottom:"0.5rem"}}>
                  {["UNCLEAR","UNKNOWN","UNDEFINED"].includes(adv.wyckoff?.phase) ? "Phase Unclear" : fmtTag(adv.wyckoff?.phase || "Unknown")}
                </div>
                <div className="coverage-list">
                  <span>Event {adv.wyckoff?.event ? fmtTag(adv.wyckoff.event) : "—"}</span>
                  <span>Volume {fmtTag(adv.wyckoff?.volumeTrend || "--")}</span>
                  <span>20d price {adv.wyckoff?.priceTrend20d != null ? `${Number(adv.wyckoff.priceTrend20d) > 0 ? "+" : ""}${Number(adv.wyckoff.priceTrend20d).toFixed(1)}%` : "--"}</span>
                  <span>Confidence {adv.wyckoff?.confidence ?? "--"}%</span>
                </div>
                <p className="muted">{adv.wyckoff?.interpretation || "Wyckoff phase unclear — needs more candle history."}</p>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Elliott Wave</Kicker>
                <div className={`lt-stance lt-${ewColor}`} style={{fontSize:"13px", marginBottom:"0.5rem"}}>
                  {["UNCLEAR","UNKNOWN","INSUFFICIENT_PIVOTS"].includes(adv.elliottWave?.wavePosition) ? "Structure Unclear" : fmtTag(adv.elliottWave?.wavePosition || "Unclear")}
                </div>
                <div className="coverage-list">
                  <span>Confidence {adv.elliottWave?.confidence ?? 0}%</span>
                  <span>W3/W1 ratio {adv.elliottWave?.fibRatios?.wave3to1 != null ? Number(adv.elliottWave.fibRatios.wave3to1).toFixed(2) : "--"}</span>
                  {adv.elliottWave?.projection?.wave5Target && <span>W5 target ~{Number(adv.elliottWave.projection.wave5Target).toFixed(1)}</span>}
                </div>
                <p className="muted">{adv.elliottWave?.interpretation || "Insufficient pivot data for wave labelling."}</p>
              </div>
              {adv.chartPatterns?.patterns?.length > 0 && (
                <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                  <Kicker>Chart Patterns</Kicker>
                  {adv.chartPatterns.patterns.map((p) => (
                    <div key={p.pattern} style={{marginBottom:"0.75rem"}}>
                      <div className="news-tags">
                        <Badge color={p.bias === "BULLISH" ? "green" : p.bias === "BEARISH" ? "red" : "amber"}>{fmtTag(p.pattern)}</Badge>
                        <Badge color={p.bias === "BULLISH" ? "green" : "red"}>{p.bias}</Badge>
                        <Badge>{p.confidence}% confidence</Badge>
                      </div>
                      <p className="muted" style={{marginTop:"0.25rem"}}>{p.description}</p>
                      {p.target && <p className="muted">Target: ₹{Number(p.target).toFixed(1)}</p>}
                    </div>
                  ))}
                </div>
              )}
              {adv.volumeProfile?.poc && (
                <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                  <Kicker>Volume Profile — POC</Kicker>
                  <div className="coverage-list">
                    <span>Point of Control ₹{Number(adv.volumeProfile.poc).toFixed(1)}</span>
                    <span>Signal {fmtTag(adv.volumeProfile.signal || "--")}</span>
                    <span>HVN zones {adv.volumeProfile.hvn?.length || 0}</span>
                    <span>LVN zones {adv.volumeProfile.lvn?.length || 0}</span>
                  </div>
                  <p className="muted">POC = highest-volume price. Acts as magnet. LVN zones = fast-move areas.</p>
                </div>
              )}
              {adv.signals?.length > 0 && (
                <div className="detail-card">
                  <Kicker>All Advanced Signals</Kicker>
                  <ul className="signal-list">
                    {adv.signals.map((s, i) => (
                      <li key={i}><strong>{s.indicator}</strong>: {s.signal}{s.value != null ? ` (${Number(s.value).toFixed(1)})` : ""}</li>
                    ))}
                  </ul>
                  <p className="muted">Net technical delta: {adv.delta > 0 ? "+" : ""}{adv.delta}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ FUNDAMENTALS ══ */}
      {section === "fundamentals" && (
        <div className="adv-body">
          {!fi ? (
            <div className="lt-wrap">
              <div className="quality-note" style={{borderColor:"var(--amber)"}}>
                <strong>Framework scoring unavailable</strong>
                <p>QGLP, Coffee Can, Moat, and Lynch scoring requires detailed data from Screener/Moneycontrol. Showing available fundamental metrics below.</p>
              </div>
              {focus.fundamentals && (
                <div className="verdict-stats" style={{marginTop:"1rem"}}>
                  <StatBox label="ROE" value={focus.fundamentals.roe != null ? `${Number(focus.fundamentals.roe).toFixed(1)}%` : "--"} sub="Return on Equity" color={focus.fundamentals.roe >= 20 ? "green" : focus.fundamentals.roe >= 15 ? "amber" : "red"} />
                  <StatBox label="ROCE" value={focus.fundamentals.roce != null ? `${Number(focus.fundamentals.roce).toFixed(1)}%` : "--"} sub="Return on Capital" color={focus.fundamentals.roce >= 18 ? "green" : "amber"} />
                  <StatBox label="P/E" value={focus.fundamentals.pe != null ? Number(focus.fundamentals.pe).toFixed(1) : "--"} sub="Price / Earnings" />
                  <StatBox label="Rev Growth" value={focus.fundamentals.salesGrowth3yr != null ? `${Number(focus.fundamentals.salesGrowth3yr).toFixed(1)}%` : "--"} sub="3yr Revenue" color={focus.fundamentals.salesGrowth3yr >= 12 ? "green" : "amber"} />
                  <StatBox label="Profit Growth" value={focus.fundamentals.profitGrowth3yr != null ? `${Number(focus.fundamentals.profitGrowth3yr).toFixed(1)}%` : "--"} sub="3yr PAT" color={focus.fundamentals.profitGrowth3yr >= 15 ? "green" : "amber"} />
                  <StatBox label="Fund Score" value={focus.fundamentals.score != null ? Number(focus.fundamentals.score).toFixed(0) : "--"} sub="/ 100" color={focus.fundamentals.score >= 60 ? "green" : focus.fundamentals.score >= 40 ? "amber" : "red"} />
                </div>
              )}
            </div>
          ) : (
            <div className="lt-wrap">
              <div className="lt-head">
                <div>
                  <Kicker>Fundamental Frameworks — Phase 3</Kicker>
                  <div className={`lt-stance lt-${qualityColor}`}>Fundamental Quality: {fi.fundamentalQuality || "--"}</div>
                </div>
                <div className={`lt-score score-${qglpColor}`}>
                  <span>QGLP</span>
                  <strong>{fi.qglp?.totalScore || "--"}</strong>
                  <span>/ 100</span>
                </div>
              </div>
              {fi.topSignals?.length > 0 && (
                <div className="quality-note">
                  <strong>Key Signals</strong>
                  <ul className="signal-list">{fi.topSignals.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>QGLP — Raamdeo Agrawal</Kicker>
                <div className="verdict-stats">
                  <StatBox label="Quality" value={fi.qglp?.scores?.quality || "--"} sub="ROE+ROCE+D/E" color={fi.qglp?.scores?.quality >= 60 ? "green" : "amber"} />
                  <StatBox label="Growth" value={fi.qglp?.scores?.growth || "--"} sub="rev+profit growth" color={fi.qglp?.scores?.growth >= 60 ? "green" : "amber"} />
                  <StatBox label="Longevity" value={fi.qglp?.scores?.longevity || "--"} sub="durability" color={fi.qglp?.scores?.longevity >= 60 ? "green" : "amber"} />
                  <StatBox label="Price" value={fi.qglp?.scores?.price || "--"} sub={`PEG ${fi.qglp?.peg != null ? Number(fi.qglp.peg).toFixed(2) : "--"}`} color={fi.qglp?.peg < 1.5 ? "green" : "red"} />
                </div>
                <div className="news-tags" style={{marginTop:"0.5rem"}}>
                  <Badge color={qglpColor}>{fi.qglp?.verdict ? fmtTag(fi.qglp.verdict) : "--"}</Badge>
                </div>
                <ul className="signal-list" style={{marginTop:"0.5rem"}}>
                  {(fi.qglp?.signals || []).slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Coffee Can — Saurabh Mukherjea</Kicker>
                <div className={`lt-stance lt-${ccColor}`} style={{fontSize:"13px", marginBottom:"0.5rem"}}>
                  {fi.coffeeCan?.verdict ? fmtTag(fi.coffeeCan.verdict) : "--"} ({fi.coffeeCan?.metCount || 0}/5 criteria)
                </div>
                <ul className="signal-list">
                  {(fi.coffeeCan?.signals || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                <p className="muted" style={{marginTop:"0.5rem"}}>{fi.coffeeCan?.interpretation}</p>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Economic Moat — Warren Buffett</Kicker>
                <div className="verdict-stats">
                  <StatBox label="Moat Width" value={fi.moat?.moatWidth || "--"} sub={fmtTag(fi.moat?.moatType || "none")} color={moatColor} />
                  <StatBox label="Moat Score" value={fi.moat?.moatScore || "--"} sub="/ 100" color={moatColor} />
                </div>
                <ul className="signal-list" style={{marginTop:"0.5rem"}}>
                  {(fi.moat?.moatSignals || []).slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                <p className="muted">{fi.moat?.interpretation}</p>
              </div>
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Peter Lynch Category</Kicker>
                <div className="news-tags">
                  <Badge color="amber">{fmtTag(fi.lynch?.category || "--")}</Badge>
                  {fi.lynch?.avgGrowth != null && <Badge>{Number(fi.lynch.avgGrowth).toFixed(1)}% avg growth</Badge>}
                </div>
                <p className="muted" style={{marginTop:"0.5rem"}}>{fi.lynch?.strategy}</p>
                <p className="muted">{fi.lynch?.signal}</p>
              </div>
              {fi.redFlags && (
                <div className="detail-card" style={{borderLeft: fi.redFlags.riskLevel === "HIGH" ? "3px solid var(--red)" : fi.redFlags.riskLevel === "MEDIUM" ? "3px solid var(--amber)" : "3px solid var(--green)"}}>
                  <Kicker>Accounting Red Flags</Kicker>
                  <div className="news-tags">
                    <Badge color={fi.redFlags.riskLevel === "HIGH" ? "red" : fi.redFlags.riskLevel === "MEDIUM" ? "amber" : "green"}>
                      {fi.redFlags.riskLevel} risk — {fi.redFlags.count} flag(s)
                    </Badge>
                  </div>
                  {fi.redFlags.flags.length > 0 ? (
                    <ul className="signal-list" style={{marginTop:"0.5rem"}}>
                      {fi.redFlags.flags.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  ) : (
                    <p className="muted" style={{marginTop:"0.5rem"}}>No major accounting red flags from available data.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ INDIA INTEL ══ */}
      {section === "india" && (
        <div className="adv-body">
          <div className="lt-wrap">
            <Kicker>India Market Intelligence — Phase 5</Kicker>
            <p className="muted" style={{marginBottom:"1rem"}}>India-specific signals: GIFT NIFTY pre-market, event calendar, sector rotation, F&amp;O expiry, results season.</p>
            {indiaSignals.length > 0 && (
              <div className="quality-note" style={{marginBottom:"1rem"}}>
                <strong>Active India Signals ({indiaSignals.length})</strong>
                <ul className="signal-list">
                  {indiaSignals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                {india?.delta !== 0 && (
                  <p className="muted">Score delta from India signals: {india.delta > 0 ? "+" : ""}{india.delta} points</p>
                )}
              </div>
            )}
            {giftNifty?.gapType && (
              <div className="detail-card" style={{marginBottom:"0.75rem", borderLeft:`3px solid ${giftNifty.gapType.includes("UP") ? "var(--green)" : giftNifty.gapType.includes("DOWN") ? "var(--red)" : "var(--amber)"}`}}>
                <Kicker>GIFT NIFTY Pre-Market Signal</Kicker>
                <div className="verdict-stats">
                  <StatBox label="Gap" value={giftNifty.gapPct != null ? `${giftNifty.gapPct > 0 ? "+" : ""}${Number(giftNifty.gapPct).toFixed(2)}%` : "--"} sub={fmtTag(giftNifty.gapType || "")} color={giftNifty.gapPct > 0 ? "green" : "red"} />
                  <StatBox label="Futures" value={giftNifty.currentFuturesPrice || "--"} sub="current" />
                  <StatBox label="Prev Close" value={giftNifty.prevNSEClose || "--"} sub="NSE close" />
                </div>
                <p className="muted">{giftNifty.interpretation}</p>
              </div>
            )}
            {resultsSeason && (
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Results Season Status</Kicker>
                <div className="news-tags">
                  <Badge color={resultsSeason.isInSeason ? "amber" : "green"}>{resultsSeason.isInSeason ? "ACTIVE" : "OFF-SEASON"}</Badge>
                  <Badge color={resultsSeason.ivExpansionRisk === "HIGH" ? "red" : "green"}>IV risk: {resultsSeason.ivExpansionRisk}</Badge>
                </div>
                <p className="muted" style={{marginTop:"0.5rem"}}>{resultsSeason.season}</p>
                <p className="muted">{resultsSeason.tradingImplication}</p>
              </div>
            )}
            {events.length > 0 && (
              <div className="detail-card" style={{marginBottom:"0.75rem"}}>
                <Kicker>Upcoming Market Events</Kicker>
                {events.slice(0, 4).map((e, i) => (
                  <div key={i} style={{marginBottom:"0.75rem", paddingBottom:"0.75rem", borderBottom: i < events.length - 1 ? "1px solid var(--border)" : "none"}}>
                    <div className="news-tags">
                      <Badge color={impactColor(e.impact)}>{e.impact} IMPACT</Badge>
                      <Badge>{fmtTag(e.type || "")}</Badge>
                      {e.daysAway != null && <Badge>{e.daysAway} day(s) away</Badge>}
                    </div>
                    <strong style={{display:"block", marginTop:"0.25rem"}}>{e.name}</strong>
                    <p className="muted">{e.description}</p>
                    {e.tradingNote && <p className="muted" style={{fontStyle:"italic"}}>{e.tradingNote}</p>}
                  </div>
                ))}
              </div>
            )}
            {sectorRotation.length > 0 && (
              <div className="detail-card">
                <Kicker>Sector Rotation Signals</Kicker>
                {sectorRotation.map((s, i) => (
                  <div key={i} style={{marginBottom:"0.5rem"}}>
                    <div className="news-tags">
                      <Badge color={s.signal === "BULLISH" || s.signal === "SEASONAL_BULLISH" ? "green" : "red"}>{s.sector}</Badge>
                      <Badge color={s.signal?.includes("BULLISH") ? "green" : "red"}>{fmtTag(s.signal || "")}</Badge>
                    </div>
                    <p className="muted" style={{marginTop:"0.25rem"}}>{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
            {!india && (
              <div className="quality-note" style={{borderColor:"var(--amber)"}}>
                <strong>India market data loading…</strong>
                <p>GIFT NIFTY signal, event calendar, sector rotation, and results season status will appear here once the backend warms up. Refresh in a few seconds.</p>
              </div>
            )}
            {india && !focus?.indiaIntelligence && (
              <p className="muted" style={{marginTop:"0.5rem", fontSize:"11px"}}>Showing global market data. Search a stock for symbol-specific sector signals.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function Sidebar({ dashboard, onFocus, activeTab, setActiveTab }) {
  const regime = dashboard?.marketContext?.regime || "--";
  const riskOn = dashboard?.marketContext?.riskOnScore;
  const tabs = ["Verdict", "AI Report", "Evidence", "Advanced", "Long Term", "Market", "News", "Signal Radar"];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandMark />
        <div>
          <div className="brand-name">Superbrain</div>
          <div className="brand-sub">India Intelligence</div>
        </div>
      </div>
      <div className="sidebar-stats">
        <div className="ss-item">
          <span>Regime</span>
          <strong className={regime.includes("BULL") ? "green" : regime.includes("BEAR") ? "red" : "amber"}>{regime}</strong>
        </div>
        <div className="ss-item">
          <span>Risk Score</span>
          <strong>{riskOn != null ? fmt(riskOn, "", 2) : "--"}</strong>
        </div>
        <div className="ss-item">
          <span>Coverage</span>
          <strong>{dashboard?.summary?.totalCovered || 0}</strong>
        </div>
        <div className="ss-item">
          <span>Updated</span>
          <strong>{dashboard?.generatedAt ? timeAgo(dashboard.generatedAt) : "--"}</strong>
        </div>
      </div>
      <nav className="sidebar-nav">
        {tabs.map((tab) => {
          const isNew = ["AI Report", "Advanced"].includes(tab);
          return (
            <button key={tab} className={`nav-item ${activeTab === tab ? "nav-active" : ""}`} type="button" onClick={() => setActiveTab(tab)}>
              {tab}
              {isNew ? <span className="nav-new-badge">NEW</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-leaders">
        <Kicker>Top Picks</Kicker>
        {(dashboard?.leaders || []).slice(0, 5).map((item, index) => (
          <button key={item.symbol} className="mini-leader" type="button" onClick={() => onFocus(item.symbol, item.companyName)}>
            <span className="mini-rank">{index + 1}</span>
            <span className="mini-sym">{item.symbol}</span>
            <Pill color={verdictColor(item.verdict)}>{(item.verdict || "").replaceAll("_", " ")}</Pill>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_WATCHLIST);
  const [strategy, setStrategy] = useState("swing");
  const [horizon, setHorizon] = useState("");
  const [recentAsks, setRecentAsks] = useState(readRecent);
  const [dashLoading, setDashLoading] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Verdict");
  const [showSettings, setShowSettings] = useState(false);

  const onSubmitRef = useRef(null);
  const errorTimerRef = useRef(null);

  // Auto-dismiss errors after 8 seconds so they don't persist across tabs.
  function showError(msg) {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) {
      errorTimerRef.current = setTimeout(() => setError(""), 8_000);
    }
  }

  // Clear error whenever the user switches tabs — it's always stale by then.
  function switchTab(tab) {
    setActiveTab(tab);
    setError("");
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }

  const focus = analysisResult?.found ? analysisResult.analysis : dashboard?.focus || null;
  const answer = analysisResult?.found ? analysisResult.answer : "";
  const unresolved = analysisResult && !analysisResult.found ? analysisResult : null;
  const allStrategies = analysisResult?.found ? (analysisResult.allStrategies || []) : [];
  const strategyConsensus = analysisResult?.found ? (analysisResult.strategyConsensus || null) : null;
  const strategySelection = analysisResult?.found ? (analysisResult.strategySelection || null) : null;
  // Phase 1.7 — snapshot freshness for the asOf banner.
  // Prefer the /api/ask snapshot's asOf; fall back to dashboard's captured time.
  const dataSnapshotId = analysisResult?.snapshotId ?? null;
  const dataAsOf = analysisResult?.asOf ?? dashboard?.asOf ?? dashboard?.generatedAt ?? null;

  async function loadDashboard(preserve = false, { silentRetry = false } = {}) {
    if (!silentRetry) {
      setDashLoading(true);
      setError("");
    }
    try {
      // Cap to 6 symbols client-side to match the server limit.
      const cappedSymbols = symbolsInput
        .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6).join(",");
      const params = new URLSearchParams({ symbols: cappedSymbols, strategy });
      if (horizon) {
        params.set("horizonDays", horizon);
      }
      const nextDashboard = await apiFetch(`/api/dashboard?${params.toString()}`);

      // Server returns _partial:true + skeleton rows when the build exceeds
      // the Netlify function timeout. Show the skeleton immediately, then
      // silently retry once — by then the Blob cache should be warm.
      if (nextDashboard?._partial) {
        setDashboard(nextDashboard);
        if (!preserve) {
          setAnalysisResult(null);
        }
        setError("");
        setTimeout(() => {
          loadDashboard(true, { silentRetry: true });
        }, 5000);
        return;
      }

      if (nextDashboard?.timedOut) {
        showError("Dashboard timed out — showing partial results. Try fewer symbols.");
      }
      setDashboard(nextDashboard);
      if (!preserve) {
        setAnalysisResult(null);
      }
    } catch (nextError) {
      const msg = nextError.message || "Dashboard load failed.";
      if (!silentRetry) {
        showError(msg.includes("504") || msg.includes("timed out")
          ? "Analysis timed out. Reduce the symbol list to 4–5 stocks and try again."
          : msg);
      }
    } finally {
      if (!silentRetry) {
        setDashLoading(false);
      }
    }
  }

  function rememberAsk(query, symbol = "", companyName = "") {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return;
    }
    const merged = [
      { query: trimmed, symbol, companyName, at: new Date().toISOString() },
      ...recentAsks.filter((item) => item.query !== trimmed),
    ].slice(0, 8);
    writeRecent(merged);
    setRecentAsks(merged);
  }

  async function runAsk(query, symbol = "", companyName = "", { forceRefresh = false } = {}) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return;
    }

    // Clear previous result immediately so the UI never shows the OLD stock
    // while waiting for the new one. If the user clicked "APOLLO" after
    // viewing "ICICIBANK", we reset so the loading state is unambiguous.
    setAnalysisResult(null);
    setAskLoading(true);
    setError("");

    try {
      let payload = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          // Pass explicit symbol so backend skips freetext extraction (faster,
          // more accurate — avoids APOLLO/APOLLOHOSP ambiguity).
          symbol: symbol || undefined,
          includeAllStrategies: true,
          // forceRefresh bypasses the Blobs snapshot cache (Phase 1.4/1.7).
          forceRefresh: forceRefresh || undefined,
        }),
      });

      if (!payload.found && (!Array.isArray(payload.suggestions) || payload.suggestions.length === 0)) {
        try {
          const fallback = await apiFetch(`/api/search/semantic?q=${encodeURIComponent(trimmed)}&limit=5`);
          const items = Array.isArray(fallback.items) && fallback.items.length
            ? fallback.items
            : (await apiFetch(`/api/universe?q=${encodeURIComponent(trimmed)}&limit=5`)).items || [];
          if (Array.isArray(items) && items.length) {
            payload = {
              ...payload,
              suggestions: items.map((item) => ({
                symbol: item.symbol,
                companyName: item.companyName || item.name,
              })),
            };
          }
        } catch {
          // Keep the original unresolved payload.
        }
      }

      // Backend timed out — show a friendly retry prompt instead of stale stock.
      if (payload.timedOut) {
        showError(`Analysis for ${symbol || payload.query || "this stock"} timed out — server is warming up. Try again in a moment.`);
        setAnalysisResult(null);
      } else {
        setAnalysisResult(payload);
        switchTab("Verdict");
        if (payload.found) {
          rememberAsk(trimmed, payload.symbol || symbol, payload.companyName || companyName);
        }
      }
    } catch (nextError) {
      const msg = nextError.message || "Ask failed.";
      showError(msg.includes("502") || msg.includes("504") || msg.includes("timeout")
        ? `Analysis for ${symbol || "this stock"} timed out — server is warming up. Try again in a moment.`
        : msg);
    } finally {
      setAskLoading(false);
    }
  }

  onSubmitRef.current = runAsk;

  function focusSymbol(symbol, companyName = "") {
    const query = `Analyze ${symbol}${companyName ? ` (${companyName})` : ""} across all strategies with full evidence`;
    if (SearchBar._setTextRef) {
      SearchBar._setTextRef(query);
    }
    runAsk(query, symbol, companyName);
  }

  function connectUpstox() {
    window.location.href = "/upstox/connect";
  }

  useEffect(() => {
    loadDashboard(true);
  }, []);

  useEffect(() => {
    const handleSlashFocus = (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        document.getElementById("query-input")?.focus();
      }
    };
    window.addEventListener("keydown", handleSlashFocus);
    return () => {
      window.removeEventListener("keydown", handleSlashFocus);
    };
  }, []);

  const quickSymbols = [...new Set([...(dashboard?.leaders || []).map((item) => item.symbol), ...DEFAULT_QUICK])].slice(0, 12);

  return (
    <div className="app">
      <Sidebar
        dashboard={dashboard}
        onFocus={focusSymbol}
        activeTab={activeTab}
        setActiveTab={switchTab}
      />

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">Superbrain India</span>
            <span className="topbar-regime">{dashboard?.marketContext?.regime || "Loading"}</span>
          </div>
          <div className="topbar-right">
            <button className="btn-secondary" type="button" onClick={connectUpstox}>
              Upstox Connect
            </button>
            <button className="btn-secondary" type="button" onClick={() => loadDashboard(true)} disabled={dashLoading}>
              {dashLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button className="icon-btn" type="button" onClick={() => setShowSettings((value) => !value)} title="Settings">
              S
            </button>
          </div>
        </header>
        {/* Phase 1.7 — snapshot freshness banner */}
        <AsOfBanner
          asOf={dataAsOf}
          snapshotId={dataSnapshotId}
          loading={askLoading || dashLoading}
          onRefresh={() => {
            if (analysisResult?.found && analysisResult.symbol) {
              runAsk(
                `Analyze ${analysisResult.symbol}`,
                analysisResult.symbol,
                analysisResult.companyName,
                { forceRefresh: true },
              );
            } else {
              loadDashboard(true);
            }
          }}
        />

        <div className="main-scroll">

          {error ? (
            <div className="error-bar" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="error-bar-dismiss"
                onClick={() => { setError(""); if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }}
                aria-label="Dismiss"
              >✕</button>
            </div>
          ) : null}
          <ResolutionPanel result={unresolved} onFocus={focusSymbol} />

          {showSettings ? (
            <div className="settings-panel">
              <Kicker>Dashboard Settings</Kicker>
              <p className="muted settings-note">These filters only affect the watchlist dashboard. Stock search always runs all strategies and shows the full evidence stack.</p>
              <div className="settings-grid">
                <label className="field">
                  <span>Watchlist</span>
                  <input value={symbolsInput} onChange={(event) => setSymbolsInput(event.target.value)} />
                </label>
                <label className="field">
                  <span>Dashboard Bias</span>
                  <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                    <option value="swing">Swing</option>
                    <option value="position">Position</option>
                    <option value="longterm">Long Term</option>
                    <option value="intraday">Intraday</option>
                  </select>
                </label>
                <label className="field">
                  <span>Dashboard Horizon</span>
                  <select value={horizon} onChange={(event) => setHorizon(event.target.value)}>
                    <option value="">Auto</option>
                    <option value="20">20 Days</option>
                    <option value="60">60 Days</option>
                    <option value="240">12 Months</option>
                  </select>
                </label>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    loadDashboard();
                  }}
                >
                  Apply Dashboard Filters
                </button>
              </div>
              <div className="integration-strip">
                <div>
                  <Kicker>Broker Integration</Kicker>
                  <p>Open the Upstox authorization flow when you want local OAuth and broker-backed quote access. Status is intentionally kept out of the main dashboard.</p>
                </div>
                <button className="btn-secondary" type="button" onClick={connectUpstox}>
                  Open Upstox Connect
                </button>
              </div>
            </div>
          ) : null}

          <div className="tab-content">
            {activeTab === "Verdict" ? (
              <>
                <section className="search-section">
                  <div className="search-shell">
                    <div className="search-hero-row">
                      <div className="search-copy">
                        <Kicker>Ask Superbrain</Kicker>
                        <h1>AI research cockpit for Indian equities.</h1>
                      </div>
                      <SearchVisualPanel dashboard={dashboard} focus={focus} />
                    </div>
                    <SearchBar onSubmitRef={onSubmitRef} loading={askLoading} recentAsks={recentAsks} />
                    <div className="quick-chips">
                      {quickSymbols.map((symbol) => (
                        <button key={symbol} className="quick-chip" type="button" onClick={() => focusSymbol(symbol)}>
                          {symbol}
                        </button>
                      ))}
                    </div>
                    {recentAsks.length ? (
                      <div className="recent-row">
                        <span className="muted">Recent</span>
                        {recentAsks.slice(0, 5).map((item) => (
                          <button
                            key={item.at}
                            className="recent-chip"
                            type="button"
                            onClick={() => {
                              if (SearchBar._setTextRef) {
                                SearchBar._setTextRef(item.query);
                              }
                              runAsk(item.query);
                            }}
                          >
                            {item.symbol || item.query.slice(0, 20)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
                <section className="hero-grid">
                  <div className="hero-card hero-card-summary">
                    <div className="hero-card-head">
                      <div>
                        <Kicker>Decision Overview</Kicker>
                        <h2 style={{fontSize:"28px",fontWeight:800,letterSpacing:"-0.5px",marginTop:"2px"}}>{focus?.symbol || "Market Overview"}</h2>
                      </div>
                      {focus?.verdict
                        ? <div className={`do-verdict-pill do-verdict-${verdictColor(focus.verdict)}`}>{fmtVerdict(focus.verdict)}</div>
                        : <div className="do-verdict-pill do-verdict-default">Awaiting</div>}
                    </div>
                    <p style={{fontSize:"13px",color:"var(--muted)",lineHeight:1.5,marginBottom:"16px",minHeight:"44px"}}>
                      {answer || focus?.recommendation?.summary || "Search any Indian stock to see the full cross-strategy verdict and evidence stack."}
                    </p>
                    <div className="do-stat-row">
                      <div className="do-stat">
                        <span className="do-stat-val">{fmt(dashboard?.summary?.avgConfidence, "%", 0)}</span>
                        <span className="do-stat-label">Avg Confidence</span>
                        <div className="do-conf-bar"><div className="do-conf-fill" style={{width:`${Math.min(100, dashboard?.summary?.avgConfidence || 0)}%`}} /></div>
                      </div>
                      <div className="do-stat-divider" />
                      <div className="do-stat">
                        <span className="do-stat-val do-stat-green">{dashboard?.summary?.buySignals || 0}</span>
                        <span className="do-stat-label">Buy Setups</span>
                      </div>
                      <div className="do-stat-divider" />
                      <div className="do-stat">
                        <span className="do-stat-val do-stat-red">{dashboard?.summary?.sellSignals || 0}</span>
                        <span className="do-stat-label">Sell Setups</span>
                      </div>
                    </div>
                  </div>
                  <MarketGraphic dashboard={dashboard} focus={focus} />
                </section>
                <ResearchQualityCard focus={focus} dashboard={dashboard} />
                <VerdictCard focus={focus} answer={answer} disclaimer={dashboard?.disclaimer} allStrategies={allStrategies} strategyConsensus={strategyConsensus} strategySelection={strategySelection} />
              </>
            ) : null}
            {activeTab === "AI Report" ? <GodLevelReportPanel focus={focus} /> : null}
            {activeTab === "Evidence" ? <ReasonPanel focus={focus} answer={answer} allStrategies={allStrategies} strategyConsensus={strategyConsensus} strategySelection={strategySelection} /> : null}
            {activeTab === "Advanced" ? <AdvancedIntelPanel focus={focus} dashboard={dashboard} /> : null}
            {activeTab === "Long Term" ? <LongTermPanel focus={focus} /> : null}
            {activeTab === "Market" ? <MarketPanel dashboard={dashboard} /> : null}
            {activeTab === "News" ? <NewsPanel focus={focus} dashboard={dashboard} /> : null}
            {activeTab === "Signal Radar" ? <TopSignalsTab onFocus={focusSymbol} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
