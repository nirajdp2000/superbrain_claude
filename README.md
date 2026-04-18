# Superbrain India

Superbrain India is a standalone stock-intelligence app for Indian equities. It serves a backend API and a built frontend from one Node.js process, so local setup is simple: install dependencies, copy the env file, and start the server.

## What This App Does

- Analyzes NSE/BSE stocks with technical, fundamental, macro, and news context.
- Shows cross-strategy results on one screen: intraday, swing, short term, and long term.
- Surfaces evidence quality, verified headlines, source discipline, and risk context.
- Supports optional Upstox integration for broker-backed market data.
- Serves the UI and API from the same local app.

## Prerequisites

- Node.js 20 or newer
- npm
- Windows, macOS, or Linux

## Quick Start

### 1. Go to the project folder

If you are starting from the workspace parent directory:

```bash
cd superbrain_ai-superbrain_ai
```

If you are already inside the project root, skip this step.

### 2. Install dependencies

```bash
npm install
```

If PowerShell blocks `npm`, use:

```powershell
npm.cmd install
```

### 3. Create your env file

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

### 4. Start the app

```bash
npm start
```

If PowerShell blocks `npm`, use:

```powershell
npm.cmd start
```

### 5. Open the app

- UI: [http://localhost:3210](http://localhost:3210)
- Health check: [http://localhost:3210/api/health](http://localhost:3210/api/health)

If the app is running correctly, `/api/health` returns JSON with `"ok": true`.

## Netlify Deployment

This project is now wired for Netlify with:

- Static frontend publish directory: `public/`
- Netlify Functions entrypoint: `netlify/functions/server.mjs`
- Shared API/function handler: `src/netlify-handler.mjs`
- Netlify config file: `netlify.toml`

### Netlify port rules

- Standalone local Node server: `3210`
- Vite frontend dev server: `5173`
- Netlify Dev public URL: `8888`
- Netlify production: no custom listen port is required

That means:

- `npm start` still serves the standalone app on `http://localhost:3210`
- `npm run ui:dev` still runs Vite on `http://localhost:5173`
- `netlify dev` should expose the app on `http://localhost:8888`

### Netlify deploy settings

- Build command: `npm run build`
- Publish directory: `public`
- Functions directory: `netlify/functions`

### Upstox redirect URI for Netlify

When deploying on Netlify, configure Upstox with:

```env
UPSTOX_REDIRECT_URI=https://your-site.netlify.app/api/upstox/callback
```

Do not use `localhost:3210` as the redirect URI in production.

Netlify note:

- Broker token file writes now fall back safely in serverless mode, but durable token persistence is still best handled through environment variables or an external store.

## Fast Local Run Checklist

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm start`.
5. Open `http://localhost:3210`.

## Environment Variables

Default `.env.example`:

```env
PORT=3210
SUPERBRAIN_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
SUPERBRAIN_ADMIN_TOKEN=change-me
SUPERBRAIN_TOKEN_DB_PATH=./data/upstox-token-store.json
SUPERBRAIN_HTTP_TIMEOUT_MS=9000
SUPERBRAIN_UPSTOX_PROXY_URL=http://127.0.0.1:3000

UPSTOX_CLIENT_ID=
UPSTOX_CLIENT_SECRET=
UPSTOX_REDIRECT_URI=http://localhost:3210/api/upstox/callback
UPSTOX_ACCESS_TOKEN=
UPSTOX_REFRESH_TOKEN=
```

### Minimum required for local run

You can run the app locally with only:

```env
PORT=3210
SUPERBRAIN_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
SUPERBRAIN_ADMIN_TOKEN=change-me
SUPERBRAIN_TOKEN_DB_PATH=./data/upstox-token-store.json
SUPERBRAIN_HTTP_TIMEOUT_MS=9000
```

Upstox values are optional unless you want broker-backed data.

## Upstox Integration

You have two options:

### Option 1. Run without Upstox

- Leave the Upstox credentials empty.
- The app still runs and falls back to public/simulated data when needed.

### Option 2. Use Upstox locally

Fill these values in `.env`:

```env
UPSTOX_CLIENT_ID=your_client_id
UPSTOX_CLIENT_SECRET=your_client_secret
UPSTOX_REDIRECT_URI=http://localhost:3210/api/upstox/callback
```

Then start the app and open:

- [http://localhost:3210/upstox/connect](http://localhost:3210/upstox/connect)

### Option 3. Use Upstox on Netlify

Add the same credentials in Netlify site environment variables and set:

```env
UPSTOX_REDIRECT_URI=https://your-site.netlify.app/api/upstox/callback
```

Then use:

- `https://your-site.netlify.app/upstox/connect`

## Project Scripts

```json
{
  "dev": "node --watch src/server.mjs",
  "start": "node src/server.mjs",
  "ui:dev": "vite --config frontend/vite.config.mjs",
  "ui:build": "vite build --config frontend/vite.config.mjs",
  "build": "npm run ui:build"
}
```

### When to use each script

- `npm start`: normal local run
- `npm run dev`: backend auto-restart while editing server code
- `npm run ui:dev`: Vite frontend dev mode
- `npm run build`: rebuild frontend assets into `public/`
- `netlify dev`: local Netlify-style run on port `8888`

If PowerShell blocks npm:

- `npm.cmd run dev`
- `npm.cmd run ui:dev`
- `npm.cmd run build`

## Recommended Local Development Flow

### Backend-only changes

```bash
npm run dev
```

### Frontend changes

Use Vite during UI work:

```bash
npm run ui:dev
```

Then rebuild the shipped frontend bundle:

```bash
npm run build
```

### Full app smoke test

```bash
npm start
```

Then verify:

```bash
curl http://localhost:3210/api/health
```

Or open it in your browser.

## Main API Endpoints

- `GET /api/health`
- `GET /api/universe?q=bank`
- `GET /api/search/semantic?q=reliance`
- `GET /api/search/fuzzy?q=relince`
- `GET /api/dashboard?symbols=RELIANCE,TCS`
- `POST /api/analyze`
- `POST /api/ask`
- `GET /api/news?symbol=RELIANCE`
- `GET /api/macro`
- `GET /api/upstox/status`
- `POST /api/upstox/token`
- `GET /api/upstox/connect`

## Example API Request

```json
{
  "query": "Analyze RELIANCE across all strategies with full evidence",
  "includeAllStrategies": true
}
```

## Folder Guide

- `src/server.mjs`: HTTP server
- `src/netlify-handler.mjs`: Netlify serverless request handler
- `src/services/analysis-service.mjs`: stock analysis and strategy logic
- `frontend/src/App.jsx`: main UI
- `frontend/src/styles.css`: app styling
- `public/`: built frontend assets served by the Node app
- `netlify/functions/server.mjs`: Netlify Functions entrypoint
- `netlify.toml`: Netlify build and dev configuration
- `data/`: local data files and token store
- `logs/`: runtime logs

## Troubleshooting

### Port 3210 is already in use

Change the port in `.env`:

```env
PORT=3211
```

Then restart the app.

### PowerShell says npm is blocked

Use `npm.cmd` instead of `npm`:

```powershell
npm.cmd install
npm.cmd start
```

### Frontend changes do not appear

Rebuild the frontend bundle:

```bash
npm run build
```

Then restart the server.

### Upstox is not connecting

Check:

1. `UPSTOX_CLIENT_ID`
2. `UPSTOX_CLIENT_SECRET`
3. `UPSTOX_REDIRECT_URI`
4. That the redirect URI in Upstox matches `http://localhost:3210/api/upstox/callback`

For Netlify production, item 4 becomes:

- `https://your-site.netlify.app/api/upstox/callback`

## Notes

- This project is an analysis aid, not a guarantee engine.
- Always verify liquidity, execution levels, and your own risk controls before trading.
- The app is opinionated toward Indian listed equities.
