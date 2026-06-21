const SBT_TIERS = [
  { tier: "rainbow", threshold: 600, multiplier: 3 },
  { tier: "gold", threshold: 250, multiplier: 2 },
  { tier: "silver", threshold: 100, multiplier: 1.5 },
  { tier: "brown", threshold: 40, multiplier: 1.2 },
];

export function compactAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getSbtTier(rawTickets) {
  const raw = Math.max(0, Math.floor(Number(rawTickets) || 0));
  return SBT_TIERS.find((row) => raw >= row.threshold) ?? { tier: "none", multiplier: 1 };
}

export function calculateRawTickets(packs = {}, packRules = []) {
  const weights = Object.fromEntries(packRules.map((rule) => [rule.pack, rule.ticketWeight]));
  return Object.entries(packs).reduce((total, [pack, count]) => {
    return total + Math.max(0, Math.floor(Number(count) || 0)) * (weights[pack] || 0);
  }, 0);
}

export function calculateFinalTickets(rawTickets, multiplier) {
  return Math.ceil(Math.max(0, Number(rawTickets) || 0) * Math.max(1, Number(multiplier) || 1));
}

export function estimateMultiPrizeChance(userEntries, totalPoolEntries, prizeCount) {
  const user = Math.max(0, Number(userEntries) || 0);
  const pool = Math.max(0, Number(totalPoolEntries) || 0);
  const prizes = Math.max(0, Number(prizeCount) || 0);
  if (user <= 0 || pool <= 0 || prizes <= 0) return 0;
  if (user >= pool) return 1;
  return 1 - Math.pow((pool - user) / pool, prizes);
}

export function formatPercent(value, digits = 3) {
  const percent = Math.max(0, Number(value) || 0) * 100;
  if (percent > 0 && percent < 0.001) return "<0.001%";
  return `${percent.toFixed(digits)}%`;
}

export function formatDateTime(value, locale = "zh-Hant") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeIntlLocale(locale) {
  return locale === "zh-Hant" ? "zh-Hant" : "en-US";
}

export function formatNumber(value, locale = "en-US") {
  return new Intl.NumberFormat(normalizeIntlLocale(locale)).format(Math.max(0, Math.floor(Number(value) || 0)));
}

export function formatCurrencyAmount(value, locale = "en-US") {
  const amount = Math.max(0, Number(value) || 0);
  const hasFraction = Math.abs(amount - Math.round(amount)) > Number.EPSILON;
  return new Intl.NumberFormat(normalizeIntlLocale(locale), {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPrizeMoney(value, currency = "USDT", locale = "en-US") {
  const amount = formatCurrencyAmount(value, locale);
  const normalizedCurrency = String(currency || "USDT").toUpperCase();
  if (normalizedCurrency === "USDT" || normalizedCurrency === "USD") return `US$${amount}`;
  return `${amount} ${currency}`;
}

export function formatCompactVoteCount(value, locale = "zh-Hant") {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return new Intl.NumberFormat(normalizeIntlLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

export function ticketRangeLabel(entry) {
  if (!entry?.ticketStart || !entry?.ticketEnd) return "-";
  return `#${formatNumber(entry.ticketStart)}-${formatNumber(entry.ticketEnd)}`;
}
