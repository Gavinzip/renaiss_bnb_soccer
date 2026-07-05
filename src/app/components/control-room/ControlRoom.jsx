import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  Medal,
  Home,
  Landmark,
  LogOut,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Ticket,
  Trophy,
  Vote,
  WalletCards,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import renaissLogo from "../../assets/renaiss-logo-mark.webp";
import { commandViews } from "../../data/campaignRuntime";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { scheduleIdleWork } from "../../utils/preloadAssets";
import { requestRenaissProviderSignOut } from "../../utils/renaissAuth";
import { AnimatedContent } from "../AnimatedContent";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { HomeRoom } from "./HomeRoom";
import { XFollowGate } from "./XFollowGate";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const roomLoaders = {
  schedule: () => import("./ScheduleRoom"),
  vote: () => import("./VoteRoom"),
  draw: () => import("./DrawRoom"),
  winners: () => import("./WinnersRoom"),
};

const LazyScheduleRoom = lazyNamed(roomLoaders.schedule, "ScheduleRoom");
const LazyVoteRoom = lazyNamed(roomLoaders.vote, "VoteRoom");
const LazyDrawRoom = lazyNamed(roomLoaders.draw, "DrawRoom");
const LazyWinnersRoom = lazyNamed(roomLoaders.winners, "WinnersRoom");
const roomPreloadCache = new Map();
const ADMIN_ONLY_ROUND_IDS = new Set(["round32"]);
const BRAND_STATS_CLICK_WINDOW_MS = 3000;
const VERIFICATION_STATS_ENDPOINT = "/api/auth/verification-stats";

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

function preloadInactiveRooms(activeViewId, views = commandViews) {
  const preloadableViews = views
    .map((view) => view.id)
    .filter((viewId) => viewId !== "home" && roomLoaders[viewId]);
  const order = activeViewId === "home"
    ? preloadableViews
    : [activeViewId, ...preloadableViews];
  const uniqueOrder = [...new Set(order)].filter((viewId) => viewId !== "home");

  const cancelJobs = uniqueOrder.map((viewId, index) => (
    scheduleIdleWork(() => {
      preloadRoom(viewId).catch(() => undefined);
    }, 260 + index * 240)
  ));

  return () => cancelJobs.forEach((cancel) => cancel());
}

function toLedgerInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function compactHash(value) {
  const hash = String(value || "");
  if (hash.length <= 14) return hash || "-";
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatLedgerTimestamp(value, dateTime) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return dateTime(timestamp * 1000);
}

function intervalTicketRange(interval) {
  const start = interval?.displayStart ?? interval?.start;
  const end = interval?.displayEnd ?? interval?.end ?? start;
  if (!start) return "-";
  return start === end ? `#${start}` : `#${start}-${end}`;
}

function WalletTicketSourceDialog({ entry, ledger, walletAddress, onClose }) {
  const { dateTime, number, sourceLabel, t } = useCampaignCopy();
  const inspectedAddress = walletAddress || entry?.userAddress || "";
  const rawTickets = toLedgerInteger(entry?.rawTickets);
  const carryoverTickets = toLedgerInteger(entry?.carryoverTickets);
  const insiderPracticeTickets = toLedgerInteger(entry?.insiderPracticeTickets);
  const insiderGrantTickets = toLedgerInteger(entry?.insiderGrantTickets);
  const finalTickets = toLedgerInteger(entry?.finalTickets);
  const totalVotingTickets = Math.max(
    toLedgerInteger(entry?.totalVotingTickets),
    rawTickets + carryoverTickets + insiderPracticeTickets + insiderGrantTickets,
  );
  const visibleSourceTotalTickets = rawTickets + carryoverTickets + insiderGrantTickets;
  const eventCount = toLedgerInteger(entry?.eventCount);
  const rank = toLedgerInteger(entry?.rank);
  const ticketIntervals = Array.isArray(entry?.ticketIntervals) ? entry.ticketIntervals : [];
  const ticketIntervalCount = toLedgerInteger(entry?.ticketIntervalCount ?? ticketIntervals.length);
  const matchedLedgerEntry = totalVotingTickets > 0 || finalTickets > 0 || rawTickets > 0 || rank > 0;
  const ledgerHash = ledger?.ledgerHash ? compactHash(ledger.ledgerHash) : "-";
  const sourceAddresses = [...new Set([
    inspectedAddress,
    ...(Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : []),
  ].filter(Boolean))];
  const visibleSourceAddresses = sourceAddresses.slice(0, 3);
  const hiddenSourceAddressCount = Math.max(0, sourceAddresses.length - visibleSourceAddresses.length);
  const packRuleMap = useMemo(
    () => new Map((Array.isArray(ledger?.packRules) ? ledger.packRules : []).map((rule) => [rule.pack, rule])),
    [ledger?.packRules],
  );
  const packRows = useMemo(() => Object.entries(entry?.packs || {})
    .map(([pack, count]) => ({
      pack,
      count: toLedgerInteger(count),
      rule: packRuleMap.get(pack),
    }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count || left.pack.localeCompare(right.pack)),
  [entry?.packs, packRuleMap]);
  const [carryoverInfoOpen, setCarryoverInfoOpen] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <aside className="ticket-source-layer" role="presentation" onClick={onClose}>
      <section
        className={matchedLedgerEntry ? "ticket-source-panel" : "ticket-source-panel is-empty"}
        role="dialog"
        aria-modal="true"
        aria-label={t("ticketSource.aria")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ticket-source-panel__head">
          <div>
            <span>{t("ticketSource.eyebrow")}</span>
            <strong>{t("ticketSource.title")}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label={t("ticketSource.close")}>
            <X size={18} strokeWidth={2.35} />
          </button>
        </header>

        <section className="ticket-source-wallet">
          <WalletCards size={19} strokeWidth={2.15} />
          <div>
            <span>{matchedLedgerEntry ? t("ticketSource.walletMatched") : t("ticketSource.walletMissing")}</span>
            <strong>{inspectedAddress || "-"}</strong>
          </div>
        </section>

        <p className="ticket-source-panel__note">
          {matchedLedgerEntry
            ? t("ticketSource.matchBody", { count: number(visibleSourceTotalTickets) })
            : t("ticketSource.noMatchBody")}
        </p>
        {carryoverTickets > 0 ? (
          <p className="ticket-source-panel__note is-carryover-note">
            {t("ticketSource.carryoverRule", { count: number(carryoverTickets) })}
          </p>
        ) : null}
        {insiderGrantTickets > 0 ? (
          <p className="ticket-source-panel__note is-carryover-note">
            {t("ticketSource.insiderRule", {
              grant: number(insiderGrantTickets),
            })}
          </p>
        ) : null}

        <dl className="ticket-source-stats">
          <div>
            <dt>{t("ticketSource.finalTickets")}</dt>
            <dd>{number(visibleSourceTotalTickets)}</dd>
          </div>
          <div>
            <dt>{t("ticketSource.rawTickets")}</dt>
            <dd>{number(rawTickets)}</dd>
          </div>
          <div>
            <dt className="ticket-source-stat-label">
              <span>{t("ticketSource.carryoverTickets")}</span>
              <button
                type="button"
                className="ticket-source-info-button"
                aria-label={t("ticketSource.carryoverInfoAria")}
                aria-expanded={carryoverInfoOpen}
                onClick={() => setCarryoverInfoOpen((current) => !current)}
              >
                <CircleAlert size={14} strokeWidth={2.35} />
              </button>
            </dt>
            <dd>{number(carryoverTickets)}</dd>
            {carryoverInfoOpen ? (
              <p className="ticket-source-stat-note">{t("ticketSource.carryoverInfo")}</p>
            ) : null}
          </div>
          <div>
            <dt>{t("ticketSource.insiderGrantTickets")}</dt>
            <dd>{number(insiderGrantTickets)}</dd>
          </div>
        </dl>

        <dl className="ticket-source-meta">
          <div>
            <dt>{t("ticketSource.buybackWindow")}</dt>
            <dd>
              {formatLedgerTimestamp(entry?.firstBuybackAt, dateTime)}
              <span aria-hidden="true"> → </span>
              {formatLedgerTimestamp(entry?.lastBuybackAt, dateTime)}
            </dd>
          </div>
          <div>
            <dt>{t("ticketSource.eventCount")}</dt>
            <dd>{number(eventCount)}</dd>
          </div>
          <div>
            <dt>{t("ticketSource.ledgerSource")}</dt>
            <dd>{sourceLabel(ledger?.sourceLabel)} · {ledgerHash}</dd>
          </div>
        </dl>

        <section className="ticket-source-section">
          <header>
            <Database size={16} strokeWidth={2.2} />
            <span>{t("ticketSource.sourceAddresses")}</span>
          </header>
          <div className="ticket-source-addresses">
            {visibleSourceAddresses.map((address) => (
              <code key={address}>{address}</code>
            ))}
            {hiddenSourceAddressCount > 0 ? <em>{t("ticketSource.moreAddresses", { count: number(hiddenSourceAddressCount) })}</em> : null}
          </div>
        </section>

        <section className="ticket-source-section">
          <header>
            <Ticket size={16} strokeWidth={2.2} />
            <span>{t("ticketSource.packBreakdown")}</span>
          </header>
          {packRows.length ? (
            <ol className="ticket-source-packs">
              {packRows.map((row) => (
                <li key={row.pack}>
                  <strong>{row.rule?.label || row.pack}</strong>
                  <span>
                    {number(row.count)}
                    {row.rule?.ticketWeight ? ` · ${t("ticketSource.weight", { count: number(row.rule.ticketWeight) })}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("ticketSource.noPackRows")}</p>
          )}
        </section>

        <section className="ticket-source-section">
          <header>
            <Clock3 size={16} strokeWidth={2.2} />
            <span>{t("ticketSource.intervalTitle")}</span>
          </header>
          {ticketIntervals.length ? (
            <>
              <p className="ticket-source-section__hint">
                {t("ticketSource.intervalLoaded", {
                  shown: number(ticketIntervals.length),
                  total: number(ticketIntervalCount || ticketIntervals.length),
                })}
              </p>
              <ol className="ticket-source-intervals">
                {ticketIntervals.map((interval, index) => (
                  <li key={`${interval.namespace || "ticket"}-${interval.start}-${interval.end}-${index}`}>
                    <strong>{intervalTicketRange(interval)}</strong>
                    <span>{interval.pack || interval.source || interval.namespace || "-"}</span>
                    <small>{formatLedgerTimestamp(interval.timestamp, dateTime)}</small>
                    <code>{compactHash(interval.txHash)}</code>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p>{matchedLedgerEntry ? t("ticketSource.intervalMissing") : t("ticketSource.intervalNoEntry")}</p>
          )}
        </section>
      </section>
    </aside>
  );
}

function isLocalTestOrigin() {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === "localhost"
    || normalizedHostname === "127.0.0.1"
    || normalizedHostname === "0.0.0.0"
    || normalizedHostname === "::1"
    || normalizedHostname === "127.0.0.1.nip.io"
    || normalizedHostname.endsWith(".127.0.0.1.nip.io");
}

function isDrawRoomFeatureEnabled(localToolsEnabled) {
  if (localToolsEnabled) return true;
  const value = String(import.meta.env.VITE_DRAW_ROOM_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function drawRoomAllowedWallets() {
  return String(import.meta.env.VITE_DRAW_ROOM_ALLOWED_WALLETS || "")
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value));
}

function canViewDrawRoom(localToolsEnabled, authSession) {
  if (localToolsEnabled) return true;
  if (!isDrawRoomFeatureEnabled(localToolsEnabled)) return false;
  const allowedWallets = drawRoomAllowedWallets();
  if (allowedWallets.length === 0) return true;
  const walletAddress = String(authSession?.walletAddress || "").trim().toLowerCase();
  return allowedWallets.includes(walletAddress);
}

function isAdminOnlyRound(roundId) {
  return ADMIN_ONLY_ROUND_IDS.has(String(roundId || ""));
}

function visibleRoundsForAccess(rounds, canViewAdminOnlyRounds) {
  if (canViewAdminOnlyRounds) return rounds;
  return rounds.filter((round) => !isAdminOnlyRound(round.id));
}

function normalizeWinnerWalletAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function winnerWalletAddress(row) {
  return normalizeWinnerWalletAddress(row?.walletAddress || row?.userAddress || row?.profile?.walletAddress);
}

function filterWinnerRowsByRounds(rows, visibleRoundIds) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((row) => visibleRoundIds.has(String(row?.roundId || "")));
}

function filterWinnerDrawsByRounds(draws, visibleRoundIds) {
  if (!Array.isArray(draws)) return draws;
  return draws
    .map((draw) => ({
      ...draw,
      winners: filterWinnerRowsByRounds(draw.winners, visibleRoundIds),
      alternates: filterWinnerRowsByRounds(draw.alternates, visibleRoundIds),
      prizeSlots: Array.isArray(draw.prizeSlots)
        ? draw.prizeSlots
          .map((slot) => {
            const winnerRoundId = String(slot?.winner?.roundId || draw?.roundId || "");
            return {
              ...slot,
              winner: !slot?.winner || visibleRoundIds.has(winnerRoundId) ? slot.winner : null,
              alternates: filterWinnerRowsByRounds(slot?.alternates, visibleRoundIds),
            };
          })
          .filter((slot) => slot.winner || (Array.isArray(slot.alternates) && slot.alternates.length > 0))
        : draw.prizeSlots,
    }))
    .filter((draw) => visibleRoundIds.has(String(draw?.roundId || ""))
      || (Array.isArray(draw.winners) && draw.winners.length > 0)
      || (Array.isArray(draw.prizeSlots) && draw.prizeSlots.length > 0));
}

function filterWinnerRevealDataByRounds(winnerRevealData, visibleRoundIds) {
  const winners = filterWinnerRowsByRounds(winnerRevealData?.winners, visibleRoundIds);
  const winnersBySlot = filterWinnerRowsByRounds(winnerRevealData?.winnersBySlot, visibleRoundIds);
  const alternates = filterWinnerRowsByRounds(winnerRevealData?.alternates, visibleRoundIds);
  return {
    ...winnerRevealData,
    winners,
    winnersBySlot,
    alternates,
    draws: filterWinnerDrawsByRounds(winnerRevealData?.draws, visibleRoundIds),
    winnerCount: Array.isArray(winners) ? winners.length : winnerRevealData?.winnerCount,
    alternateCount: Array.isArray(alternates) ? alternates.length : winnerRevealData?.alternateCount,
  };
}

function countVisibleWinnersForWallet(winnerRevealData, walletAddress, visibleRoundIds) {
  const wallet = normalizeWinnerWalletAddress(walletAddress);
  if (!wallet || winnerRevealData?.sourceStatus !== "revealed") return 0;
  return (Array.isArray(winnerRevealData?.winners) ? winnerRevealData.winners : [])
    .filter((winner) => visibleRoundIds.has(String(winner?.roundId || "")) && winnerWalletAddress(winner) === wallet)
    .length;
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
  winners: Medal,
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
    winners: {
      Icon: Medal,
      eyebrow: t("views.winners.eyebrow"),
      title: t("views.winners.title"),
      body: t("views.winners.body"),
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

function VerificationStatsPanel({
  loading,
  issue,
  stats,
  onClose,
  onRefresh,
  t,
}) {
  const counts = stats?.counts || {};
  const xVerified = Number.isFinite(Number(counts.xVerified)) ? Number(counts.xVerified) : 0;
  const voteEligible = Number.isFinite(Number(counts.voteEligible)) ? Number(counts.voteEligible) : 0;
  const generatedAt = stats?.generatedAt ? new Date(stats.generatedAt) : null;
  const generatedLabel = generatedAt && Number.isFinite(generatedAt.getTime())
    ? generatedAt.toLocaleString()
    : "";

  return (
    <div className="verification-stats-panel" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="verification-stats-panel__card"
        role="dialog"
        aria-modal="true"
        aria-label={t("verificationStats.title")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="verification-stats-panel__head">
          <span>{t("verificationStats.eyebrow")}</span>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>
        <h2>{t("verificationStats.title")}</h2>
        <div className="verification-stats-panel__grid">
          <output>
            <span>{t("verificationStats.xVerified")}</span>
            <strong>{loading ? "..." : formatNumber(xVerified)}</strong>
            <small>{t("verificationStats.people")}</small>
          </output>
          <output>
            <span>{t("verificationStats.voteEligible")}</span>
            <strong>{loading ? "..." : formatNumber(voteEligible)}</strong>
            <small>{t("verificationStats.people")}</small>
          </output>
        </div>
        {issue ? (
          <p className="verification-stats-panel__issue">
            <CircleAlert size={15} strokeWidth={2.3} />
            <span>{issue}</span>
          </p>
        ) : null}
        <div className="verification-stats-panel__foot">
          <span>{generatedLabel ? t("verificationStats.updatedAt", { time: generatedLabel }) : t("verificationStats.noTimestamp")}</span>
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? t("common.loading") : t("verificationStats.refresh")}
          </button>
        </div>
      </section>
    </div>
  );
}

function RoundSwitch({
  rounds,
  activeRoundId,
  simulatedRoundId,
  simulationMode,
  liveQualification,
  drawStats,
  remainingRoundTickets,
  showModeTools = false,
  allowAllRounds = false,
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
    <section className={showModeTools ? "round-simulator" : "round-simulator is-rail-only"} aria-label={t("roundRail.simulatorAria")}>
      <ol className="round-switch round-switch--read-only" aria-label={t("common.round")}>
        {rounds.map((round, index) => {
          const draw = drawById.get(round.id);
          const isActive = round.id === activeRoundId;
          const canInspect = allowAllRounds || simulationMode === "realtime" || showModeTools || index <= simulatedIndex;
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
      {showModeTools ? (
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
      ) : null}
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

function ViewMenu({ activeViewId, id, onSelectView, t, views = commandViews, winnersAlert = false }) {
  const activeIndex = Math.max(0, views.findIndex((view) => view.id === activeViewId));

  function handlePreload(viewId) {
    if (viewId !== "home") {
      preloadRoom(viewId).catch(() => undefined);
    }
  }

  return (
    <menu className="command-menu pill-nav" id={id} aria-label={t("nav.aria")} data-active-index={activeIndex} data-view-count={views.length}>
      <span className="command-menu__indicator" aria-hidden="true" />
      {views.map((view) => {
        const Icon = viewIcons[view.id] ?? Landmark;
        const hasAlert = winnersAlert && view.id === "winners";
        return (
          <li key={view.id}>
            <Magnet
              as="button"
              className={[
                activeViewId === view.id ? "is-active" : "",
                hasAlert ? "has-alert" : "",
              ].filter(Boolean).join(" ")}
              type="button"
              strength={72}
              aria-current={activeViewId === view.id ? "page" : undefined}
              aria-label={hasAlert ? `${t(`nav.${view.id}`)} · ${t("winnerReveal.navAlert")}` : undefined}
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
  const [open, setOpen] = useState(false);
  const activeOption = locales.find((option) => option.id === locale) ?? locales[0];
  const shortLabel = (option) => ({
    "zh-Hant": "CN",
    en: "EN",
    ko: "KR",
  })[option.id] ?? option.label;

  function handleSelect(nextLocale) {
    setLocale(nextLocale);
    setOpen(false);
  }

  return (
    <div
      className={open ? "language-switch language-switch--select language-switch--popover is-open" : "language-switch language-switch--select language-switch--popover"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        className="language-switch__trigger"
        type="button"
        aria-label={t("language.toggle")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{shortLabel(activeOption)}</span>
        <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open ? (
        <menu className="language-switch__menu" role="menu" aria-label={t("language.label")}>
          {locales.map((option) => {
            const active = option.id === locale;
            return (
              <li key={option.id}>
                <button
                  className={active ? "is-active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => handleSelect(option.id)}
                >
                  <span>{shortLabel(option)}</span>
                </button>
              </li>
            );
          })}
        </menu>
      ) : null}
    </div>
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
  roundTicketBreakdown,
  usedRoundTickets,
  roundAllocations,
  roundVoteOutcomes,
  roundOutcomeSummary,
  previewVoteIssue,
  winnerRevealData,
  winnerRevealIssue,
  currentWinnerWalletAddress,
  currentUserWinnerCount,
  drawStats,
  milestones,
  currentMilestoneValue,
  simulationMode,
  liveQualification,
  authSession,
  authConfig,
  authIssue,
  authEndpointReady,
  onRequestLogin,
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
  const localToolsEnabled = isLocalTestOrigin();
  const drawViewEnabled = canViewDrawRoom(localToolsEnabled, authSession);
  const canViewAdminOnlyRounds = canViewDrawRoom(false, authSession);
  const showSimulationControls = localToolsEnabled;
  const [winnerRevealStarted, setWinnerRevealStarted] = useState(false);
  const visibleRounds = useMemo(
    () => visibleRoundsForAccess(rounds, canViewAdminOnlyRounds),
    [canViewAdminOnlyRounds, rounds],
  );
  const visibleRoundIds = useMemo(
    () => new Set(visibleRounds.map((round) => round.id)),
    [visibleRounds],
  );
  const visibleDrawStats = useMemo(
    () => drawStats.filter((round) => visibleRoundIds.has(round.id)),
    [drawStats, visibleRoundIds],
  );
  const visibleActiveRound = visibleRounds.find((round) => round.id === activeRoundId)
    ?? visibleRounds[0]
    ?? activeRound;
  const visibleActiveRoundId = visibleActiveRound?.id ?? activeRoundId;
  const activeRoundIsVisible = visibleRoundIds.has(activeRoundId);
  const displayedRoundAllocations = activeRoundIsVisible ? roundAllocations : [];
  const displayedRoundVoteOutcomes = activeRoundIsVisible ? roundVoteOutcomes : [];
  const displayedRoundOutcomeSummary = activeRoundIsVisible
    ? roundOutcomeSummary
    : { lostTickets: 0, winnerTickets: 0, pendingTickets: 0 };
  const displayedRemainingRoundTickets = activeRoundIsVisible ? remainingRoundTickets : 0;
  const displayedUsedRoundTickets = activeRoundIsVisible ? usedRoundTickets : 0;
  const displayedRoundTicketBreakdown = activeRoundIsVisible
    ? roundTicketBreakdown
    : { usableTickets: 0, remainingTickets: 0, usedTickets: 0, allocations: [] };
  const visibleWinnerRevealData = useMemo(
    () => (canViewAdminOnlyRounds
      ? winnerRevealData
      : filterWinnerRevealDataByRounds(winnerRevealData, visibleRoundIds)),
    [canViewAdminOnlyRounds, visibleRoundIds, winnerRevealData],
  );
  const visibleCurrentUserWinnerCount = canViewAdminOnlyRounds
    ? currentUserWinnerCount
    : countVisibleWinnersForWallet(winnerRevealData, currentWinnerWalletAddress, visibleRoundIds);
  const visibleCommandViews = useMemo(
    () => (drawViewEnabled ? commandViews : commandViews.filter((view) => view.id !== "draw")),
    [drawViewEnabled],
  );
  const effectiveActiveViewId = !drawViewEnabled && activeViewId === "draw" ? "home" : activeViewId;
  const activeView = visibleCommandViews.find((view) => view.id === effectiveActiveViewId) ?? visibleCommandViews[0] ?? commandViews[0];
  const activeDraw = visibleDrawStats.find((round) => round.id === visibleActiveRound.id) ?? visibleDrawStats[0] ?? drawStats[0];
  const accumulatedDrawEntries = (activeDraw?.eligibleEntries ?? 0) + (activeDraw?.pendingEntries ?? 0);
  const matchStateCounts = countMatchStates(matches, visibleActiveRoundId);
  const compactWorkViews = new Set(["schedule", "vote", "draw", "winners"]);
  const showRoomMast = effectiveActiveViewId !== "home" && !compactWorkViews.has(effectiveActiveViewId);
  const showRoundSwitch = effectiveActiveViewId === "schedule"
    || effectiveActiveViewId === "vote"
    || (effectiveActiveViewId === "winners" && winnerRevealStarted);
  const roundSwitchAllowsAll = effectiveActiveViewId === "winners";
  const authWalletLinked = Boolean(authSession?.walletAddress);
  const showAuthState = Boolean(authEndpointReady);
  const authIdentityActionable = showAuthState && !authSession?.authenticated;
  const ticketSourceWalletAddress = authWalletLinked ? authSession.walletAddress : (!showAuthState ? activeEntry?.userAddress : "");
  const ticketSourceActionable = Boolean(ticketSourceWalletAddress);
  const headerWalletActionable = authIdentityActionable || ticketSourceActionable;
  const HeaderWalletIdentity = headerWalletActionable ? "button" : "div";
  const headerTicketCount = toLedgerInteger(remainingRoundTickets);
  const brandStatsClickRef = useRef({ count: 0, lastAt: 0, timerId: null });
  const [ticketSourceOpen, setTicketSourceOpen] = useState(false);
  const [xFollowPanelOpen, setXFollowPanelOpen] = useState(false);
  const [xFollowOverlayDismissed, setXFollowOverlayDismissed] = useState(false);
  const [verificationStatsOpen, setVerificationStatsOpen] = useState(false);
  const [verificationStatsLoading, setVerificationStatsLoading] = useState(false);
  const [verificationStatsIssue, setVerificationStatsIssue] = useState("");
  const [verificationStats, setVerificationStats] = useState(null);
  const xFollowGateRequired = authConfig?.xFollowGate?.required !== false;
  const xAccountEligibilityRequired = authConfig?.xAccountEligibility?.required !== false;
  const preVoteGateRequired = xFollowGateRequired || xAccountEligibilityRequired;
  const xFollowGatePassed = !xFollowGateRequired || Boolean(authSession?.xFollow?.gatePassed);
  const xAccountEligibilityPassed = !xAccountEligibilityRequired || Boolean(authSession?.xAccountEligibility?.gatePassed);
  const xFollowVerifyComplete = Boolean(authSession?.xFollow?.gatePassed) && xAccountEligibilityPassed;
  const voteRequiresPreVoteGate = authEndpointReady && preVoteGateRequired && (!xFollowGatePassed || !xAccountEligibilityPassed);
  const voteActionBlockReason = voteRequiresPreVoteGate ? t("vote.voteEligibilityBlocked") : "";
  const showXFollowVerifyButton = authEndpointReady && (preVoteGateRequired || localToolsEnabled) && effectiveActiveViewId === "vote";
  const canDismissXFollowOverlay = true;
  const closeXFollowOverlay = useCallback(() => {
    setXFollowOverlayDismissed(true);
    setXFollowPanelOpen(false);
  }, []);
  const openXFollowOverlay = useCallback(() => {
    if (!showXFollowVerifyButton) return;
    setXFollowOverlayDismissed(false);
    setXFollowPanelOpen(true);
  }, [showXFollowVerifyButton]);
  const showXFollowOverlay = effectiveActiveViewId === "vote"
    && !(xFollowOverlayDismissed && canDismissXFollowOverlay)
    && showXFollowVerifyButton
    && xFollowPanelOpen;

  const loadVerificationStats = useCallback(async () => {
    if (typeof window === "undefined") return;
    setVerificationStatsLoading(true);
    setVerificationStatsIssue("");

    try {
      const response = await fetch(VERIFICATION_STATS_ENDPOINT, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setVerificationStats(payload);
    } catch (error) {
      setVerificationStatsIssue(t("verificationStats.loadFailed", {
        message: error instanceof Error ? error.message : String(error || ""),
      }));
    } finally {
      setVerificationStatsLoading(false);
    }
  }, [t]);

  const openVerificationStats = useCallback(() => {
    setVerificationStatsOpen(true);
    loadVerificationStats();
  }, [loadVerificationStats]);

  const handleBrandLockupClick = useCallback((event) => {
    const clickState = brandStatsClickRef.current;
    const now = Date.now();
    if (now - clickState.lastAt > BRAND_STATS_CLICK_WINDOW_MS) {
      clickState.count = 0;
    }

    clickState.lastAt = now;
    clickState.count += 1;

    if (clickState.timerId) window.clearTimeout(clickState.timerId);
    clickState.timerId = window.setTimeout(() => {
      clickState.count = 0;
      clickState.timerId = null;
    }, BRAND_STATS_CLICK_WINDOW_MS);

    if (clickState.count >= 3) {
      if (clickState.timerId) window.clearTimeout(clickState.timerId);
      clickState.count = 0;
      clickState.timerId = null;
      event.preventDefault();
      openVerificationStats();
      return;
    }

    onSelectView("home");
  }, [onSelectView, openVerificationStats]);

  async function handleLogout() {
    if (typeof window === "undefined") return;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const logoutUrl = new URL("/api/auth/logout", window.location.origin);
    logoutUrl.searchParams.set("return_to", returnTo);
    requestRenaissProviderSignOut(authSession, authConfig, { waitForFetch: false });
    window.location.assign(`${logoutUrl.pathname}${logoutUrl.search}`);
  }

  function handleHeaderWalletClick() {
    if (authIdentityActionable) {
      onRequestLogin();
      return;
    }

    if (ticketSourceActionable) setTicketSourceOpen(true);
  }

  function handleSelectVisibleRound(roundId) {
    if (!canViewAdminOnlyRounds && isAdminOnlyRound(roundId)) {
      const fallbackRoundId = visibleRounds[0]?.id;
      if (fallbackRoundId) onSelectRound(fallbackRoundId);
      return;
    }
    onSelectRound(roundId);
  }

  useEffect(() => {
    if (!drawViewEnabled && activeViewId === "draw") {
      onSelectView("home");
    }
  }, [activeViewId, drawViewEnabled, onSelectView]);

  useEffect(() => {
    if (canViewAdminOnlyRounds) return;
    if (!isAdminOnlyRound(activeRoundId)) return;
    const fallbackRoundId = visibleRounds[0]?.id;
    if (fallbackRoundId) onSelectRound(fallbackRoundId);
  }, [activeRoundId, canViewAdminOnlyRounds, onSelectRound, visibleRounds]);

  useEffect(() => {
    if (effectiveActiveViewId !== "winners") setWinnerRevealStarted(false);
  }, [effectiveActiveViewId]);

  useEffect(() => () => {
    const timerId = brandStatsClickRef.current.timerId;
    if (timerId) window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    let cancelPreloadJobs = () => {};
    const cancelStart = scheduleIdleWork(() => {
      cancelPreloadJobs = preloadInactiveRooms(effectiveActiveViewId, visibleCommandViews);
    }, 900);

    return () => {
      cancelStart();
      cancelPreloadJobs();
    };
  }, [drawViewEnabled, effectiveActiveViewId, visibleCommandViews]);

  useEffect(() => {
    if (effectiveActiveViewId !== "vote" || !showXFollowVerifyButton) {
      setXFollowPanelOpen(false);
      setXFollowOverlayDismissed(false);
    }
  }, [effectiveActiveViewId, showXFollowVerifyButton]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (effectiveActiveViewId !== "vote" || !showXFollowVerifyButton) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("xgate") !== "1") return;

    setXFollowOverlayDismissed(false);
    setXFollowPanelOpen(true);
  }, [effectiveActiveViewId, showXFollowVerifyButton]);

  useEffect(() => {
    if (!showXFollowOverlay || !canDismissXFollowOverlay) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") closeXFollowOverlay();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showXFollowOverlay, canDismissXFollowOverlay, closeXFollowOverlay]);

  return (
    <main
      className="control-room"
      data-view={effectiveActiveViewId}
      data-simulation={simulationMode}
      data-local-tools={localToolsEnabled ? "true" : "false"}
    >
      <header className={mobileNavOpen ? "control-header is-mobile-nav-open" : "control-header"} aria-label={t("nav.aria")}>
        <Magnet
          as="button"
          className="brand-lockup"
          type="button"
          strength={80}
          onClick={handleBrandLockupClick}
          aria-label={t("brand.homeAria")}
        >
          <img src={renaissLogo} alt="" aria-hidden="true" />
          <span>
            <strong>{t("brand.name")}</strong>
            <small>{t("brand.product")}</small>
          </span>
        </Magnet>
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={onToggleMobileNav}
          aria-controls="control-view-menu"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? t("common.close") : t("nav.aria")}
        >
          {mobileNavOpen ? <X size={18} strokeWidth={2.35} /> : <Menu size={18} strokeWidth={2.35} />}
          <span>{t(`nav.${activeView.id}`)}</span>
        </button>
        <ViewMenu
          id="control-view-menu"
          activeViewId={effectiveActiveViewId}
          onSelectView={onSelectView}
          t={t}
          views={visibleCommandViews}
          winnersAlert={visibleCurrentUserWinnerCount > 0}
        />
        <LanguageSwitch />
        {showXFollowVerifyButton ? (
          <button
            type="button"
            className={xFollowVerifyComplete ? "header-x-verify is-complete" : "header-x-verify"}
            onClick={() => (xFollowPanelOpen ? setXFollowPanelOpen(false) : openXFollowOverlay())}
            aria-expanded={xFollowPanelOpen}
            aria-label={xFollowVerifyComplete ? t("xFollowGate.optionalComplete") : t("xFollowGate.verifyEligibility")}
          >
            <ShieldCheck size={16} strokeWidth={2.25} />
            <span>{xFollowVerifyComplete ? t("xFollowGate.optionalComplete") : t("xFollowGate.optionalButton")}</span>
          </button>
        ) : null}
        <section className={showAuthState ? "header-wallet header-wallet--auth" : "header-wallet"} aria-label={showAuthState ? t("auth.accountAria") : t("vote.previewWallet")}>
          <HeaderWalletIdentity
            className={headerWalletActionable ? "header-wallet__identity" : "header-wallet__identity is-static"}
            {...(headerWalletActionable ? {
              type: "button",
              onClick: handleHeaderWalletClick,
              "aria-label": authIdentityActionable ? t("auth.loginCta") : t("ticketSource.open"),
            } : {})}
          >
            <WalletCards size={18} strokeWidth={2.1} />
            {showAuthState ? (
              <>
                <span>{authWalletLinked ? compactAddress(authSession.walletAddress) : authSession?.authenticated ? t("auth.walletUnlinked") : t("auth.loginCta")}</span>
                <strong>{authWalletLinked ? `${formatNumber(headerTicketCount)} ${t("common.tickets")}` : t("auth.loginDetail")}</strong>
              </>
            ) : (
              <>
                <span>{compactAddress(activeEntry?.userAddress)}</span>
                <strong>{formatNumber(headerTicketCount)} {t("common.tickets")}</strong>
              </>
            )}
          </HeaderWalletIdentity>
          {showAuthState && authSession?.authenticated ? (
            <button className="header-wallet__logout" type="button" onClick={handleLogout} aria-label={t("auth.logout")}>
              <LogOut size={15} strokeWidth={2.25} />
            </button>
          ) : null}
        </section>
      </header>

      {verificationStatsOpen ? (
        <VerificationStatsPanel
          loading={verificationStatsLoading}
          issue={verificationStatsIssue}
          stats={verificationStats}
          onClose={() => setVerificationStatsOpen(false)}
          onRefresh={loadVerificationStats}
          t={t}
        />
      ) : null}

      {ticketSourceOpen ? (
        <WalletTicketSourceDialog
          entry={activeEntry}
          ledger={ledger}
          walletAddress={ticketSourceWalletAddress}
          onClose={() => setTicketSourceOpen(false)}
        />
      ) : null}

      <section className={effectiveActiveViewId === "home" ? "room-shell is-home" : "room-shell"} id="top" aria-label={`${t(`nav.${activeView.id}`)} ${t("common.workspace")}`}>
        <HomeRoom
          activeRound={visibleActiveRound}
          matches={matches}
          milestones={milestones}
          currentMilestoneValue={currentMilestoneValue}
          rounds={visibleRounds}
          onSelectView={onSelectView}
          isActive={effectiveActiveViewId === "home"}
        />

        {effectiveActiveViewId !== "home" ? (
          <>
            {showRoomMast ? (
              <RoomCommandMast
                activeViewId={effectiveActiveViewId}
                activeRound={visibleActiveRound}
                activeDraw={activeDraw}
                matchStateCounts={matchStateCounts}
                remainingRoundTickets={displayedRemainingRoundTickets}
                accumulatedDrawEntries={accumulatedDrawEntries}
                copy={copy}
              />
            ) : null}

            {showRoundSwitch ? (
              <RoundSwitch
                rounds={visibleRounds}
                activeRoundId={visibleActiveRoundId}
                simulatedRoundId={simulatedRoundId}
                simulationMode={simulationMode}
                liveQualification={liveQualification}
                drawStats={visibleDrawStats}
                remainingRoundTickets={displayedRemainingRoundTickets}
                showModeTools={showSimulationControls && effectiveActiveViewId !== "winners"}
                allowAllRounds={roundSwitchAllowsAll}
                onSelectRound={handleSelectVisibleRound}
                onSelectSimulatedRound={onSelectSimulatedRound}
                onSelectSimulationMode={onSelectSimulationMode}
                copy={copy}
              />
            ) : null}
          </>
        ) : null}

        <Suspense fallback={<RoomLoadingShell t={t} />}>
          {effectiveActiveViewId === "schedule" ? (
            <LazyScheduleRoom
              activeRound={visibleActiveRound}
              activeRoundId={visibleActiveRoundId}
              simulatedRound={simulatedRound}
              simulatedRoundId={simulatedRoundId}
              rounds={visibleRounds}
              matches={matches}
              teamsById={teamsById}
              selectedMatch={selectedMatch}
              roundAllocations={displayedRoundAllocations}
              onSelectRound={handleSelectVisibleRound}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              onSelectView={onSelectView}
            />
          ) : null}

          {effectiveActiveViewId === "vote" ? (
            <LazyVoteRoom
              ledger={ledger}
              ledgerIssue={ledgerIssue}
              activeEntry={activeEntry}
              selectedWallet={selectedWallet}
              activeRound={visibleActiveRound}
              activeRoundId={visibleActiveRoundId}
              matches={matches}
              teamsById={teamsById}
              selectedMatch={selectedMatch}
              selectedTeamId={selectedTeamId}
              ticketAmount={ticketAmount}
              remainingRoundTickets={displayedRemainingRoundTickets}
              roundTicketBreakdown={displayedRoundTicketBreakdown}
              usedRoundTickets={displayedUsedRoundTickets}
              roundAllocations={displayedRoundAllocations}
              roundVoteOutcomes={displayedRoundVoteOutcomes}
              roundOutcomeSummary={displayedRoundOutcomeSummary}
              previewVoteIssue={previewVoteIssue}
              voteActionBlocked={voteRequiresPreVoteGate}
              voteActionBlockReason={voteActionBlockReason}
              authSession={authSession}
              authEndpointReady={authEndpointReady}
              onRequestLogin={onRequestLogin}
              onSelectWallet={onSelectWallet}
              onSelectMatch={onSelectMatch}
              onSelectTeam={onSelectTeam}
              onSetTicketAmount={onSetTicketAmount}
              onConfirmPreviewVote={onConfirmPreviewVote}
              onRequestVoteEligibility={openXFollowOverlay}
            />
          ) : null}

          {showXFollowOverlay ? (
            <section
              className={canDismissXFollowOverlay ? "x-follow-gate-overlay is-optional" : "x-follow-gate-overlay is-required"}
              aria-label={t("xFollowGate.aria")}
            >
              {canDismissXFollowOverlay ? (
                <button
                  type="button"
                  className="x-follow-gate-overlay__scrim"
                  aria-label={t("xFollowGate.close")}
                  onClick={closeXFollowOverlay}
                />
              ) : (
                <div className="x-follow-gate-overlay__scrim" aria-hidden="true" />
              )}
              <div className="x-follow-gate-overlay__sheet" role="dialog" aria-modal="true" aria-label={t("xFollowGate.aria")}>
                <XFollowGate
                  authSession={authSession}
                  authConfig={authConfig}
                  authEndpointReady={authEndpointReady}
                  onRefreshAuth={onRefreshAuth}
                  onRequestLogin={onRequestLogin}
                  onRequestClose={canDismissXFollowOverlay ? closeXFollowOverlay : undefined}
                />
              </div>
            </section>
          ) : null}

          {effectiveActiveViewId === "draw" && drawViewEnabled ? (
            <LazyDrawRoom
              activeRound={visibleActiveRound}
              rounds={visibleRounds}
              simulatedRoundId={simulatedRoundId}
              drawStats={visibleDrawStats}
              matches={matches}
              teamsById={teamsById}
              onSelectRound={handleSelectVisibleRound}
            />
          ) : null}

          {effectiveActiveViewId === "winners" ? (
            <LazyWinnersRoom
              activeRoundId={visibleActiveRoundId}
              rounds={visibleRounds}
              matches={matches}
              winnerRevealData={visibleWinnerRevealData}
              winnerRevealIssue={winnerRevealIssue}
              currentWalletAddress={currentWinnerWalletAddress}
              currentUserWinnerCount={visibleCurrentUserWinnerCount}
              onRevealStateChange={setWinnerRevealStarted}
            />
          ) : null}
        </Suspense>
      </section>
    </main>
  );
}
