export class SuperbrainClient {
  constructor(baseUrl = "http://127.0.0.1:3210") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Superbrain request failed: ${response.status}`);
    }

    return response.json();
  }

  health() {
    return this.request("/api/health");
  }

  dashboard(query = "") {
    const suffix = query ? `?${query}` : "";
    return this.request(`/api/dashboard${suffix}`);
  }

  analyze(payload) {
    return this.request("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  news(symbol) {
    const suffix = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    return this.request(`/api/news${suffix}`);
  }

  macro() {
    return this.request("/api/macro");
  }
}
