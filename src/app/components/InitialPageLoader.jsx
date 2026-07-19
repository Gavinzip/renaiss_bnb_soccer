import renaissLogo from "../assets/renaiss-logo-mark.webp";
import { useCampaignCopy } from "../i18n/useCampaignCopy";
import { CircularText } from "./CircularText";
import "./InitialPageLoader.css";

export function InitialPageLoader({ isLeaving, issue = "", onRetry }) {
  const { t } = useCampaignCopy();

  return (
    <div
      className={[
        "initial-loader",
        isLeaving ? "is-leaving" : "",
        issue ? "has-issue" : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-busy={!isLeaving && !issue}
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
      {issue ? (
        <div className="initial-loader__issue">
          <p>{t("common.loadingIssue", { message: issue })}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              {t("common.retryLoading")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
