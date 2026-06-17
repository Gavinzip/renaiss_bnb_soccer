import {
  ArrowRightLeft,
  BadgeCheck,
  Clock3,
  Database,
  LockKeyhole,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Ticket,
  Trophy,
} from "lucide-react";
import { AnimatedContent } from "../AnimatedContent";
import { GlareHover } from "../GlareHover";
import { formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

const ruleFlowBlueprint = [
  {
    id: "source",
    icon: Database,
    step: "01",
  },
  {
    id: "reset",
    icon: RefreshCw,
    step: "02",
  },
  {
    id: "cutoff",
    icon: Clock3,
    step: "03",
  },
  {
    id: "result",
    icon: ShieldCheck,
    step: "04",
  },
  {
    id: "draw",
    icon: LockKeyhole,
    step: "05",
  },
];

const eligibilityBlueprint = [
  {
    id: "allocate",
    icon: Ticket,
  },
  {
    id: "locked",
    icon: LockKeyhole,
  },
  {
    id: "entry",
    icon: BadgeCheck,
  },
  {
    id: "prize",
    icon: Trophy,
  },
];

const boundaryIds = ["wallet", "vote", "voteRecord", "draw"];
const opsRequirementIds = ["setup", "result", "draw", "finance", "abuse"];
const lockNoticeBlueprint = [
  {
    id: "submit",
    icon: LockKeyhole,
  },
  {
    id: "settlement",
    icon: RefreshCw,
  },
  {
    id: "fifa",
    icon: ShieldCheck,
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

function RuleSignalCard({ eyebrow, title, items, className = "" }) {
  return (
    <GlareHover as="article" className={["rules-signal-card", className].filter(Boolean).join(" ")}>
      <header>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      <ol>
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <AnimatedContent as="li" key={item.id} delay={index * 0.035} distance={8}>
              <Icon size={18} strokeWidth={2.15} />
              <em>{item.meta}</em>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </AnimatedContent>
          );
        })}
      </ol>
    </GlareHover>
  );
}

function RulesPrizeBoard({ activeRound, matches, teamsById, copy }) {
  const { dateTime, number, roundLabel, t, teamName, venueName } = copy;
  const prizeRows = matches.map((match, index) => {
    const prize = getMatchPrize(match, activeRound);
    const [leftTeamId, rightTeamId] = match.teams;
    const leftTeam = teamsById.get(leftTeamId) ?? { id: leftTeamId };
    const rightTeam = teamsById.get(rightTeamId) ?? { id: rightTeamId };

    return {
      id: match.id,
      index,
      match,
      prize,
      title: `${teamName(leftTeam)} ${t("vote.versusShort")} ${teamName(rightTeam)}`,
    };
  });
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

  return (
    <GlareHover as="article" className="rules-prize-board">
      <header>
        <Trophy size={22} strokeWidth={2.1} />
        <span>{t("rules.currentPrizeDesk")}</span>
        <h2>{t("rules.matchPrizeTitle", { round: activeRound ? roundLabel(activeRound) : t("common.round") })}</h2>
        <p>{t("rules.matchPrizeBody", { amount: defaultPrizeLabel })}</p>
        <dl className="rules-prize-board__summary" aria-label={t("rules.currentPrizeDesk")}>
          <div>
            <dt>{t("rules.roundPrizeTotal")}</dt>
            <dd>{totalPrizeLabel}</dd>
          </div>
          <div>
            <dt>{t("rules.roundPrizeMatches")}</dt>
            <dd>{t("rules.matchCountValue", { count: number(prizeRows.length) })}</dd>
          </div>
        </dl>
      </header>

      <ol className="rules-match-prize-list" aria-label={t("rules.matchPrizeListAria")}>
        {prizeRows.map((row) => (
          <li key={row.id}>
            <header>
              <span>{String(row.index + 1).padStart(2, "0")} / {row.id.toUpperCase()}</span>
              <strong>{formatPrizeAmount(row.prize.amount, row.prize.currency, number)}</strong>
            </header>
            <p>{row.title}</p>
            <footer>
              <small>{venueName(row.match.venue)}</small>
              <small>{dateTime(row.match.kickoffAt)} {t("common.hkt")}</small>
            </footer>
          </li>
        ))}
      </ol>
    </GlareHover>
  );
}

function RulesRoundStrip({ rounds, drawById, activeRound, copy }) {
  const { roundLabel, t } = copy;

  return (
    <GlareHover as="article" className="rules-round-strip">
      <header>
        <ArrowRightLeft size={22} strokeWidth={2.1} />
        <span>{t("rules.roundRulebook")}</span>
        <h2>{t("rules.eligibilityMap", { round: activeRound ? roundLabel(activeRound, "englishLabel") : t("common.round") })}</h2>
      </header>
      <ol aria-label={t("rules.roundListAria")}>
        {rounds.map((round) => {
          const draw = drawById.get(round.id);
          const active = round.id === activeRound?.id;
          return (
            <li className={active ? "is-active" : ""} key={round.id}>
              <span>{roundLabel(round)}</span>
              <strong>{roundLabel(round, "advanceLabel")}</strong>
              <small>{getDrawLabel(draw, t)}</small>
              <em>{formatNumber(round.prizeCount)}</em>
            </li>
          );
        })}
      </ol>
    </GlareHover>
  );
}

function RulesLockNotice({ copy }) {
  const { copyList, t } = copy;

  return (
    <GlareHover as="article" className="rules-lock-notice">
      <header>
        <LockKeyhole size={22} strokeWidth={2.1} />
        <span>{t("rules.lockNoticeEyebrow")}</span>
        <h2>{t("rules.lockNoticeTitle")}</h2>
      </header>
      <ol aria-label={t("rules.lockNoticeAria")}>
        {lockNoticeBlueprint.map((item, index) => {
          const Icon = item.icon;
          const [title, body] = copyList(`rules.lockNotice.${item.id}`);

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

export function RulesRoom({ activeRound, activeRoundMatches = [], rounds = [], drawStats = [], teamsById = new Map(), className = "" }) {
  const copy = useCampaignCopy();
  const { copyList, number, roundLabel, t } = copy;
  const drawById = new Map(drawStats.map((round) => [round.id, round]));
  const totalPrizeSlots = rounds.reduce((total, round) => total + (round.prizeCount || 0), 0);
  const totalMatches = drawStats.reduce((total, round) => total + (round.matchCount || 0), 0);
  const activeDraw = activeRound ? drawById.get(activeRound.id) : null;
  const activePrizeTotal = activeRoundMatches.reduce((total, match) => total + getMatchPrize(match, activeRound).amount, 0);
  const activePrizeCurrency = activeRound?.prizeCurrency ?? DEFAULT_PRIZE_CURRENCY;
  const ruleSignalGroups = [
    {
      id: "lifecycle",
      className: "is-lifecycle",
      eyebrow: t("rules.lifecycleEyebrow"),
      title: t("rules.lifecycleTitle"),
      items: ruleFlowBlueprint.map((item) => {
        const [title, body] = copyList(`rules.flow.${item.id}`);
        return {
          id: item.id,
          icon: item.icon,
          meta: item.step,
          title,
          body,
        };
      }),
    },
    {
      id: "eligibility",
      className: "is-eligibility",
      eyebrow: t("rules.roundRulebook"),
      title: t("rules.eligibilityMap", { round: activeRound ? roundLabel(activeRound, "englishLabel") : t("common.round") }),
      items: eligibilityBlueprint.map((item) => {
        const [title, state, body] = copyList(`rules.eligibility.${item.id}`);
        return {
          id: item.id,
          icon: item.icon,
          meta: state,
          title,
          body,
        };
      }),
    },
    {
      id: "boundary",
      className: "is-boundary",
      eyebrow: t("rules.notConnected"),
      title: t("rules.boundaryTitle"),
      items: boundaryIds.map((boundaryId) => {
        const [title, body] = copyList(`rules.boundaries.${boundaryId}`);
        return {
          id: boundaryId,
          icon: LockKeyhole,
          meta: t("rules.notConnected"),
          title,
          body,
        };
      }),
    },
  ];
  const opsItems = opsRequirementIds.map((itemId) => {
    const [title] = copyList(`rules.ops.${itemId}`);
    return { id: itemId, title };
  });

  return (
    <section className={["rules-room", className].filter(Boolean).join(" ")} aria-label={t("rules.roomAria")}>
      <GlareHover as="article" className="rules-hero">
        <header>
          <span>{t("rules.heroEyebrow")}</span>
          <h2>{t("rules.heroTitle")}</h2>
          <p>{t("rules.heroBody")}</p>
        </header>
        <section className="rules-hero__metrics" aria-label={t("rules.roomAria")}>
          <article className="rules-hero__metric">
            <span>{t("rules.activeRound")}</span>
            <strong>{activeRound ? roundLabel(activeRound) : "-"}</strong>
          </article>
          <article className="rules-hero__metric">
            <span>{t("rules.roundPrizes")}</span>
            <strong>{formatPrizeAmount(activePrizeTotal, activePrizeCurrency, number)}</strong>
          </article>
          <article className="rules-hero__metric">
            <span>{t("rules.campaignMatches")}</span>
            <strong>{formatNumber(totalMatches)}</strong>
          </article>
          <article className="rules-hero__metric">
            <span>{t("rules.totalSlots")}</span>
            <strong>{formatNumber(totalPrizeSlots)}</strong>
          </article>
          <article className="rules-hero__metric">
            <span>{t("common.drawState")}</span>
            <strong>{getDrawLabel(activeDraw, t)}</strong>
          </article>
        </section>
      </GlareHover>

      <RulesPrizeBoard
        activeRound={activeRound}
        matches={activeRoundMatches}
        teamsById={teamsById}
        copy={copy}
      />

      <section className="rules-signal-grid">
        {ruleSignalGroups.map((group) => (
          <RuleSignalCard
            key={group.id}
            eyebrow={group.eyebrow}
            title={group.title}
            items={group.items}
            className={group.className}
          />
        ))}
      </section>

      <RulesLockNotice copy={copy} />

      <RulesRoundStrip rounds={rounds} drawById={drawById} activeRound={activeRound} copy={copy} />

      <GlareHover as="article" className="rules-ops-ribbon">
        <header>
          <Settings2 size={20} strokeWidth={2.1} />
          <span>{t("rules.productionOps")}</span>
          <h2>{t("rules.adminRequirements")}</h2>
        </header>
        <ol aria-label={t("rules.checklistAria")}>
          {opsItems.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ol>
      </GlareHover>
    </section>
  );
}
