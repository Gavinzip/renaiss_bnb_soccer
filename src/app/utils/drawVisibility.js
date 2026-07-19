const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/;

export function normalizeVisibilityWallet(value) {
  const address = String(value || "").trim().toLowerCase();
  return WALLET_ADDRESS_PATTERN.test(address) ? address : "";
}

export function parseVisibilityWallets(value) {
  return [...new Set(
    String(value || "")
      .split(/[,\s]+/)
      .map(normalizeVisibilityWallet)
      .filter(Boolean),
  )];
}

export function visibilityFeatureEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function sessionWalletAllowed(authSession, allowedWallets) {
  const walletAddress = normalizeVisibilityWallet(authSession?.walletAddress);
  return Boolean(authSession?.authenticated && walletAddress && allowedWallets.includes(walletAddress));
}

export function canViewDrawRoom({ localToolsEnabled, enabled, allowlist, authSession }) {
  if (localToolsEnabled) return true;
  if (!visibilityFeatureEnabled(enabled)) return false;
  const allowedWallets = parseVisibilityWallets(allowlist);
  if (allowedWallets.length === 0) return true;
  return sessionWalletAllowed(authSession, allowedWallets);
}

export function canViewWinnersFinalDraw({ localToolsEnabled, enabled, allowlist, authSession }) {
  if (localToolsEnabled) return true;
  if (!visibilityFeatureEnabled(enabled)) return false;
  const allowedWallets = parseVisibilityWallets(allowlist);
  if (allowedWallets.length === 0) return false;
  return sessionWalletAllowed(authSession, allowedWallets);
}
