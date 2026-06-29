const DEFAULT_JSON_TIMEOUT_MS = 12000;

export class HttpRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HttpRequestError";
    this.status = options.status || 0;
    this.payload = options.payload || {};
    this.code = options.code || this.payload.code || "";
    this.retryAfterSeconds = options.retryAfterSeconds || this.payload.retryAfterSeconds || 0;
    if (options.cause) this.cause = options.cause;
  }
}

function createTimeoutReason() {
  if (typeof DOMException === "function") return new DOMException("Request timed out", "TimeoutError");
  return Object.assign(new Error("Request timed out"), { name: "TimeoutError" });
}

function abortController(controller, reason) {
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function mergeSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  activeSignals.forEach((signal) => {
    if (signal.aborted) {
      abortController(controller, signal.reason);
      return;
    }
    signal.addEventListener("abort", () => abortController(controller, signal.reason), { once: true });
  });
  return controller.signal;
}

export function isRequestAbortError(error) {
  return error?.name === "AbortError";
}

export async function fetchJsonWithTimeout(url, options = {}) {
  const {
    timeoutMs = DEFAULT_JSON_TIMEOUT_MS,
    signal,
    ...fetchOptions
  } = options;
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortController(timeoutController, createTimeoutReason());
  }, timeoutMs);
  const requestSignal = mergeSignals([signal, timeoutController.signal]);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: requestSignal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new HttpRequestError(payload.error || `HTTP ${response.status}`, {
        status: response.status,
        payload,
      });
    }
    return { response, payload };
  } catch (error) {
    if (timedOut) {
      throw new HttpRequestError("Request timed out", {
        code: "request_timeout",
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
