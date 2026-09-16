export const POKEMON30_EVENT = {
  title: "Pokémon 30 週年抽獎活動",
  subtitle: "完成回收且符合最低級 BBBV 對應門檻，即累積抽獎券",
  start: "2026-09-16T19:00:00+08:00",
  end: "2026-09-23T19:00:00+08:00",
  timezone: "香港時間（UTC+8）",
};

export const POKEMON30_TICKET_RULES = [
  { price: "$28", tickets: 1, caption: "Tier C BBBV ≤ $35 · 回收額 ≤ $29.75" },
  { price: "$48", tickets: 2, caption: "Tier C BBBV ≤ $60 · 回收額 ≤ $51" },
  { price: "$88", tickets: 3, caption: "Common BBBV ≤ $90 · 回收額 ≤ $76.50" },
  { price: "$248", tickets: 8, caption: "Common BBBV ≤ $250 · 回收額 ≤ $212.50" },
  { price: "$100", tickets: 5, caption: "限定卡機 · BBBV ≤ $120 · 回收額 ≤ $108（90%）" },
];

export function formatHongKongTime(value, options = {}) {
  return new Intl.DateTimeFormat("zh-Hant-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(new Date(value));
}

export function eventStatus(now = Date.now()) {
  const start = Date.parse(POKEMON30_EVENT.start);
  const end = Date.parse(POKEMON30_EVENT.end);
  if (now < start) return { id: "upcoming", label: "活動即將開始" };
  if (now >= end) return { id: "ended", label: "活動已結束" };
  return { id: "live", label: "活動進行中" };
}
