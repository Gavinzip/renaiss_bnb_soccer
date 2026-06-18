import {
  CalendarClock,
  Clock3,
  Database,
  Home,
  Landmark,
  LogOut,
  LockKeyhole,
  ShieldCheck,
  Ticket,
  Trophy,
  Vote,
  WalletCards,
} from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { flushSync } from "react-dom";
import renaissLogo from "../../assets/renaiss-logo-mark.webp";
import { commandViews } from "../../data/campaignRuntime";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { scheduleIdleWork } from "../../utils/preloadAssets";
import { AnimatedContent } from "../AnimatedContent";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { HomeRoom } from "./HomeRoom";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const roomLoaders = {
  schedule: () => import("./ScheduleRoom"),
  vote: () => import("./VoteRoom"),
  draw: () => import("./DrawRoom"),
};

const LazyScheduleRoom = lazyNamed(roomLoaders.schedule, "ScheduleRoom");
const LazyVoteRoom = lazyNamed(roomLoaders.vote, "VoteRoom");
const LazyDrawRoom = lazyNamed(roomLoaders.draw, "DrawRoom");
const roomPreloadCache = new Map();

function preloadRoom(viewId) {
  const loader = roomLoaders[viewId];
  if (!loader) return Promise.resolve();
  if (roomPreloadCache.has(viewId)) return roomPreloadCache.get(viewId);

  const preload = loader()
    .then((module) => {
      if (typeof module.preloadRoomAssets === "function") return module.preloadRoomAssets();
      return undefined;
    })
    .catch((error) => {
      roomPreloadCache.delete(viewId);
      throw error;
    });
  roomPreloadCache.set(viewId, preload);
  return preload;
}

function preloadInactiveRooms(activeViewId) {
  const order = activeViewId === "home"
    ? ["schedule", "vote", "draw"]
    : [activeViewId, "schedule", "vote", "draw"];
  const uniqueOrder = [...new Set(order)].filter((viewId) => viewId !== "home");

  const cancelJobs = uniqueOrder.map((viewId, index) => (
    scheduleIdleWork(() => {
      preloadRoom(viewId).catch(() => undefined);
    }, 260 + index * 240)
  ));

  return () => cancelJobs.forEach((cancel) => cancel());
}

function RoomLoadingShell({ t }) {
  return (
    <section className="room-loading-shell" aria-live="polite" aria-label={t("common.loading")}>
      <span aria-hidden="true" />
    </section>
  );
}

const viewIcons = {
  home: Home,
  schedule: CalendarClock,
  vote: Vote,
  draw: Trophy,
  rules: ShieldCheck,
};

function getRoomMeta(viewId, t) {
  const meta = {
    schedule: {
      Icon: CalendarClock,
      eyebrow: t("views.schedule.eyebrow"),
      title: t("views.schedule.title"),
      body: t("views.schedule.body"),
    },
    vote: {
      Icon: Vote,
      eyebrow: t("views.vote.eyebrow"),
      title: t("views.vote.title"),
      body: t("views.vote.body"),
    },
    draw: {
      Icon: Trophy,
      eyebrow: t("views.draw.eyebrow"),
      title: t("views.draw.title"),
      body: t("views.draw.body"),
    },
    rules: {
      Icon: ShieldCheck,
      eyebrow: t("views.rules.eyebrow"),
      title: t("views.rules.title"),
      body: t("views.rules.body"),
    },
  };
  return meta[viewId] ?? meta.vote;
}

function countMatchStates(matches, activeRoundId) {
  return matches
    .filter((match) => match.roundId === activeRoundId)
    .reduce(
      (counts, match) => {
        if (["open", "closing_soon"].includes(match.status)) counts.voteable += 1;
        if (match.status === "closing_soon") counts.closing += 1;
        if (match.status === "locked") counts.locked += 1;
        if (match.status === "official_final") counts.final += 1;
        if (match.status === "scheduled") counts.scheduled += 1;
        return counts;
      },
      { voteable: 0, closing: 0, locked: 0, final: 0, scheduled: 0 },
    );
}

function getRoundRailDetail(round, draw, isActive, remainingRoundTickets, roundStatus, t) {
  if (isActive) {
    return {
      tone: "active",
      text: t("roundRail.remaining", { count: formatNumber(remainingRoundTickets) }),
    };
  }

  if ((draw?.eligibleEntries ?? 0) > 0) {
    return {
      tone: "eligible",
      text: t("roundRail.eligible", { count: formatNumber(draw.eligibleEntries) }),
    };
  }

  if ((draw?.lostEntries ?? 0) > 0) {
    return {
      tone: "lost",
      text: t("roundRail.lost", { count: formatNumber(draw.lostEntries) }),
    };
  }

  if ((draw?.pendingEntries ?? 0) > 0) {
    return {
      tone: "preview",
      text: t("roundRail.preview", { count: formatNumber(draw.pendingEntries) }),
    };
  }

  return {
    tone: round.status,
    text: roundStatus(round, draw),
  };
}

function RoundSwitch({
  rounds,
  activeRoundId,
  simulatedRoundId,
  simulationMode,
  liveQualification,
  drawStats,
  remainingRoundTickets,
  onSelectRound,
  onSelectSimulatedRound,
  onSelectSimulationMode,
  copy,
}) {
  const drawById = new Map(drawStats.map((draw) => [draw.id, draw]));
  const { dateTime, roundLabel, roundStatus, t } = copy;
  const simulatedIndex = Math.max(0, rounds.findIndex((round) => round.id === simulatedRoundId));
  const liveCounts = liveQualification?.counts ?? { confirmed: 0, provisional: 0, unrevealed: 32 };
  const liveSourceTone = liveQualification?.sourceStatus ?? "pending";
  const liveSourceLine = liveSourceTone === "live"
    ? t("liveQualification.sourceLive", {
      confirmed: formatNumber(liveCounts.confirmed),
      provisional: formatNumber(liveCounts.provisional),
      unrevealed: formatNumber(liveCounts.unrevealed),
      time: liveQualification?.fetchedAt ? dateTime(liveQualification.fetchedAt) : "-",
    })
    : liveSourceTone === "stale"
      ? t("liveQualification.sourceStale", {
        confirmed: formatNumber(liveCounts.confirmed),
        provisional: formatNumber(liveCounts.provisional),
        unrevealed: formatNumber(liveCounts.unrevealed),
        message: liveQualification?.issue || t("liveQualification.pendingReason"),
      })
      : t("liveQualification.sourcePending", {
        message: liveQualification?.issue || t("liveQualification.pendingReason"),
      });

  function handleInspectRound(roundId) {
    if (roundId === activeRoundId) return;

    const canTransition = typeof document !== "undefined"
      && typeof document.startViewTransition === "function"
      && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!canTransition) {
      onSelectRound(roundId);
      return;
    }

    document.startViewTransition(() => {
      flushSync(() => onSelectRound(roundId));
    });
  }

  return (
    <section className="round-simulator" aria-label={t("roundRail.simulatorAria")}>
      <ol className="round-switch round-switch--read-only" aria-label={t("common.round")}>
        {rounds.map((round, index) => {
          const draw = drawById.get(round.id);
          const isActive = round.id === activeRoundId;
          const canInspect = simulationMode === "realtime" ? round.id === "round32" : index <= simulatedIndex;
          const detail = getRoundRailDetail(round, draw, isActive, remainingRoundTickets, roundStatus, t);

          return (
            <li
              className={[
                "round-switch__item",
                isActive ? "is-active" : "",
                canInspect ? "is-inspectable" : "is-future-locked",
                round.id === "final" ? "is-final-round" : "",
                `is-${round.status}`,
                `has-${detail.tone}`,
              ].filter(Boolean).join(" ")}
              key={round.id}
              aria-current={isActive ? "step" : undefined}
            >
              <button
                className="round-switch__stage"
                type="button"
                disabled={!canInspect}
                onClick={() => handleInspectRound(round.id)}
              >
                <span className="round-switch__label">{roundLabel(round)}</span>
                <strong className="round-switch__metric">
                  <span>{formatNumber(draw?.matchCount ?? 0)}</span>
                  <small>{t("roundRail.matchUnit")}</small>
                </strong>
                <span className="round-switch__detail">{canInspect ? detail.text : t("roundRail.futureLocked")}</span>
                <span className="round-switch__track" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <section className="round-simulator__tools" aria-label={t("roundRail.modeAria")}>
        <div className="round-simulator__mode" role="group" aria-label={t("roundRail.modeAria")}>
          <button
            type="button"
            className={simulationMode === "scenario" ? "is-active" : ""}
            onClick={() => onSelectSimulationMode("scenario")}
            aria-pressed={simulationMode === "scenario"}
          >
            {t("roundRail.modeScenario")}
          </button>
          <button
            type="button"
            className={simulationMode === "realtime" ? "is-active" : ""}
            onClick={() => onSelectSimulationMode("realtime")}
            aria-pressed={simulationMode === "realtime"}
          >
            {t("roundRail.modeRealtime")}
          </button>
        </div>
        <label className="round-simulator__control">
          <span>{t("roundRail.simulateStage")}</span>
          <select
            value={simulatedRoundId}
            onChange={(event) => onSelectSimulatedRound(event.target.value)}
            disabled={simulationMode === "realtime"}
          >
            {rounds.map((round) => (
              <option key={round.id} value={round.id}>
                {roundLabel(round, "advanceLabel")}
              </option>
            ))}
          </select>
        </label>
        {simulationMode === "realtime" ? (
          <p className={`round-simulator__source is-${liveSourceTone}`}>
            {liveSourceLine}
          </p>
        ) : null}
      </section>
    </section>
  );
}

function RoomCommandMast({
  activeViewId,
  activeRound,
  activeDraw,
  matchStateCounts,
  remainingRoundTickets,
  accumulatedDrawEntries,
  copy,
}) {
  const { roundLabel, roundStatus, t } = copy;
  const meta = getRoomMeta(activeViewId, t);
  const Icon = meta.Icon;
  const signals = [
    {
      id: "round",
      icon: Clock3,
      label: roundLabel(activeRound),
      value: roundLabel(activeRound, "advanceLabel"),
      detail: roundLabel(activeRound, "windowLabel"),
      tone: "round",
    },
    {
      id: "voteable",
      icon: Ticket,
      label: t("mast.canVote"),
      value: `${formatNumber(matchStateCounts.voteable)} ${t("common.matches")}`,
      detail: matchStateCounts.closing > 0 ? t("mast.closingSoon", { count: formatNumber(matchStateCounts.closing) }) : t("mast.openWindows"),
      tone: "open",
    },
    {
      id: "locked",
      icon: LockKeyhole,
      label: t("mast.locked"),
      value: `${formatNumber(matchStateCounts.locked)} ${t("common.matches")}`,
      detail: t("schedule.inspectOnly"),
      tone: "locked",
    },
    {
      id: "draw",
      icon: Trophy,
      label: t("mast.drawEntries"),
      value: formatNumber(accumulatedDrawEntries),
      detail: `${formatNumber(activeDraw?.prizeCount ?? activeRound.prizeCount)} ${t("common.prizeSlots")}`,
      tone: "draw",
    },
  ];

  return (
    <GlareHover as="header" className={`room-mast room-mast--${activeViewId}`}>
      <section className="room-mast__copy">
        <span>
          <Icon size={16} strokeWidth={2.2} />
          {meta.eyebrow}
        </span>
        <h1>{meta.title}</h1>
        <p>{meta.body}</p>
      </section>
      <section className="mast-pills" aria-label={t("mast.currentRoundBalances")}>
        <output aria-live="polite">
          <Ticket size={16} strokeWidth={2.2} />
          {formatNumber(remainingRoundTickets)} {t("common.ticketsLeft")}
        </output>
        <output aria-live="polite">
          <Database size={16} strokeWidth={2.2} />
          {roundStatus(activeRound, activeDraw)}
        </output>
        <output aria-live="polite">
          <Trophy size={16} strokeWidth={2.2} />
          {formatNumber(accumulatedDrawEntries)} {t("common.entries")}
        </output>
      </section>
      <dl className="room-signal-grid" aria-label={t("mast.workspaceState")}>
        {signals.map((signal, index) => {
          const SignalIcon = signal.icon;
          return (
            <AnimatedContent as="div" key={signal.id} delay={index * 0.03} distance={10}>
              <dt className={`is-${signal.tone}`}>
                <SignalIcon size={16} strokeWidth={2.25} />
                {signal.label}
              </dt>
              <dd>
                <strong>{signal.value}</strong>
                <span>{signal.detail}</span>
              </dd>
            </AnimatedContent>
          );
        })}
      </dl>
    </GlareHover>
  );
}

function ViewMenu({ activeViewId, onSelectView, t }) {
  const activeIndex = Math.max(0, commandViews.findIndex((view) => view.id === activeViewId));

  function handlePreload(viewId) {
    if (viewId !== "home") {
      preloadRoom(viewId).catch(() => undefined);
    }
  }

  return (
    <menu className="command-menu pill-nav" aria-label={t("nav.aria")} data-active-index={activeIndex}>
      <span className="command-menu__indicator" aria-hidden="true" />
      {commandViews.map((view) => {
        const Icon = viewIcons[view.id] ?? Landmark;
        return (
          <li key={view.id}>
            <Magnet
              as="button"
              className={activeViewId === view.id ? "is-active" : ""}
              type="button"
              strength={72}
              aria-current={activeViewId === view.id ? "page" : undefined}
              onPointerEnter={() => handlePreload(view.id)}
              onPointerDown={() => handlePreload(view.id)}
              onFocus={() => handlePreload(view.id)}
              onClick={() => onSelectView(view.id)}
            >
              <Icon size={15} strokeWidth={2.1} />
              <span>{t(`nav.${view.id}`)}</span>
            </Magnet>
          </li>
        );
      })}
    </menu>
  );
}

function LanguageSwitch() {
  const { locale, locales, setLocale, t } = useCampaignCopy();

  return (
    <label className="language-switch language-switch--select" aria-label={t("language.label")} data-locale={locale}>
      <span>{t("language.label")}</span>
      <select value={locale} onChange={(event) => setLocale(event.target.value)} aria-label={t("language.toggle")}>
        {locales.map((option) => (
          <option key={option.id} value={option.id}>
            {option.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ControlRoom({
  activeViewId,
  mobileNavOpen,
  ledger,
  ledgerIssue,
  activeEntry,
  selectedWallet,
  simulatedRound,
  simulatedRoundId,
  activeRound,
  activeRoundId,
  rounds,
  matches,
  teamsById,
  selectedMatch,
  selectedTeamId,
  ticketAmount,
  remainingRoundTickets,
  usedRoundTickets,
  roundAllocations,
  roundVoteOutcomes,
  roundOutcomeSummary,
  previewVoteIssue,
  drawStats,
  milestones,
  currentMilestoneValue,
  simulationMode,
  liveQualification,
  authSession,
  authConfig,
  authIssue,
  authEndpointReady,
  onOpenAuthModal,
  onRefreshAuth,
  onSelectView,
  onToggleMobileNav,
  onSelectWallet,
  onSelectRound,
  onSelectSimulatedRound,
  onSelectSimulationMode,
  onSelectMatch,
  onSelectTeam,
  onSetTicketAmount,
  onConfirmPreviewVote,
}) {
  const copy = useCampaignCopy();
  const { roundLabel, t } = copy;
  const activeView = commandViews.find((view) => view.id === activeViewId) ?? commandViews[0];
  const activeDraw = drawStats.find((round) => round.id === activeRound.id) ?? drawStats[0];
  const accumulatedDrawEntries = (activeDraw?.eligibleEntries ?? 0) + (activeDraw?.pendingEntries ?? 0);
  const matchStateCounts = countMatchStates(matches, activeRoundId);
  const compactWorkViews = new Set(["schedule", "vote", "draw"]);
  const showRoomMast = activeViewId !== "home" && !compactWorkViews.has(activeViewId);
  const authWalletLinked = Boolean(authSession?.walletAddress);
  const showAuthState = Boolean(authEndpointReady);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      await onRefreshAuth?.();
    }
  }

  useEffect(() => {
    let cancelPreloadJobs = () => {};
    const cancelStart = scheduleIdleWork(() => {
      cancelPreloadJobs = preloadInactiveRooms(activeViewId);
    }, 900);

    return () => {
      cancelStart();
      cancelPreloadJobs();
    };
  }, [activeViewId]);

  return (
    <main className="control-room" data-view={activeViewId} data-simulation={simulationMode}>
      <header className="control-header" aria-label={t("nav.aria")}>
        <Magnet as="button" className="brand-lockup" type="button" strength={80} onClick={() => onSelectView("home")} aria-label={t("brand.homeAria")}>
          <img src={renaissLogo} alt="" aria-hidden="true" />
          <span>
            <strong>{t("brand.name")}</strong>
            <small>{t("brand.product")}</small>
          </span>
        </Magnet>
        <ViewMenu activeViewId={activeViewId} onSelectView={onSelectView} t={t} />
        <LanguageSwitch />
        <section className={showAuthState ? "header-wallet header-wallet--auth" : "header-wallet"} aria-label={showAuthState ? t("auth.accountAria") : t("vote.previewWallet")}>
          <button type="button" className="header-wallet__identity" onClick={showAuthState ? onOpenAuthModal : undefined}>
            <WalletCards size={18} strokeWidth={2.1} />
            {showAuthState ? (
              <>
                <span>{authWalletLinked ? compactAddress(authSession.walletAddress) : authSession?.authenticated ? t("auth.walletUnlinked") : t("auth.loginCta")}</span>
                <strong>{authWalletLinked ? `${formatNumber(activeEntry?.finalTickets)} ${t("common.tickets")}` : t("auth.loginDetail")}</strong>
              </>
            ) : (
              <>
                <span>{compactAddress(activeEntry?.userAddress)}</span>
                <strong>{formatNumber(activeEntry?.finalTickets)} {t("common.tickets")}</strong>
              </>
            )}
          </button>
          {showAuthState && authSession?.authenticated ? (
            <button className="header-wallet__logout" type="button" onClick={handleLogout} aria-label={t("auth.logout")}>
              <LogOut size={15} strokeWidth={2.25} />
            </button>
          ) : null}
        </section>
      </header>

      <section className={activeViewId === "home" ? "room-shell is-home" : "room-shell"} id="top" aria-label={`${t(`nav.${activeView.id}`)} ${t("common.workspace")}`}>
        {activeViewId === "home" ? (
          <HomeRoom
            activeRound={activeRound}
            matches={matches}
            milestones={milestones}
            currentMilestoneValue={currentMilestoneValue}
            rounds={rounds}
            onSelectView={onSelectView}
          />
        ) : (
          <>
            {showRoomMast ? (
              <RoomCommandMast
                activeViewId={activeViewId}
                activeRound={activeRound}
                activeDraw={activeDraw}
                matchStateCounts={matchStateCounts}
                remainingRoundTickets={remainingRoundTickets}
                accumulatedDrawEntries={accumulatedDrawEntries}
                copy={copy}
              />
            ) : null}

            {activeViewId !== "draw" ? (
              <RoundSwitch
                rounds={rounds}
                activeRoundId={activeRoundId}
                simulatedRoundId={simulatedRoundId}
                simulationMode={simulationMode}
                liveQualification={liveQualification}
                drawStats={drawStats}
                remainingRoundTickets={remainingRoundTickets}
                onSelectRound={onSelectRound}
                onSelectSimulatedRound={onSelectSimulatedRound}
                onSelectSimulationMode={onSelectSimulationMode}
                copy={copy}
              />
            ) : null}
          </>
        )}

        <Suspense fallback={<RoomLoadingShell t={t} />}>
          {activeViewId === "schedule" ? (
            <LazyScheduleRoom
              activeRound={activeRound}
              activeRoundId={activeRoundId}
              simulatedRound={simulatedRound}
              simulatedRoundId={simulatedRoundId}
              rounds={rounds}
              matches={matches}
              teamsById={teamsById}
              selectedMatch={selectedMatch}
              roundAllocations={roundAllocations}
              onSelectRound={onSelectRound}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              onSelectView={onSelectView}
            />
          ) : null}

          {activeViewId === "vote" ? (
            <LazyVoteRoom
              ledger={ledger}
              ledgerIssue={ledgerIssue}
              activeEntry={activeEntry}
              selectedWallet={selectedWallet}
              activeRound={activeRound}
              activeRoundId={activeRoundId}
              matches={matches}
              teamsById={teamsById}
              selectedMatch={selectedMatch}
              selectedTeamId={selectedTeamId}
              ticketAmount={ticketAmount}
              remainingRoundTickets={remainingRoundTickets}
              usedRoundTickets={usedRoundTickets}
              roundAllocations={roundAllocations}
              roundVoteOutcomes={roundVoteOutcomes}
              roundOutcomeSummary={roundOutcomeSummary}
              previewVoteIssue={previewVoteIssue}
              authSession={authSession}
              authEndpointReady={authEndpointReady}
              onOpenAuthModal={onOpenAuthModal}
              onSelectWallet={onSelectWallet}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              onSetTicketAmount={onSetTicketAmount}
              onConfirmPreviewVote={onConfirmPreviewVote}
            />
          ) : null}

          {activeViewId === "draw" ? (
            <LazyDrawRoom
              activeRound={activeRound}
              rounds={rounds}
              simulatedRoundId={simulatedRoundId}
              drawStats={drawStats}
              matches={matches}
              teamsById={teamsById}
              onSelectRound={onSelectRound}
            />
          ) : null}
        </Suspense>
      </section>
    </main>
  );
}
