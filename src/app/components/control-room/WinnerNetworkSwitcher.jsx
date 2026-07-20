import { Network } from "lucide-react";
import { useEffect } from "react";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

export function WinnerNetworkSwitcher({
  network = "mainnet",
  loading = false,
  authorized = false,
  onSelectNetwork,
  onAccessChange,
}) {
  const { t } = useCampaignCopy();

  useEffect(() => {
    onAccessChange?.(authorized);
  }, [authorized, onAccessChange]);

  if (!authorized) return null;

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
