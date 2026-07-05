import { Award, CirclePlay, Gift, RotateCcw, Sparkles, Ticket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import revealBackdrop from "../../assets/championship-trophy-renaiss-mark.webp";
import { getMatchPrizeImageByMatchId, preloadRoundPrizeImages } from "../../data/matchPrizeImages";
import { canonicalMatchId } from "../../data/matchIds";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import SideRays from "../SideRays/SideRays";

const FALLBACK_ROUND_ORDER = ["round32", "round16", "quarterFinal", "semiFinal", "final"];
const WINNER_ROUND_LABEL_KEYS = {
  round32: "winnerReveal.roundGroupRound32",
  round16: "winnerReveal.roundGroupRound16",
  quarterFinal: "winnerReveal.roundGroupQuarterFinal",
  semiFinal: "winnerReveal.roundGroupSemiFinal",
  final: "winnerReveal.roundGroupFinal",
};

function winnerWalletLabel(winner) {
  return compactAddress(winner.walletAddress || winner.userAddress || "");
}

function normalizeWalletAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function winnerWalletAddress(winner) {
  return normalizeWalletAddress(winner?.walletAddress || winner?.userAddress || winner?.profile?.walletAddress);
}

function isCurrentUserWinner(winner, currentWalletAddress) {
  const current = normalizeWalletAddress(currentWalletAddress);
  return Boolean(current && winnerWalletAddress(winner) === current);
}

function cleanWinnerTwitterUsername(winner) {
  return String(winner?.profile?.twitterUsername || "").trim().replace(/^@+/, "");
}

function winnerPrimaryLabel(winner, fallbackLabel) {
  const twitterUsername = cleanWinnerTwitterUsername(winner);
  if (twitterUsername) return `@${twitterUsername}`;
  const displayName = String(winner?.profile?.displayName || winner?.profile?.name || "").trim();
  return displayName || winnerWalletLabel(winner) || fallbackLabel;
}

function winnerSecondaryLabel(winner, prizeMeta) {
  const walletLabel = winnerWalletLabel(winner);
  const twitterUsername = cleanWinnerTwitterUsername(winner);
  if (walletLabel && twitterUsername) return `${walletLabel} · ${prizeMeta}`;
  return prizeMeta;
}

function winnerAvatarInitial(winner) {
  const source = cleanWinnerTwitterUsername(winner)
    || String(winner?.profile?.displayName || winner?.profile?.name || "").trim();
  if (source) return source.slice(0, 1).toUpperCase();
  return "";
}

function winnerRoundGroupLabel(roundId, round, t, roundLabel) {
  const labelKey = WINNER_ROUND_LABEL_KEYS[roundId];
  if (labelKey) {
    const label = t(labelKey);
    if (label !== labelKey) return label;
  }
  return round ? roundLabel(round, "label") : "";
}

function matchDisplayCode(match, fallbackMatchId = "") {
  return String(match?.displayCode || match?.id || fallbackMatchId || "").toUpperCase();
}

function buildWinnerRoundGroups(winners, rounds, matches, t, roundLabel) {
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const roundOrder = new Map(rounds.map((round, index) => [round.id, index]));
  const fallbackOrder = new Map(FALLBACK_ROUND_ORDER.map((roundId, index) => [roundId, index]));
  const matchById = new Map(matches.map((match) => [canonicalMatchId(match.id), match]));
  const groupsById = new Map();

  winners.forEach((winner, globalIndex) => {
    const roundId = winner.roundId || "unknown";
    const round = roundById.get(roundId) || null;
    const group = groupsById.get(roundId) || {
      id: roundId,
      label: winnerRoundGroupLabel(roundId, round, t, roundLabel),
      order: roundOrder.get(roundId) ?? fallbackOrder.get(roundId) ?? 999,
      winners: [],
    };
    const match = matchById.get(canonicalMatchId(winner.matchId)) || null;

    group.winners.push({
      winner,
      globalIndex,
      matchLabel: matchDisplayCode(match, winner.matchId),
      prizeImage: getMatchPrizeImageByMatchId(match?.id || winner.matchId, matches, roundId),
    });
    groupsById.set(roundId, group);
  });

  return Array.from(groupsById.values())
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((group) => ({
      ...group,
      winners: [...group.winners].sort((left, right) => left.globalIndex - right.globalIndex),
    }));
}

function buildWinnerRoundOptions(winnerRoundGroups, rounds, t, roundLabel) {
  const groupsById = new Map(winnerRoundGroups.map((group) => [group.id, group]));
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const sourceIds = rounds.length ? rounds.map((round) => round.id) : FALLBACK_ROUND_ORDER;
  const optionIds = sourceIds.filter((roundId) => FALLBACK_ROUND_ORDER.includes(roundId));

  return optionIds.map((roundId, index) => {
    const round = roundById.get(roundId) || null;
    const group = groupsById.get(roundId) || null;
    return {
      id: roundId,
      label: winnerRoundGroupLabel(roundId, round, t, roundLabel),
      count: group?.winners.length || 0,
      order: index,
      winners: group?.winners || [],
    };
  });
}

function WinnerRevealRow({ winner, index, visible, active, selected, matchLabel, prizeImage, currentUser, onSelect }) {
  const { t } = useCampaignCopy();
  const prizeSlot = t("winnerReveal.prizeSlot", { slot: formatNumber(winner.prizeSlotIndex + 1) });
  const prizeMeta = matchLabel
    ? t("winnerReveal.matchPrizeSlot", { match: matchLabel, slot: formatNumber(winner.prizeSlotIndex + 1) })
    : prizeSlot;
  const avatarUrl = String(winner.profile?.avatarUrl || winner.profile?.picture || "").trim();
  const twitterUsername = cleanWinnerTwitterUsername(winner);
  const hasProfileIdentity = Boolean(
    twitterUsername
    || avatarUrl
    || String(winner?.profile?.displayName || winner?.profile?.name || "").trim(),
  );
  const primaryLabel = winnerPrimaryLabel(winner, t("winnerReveal.walletPending"));
  const secondaryLabel = winnerSecondaryLabel(winner, prizeMeta);

  return (
    <li
      className={[
        "winner-reveal-row",
        visible ? "is-visible" : "",
        active ? "is-active" : "",
        currentUser ? "is-current-user" : "",
        twitterUsername ? "has-twitter-profile" : "is-wallet-only",
      ].filter(Boolean).join(" ")}
      style={{ "--winner-delay": `${Math.min(index, 5) * 40}ms`, "--winner-order": index }}
      role={visible ? "button" : undefined}
      tabIndex={visible ? 0 : undefined}
      aria-pressed={visible ? selected : undefined}
      onClick={visible ? onSelect : undefined}
      onKeyDown={visible ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.();
      } : undefined}
    >
      <span className="winner-reveal-row__rank">{String(index + 1).padStart(2, "0")}</span>
      <span className="winner-reveal-row__prize" aria-hidden="true">
        <img src={prizeImage} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="winner-reveal-row__identity">
        <span className={["winner-reveal-row__avatar", avatarUrl ? "has-image" : ""].filter(Boolean).join(" ")} aria-hidden="true">
          {hasProfileIdentity ? (
            <span>{winnerAvatarInitial(winner)}</span>
          ) : (
            <Ticket size={16} strokeWidth={2.25} />
          )}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
        </span>
        <span className="winner-reveal-row__main">
          <strong>{primaryLabel}</strong>
          <small>{secondaryLabel}</small>
        </span>
      </span>
      {currentUser ? (
        <span className="winner-reveal-row__self">
          <Sparkles size={14} strokeWidth={2.35} />
          {t("winnerReveal.currentUserBadge")}
        </span>
      ) : null}
      <span className="winner-reveal-row__ticket">
        <Ticket size={15} strokeWidth={2.25} />
        {t("winnerReveal.ticketNumber", { ticket: winner.ticketNumber })}
      </span>
    </li>
  );
}

export function WinnersRoom({
  activeRoundId = "",
  winnerRevealData,
  winnerRevealIssue,
  rounds = [],
  matches = [],
  currentWalletAddress = "",
  currentUserWinnerCount = 0,
  onRevealStateChange,
}) {
  const { t, roundLabel } = useCampaignCopy();
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const [videoFinished, setVideoFinished] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [mediaIssue, setMediaIssue] = useState("");
  const [selectedWinnerId, setSelectedWinnerId] = useState("");
  const winners = useMemo(() => winnerRevealData.winners || [], [winnerRevealData.winners]);
  const hasOfficialWinners = winnerRevealData.sourceStatus === "revealed" && winners.length > 0;
  const revealStarted = videoFinished;
  const winnerRoundGroups = useMemo(
    () => buildWinnerRoundGroups(winners, rounds, matches, t, roundLabel),
    [matches, roundLabel, rounds, t, winners],
  );
  const roundOptions = useMemo(
    () => buildWinnerRoundOptions(winnerRoundGroups, rounds, t, roundLabel),
    [roundLabel, rounds, t, winnerRoundGroups],
  );
  const latestRevealedRoundId = useMemo(() => {
    const revealedOptions = roundOptions.filter((option) => option.count > 0);
    return revealedOptions[revealedOptions.length - 1]?.id || roundOptions[0]?.id || "";
  }, [roundOptions]);
  const selectedRound = roundOptions.find((option) => option.id === activeRoundId)
    || roundOptions.find((option) => option.id === latestRevealedRoundId)
    || roundOptions[0]
    || null;
  const selectedRoundWinners = selectedRound?.winners || [];
  const selectedRoundHasWinners = hasOfficialWinners && selectedRoundWinners.length > 0;
  const autoActiveRowIndex = selectedRoundHasWinners
    ? Math.max(0, Math.min(visibleCount - 1, selectedRoundWinners.length - 1))
    : -1;
  const manuallySelectedRowIndex = selectedRoundHasWinners && selectedWinnerId
    ? selectedRoundWinners.findIndex(({ winner }) => winner.id === selectedWinnerId)
    : -1;
  const selectedActiveRowIndex = manuallySelectedRowIndex >= 0 ? manuallySelectedRowIndex : autoActiveRowIndex;
  const selectedActiveWinner = selectedRoundHasWinners
    ? selectedRoundWinners[selectedActiveRowIndex] || selectedRoundWinners[0] || null
    : null;
  const showPrizeCard = revealStarted && Boolean(selectedActiveWinner);
  const activePrizeImage = selectedActiveWinner?.prizeImage || getMatchPrizeImageByMatchId("", matches, selectedRound?.id);
  const activePrizeMatchLabel = selectedActiveWinner?.matchLabel || selectedRound?.label || "";
  const activePrizeTitle = activePrizeMatchLabel
    ? t("winnerReveal.cardPrizeMatchTitle", { match: activePrizeMatchLabel })
    : t("winnerReveal.cardPrizeTitle");

  useEffect(() => {
    preloadRoundPrizeImages(selectedRound?.id);
  }, [selectedRound?.id]);

  useEffect(() => {
    setVideoFinished(false);
    setVisibleCount(0);
    setMediaIssue("");
    setSelectedWinnerId("");
  }, [winnerRevealData.videoUrl, winnerRevealData.drawId, winnerRevealData.generatedAt]);

  useEffect(() => {
    onRevealStateChange?.(revealStarted);
  }, [onRevealStateChange, revealStarted]);

  useEffect(() => () => {
    onRevealStateChange?.(false);
  }, [onRevealStateChange]);

  useEffect(() => {
    if (!revealStarted || !selectedRoundHasWinners) {
      setVisibleCount(0);
      setSelectedWinnerId("");
      return undefined;
    }

    if (listRef.current) listRef.current.scrollTop = 0;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisibleCount(selectedRoundWinners.length);
      return undefined;
    }

    setVisibleCount(0);
    setSelectedWinnerId("");
    const intervalId = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(selectedRoundWinners.length, current + 1);
        if (next >= selectedRoundWinners.length) window.clearInterval(intervalId);
        return next;
      });
    }, 560);

    return () => window.clearInterval(intervalId);
  }, [revealStarted, selectedRoundHasWinners, selectedRound?.id, selectedRoundWinners.length]);

  function replayIntro() {
    const video = videoRef.current;
    setVideoFinished(false);
    setVisibleCount(0);
    setSelectedWinnerId("");
    if (!video) return;
    video.currentTime = 0;
    video.play().catch(() => undefined);
  }

  return (
    <section
      className={[
        "winners-room",
        revealStarted ? "is-reveal" : "is-intro",
        hasOfficialWinners ? "has-winners" : "is-pending",
      ].join(" ")}
      aria-label={t("winnerReveal.roomAria")}
    >
      <video
        ref={videoRef}
        className="winner-stage-video"
        src={winnerRevealData.videoUrl}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={() => setVideoFinished(true)}
        onError={() => setMediaIssue(t("winnerReveal.videoIssue"))}
      />
      <div
        className="winner-stage-reveal-bg"
        style={{ backgroundImage: showPrizeCard ? "none" : `url(${revealBackdrop})` }}
        aria-hidden="true"
      />
      <div className="winner-stage-grid" aria-hidden="true" />
      {revealStarted ? (
        <div className="winner-stage-side-rays" aria-hidden="true">
          <SideRays
            speed={2.5}
            rayColor1="#EAB308"
            rayColor2="#96c8ff"
            intensity={2}
            spread={2}
            origin="top-left"
            tilt={0}
            saturation={1.5}
            blend={0.75}
            falloff={1.6}
            opacity={1}
          />
        </div>
      ) : null}
      <div className="winner-stage-scrim" aria-hidden="true" />

      <section className="winner-stage-intro" aria-hidden={revealStarted}>
        <span>
          <Award size={16} strokeWidth={2.25} />
          {t("winnerReveal.eyebrow")}
        </span>
        <h1>{t("winnerReveal.title")}</h1>
      </section>

      <section className="winner-stage-actions" aria-label={t("winnerReveal.controlsAria")}>
        {!revealStarted ? (
          <button type="button" onClick={() => setVideoFinished(true)}>
            <CirclePlay size={16} strokeWidth={2.25} />
            {t("winnerReveal.skipVideo")}
          </button>
        ) : (
          <button type="button" onClick={replayIntro}>
            <RotateCcw size={16} strokeWidth={2.25} />
            {t("winnerReveal.replay")}
          </button>
        )}
      </section>

      <section
        className={showPrizeCard ? "winner-stage-reveal has-prize-card" : "winner-stage-reveal"}
        aria-live="polite"
        aria-hidden={!revealStarted}
      >
        {showPrizeCard ? (
          <section className="winner-stage-prize-card" aria-label={t("winnerReveal.cardPrizeAria")}>
            <span className="winner-stage-prize-card__image">
              <img src={activePrizeImage} alt="" decoding="async" />
            </span>
            <span className="winner-stage-prize-card__copy">
              <span>
                <Gift size={15} strokeWidth={2.35} />
                {t("winnerReveal.cardPrizeLabel")}
              </span>
              <strong>{activePrizeTitle}</strong>
              <p>{t("winnerReveal.cardPrizeBody")}</p>
            </span>
          </section>
        ) : null}
        <section className="winner-stage-board" aria-label={t("winnerReveal.listAria")}>
          {currentUserWinnerCount > 0 ? (
            <section className="winner-current-user-callout" aria-label={t("winnerReveal.currentUserAria")}>
              <Sparkles size={16} strokeWidth={2.35} />
              <span>{t("winnerReveal.currentUserWinner", { count: formatNumber(currentUserWinnerCount) })}</span>
            </section>
          ) : null}
          {selectedRoundHasWinners ? (
            <section
              ref={listRef}
              className={selectedRoundWinners.length > 9 ? "winner-reveal-list winner-reveal-list--dense" : "winner-reveal-list"}
              aria-label={t("winnerReveal.selectedRoundListAria", { round: selectedRound?.label || "" })}
            >
              <section className="winner-round-group" aria-label={selectedRound?.label || t("winnerReveal.unknownRound")}>
                <header className="winner-round-group__head">
                  <span>{selectedRound?.label || t("winnerReveal.unknownRound")}</span>
                  <em>{t("winnerReveal.roundGroupCount", { count: formatNumber(selectedRoundWinners.length) })}</em>
                </header>
                <ol>
                  {selectedRoundWinners.map(({ winner, matchLabel, prizeImage }, index) => (
                    <WinnerRevealRow
                      winner={winner}
                      index={index}
                      matchLabel={matchLabel}
                      prizeImage={prizeImage}
                      currentUser={isCurrentUserWinner(winner, currentWalletAddress)}
                      visible={index < visibleCount}
                      selected={index === selectedActiveRowIndex}
                      active={index === selectedActiveRowIndex}
                      onSelect={() => setSelectedWinnerId(winner.id)}
                      key={winner.id}
                    />
                  ))}
                </ol>
              </section>
            </section>
          ) : (
            <section className="winner-reveal-empty" aria-label={t("winnerReveal.pendingAria")}>
              <strong>{hasOfficialWinners ? t("winnerReveal.noRoundWinners", { round: selectedRound?.label || "" }) : t("winnerReveal.noOfficialWinners")}</strong>
              <p>{hasOfficialWinners ? t("winnerReveal.noRoundWinnersBody") : t("winnerReveal.noOfficialWinnersBody")}</p>
            </section>
          )}
        </section>
      </section>

      {mediaIssue || winnerRevealIssue ? (
        <p className="winner-stage-issue">{mediaIssue || winnerRevealIssue}</p>
      ) : null}
    </section>
  );
}
