function normalizeIssuer(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getRenaissProviderSignOutUrl(authSession, authConfig) {
  const sessionIssuer = authSession?.identity?.provider === "renaiss"
    ? normalizeIssuer(authSession.identity?.issuer)
    : "";
  if (sessionIssuer) return `${sessionIssuer}/sign-out`;

  const configUrl = String(authConfig?.renaiss?.signOutUrl || authSession?.config?.renaiss?.signOutUrl || "").trim();
  return configUrl || "";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestRenaissProviderSignOut(authSession, authConfig, options = {}) {
  if (typeof window === "undefined") return false;

  const signOutUrl = getRenaissProviderSignOutUrl(authSession, authConfig);
  if (!signOutUrl) return false;

  const waitForFetch = options.waitForFetch !== false;
  const payload = "{}";
  const jsonBlob = new Blob([payload], { type: "application/json" });
  let attempted = false;

  try {
    attempted = Boolean(window.navigator?.sendBeacon?.(signOutUrl, jsonBlob));
  } catch {
    attempted = false;
  }

  if (!waitForFetch) return attempted;

  try {
    await Promise.race([
      fetch(signOutUrl, {
        method: "POST",
        mode: "no-cors",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: payload,
      }),
      wait(650),
    ]);
    attempted = true;
  } catch {
    // The provider does not expose CORS for this endpoint. The beacon above is
    // the primary browser-compatible sign-out attempt; failures are non-fatal
    // because local logout must still complete.
  }

  if (attempted) await wait(220);
  return attempted;
}
