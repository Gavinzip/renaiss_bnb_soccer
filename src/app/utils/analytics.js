const GA_MEASUREMENT_ID = String(import.meta.env.VITE_GA_MEASUREMENT_ID || "").trim();
const GA_ID_PATTERN = /^G-[A-Z0-9]+$/i;
const PRIVATE_QUERY_PARAMS = new Set(["wallet", "address", "email", "code", "state"]);

let installed = false;

function canUseBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function configuredMeasurementId() {
  return GA_ID_PATTERN.test(GA_MEASUREMENT_ID) ? GA_MEASUREMENT_ID : "";
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
}

function sanitizedCurrentUrl() {
  if (!canUseBrowser()) return { path: "/", location: "" };
  const url = new URL(window.location.href);
  for (const key of PRIVATE_QUERY_PARAMS) url.searchParams.delete(key);
  const path = `${url.pathname}${url.search}${url.hash}`;
  return {
    path,
    location: url.toString(),
  };
}

export function googleAnalyticsConfigured() {
  return Boolean(configuredMeasurementId());
}

export function installGoogleAnalytics() {
  const measurementId = configuredMeasurementId();
  if (!canUseBrowser() || !measurementId || installed) return false;

  ensureGtag();
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

  const scriptId = `ga-gtag-${measurementId}`;
  if (!document.getElementById(scriptId)) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }

  installed = true;
  return true;
}

export function trackPageView({ title = "", viewId = "" } = {}) {
  if (!canUseBrowser() || !configuredMeasurementId() || typeof window.gtag !== "function") return false;
  const { path, location } = sanitizedCurrentUrl();
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: location,
    page_title: title || document.title,
    app_view: viewId || undefined,
  });
  return true;
}

export function trackEvent(name, params = {}) {
  if (!canUseBrowser() || !configuredMeasurementId() || typeof window.gtag !== "function") return false;
  window.gtag("event", name, params);
  return true;
}
