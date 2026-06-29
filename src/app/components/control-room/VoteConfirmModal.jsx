import { AlertTriangle, CheckCircle2, Clock3, Loader2, X } from "lucide-react";
import { formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

export function VoteConfirmModal({ amount, issue = "", match, submitting = false, team, onCancel, onConfirm }) {
  const { dateTime, teamName, t } = useCampaignCopy();

  if (!amount || !match || !team) return null;
  const matchCode = String(match.displayCode || match.id || "").toUpperCase();

  return (
    <aside className="confirm-layer" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={t("confirm.aria")}>
        <header>
          <span>{t("confirm.title")}</span>
          <button type="button" onClick={onCancel} disabled={submitting} aria-label={t("confirm.close")}>
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        <section className="confirm-team">
          <img src={team.flagSrc} alt="" aria-hidden="true" />
          <p>
            <span>{t("confirm.selectedTeam")}</span>
            <strong>{teamName(team)}</strong>
          </p>
        </section>

        <dl>
          <dt>{t("common.match")}</dt>
          <dd>{matchCode}</dd>
          <dt>{t("confirm.ticketsUsed")}</dt>
          <dd>{formatNumber(amount)}</dd>
          <dt>
            <Clock3 size={15} strokeWidth={2.2} />
            {t("common.cutoff")}
          </dt>
          <dd>{dateTime(match.cutoffAt)} {t("common.hkt")}</dd>
        </dl>

        <p className="confirm-warning">
          <AlertTriangle size={17} strokeWidth={2.2} />
          {t("confirm.warning")}
        </p>

        {issue ? (
          <p className="confirm-error" role="alert">
            <AlertTriangle size={17} strokeWidth={2.2} />
            {issue}
          </p>
        ) : null}

        <footer>
          <button type="button" onClick={onCancel} disabled={submitting}>{t("common.cancel")}</button>
          <button type="button" onClick={onConfirm} disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <Loader2 className="confirm-spin" size={18} strokeWidth={2.2} />
            ) : (
              <CheckCircle2 size={18} strokeWidth={2.2} />
            )}
            {submitting ? t("confirm.submitting") : t("confirm.confirmPreview")}
          </button>
        </footer>
      </section>
    </aside>
  );
}
