/**
 * Renders the Upstox connect/status HTML page.
 */

const STYLES = `
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0b;color:#e4e4e7;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#18181b;border:1px solid rgba(255,255,255,0.07);border-radius:24px;padding:40px;max-width:520px;width:100%;box-shadow:0 32px 80px rgba(0,0,0,0.6)}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:32px}
.logo-icon{width:40px;height:40px;background:linear-gradient(135deg,#2563eb,#0f766e);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
.logo-text{font-size:18px;font-weight:800;letter-spacing:-0.5px}
.logo-sub{font-size:10px;color:#71717a;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;margin-top:2px}
h1{font-size:22px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px}
.subtitle{font-size:13px;color:#71717a;margin-bottom:28px}
.badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:28px}
.badge-green{background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#34d399}
.badge-red{background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-green{background:#10b981;box-shadow:0 0 8px rgba(16,185,129,0.8)}
.dot-red{background:#ef4444;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
.info-card{background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px}
.info-label{font-size:9px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:6px}
.info-value{font-size:13px;font-weight:700;color:#e4e4e7}
.green{color:#34d399}
.amber{color:#fbbf24}
.steps-box{background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:20px;margin-bottom:24px}
.section-label{font-size:9px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:14px}
.step{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.step:last-child{margin-bottom:0}
.step-num{width:22px;height:22px;border-radius:50%;background:rgba(37,99,235,0.15);border:1px solid rgba(37,99,235,0.3);color:#93c5fd;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step-text{font-size:12px;color:#a1a1aa;line-height:1.5}
.benefits{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:24px}
.benefit{display:flex;align-items:center;gap:8px;font-size:11px;color:#a1a1aa;background:#09090b;border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:10px 12px}
.bdot{width:6px;height:6px;border-radius:50%;background:#2563eb;flex-shrink:0}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 24px;border-radius:14px;font-size:13px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;text-decoration:none;border:none;cursor:pointer;transition:all 0.2s;margin-bottom:10px}
.btn-primary{background:linear-gradient(135deg,#2563eb,#0f766e);color:white;box-shadow:0 8px 24px rgba(37,99,235,0.3)}
.btn-secondary{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#a1a1aa}
.warn-box{background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:12px;padding:14px 16px;margin-bottom:24px;display:flex;gap:12px}
.warn-text{font-size:12px;color:#fbbf24;line-height:1.5}
.note{font-size:10px;color:#3f3f46;text-align:center;margin-top:16px;line-height:1.6}
.user-info{background:#09090b;border:1px solid rgba(16,185,129,0.15);border-radius:14px;padding:16px;margin-bottom:24px}
.user-name{font-size:15px;font-weight:700;color:#34d399;margin-bottom:4px}
.user-email{font-size:12px;color:#71717a}
</style>`;

const HTML_ESCAPE = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (match) => HTML_ESCAPE[match]);
}

function getConnectPageContext(options = {}) {
  const deploymentMode = options.deploymentMode === "netlify" ? "netlify" : "local";
  const fallbackOrigin = deploymentMode === "netlify"
    ? "https://your-site.netlify.app"
    : "http://localhost:3210";
  const siteOrigin = String(options.siteOrigin || fallbackOrigin).replace(/\/+$/, "");
  const callbackUrl = escapeHtml(options.callbackUrl || `${siteOrigin}/api/upstox/callback`);
  const safeOrigin = escapeHtml(siteOrigin);

  if (deploymentMode === "netlify") {
    return {
      callbackUrl,
      dashboardUrl: options.dashboardUrl || "/",
      storageLabel: "Runtime cache",
      connectedSubtitle: "Your account is active. Live market data is flowing through this Netlify deployment.",
      connectedNote: "Tokens are cached inside the active Netlify runtime. After a redeploy or cold start, reconnect may be required unless a persistent token is supplied through environment variables.",
      connectStepText: "Redirected back automatically and token cached inside the active Netlify runtime",
      connectNote: `OAuth 2.0 secured. The Upstox redirect URI must exactly match ${callbackUrl}.`,
      callbackStorageText: "Token cached in the active Netlify runtime",
      configSubtitle: `Upstox API credentials are not configured in this Netlify site's environment variables.`,
      configSectionLabel: "Add in Netlify environment variables",
      configLines: [
        "UPSTOX_CLIENT_ID=your_client_id",
        "UPSTOX_CLIENT_SECRET=your_client_secret",
        `UPSTOX_REDIRECT_URI=${callbackUrl}`,
        `SUPERBRAIN_ALLOWED_ORIGINS=${safeOrigin}`,
      ],
      configNote: `In the Upstox developer app, set the redirect URI to ${callbackUrl}. Then add the same values in Netlify Site configuration > Environment variables and trigger a fresh deploy.`,
    };
  }

  return {
    callbackUrl,
    dashboardUrl: options.dashboardUrl || "/",
    storageLabel: "JSON File",
    connectedSubtitle: "Your account is active. Live market data is flowing.",
    connectedNote: "Token auto-refreshes daily at 8:30 AM IST. No manual re-login required.",
    connectStepText: "Redirected back automatically and token saved securely",
    connectNote: "OAuth 2.0 secured. Token stored locally. Never shared.",
    callbackStorageText: "Token stored securely on disk",
    configSubtitle: `Upstox API credentials are not configured in your <code style="color:#93c5fd">.env</code> file.`,
    configSectionLabel: "Add to your .env file",
    configLines: [
      "UPSTOX_CLIENT_ID=your_client_id",
      "UPSTOX_CLIENT_SECRET=your_client_secret",
      `UPSTOX_REDIRECT_URI=${callbackUrl}`,
    ],
    configNote: `After updating <code style="color:#93c5fd">.env</code>, restart <code style="color:#93c5fd">node src/server.mjs</code>.`,
  };
}

export function renderConnectedPage(userInfo, options = {}) {
  const name = userInfo?.userName || userInfo?.userId || "Authenticated";
  const email = userInfo?.email || "";
  const context = getConnectPageContext(options);

  return `<!DOCTYPE html><html><head><title>Upstox Connected - Superbrain</title>${STYLES}</head><body>
<div class="card">
  <div class="logo"><div class="logo-icon">SB</div><div><div class="logo-text">Superbrain</div><div class="logo-sub">India Intelligence</div></div></div>
  <div class="badge badge-green"><div class="dot dot-green"></div>Live Connected</div>
  <h1>Upstox Connected</h1>
  <p class="subtitle">${context.connectedSubtitle}</p>
  ${userInfo ? `<div class="user-info"><div class="user-name">${name}</div>${email ? `<div class="user-email">${email}</div>` : ""}</div>` : ""}
  <div class="grid2">
    <div class="info-card"><div class="info-label">Status</div><div class="info-value green">Active</div></div>
    <div class="info-card"><div class="info-label">Data Source</div><div class="info-value green">Upstox Live</div></div>
    <div class="info-card"><div class="info-label">Auto-Refresh</div><div class="info-value amber">8:30 AM IST</div></div>
    <div class="info-card"><div class="info-label">Token Storage</div><div class="info-value">${context.storageLabel}</div></div>
  </div>
  <div class="benefits">
    <div class="benefit"><div class="bdot"></div>Real-time quotes</div>
    <div class="benefit"><div class="bdot"></div>Live price feed</div>
    <div class="benefit"><div class="bdot"></div>Actual volume</div>
    <div class="benefit"><div class="bdot"></div>Auto token refresh</div>
    <div class="benefit"><div class="bdot"></div>5000+ instruments</div>
    <div class="benefit"><div class="bdot"></div>NSE + BSE data</div>
  </div>
  <a href="/" class="btn btn-primary">Back to Dashboard</a>
  <a href="/api/upstox/status" class="btn btn-secondary">View API Status</a>
  <p class="note">${context.connectedNote}</p>
</div></body></html>`;
}

export function renderConnectPage(authUrl, options = {}) {
  const context = getConnectPageContext(options);

  return `<!DOCTYPE html><html><head><title>Connect Upstox - Superbrain</title>${STYLES}</head><body>
<div class="card">
  <div class="logo"><div class="logo-icon">SB</div><div><div class="logo-text">Superbrain</div><div class="logo-sub">India Intelligence</div></div></div>
  <div class="badge badge-red"><div class="dot dot-red"></div>Not Connected</div>
  <h1>Connect to Upstox</h1>
  <p class="subtitle">Authorize once to unlock live market data.</p>
  <div class="warn-box">
    <div style="font-size:16px;flex-shrink:0">!</div>
    <div class="warn-text"><strong>Currently using simulated data.</strong> Connect your Upstox account to switch to real-time live market feeds instantly.</div>
  </div>
  <div class="steps-box">
    <div class="section-label">What happens next</div>
    <div class="step"><div class="step-num">1</div><div class="step-text">Redirected to the Upstox login page</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-text">Login with your Upstox credentials</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-text">Authorize Superbrain to access market data</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-text">${context.connectStepText}</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-text">Live data activates instantly</div></div>
  </div>
  <div class="benefits">
    <div class="benefit"><div class="bdot"></div>Real-time quotes</div>
    <div class="benefit"><div class="bdot"></div>Live price feed</div>
    <div class="benefit"><div class="bdot"></div>Actual volume data</div>
    <div class="benefit"><div class="bdot"></div>5000+ instruments</div>
    <div class="benefit"><div class="bdot"></div>NSE + BSE coverage</div>
    <div class="benefit"><div class="bdot"></div>Auto daily refresh</div>
  </div>
  <a href="${authUrl}" class="btn btn-primary">Authorize Upstox Account</a>
  <a href="/" class="btn btn-secondary">Back to Dashboard</a>
  <p class="note">${context.connectNote}</p>
</div></body></html>`;
}

export function renderCallbackSuccess(userInfo, options = {}) {
  const name = userInfo?.userName || userInfo?.userId || "your account";
  const dashboardUrl = options.dashboardUrl || options.redirectUrl || "/";
  const redirectUrl = options.redirectUrl || dashboardUrl;
  const context = getConnectPageContext({ ...options, dashboardUrl });

  return `<!DOCTYPE html><html><head><title>Connected - Superbrain</title>${STYLES}
<script>setTimeout(() => location.replace(${JSON.stringify(redirectUrl)}), 2500)</script>
</head><body>
<div class="card">
  <div class="logo"><div class="logo-icon">SB</div><div><div class="logo-text">Superbrain</div><div class="logo-sub">India Intelligence</div></div></div>
  <div class="badge badge-green"><div class="dot dot-green"></div>Connected</div>
  <h1>Upstox Connected</h1>
  <p class="subtitle">Welcome, ${name}. Live market data is now active.</p>
  <div class="steps-box">
    <div class="section-label">What's active now</div>
    <div class="step"><div class="step-num">OK</div><div class="step-text">${context.callbackStorageText}</div></div>
    <div class="step"><div class="step-num">OK</div><div class="step-text">Auto-refresh scheduled for 8:30 AM IST daily</div></div>
    <div class="step"><div class="step-num">OK</div><div class="step-text">Live quotes now flowing from Upstox</div></div>
  </div>
  <a href="${dashboardUrl}" class="btn btn-primary">Open Dashboard</a>
  <p class="note">Redirecting to dashboard in 2 seconds...</p>
</div></body></html>`;
}

export function renderCallbackError(message, options = {}) {
  const retryUrl = options.retryUrl || "/upstox/connect";
  const redirectUrl = options.redirectUrl || retryUrl;

  return `<!DOCTYPE html><html><head><title>Auth Failed - Superbrain</title>${STYLES}
<script>setTimeout(() => location.replace(${JSON.stringify(redirectUrl)}), 4000)</script>
</head><body>
<div class="card">
  <div class="logo"><div class="logo-icon">SB</div><div><div class="logo-text">Superbrain</div><div class="logo-sub">India Intelligence</div></div></div>
  <div class="badge badge-red"><div class="dot dot-red"></div>Auth Failed</div>
  <h1>Connection Failed</h1>
  <p class="subtitle">${message || "Something went wrong during authorization."}</p>
  <a href="${retryUrl}" class="btn btn-primary">Try Again</a>
  <p class="note">Redirecting back to try again in 4 seconds...</p>
</div></body></html>`;
}

export function renderConfigMissingPage(options = {}) {
  const context = getConnectPageContext(options);

  return `<!DOCTYPE html><html><head><title>Setup Required - Superbrain</title>${STYLES}</head><body>
<div class="card">
  <div class="logo"><div class="logo-icon">CFG</div><div><div class="logo-text">Superbrain</div><div class="logo-sub">Configuration</div></div></div>
  <div class="badge badge-red"><div class="dot dot-red"></div>Config Missing</div>
  <h1>Setup Required</h1>
  <p class="subtitle">${context.configSubtitle}</p>
  <div class="steps-box" style="margin-top:20px">
    <div class="section-label">${context.configSectionLabel}</div>
    <div style="font-family:monospace;font-size:11px;color:#93c5fd;line-height:2">${context.configLines.join("<br>")}</div>
  </div>
  <a href="https://account.upstox.com/developer/apps" target="_blank" class="btn btn-primary">Get Credentials from Upstox</a>
  <a href="/" class="btn btn-secondary">Back to Dashboard</a>
  <p class="note">${context.configNote}</p>
</div></body></html>`;
}
