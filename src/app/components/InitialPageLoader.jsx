import renaissLogo from "../assets/renaiss-logo-mark.webp";
import { useCampaignCopy } from "../i18n/useCampaignCopy";
import { CircularText } from "./CircularText";
import "./InitialPageLoader.css";

export function InitialPageLoader({ isLeaving }) {
  const { t } = useCampaignCopy();

  return (
    <div
      className={`initial-loader${isLeaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!isLeaving}
    >
      <div className="initial-loader__mark" aria-hidden="true">
        <CircularText
          text="World Cup • Renaiss • Predict • "
          onHover="speedUp"
          spinDuration={18}
          className="initial-loader__circular"
        />
        <img className="initial-loader__logo" src={renaissLogo} alt="" draggable={false} decoding="async" />
      </div>
      <span className="initial-loader__sr">{t("common.loadingCampaign")}</span>
    </div>
  );
}
