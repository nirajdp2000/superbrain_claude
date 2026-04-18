import { refreshTokenNow } from "../../src/services/upstox-service.mjs";

/**
 * Scheduled daily at 03:00 UTC (08:30 IST — 30 minutes before the NSE opens at 09:15 IST).
 * Uses the stored refresh token to rotate the Upstox access token so live quotes
 * keep working without manual re-auth.
 *
 * Netlify Scheduled Functions docs: https://docs.netlify.com/functions/scheduled-functions/
 */
export default async () => {
  const startedAt = new Date().toISOString();
  try {
    const token = await refreshTokenNow();
    if (token) {
      console.log(`[refresh-upstox-token] Token refreshed successfully at ${startedAt}`);
      return new Response(JSON.stringify({ ok: true, refreshed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    console.warn(`[refresh-upstox-token] No refresh token on record at ${startedAt} — manual re-auth needed.`);
    return new Response(JSON.stringify({ ok: true, refreshed: false, reason: "no-refresh-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error(`[refresh-upstox-token] Refresh failed at ${startedAt}: ${error.message}`);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = {
  schedule: "0 3 * * *",
};
