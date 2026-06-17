import { AlertTriangle, CheckCircle2, Clock3, X } from "lucide-react";
import { GlareHover } from "../GlareHover";
import { formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

export function VoteConfirmModal({ amount, match, team, onCancel, onConfirm }) {
  const { dateTime, teamName, t } = useCampaignCopy();

  if (!amount || !match || !team) return null;

  return (
    <aside className="confirm-layer" role="presentation">
      <GlareHover as="section" className="confirm-modal" role="dialog" aria-modal="true" aria-label={t("confirm.aria")}>
        <header>
          <span>{t("confirm.title")}</span>
          <button type="button" onClick={onCancel} aria-label={t("confirm.close")}>
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
          <dd>{match.id.toUpperCase()}</dd>
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

        <footer>
          <button type="button" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" onClick={onConfirm}>
            <CheckCircle2 size={18} strokeWidth={2.2} />
            {t("confirm.confirmPreview")}
          </button>
        </footer>
      </GlareHover>
    </aside>
  );
}
