import { Award, CirclePlay, RotateCcw, Ticket, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import revealBackdrop from "../../assets/championship-trophy-renaiss-mark.webp";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

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

function winnerRoundGroupLabel(roundId, round, t, roundLabel) {
  const labelKey = WINNER_ROUND_LABEL_KEYS[roundId];
  if (labelKey) {
    const label = t(labelKey);
    if (label !== labelKey) return label;
  }
  return round ? roundLabel(round, "label") : "";
}

function buildWinnerRoundGroups(winners, rounds, matches, t, roundLabel) {
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const roundOrder = new Map(rounds.map((round, index) => [round.id, index]));
  const fallbackOrder = new Map(FALLBACK_ROUND_ORDER.map((roundId, index) => [roundId, index]));
  const matchById = new Map(matches.map((match) => [match.id, match]));
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
    const match = matchById.get(winner.matchId) || null;

    group.winners.push({
      winner,
      globalIndex,
      matchLabel: match?.id ? match.id.toUpperCase() : winner.matchId ? winner.matchId.toUpperCase() : "",
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

function WinnerRevealRow({ winner, index, visible, active, matchLabel }) {
  const { t } = useCampaignCopy();
  const prizeSlot = t("winnerReveal.prizeSlot", { slot: formatNumber(winner.prizeSlotIndex + 1) });
  const prizeMeta = matchLabel
    ? t("winnerReveal.matchPrizeSlot", { match: matchLabel, slot: formatNumber(winner.prizeSlotIndex + 1) })
    : prizeSlot;

  return (
    <li
      className={[
        "winner-reveal-row",
        visible ? "is-visible" : "",
        active ? "is-active" : "",
      ].filter(Boolean).join(" ")}
      style={{ "--winner-delay": `${Math.min(index, 5) * 40}ms`, "--winner-order": index }}
    >
      <span className="winner-reveal-row__rank">{String(index + 1).padStart(2, "0")}</span>
      <span className="winner-reveal-row__main">
        <strong>{winnerWalletLabel(winner) || t("winnerReveal.walletPending")}</strong>
        <small>{prizeMeta}</small>
      </span>
      <span className="winner-reveal-row__ticket">
        <Ticket size={15} strokeWidth={2.25} />
        {t("winnerReveal.ticketNumber", { ticket: winner.ticketNumber })}
      </span>
    </li>
  );
}

export function WinnersRoom({ winnerRevealData, winnerRevealIssue, rounds = [], matches = [] }) {
  const { t, dateTime, roundLabel } = useCampaignCopy();
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [videoFinished, setVideoFinished] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [mediaIssue, setMediaIssue] = useState("");
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
  const selectedRound = roundOptions.find((option) => option.id === selectedRoundId)
    || roundOptions.find((option) => option.id === latestRevealedRoundId)
    || roundOptions[0]
    || null;
  const selectedRoundWinners = selectedRound?.winners || [];
  const selectedRoundHasWinners = hasOfficialWinners && selectedRoundWinners.length > 0;
  const selectedActiveWinnerIndex = selectedRoundHasWinners
    ? Math.max(0, Math.min(visibleCount - 1, selectedRoundWinners.length - 1))
    : -1;
  const selectedActiveWinner = selectedActiveWinnerIndex >= 0 ? selectedRoundWinners[selectedActiveWinnerIndex]?.winner : null;
  const selectedRevealComplete = selectedRoundHasWinners && visibleCount >= selectedRoundWinners.length;

  useEffect(() => {
    if (!hasOfficialWinners) {
      setSelectedRoundId("");
      return;
    }

    setSelectedRoundId((currentRoundId) => currentRoundId || latestRevealedRoundId);
  }, [hasOfficialWinners, latestRevealedRoundId]);

  useEffect(() => {
    setVideoFinished(false);
    setVisibleCount(0);
    setMediaIssue("");
    setSelectedRoundId("");
  }, [winnerRevealData.videoUrl, winnerRevealData.drawId, winnerRevealData.generatedAt]);

  useEffect(() => {
    if (!revealStarted || !selectedRoundHasWinners) {
      setVisibleCount(0);
      return undefined;
    }

    if (listRef.current) listRef.current.scrollTop = 0;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisibleCount(selectedRoundWinners.length);
      return undefined;
    }

    setVisibleCount(0);
    const intervalId = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(selectedRoundWinners.length, current + 1);
        if (next >= selectedRoundWinners.length) window.clearInterval(intervalId);
        return next;
      });
    }, 560);

    return () => window.clearInterval(intervalId);
  }, [revealStarted, selectedRoundHasWinners, selectedRoundId, selectedRoundWinners.length]);

  function replayIntro() {
    const video = videoRef.current;
    setVideoFinished(false);
    setVisibleCount(0);
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
      <div className="winner-stage-reveal-bg" style={{ backgroundImage: `url(${revealBackdrop})` }} aria-hidden="true" />
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

      <section className="winner-stage-reveal" aria-live="polite" aria-hidden={!revealStarted}>
        <aside className="winner-stage-reveal__story">
          <figure className="winner-stage-trophy" aria-hidden="true">
            <img src={revealBackdrop} alt="" />
          </figure>
          <header className="winner-stage-reveal__head">
            <span>
              <Trophy size={17} strokeWidth={2.25} />
              {hasOfficialWinners ? t("winnerReveal.boardEyebrow") : t("winnerReveal.pending")}
            </span>
            <h2>{hasOfficialWinners ? t("winnerReveal.boardTitle") : t("winnerReveal.pendingTitle")}</h2>
            <p>{hasOfficialWinners ? t("winnerReveal.boardBody") : t("winnerReveal.pendingBody")}</p>
            <dl>
              <div>
                <dt>{t("winnerReveal.revealedCount")}</dt>
                <dd>{formatNumber(visibleCount)} / {formatNumber(selectedRoundWinners.length)}</dd>
              </div>
              <div>
                <dt>{t("winnerReveal.selectedRound")}</dt>
                <dd>{selectedRound?.label || "-"}</dd>
              </div>
              <div>
                <dt>{t("winnerReveal.generatedAt")}</dt>
                <dd>{winnerRevealData.generatedAt ? dateTime(winnerRevealData.generatedAt) : "-"}</dd>
              </div>
            </dl>
          </header>
        </aside>

        <section className="winner-stage-board" aria-label={t("winnerReveal.listAria")}>
          {hasOfficialWinners ? (
            <nav className="winner-round-rail" aria-label={t("winnerReveal.roundSelectorAria")}>
              {roundOptions.map((option) => (
                <button
                  type="button"
                  className={[
                    option.id === selectedRound?.id ? "is-active" : "",
                    option.count > 0 ? "has-winners" : "is-empty",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setSelectedRoundId(option.id)}
                  aria-pressed={option.id === selectedRound?.id}
                  key={option.id}
                >
                  <span>{option.label}</span>
                  <strong>{formatNumber(option.count)}</strong>
                  <small>{option.count > 0 ? t("winnerReveal.revealed") : t("winnerReveal.waitingReveal")}</small>
                  <i aria-hidden="true" />
                </button>
              ))}
            </nav>
          ) : null}

          {selectedRoundHasWinners ? (
            <section
              className={[
                "winner-spotlight",
                selectedActiveWinner ? "has-active" : "",
                selectedRevealComplete ? "is-complete" : "is-running",
              ].filter(Boolean).join(" ")}
              aria-label={t("winnerReveal.currentWinnerAria")}
            >
              <div className="winner-spotlight__beam" aria-hidden="true" />
              <div className="winner-spotlight__kicker">
                <span>{selectedRevealComplete ? t("winnerReveal.revealComplete") : t("winnerReveal.currentWinner")}</span>
                <strong>{String(selectedActiveWinnerIndex + 1).padStart(2, "0")}</strong>
              </div>
              <strong className="winner-spotlight__wallet">
                {selectedActiveWinner ? winnerWalletLabel(selectedActiveWinner) : t("winnerReveal.waitingReveal")}
              </strong>
              <dl>
                <div>
                  <dt>{t("winnerReveal.prize")}</dt>
                  <dd>{selectedActiveWinner ? t("winnerReveal.prizeSlot", { slot: formatNumber(selectedActiveWinner.prizeSlotIndex + 1) }) : "-"}</dd>
                </div>
                <div>
                  <dt>{t("winnerReveal.ticket")}</dt>
                  <dd>{selectedActiveWinner ? t("winnerReveal.ticketNumber", { ticket: selectedActiveWinner.ticketNumber }) : "-"}</dd>
                </div>
              </dl>
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
                  {selectedRoundWinners.map(({ winner, matchLabel }, index) => (
                    <WinnerRevealRow
                      winner={winner}
                      index={index}
                      matchLabel={matchLabel}
                      visible={index < visibleCount}
                      active={index === selectedActiveWinnerIndex && !selectedRevealComplete}
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
