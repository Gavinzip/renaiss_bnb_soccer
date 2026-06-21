import { Award, CirclePlay, RotateCcw, Ticket, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import revealBackdrop from "../../assets/championship-trophy-renaiss-mark.webp";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

function winnerWalletLabel(winner) {
  return compactAddress(winner.walletAddress || winner.userAddress || "");
}

function WinnerRevealRow({ winner, index, visible, active }) {
  const { t } = useCampaignCopy();
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
        <small>{t("winnerReveal.prizeSlot", { slot: formatNumber(winner.prizeSlotIndex + 1) })}</small>
      </span>
      <span className="winner-reveal-row__ticket">
        <Ticket size={15} strokeWidth={2.25} />
        {t("winnerReveal.ticketNumber", { ticket: winner.ticketNumber })}
      </span>
    </li>
  );
}

export function WinnersRoom({ winnerRevealData, winnerRevealIssue }) {
  const { t, dateTime } = useCampaignCopy();
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const [videoFinished, setVideoFinished] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [mediaIssue, setMediaIssue] = useState("");
  const winners = useMemo(() => winnerRevealData.winners || [], [winnerRevealData.winners]);
  const hasOfficialWinners = winnerRevealData.sourceStatus === "revealed" && winners.length > 0;
  const revealStarted = videoFinished;
  const activeWinnerIndex = hasOfficialWinners ? Math.max(0, Math.min(visibleCount - 1, winners.length - 1)) : -1;
  const activeWinner = activeWinnerIndex >= 0 ? winners[activeWinnerIndex] : null;
  const revealComplete = hasOfficialWinners && visibleCount >= winners.length;

  useEffect(() => {
    setVideoFinished(false);
    setVisibleCount(0);
    setMediaIssue("");
  }, [winnerRevealData.videoUrl, winnerRevealData.drawId, winnerRevealData.generatedAt]);

  useEffect(() => {
    if (!revealStarted || !hasOfficialWinners) {
      setVisibleCount(0);
      return undefined;
    }

    if (listRef.current) listRef.current.scrollTop = 0;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisibleCount(winners.length);
      return undefined;
    }

    setVisibleCount(0);
    const intervalId = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(winners.length, current + 1);
        if (next >= winners.length) window.clearInterval(intervalId);
        return next;
      });
    }, 560);

    return () => window.clearInterval(intervalId);
  }, [hasOfficialWinners, revealStarted, winners.length]);

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
        <div className="winner-stage-reveal__story">
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
                <dd>{formatNumber(visibleCount)} / {formatNumber(winners.length)}</dd>
              </div>
              <div>
                <dt>{t("winnerReveal.drawRef")}</dt>
                <dd>{winnerRevealData.matchId || winnerRevealData.drawId || "-"}</dd>
              </div>
              <div>
                <dt>{t("winnerReveal.generatedAt")}</dt>
                <dd>{winnerRevealData.generatedAt ? dateTime(winnerRevealData.generatedAt) : "-"}</dd>
              </div>
            </dl>
          </header>

          {hasOfficialWinners ? (
            <section
              className={[
                "winner-spotlight",
                activeWinner ? "has-active" : "",
                revealComplete ? "is-complete" : "is-running",
              ].filter(Boolean).join(" ")}
              aria-label={t("winnerReveal.currentWinnerAria")}
            >
              <div className="winner-spotlight__beam" aria-hidden="true" />
              <div className="winner-spotlight__kicker">
                <span>{revealComplete ? t("winnerReveal.revealComplete") : t("winnerReveal.currentWinner")}</span>
                <strong>{String(activeWinnerIndex + 1).padStart(2, "0")}</strong>
              </div>
              <strong className="winner-spotlight__wallet">
                {activeWinner ? winnerWalletLabel(activeWinner) : t("winnerReveal.waitingReveal")}
              </strong>
              <dl>
                <div>
                  <dt>{t("winnerReveal.prize")}</dt>
                  <dd>{activeWinner ? t("winnerReveal.prizeSlot", { slot: formatNumber(activeWinner.prizeSlotIndex + 1) }) : "-"}</dd>
                </div>
                <div>
                  <dt>{t("winnerReveal.ticket")}</dt>
                  <dd>{activeWinner ? t("winnerReveal.ticketNumber", { ticket: activeWinner.ticketNumber }) : "-"}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>

        {hasOfficialWinners ? (
          <ol
            ref={listRef}
            className={winners.length > 9 ? "winner-reveal-list winner-reveal-list--dense" : "winner-reveal-list"}
            aria-label={t("winnerReveal.listAria")}
          >
            {winners.map((winner, index) => (
              <WinnerRevealRow
                winner={winner}
                index={index}
                visible={index < visibleCount}
                active={index === activeWinnerIndex && !revealComplete}
                key={winner.id}
              />
            ))}
          </ol>
        ) : (
          <section className="winner-reveal-empty" aria-label={t("winnerReveal.pendingAria")}>
            <strong>{t("winnerReveal.noOfficialWinners")}</strong>
            <p>{t("winnerReveal.noOfficialWinnersBody")}</p>
          </section>
        )}
      </section>

      {mediaIssue || winnerRevealIssue ? (
        <p className="winner-stage-issue">{mediaIssue || winnerRevealIssue}</p>
      ) : null}
    </section>
  );
}
