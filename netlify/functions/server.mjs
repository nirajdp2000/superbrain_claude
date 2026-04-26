import { handleNetlifyRequest } from "../../src/netlify-handler.mjs";

export default async (request, context) => handleNetlifyRequest(request, context);

export const config = {
  path: ["/api/*", "/upstox/*"],
  // Maximum allowed on Netlify Pro (free plan cap is 10s).
  // Set here per-function — the [functions] table in netlify.toml
  // does NOT support a global timeout key.
  timeout: 26,
};
