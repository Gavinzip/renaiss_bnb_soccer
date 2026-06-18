import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  Coins,
  Database,
  Hash,
  ShieldCheck,
  Ticket,
  Trophy,
  Vote,
} from "lucide-react";
import { AnimatedContent } from "../AnimatedContent";
import { GlareHover } from "../GlareHover";
import { formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

const ruleFlowBlueprint = [
  {
    id: "tickets",
    icon: Ticket,
  },
  {
    id: "vote",
    icon: Vote,
  },
  {
    id: "cutoff",
    icon: Clock3,
  },
  {
    id: "result",
    icon: BadgeCheck,
  },
  {
    id: "pool",
    icon: Database,
  },
  {
    id: "chain",
    icon: Hash,
  },
  {
    id: "winner",
    icon: Trophy,
  },
];

const proofLaneBlueprint = [
  {
    id: "server",
    icon: Database,
  },
  {
    id: "fifa",
    icon: BadgeCheck,
  },
  {
    id: "chain",
    icon: ShieldCheck,
  },
  {
    id: "payout",
    icon: Trophy,
  },
];

const DEFAULT_MATCH_PRIZE_AMOUNT = 1000;
const DEFAULT_PRIZE_CURRENCY = "USDT";

function getDrawLabel(draw, t) {
  if (!draw) return t("roundStatus.not_started");
  if (draw.drawStatusResolved === "eligible_ready") return t("roundStatus.eligible_ready");
  if (draw.drawStatusResolved === "pending_results") return t("roundStatus.pending_results");
  if (draw.drawStatusResolved === "not_started") return t("roundStatus.not_started");
  return draw.drawStatusResolved;
}

function getMatchPrize(match, round) {
  const amount = Number(match?.prizeAmount ?? round?.matchPrizeAmount ?? DEFAULT_MATCH_PRIZE_AMOUNT);
  return {
    amount: Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0)),
    currency: String(match?.prizeCurrency ?? round?.prizeCurrency ?? DEFAULT_PRIZE_CURRENCY),
  };
}

function formatPrizeAmount(amount, currency, number) {
  const displayCurrency = currency === "USDT" ? "U" : currency;
  return `${number(amount)}${displayCurrency}`;
}

function RulesFlowChart({ copy }) {
  const { copyList, t } = copy;

  return (
    <GlareHover as="article" className="rules-flow-map">
      <header>
        <span>{t("rules.lifecycleEyebrow")}</span>
        <h2>{t("rules.lifecycleTitle")}</h2>
      </header>
      <ol>
        {ruleFlowBlueprint.map((item, index) => {
          const Icon = item.icon;
          const [title, body] = copyList(`rules.flow.${item.id}`);
          return (
            <AnimatedContent as="li" key={item.id} delay={index * 0.035} distance={8}>
              <span className="rules-flow-map__node">
                <Icon size={20} strokeWidth={2.1} />
              </span>
              <strong>{title}</strong>
              <p>{body}</p>
              {index < ruleFlowBlueprint.length - 1 ? (
                <ArrowRight className="rules-flow-map__arrow" size={17} strokeWidth={2.2} aria-hidden="true" />
              ) : null}
            </AnimatedContent>
          );
        })}
      </ol>
    </GlareHover>
  );
}

function RulesRewardMap({ activeRound, matches, totalPrizeSlots, activeDraw, copy }) {
  const { number, roundLabel, t } = copy;
  const prizeRows = matches.map((match) => ({
    id: match.id,
    prize: getMatchPrize(match, activeRound),
  }));
  const currencies = new Set(prizeRows.map((row) => row.prize.currency));
  const totalPrizeAmount = prizeRows.reduce((total, row) => total + row.prize.amount, 0);
  const totalPrizeLabel = currencies.size === 1
    ? formatPrizeAmount(totalPrizeAmount, prizeRows[0]?.prize.currency ?? DEFAULT_PRIZE_CURRENCY, number)
    : t("rules.mixedPrizeTotal");
  const defaultPrizeLabel = formatPrizeAmount(
    activeRound?.matchPrizeAmount ?? DEFAULT_MATCH_PRIZE_AMOUNT,
    activeRound?.prizeCurrency ?? DEFAULT_PRIZE_CURRENCY,
    number,
  );
  const matchCountLabel = t("rules.matchCountValue", { count: number(prizeRows.length) });
  const roundLabelText = activeRound ? roundLabel(activeRound) : "-";
  const drawLabel = getDrawLabel(activeDraw, t);

  return (
    <GlareHover as="article" className="rules-reward-map">
      <header>
        <span>{t("rules.currentPrizeDesk")}</span>
        <h2>{t("rules.heroTitle")}</h2>
        <p>{t("rules.heroBody")}</p>
      </header>

      <section className="rules-reward-map__strip" aria-label={t("rules.currentPrizeDesk")}>
        <article className="is-round">
          <Clock3 size={17} strokeWidth={2.15} />
          <span>{t("rules.activeRound")}</span>
          <strong>{roundLabelText}</strong>
        </article>
        <article className="is-prize">
          <Coins size={17} strokeWidth={2.15} />
          <span>{t("rules.prizePerMatch")}</span>
          <strong>{defaultPrizeLabel}</strong>
        </article>
        <article className="is-match">
          <Ticket size={17} strokeWidth={2.15} />
          <span>{t("rules.roundPrizeMatches")}</span>
          <strong>{matchCountLabel}</strong>
        </article>
        <article className="is-total">
          <Trophy size={17} strokeWidth={2.15} />
          <span>{t("rules.roundPrizeTotal")}</span>
          <strong>{totalPrizeLabel}</strong>
        </article>
        <article className="is-slots">
          <ShieldCheck size={17} strokeWidth={2.15} />
          <span>{t("rules.totalSlots")}</span>
          <strong>{formatNumber(totalPrizeSlots)}</strong>
        </article>
        <article className="is-state">
          <Database size={17} strokeWidth={2.15} />
          <span>{t("common.drawState")}</span>
          <strong>{drawLabel}</strong>
        </article>
      </section>
    </GlareHover>
  );
}

function RulesProofLanes({ copy }) {
  const { copyList, t } = copy;

  return (
    <GlareHover as="article" className="rules-proof-lanes">
      <header>
        <span>{t("rules.boundaryTitle")}</span>
        <h2>{t("rules.proofTitle")}</h2>
      </header>
      <ol aria-label={t("rules.boundaryAria")}>
        {proofLaneBlueprint.map((item, index) => {
          const Icon = item.icon;
          const [title, body] = copyList(`rules.proof.${item.id}`);

          return (
            <AnimatedContent as="li" key={item.id} delay={index * 0.035} distance={8}>
              <Icon size={18} strokeWidth={2.15} />
              <strong>{title}</strong>
              <p>{body}</p>
            </AnimatedContent>
          );
        })}
      </ol>
    </GlareHover>
  );
}

export function RulesRoom({ activeRound, activeRoundMatches = [], rounds = [], drawStats = [], className = "" }) {
  const copy = useCampaignCopy();
  const { t } = copy;
  const drawById = new Map(drawStats.map((round) => [round.id, round]));
  const totalPrizeSlots = rounds.reduce((total, round) => total + (round.prizeCount || 0), 0);
  const activeDraw = activeRound ? drawById.get(activeRound.id) : null;

  return (
    <section className={["rules-room", className].filter(Boolean).join(" ")} aria-label={t("rules.roomAria")}>
      <RulesRewardMap
        activeRound={activeRound}
        matches={activeRoundMatches}
        totalPrizeSlots={totalPrizeSlots}
        activeDraw={activeDraw}
        copy={copy}
      />

      <RulesFlowChart copy={copy} />

      <RulesProofLanes copy={copy} />
    </section>
  );
}
