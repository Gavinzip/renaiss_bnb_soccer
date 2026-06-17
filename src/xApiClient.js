export class XApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "XApiError";
    this.status = details.status;
    this.body = details.body;
    this.rateLimit = details.rateLimit;
  }
}

export class XApiClient {
  constructor({ bearerToken, apiBaseUrl }) {
    this.bearerToken = bearerToken;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  }

  async getUserByUsername(username) {
    return this.#request(`/users/by/username/${encodeURIComponent(username)}`, {
      "user.fields": "id,name,username,protected,verified,public_metrics",
    });
  }

  async getFollowersPage(userId, { maxResults = 1000, paginationToken } = {}) {
    const params = {
      max_results: String(maxResults),
      "user.fields": "id,name,username,protected,verified,public_metrics",
    };

    if (paginationToken) {
      params.pagination_token = paginationToken;
    }

    return this.#request(`/users/${encodeURIComponent(userId)}/followers`, params);
  }

  async #request(pathname, params = {}) {
    const url = new URL(`${this.apiBaseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "User-Agent": "renaiss-x-follower-sync/0.1.0",
      },
    });

    const body = await readJsonBody(response);
    if (!response.ok) {
      throw new XApiError(`X API request failed: ${response.status}`, {
        status: response.status,
        body,
        rateLimit: readRateLimit(response),
      });
    }

    return {
      body,
      rateLimit: readRateLimit(response),
    };
  }
}

async function readJsonBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function readRateLimit(response) {
  return {
    limit: response.headers.get("x-rate-limit-limit"),
    remaining: response.headers.get("x-rate-limit-remaining"),
    reset: response.headers.get("x-rate-limit-reset"),
  };
}
