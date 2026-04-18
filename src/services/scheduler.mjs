/**
 * Upstox Token Scheduler
 * - Validates token on startup
 * - Auto-refreshes daily at 8:30 AM IST (3:00 AM UTC) before market open
 * - Retries refresh on failure with exponential backoff
 */

import { config } from "../config.mjs";
import { getValidAccessToken, refreshTokenNow } from "./upstox-service.mjs";

let dailyTimer = null;
let retryTimer = null;

function msUntilNext330AmIST() {
  const now = new Date();
  const target = new Date();
  // 8:30 AM IST = 3:00 AM UTC
  target.setUTCHours(3, 0, 0, 0);
  if (now >= target) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

async function performDailyRefresh(attempt = 1) {
  console.log(`[Scheduler] Daily token refresh attempt ${attempt}...`);
  try {
    const token = await refreshTokenNow();
    if (token) {
      console.log("[Scheduler] Token refreshed successfully.");
    } else {
      console.warn("[Scheduler] No refresh token available — manual re-auth may be needed.");
    }
  } catch (err) {
    console.error("[Scheduler] Refresh failed:", err.message);
    if (attempt < 3) {
      const delay = attempt * 5 * 60 * 1000; // 5min, 10min
      console.log(`[Scheduler] Retrying in ${delay / 60000}m...`);
      retryTimer = setTimeout(() => performDailyRefresh(attempt + 1), delay);
    }
  }
  scheduleDailyRefresh();
}

function scheduleDailyRefresh() {
  if (dailyTimer) clearTimeout(dailyTimer);
  const ms = msUntilNext330AmIST();
  const when = new Date(Date.now() + ms).toISOString();
  console.log(`[Scheduler] Next token refresh scheduled at ${when}`);
  dailyTimer = setTimeout(() => performDailyRefresh(), ms);
}

export async function startScheduler() {
  if (config.isNetlifyRuntime) {
    console.log("[Scheduler] Netlify runtime detected — daily refresh is handled by the scheduled function (netlify/functions/refresh-upstox-token.mjs). Skipping in-process scheduler.");
    return;
  }

  console.log("[Scheduler] Starting...");

  // Validate on startup
  try {
    const token = await getValidAccessToken();
    if (token) {
      console.log("[Scheduler] Startup token validation: OK");
    } else {
      console.warn(`[Scheduler] No valid token on startup. Visit http://localhost:${config.port}/upstox/connect to authenticate.`);
    }
  } catch (err) {
    console.error("[Scheduler] Startup validation error:", err.message);
  }

  scheduleDailyRefresh();
}

export function stopScheduler() {
  if (dailyTimer) clearTimeout(dailyTimer);
  if (retryTimer) clearTimeout(retryTimer);
}
