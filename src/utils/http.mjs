import { config } from "../config.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "SuperbrainIndia/1.0 (+Indian market intelligence service)",
  accept: "application/json,text/plain,text/html,application/xml,text/xml,*/*",
};

function buildUrl(url, params = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || config.httpTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      headers: {
        ...DEFAULT_HEADERS,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(buildUrl(url, options.params), options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(buildUrl(url, options.params), options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}
