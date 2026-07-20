import { Loader2, Network, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { fetchJsonWithTimeout } from "../../utils/httpClient";
import {
  getLegacyWalletProviders,
  normalizeWalletProviders,
} from "../../utils/walletProviders";
import { WalletProviderDialog } from "./FinalDrawOperatorExperience";

const SANDBOX_WINNER_ACCESS_TIMEOUT_MS = 15000;

function drawAdminEndpoint(path) {
  const apiOrigin = String(
    import.meta.env.VITE_DRAW_ADMIN_API_ORIGIN || import.meta.env.VITE_LOCAL_API_ORIGIN || ""
  ).replace(/\/$/, "");
  if (!apiOrigin || import.meta.env.PROD) return path;
  return `${apiOrigin}${path}`;
}

function emptyAccess() {
  return {
    checked: false,
    allowed: false,
    address: "",
    expiresAt: null,
  };
}

async function fetchSandboxWinnerAccess(path, options = {}) {
  return fetchJsonWithTimeout(drawAdminEndpoint(path), {
    credentials: "include",
    timeoutMs: SANDBOX_WINNER_ACCESS_TIMEOUT_MS,
    ...options,
  });
}

export function WinnerNetworkSwitcher({
  network = "mainnet",
  loading = false,
  onSelectNetwork,
  onAccessChange,
}) {
  const { t } = useCampaignCopy();
  const [access, setAccess] = useState(emptyAccess);
  const [walletProviders, setWalletProviders] = useState([]);
  const [walletDetecting, setWalletDetecting] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [detectedOperatorWallet, setDetectedOperatorWallet] = useState(null);
  const [connectedWallet, setConnectedWallet] = useState({
    address: "",
    label: "",
    provider: null,
  });
  const [busyAction, setBusyAction] = useState("");
  const [issue, setIssue] = useState("");

  const applyAccess = useCallback((payload) => {
    const next = {
      checked: true,
      allowed: Boolean(payload?.allowed),
      address: String(payload?.address || ""),
      expiresAt: payload?.expiresAt || null,
    };
    setAccess(next);
    onAccessChange?.(next.allowed);
    return next;
  }, [onAccessChange]);

  const refreshAccess = useCallback(async () => {
    try {
      const { payload } = await fetchSandboxWinnerAccess("/api/draw-admin/sandbox-winners/session", {
        cache: "no-store",
      });
      setIssue("");
      return applyAccess(payload);
    } catch (error) {
      applyAccess({ allowed: false });
      return null;
    }
  }, [applyAccess]);

  useEffect(() => {
    refreshAccess();
  }, [refreshAccess]);

  useEffect(() => {
    let active = true;
    const discoveredEntries = [];

    function publish(entries = []) {
      if (!active) return;
      const nextEntries = entries.length > 0 ? entries : discoveredEntries;
      setWalletProviders(normalizeWalletProviders(nextEntries));
    }

    function handleAnnounceProvider(event) {
      const detail = event.detail;
      if (!detail?.provider) return;
      discoveredEntries.push({
        provider: detail.provider,
        info: detail.info || null,
        source: "eip6963",
      });
      publish();
    }

    setWalletDetecting(true);
    window.addEventListener?.("eip6963:announceProvider", handleAnnounceProvider);
    discoveredEntries.push(...getLegacyWalletProviders());
    publish();
    window.dispatchEvent?.(new Event("eip6963:requestProvider"));

    const settleTimer = window.setTimeout(() => {
      if (!active) return;
      setWalletDetecting(false);
      publish();
    }, 420);

    return () => {
      active = false;
      window.clearTimeout(settleTimer);
      window.removeEventListener?.("eip6963:announceProvider", handleAnnounceProvider);
    };
  }, []);

  useEffect(() => {
    if (!access.checked || access.allowed || walletDetecting || detectedOperatorWallet || walletProviders.length === 0) {
      return undefined;
    }

    let active = true;

    async function detectOperatorWallet() {
      for (const walletProvider of walletProviders) {
        let accounts = [];
        try {
          accounts = await walletProvider.provider.request({ method: "eth_accounts" });
        } catch {
          continue;
        }

        for (const address of Array.isArray(accounts) ? accounts : []) {
          if (!active || !address) return;
          try {
            await fetchSandboxWinnerAccess("/api/draw-admin/sandbox-winners/challenge", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ address }),
            });
            if (!active) return;
            setDetectedOperatorWallet(walletProvider);
            return;
          } catch {
            // Only an allowlisted wallet receives a challenge; all others stay invisible here.
          }
        }
      }
    }

    detectOperatorWallet();
    return () => {
      active = false;
    };
  }, [access.allowed, access.checked, detectedOperatorWallet, walletDetecting, walletProviders]);

  async function authorizeWallet(walletProvider) {
    const provider = walletProvider?.provider;
    if (!provider?.request) {
      setIssue(t("draw.operatorWalletMissing"));
      return;
    }

    setIssue("");
    setBusyAction(`connect:${walletProvider.id}`);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = String(accounts?.[0] || "");
      if (!address) throw new Error(t("draw.operatorWalletMissing"));
      setConnectedWallet({
        address,
        label: walletProvider.label,
        provider,
      });

      const { payload: challenge } = await fetchSandboxWinnerAccess(
        "/api/draw-admin/sandbox-winners/challenge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address }),
        }
      );
      const signature = await provider.request({
        method: "personal_sign",
        params: [challenge.message, address],
      });
      const { payload } = await fetchSandboxWinnerAccess(
        "/api/draw-admin/sandbox-winners/session",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address,
            nonce: challenge.nonce,
            signature,
          }),
        }
      );
      if (!payload?.allowed) throw new Error("Sandbox winner access was not granted.");
      applyAccess(payload);
      setWalletDialogOpen(false);
    } catch (error) {
      setIssue(error?.payload?.error || error?.message || t("draw.operatorWalletFailed"));
    } finally {
      setBusyAction("");
    }
  }

  async function clearAccess() {
    if (busyAction) return;
    setBusyAction("disconnect");
    try {
      await fetchSandboxWinnerAccess("/api/draw-admin/sandbox-winners/session", {
        method: "DELETE",
      });
      setConnectedWallet({ address: "", label: "", provider: null });
      applyAccess({ allowed: false });
      setWalletDialogOpen(false);
      setIssue("");
    } catch (error) {
      setIssue(error?.payload?.error || error?.message || t("draw.operatorWalletFailed"));
    } finally {
      setBusyAction("");
    }
  }

  if (access.allowed) {
    return (
      <section className="winner-network-switcher" aria-label={t("winnerReveal.networkSwitcherAria")}>
        <span className="winner-network-switcher__label">
          <Network size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>
            <small>{t("winnerReveal.networkSwitcherLabel")}</small>
            <strong>{network === "sandbox" ? t("winnerReveal.networkSandbox") : t("winnerReveal.networkMainnet")}</strong>
          </span>
        </span>
        <span className="winner-network-switcher__options" role="group">
          <button
            type="button"
            className={network === "mainnet" ? "is-active" : ""}
            aria-pressed={network === "mainnet"}
            disabled={loading}
            onClick={() => onSelectNetwork?.("mainnet")}
          >
            {t("winnerReveal.networkMainnetShort")}
          </button>
          <button
            type="button"
            className={network === "sandbox" ? "is-active" : ""}
            aria-pressed={network === "sandbox"}
            disabled={loading}
            onClick={() => onSelectNetwork?.("sandbox")}
          >
            {t("winnerReveal.networkSandboxShort")}
          </button>
        </span>
        {loading ? <small className="winner-network-switcher__loading">{t("winnerReveal.networkLoading")}</small> : null}
      </section>
    );
  }

  if (!detectedOperatorWallet) return null;

  return (
    <>
      <section className="winner-network-access" aria-label={t("winnerReveal.sandboxAccessAria")}>
        <button
          type="button"
          disabled={!access.checked || Boolean(busyAction)}
          onClick={() => setWalletDialogOpen(true)}
        >
          {busyAction ? <Loader2 className="is-spinning" size={15} /> : <ShieldCheck size={15} strokeWidth={2.2} />}
          <span>
            <small>{t("winnerReveal.sandboxAccessBody")}</small>
            <strong>{t("winnerReveal.sandboxAccessButton")}</strong>
          </span>
        </button>
        {issue ? <p>{t("winnerReveal.sandboxAccessIssue", { message: issue })}</p> : null}
      </section>
      <WalletProviderDialog
        open={walletDialogOpen}
        walletProviders={[detectedOperatorWallet]}
        walletDetecting={walletDetecting}
        connectedWallet={connectedWallet}
        busyAction={busyAction}
        operationBusy={Boolean(busyAction)}
        onSelect={authorizeWallet}
        onDisconnect={clearAccess}
        onClose={() => {
          if (!busyAction) setWalletDialogOpen(false);
        }}
        t={t}
      />
    </>
  );
}
