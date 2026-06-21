export function walletProviderLabel(provider, info) {
  if (info?.name) return info.name;
  if (provider?.isRabby) return "Rabby";
  if (provider?.isOkxWallet || provider?.isOKExWallet) return "OKX Wallet";
  if (provider?.isTrust) return "Trust Wallet";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isBraveWallet) return "Brave Wallet";
  if (provider?.isMetaMask) return "MetaMask";
  return "Injected Wallet";
}

export function walletProviderDetail(provider, info) {
  if (info?.rdns) return info.rdns;
  if (provider?.isRabby) return "rabby.io";
  if (provider?.isOkxWallet || provider?.isOKExWallet) return "okx.com";
  if (provider?.isTrust) return "trustwallet.com";
  if (provider?.isCoinbaseWallet) return "coinbase.com";
  if (provider?.isBraveWallet) return "brave.com";
  if (provider?.isMetaMask) return "metamask.io";
  return "browser injected";
}

export function getLegacyWalletProviders() {
  if (typeof window === "undefined") return [];
  const injected = window.ethereum;
  if (!injected) return [];

  const providers = Array.isArray(injected.providers) && injected.providers.length > 0
    ? injected.providers
    : [injected];

  return providers
    .filter((provider) => provider?.request)
    .map((provider) => ({
      provider,
      info: null,
      source: "legacy",
    }));
}

export function normalizeWalletProviders(entries) {
  const seenProviders = new Set();
  const seenKeys = new Set();

  return entries.reduce((providers, entry) => {
    if (!entry?.provider?.request) return providers;
    if (seenProviders.has(entry.provider)) return providers;

    const label = walletProviderLabel(entry.provider, entry.info);
    const detail = walletProviderDetail(entry.provider, entry.info);
    const key = entry.info?.uuid || entry.info?.rdns || `${label}:${detail}`;
    if (seenKeys.has(key)) return providers;

    seenProviders.add(entry.provider);
    seenKeys.add(key);
    providers.push({
      id: key,
      provider: entry.provider,
      label,
      detail,
      source: entry.source,
    });
    return providers;
  }, []);
}
