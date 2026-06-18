const loadedAssets = new Set();

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function scheduleIdleWork(callback, timeout = 1800) {
  if (!canUseDom()) return () => {};

  let cancelled = false;
  let handle = 0;

  const run = () => {
    if (!cancelled) callback();
  };

  if ("requestIdleCallback" in window) {
    handle = window.requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(handle);
    };
  }

  handle = window.setTimeout(run, Math.min(timeout, 450));
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}

export function preloadImage(src) {
  if (!canUseDom() || !src || loadedAssets.has(src)) return Promise.resolve();
  loadedAssets.add(src);

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
  });
}

export function preloadVideo(src) {
  if (!canUseDom() || !src || loadedAssets.has(src)) return Promise.resolve();
  loadedAssets.add(src);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    const finish = () => {
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("error", finish);
      resolve();
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", finish);
    video.addEventListener("error", finish);
    video.src = src;
    video.load();
  });
}

export function addPreloadHint(src, as, type = "") {
  if (!canUseDom() || !src) return;
  const key = `${as}:${src}`;
  if (loadedAssets.has(key)) return;
  loadedAssets.add(key);

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = as;
  link.href = src;
  if (type) link.type = type;
  document.head.appendChild(link);
}
