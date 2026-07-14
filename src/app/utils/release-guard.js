const recoveryKey = "__renaiss_release_recovery_at__";
const recoveryCooldownMs = 30_000;

function loadedEntryAssetPath() {
  const scripts = document.querySelectorAll('script[type="module"][src]');
  for (const script of scripts) {
    const path = new URL(script.src, window.location.origin).pathname;
    if (/^\/assets\/index-[^/]+\.js$/.test(path)) return path;
  }
  return "";
}

function canRecoverCurrentTab() {
  try {
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(recoveryKey) || 0);
    if (now - previous < recoveryCooldownMs) return false;
    window.sessionStorage.setItem(recoveryKey, String(now));
  } catch {
    // Reloading once is still preferable to leaving a stale release active.
  }
  return true;
}

export function startReleaseGuard() {
  if (!import.meta.env.PROD || typeof window === "undefined") return;

  const entryAssetPath = loadedEntryAssetPath();
  if (!entryAssetPath) return;

  void fetch("/api/client-release", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-renaiss-client-entry": entryAssetPath },
  })
    .then(async (response) => ({ response, payload: await response.json() }))
    .then(({ response, payload }) => {
      if (response.status !== 409 || payload?.entryAssetPath === entryAssetPath) return;
      if (canRecoverCurrentTab()) window.location.replace(window.location.href);
    })
    .catch(() => {
      // The app remains usable when a transient release check fails.
    });
}
