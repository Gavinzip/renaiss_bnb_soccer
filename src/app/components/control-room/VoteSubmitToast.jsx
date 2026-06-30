import { CheckCircle2 } from "lucide-react";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

export function VoteSubmitToast({ notice }) {
  const { number, t } = useCampaignCopy();

  if (!notice) return null;

  return (
    <aside className="vote-submit-toast" role="status" aria-live="polite" aria-atomic="true">
      <span className="vote-submit-toast__icon" aria-hidden="true">
        <CheckCircle2 size={20} strokeWidth={2.35} />
      </span>
      <p>
        <strong>{t("voteSubmitToast.title")}</strong>
        <span>{t("voteSubmitToast.body", { team: notice.teamName, tickets: number(notice.tickets) })}</span>
      </p>
    </aside>
  );
}
