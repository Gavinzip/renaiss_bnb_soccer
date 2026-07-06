import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Gem,
  Ticket,
} from "lucide-react";
import heroImage from "../../assets/hero-world-cup-clean.webp";
import { addPreloadHint, preloadImage } from "../../utils/preloadAssets";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { RulesRoom } from "./RulesRoom";

const HERO_SCROLL_VIDEO_URL =
  "https://pub-7230fa99c50e44e9b241e47cac526165.r2.dev/home/Background.web.2026-06-18.mp4";

function renderCopyLines(text) {
  return String(text || "")
    .split("\n")
    .map((line, index, lines) => (
      <span key={`${line}-${index}`}>
        {line}
        {index < lines.length - 1 ? <br /> : null}
      </span>
    ));
}

export function preloadHomeRoomAssets() {
  addPreloadHint(heroImage, "image", "image/webp");
  return preloadImage(heroImage);
}

function getMilestoneSnapshot(milestones, currentValue) {
  const sorted = [...milestones].sort((left, right) => left.threshold - right.threshold);
  if (sorted.length === 0) {
    return {
      sorted,
      previous: null,
      next: null,
      progress: 0,
      unlocked: [],
      remaining: 0,
      complete: true,
    };
  }

  const previous = [...sorted].reverse().find((milestone) => milestone.threshold <= currentValue) ?? null;
  const nextOpen = sorted.find((milestone) => milestone.threshold > currentValue) ?? null;
  const next = nextOpen ?? sorted[sorted.length - 1];
  const previousThreshold = previous?.threshold ?? 0;
  const progress = nextOpen
    ? Math.min(100, Math.max(0, ((currentValue - previousThreshold) / Math.max(1, next.threshold - previousThreshold)) * 100))
    : 100;
  const unlocked = sorted.filter((milestone) => currentValue >= milestone.threshold);

  return {
    sorted,
    previous,
    next,
    progress,
    unlocked,
    remaining: Math.max(0, next.threshold - currentValue),
    complete: !nextOpen,
  };
}

function useScrollScrubbedHomeVideo(containerRef, videoRef, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return undefined;

    const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduceMotionQuery?.matches) {
      video.pause();
      return undefined;
    }

    let frameId = 0;
    let duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6;
    let latestTargetTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let mobileScrubUnlocked = false;
    let mobileScrubBlocked = false;
    let mobileScrubPrimePromise = null;
    let mobileScrubPauseTimer = 0;
    const coarsePointerQuery = window.matchMedia?.("(pointer: coarse)");
    const shouldPrimeMobileScrub = Boolean(coarsePointerQuery?.matches);

    const prepareMobileScrubVideo = () => {
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
    };

    const pauseMobileScrubAtTarget = () => {
      if (!shouldPrimeMobileScrub) return;
      if (mobileScrubPauseTimer) window.clearTimeout(mobileScrubPauseTimer);

      mobileScrubPauseTimer = window.setTimeout(() => {
        mobileScrubPauseTimer = 0;
        video.pause();
        if (Number.isFinite(latestTargetTime)) {
          video.currentTime = latestTargetTime;
        }
      }, 90);
    };

    const keepMobileScrubDecoderWarm = (event) => {
      if (!shouldPrimeMobileScrub) return;
      if (document.visibilityState === "hidden") return;
      if (video.readyState < 2) {
        if (!video.paused) pauseMobileScrubAtTarget();
        return;
      }

      const isGesture = event?.type === "pointerdown" || event?.type === "touchstart";
      if (mobileScrubBlocked && !mobileScrubUnlocked && !isGesture) return;

      prepareMobileScrubVideo();

      if (mobileScrubUnlocked) {
        video.play()
          .then(pauseMobileScrubAtTarget)
          .catch(() => undefined);
        return;
      }

      if (mobileScrubPrimePromise) return;

      mobileScrubPrimePromise = video.play()
        .then(() => {
          mobileScrubUnlocked = true;
          mobileScrubBlocked = false;
          if (Number.isFinite(latestTargetTime)) video.currentTime = latestTargetTime;
          pauseMobileScrubAtTarget();
        })
        .catch(() => {
          video.pause();
          mobileScrubBlocked = true;
        })
        .finally(() => {
          mobileScrubPrimePromise = null;
        });
    };

    const syncVideoToScroll = () => {
      frameId = 0;
      if (document.visibilityState === "hidden") return;

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const containerTop = container.getBoundingClientRect().top + window.scrollY;
      const travel = Math.max(1, container.offsetHeight - viewportHeight);
      const progress = Math.min(1, Math.max(0, (window.scrollY - containerTop) / travel));
      const targetTime = Math.min(Math.max(0, duration - 0.02), Math.max(0, progress * duration));

      latestTargetTime = targetTime;
      if (!shouldPrimeMobileScrub) video.pause();
      if (Number.isFinite(targetTime)) {
        video.currentTime = targetTime;
      }
      keepMobileScrubDecoderWarm();
    };

    const requestSync = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(syncVideoToScroll);
    };

    const handleMetadata = () => {
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
      requestSync();
    };

    const handleMobilePlay = () => {
      if (shouldPrimeMobileScrub) pauseMobileScrubAtTarget();
    };

    video.addEventListener("loadedmetadata", handleMetadata);
    video.addEventListener("play", handleMobilePlay);
    window.addEventListener("pointerdown", keepMobileScrubDecoderWarm, { passive: true });
    window.addEventListener("touchstart", keepMobileScrubDecoderWarm, { passive: true });
    window.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestSync);
    window.addEventListener("visibilitychange", requestSync);

    if (video.readyState >= 1) handleMetadata();
    requestSync();

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (mobileScrubPauseTimer) window.clearTimeout(mobileScrubPauseTimer);
      video.removeEventListener("loadedmetadata", handleMetadata);
      video.removeEventListener("play", handleMobilePlay);
      window.removeEventListener("pointerdown", keepMobileScrubDecoderWarm);
      window.removeEventListener("touchstart", keepMobileScrubDecoderWarm);
      window.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestSync);
      window.removeEventListener("visibilitychange", requestSync);
    };
  }, [containerRef, enabled, videoRef]);
}

function useHomeMediaReady(videoRef) {
  const [mediaReady, setMediaReady] = useState(false);
  const [videoFrameReady, setVideoFrameReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;

    const handleVideoFrameReady = () => {
      if (!cancelled) setVideoFrameReady(true);
    };

    const handleVideoFallback = () => {
      if (!cancelled) setVideoFrameReady(false);
    };

    if (video) {
      if (video.readyState >= 2) handleVideoFrameReady();
      video.addEventListener("loadeddata", handleVideoFrameReady);
      video.addEventListener("canplay", handleVideoFrameReady);
      video.addEventListener("seeked", handleVideoFrameReady);
      video.addEventListener("error", handleVideoFallback);
    }

    preloadHomeRoomAssets().finally(() => {
      if (!cancelled) setMediaReady(true);
    });

    return () => {
      cancelled = true;
      if (video) {
        video.removeEventListener("loadeddata", handleVideoFrameReady);
        video.removeEventListener("canplay", handleVideoFrameReady);
        video.removeEventListener("seeked", handleVideoFrameReady);
        video.removeEventListener("error", handleVideoFallback);
      }
    };
  }, [videoRef]);

  return { mediaReady, videoFrameReady };
}

function formatMilestoneReward(milestone) {
  if (!milestone?.rewardAmount) return "";
  return `${formatNumber(milestone.rewardAmount)} ${milestone.rewardCurrency || "USDT"}`;
}

function formatMilestoneRewardCompact(milestone) {
  if (!milestone?.rewardAmount) return "";
  const currency = milestone.rewardCurrency === "USDT" ? "U" : milestone.rewardCurrency;
  return `${formatNumber(milestone.rewardAmount)} ${currency || ""}`.trim();
}

const MILESTONE_RAIL_START = 4;
const MILESTONE_RAIL_END = 96;
const MILESTONE_NODE_START = 12.5;
const MILESTONE_NODE_END = 87.5;

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function getMilestoneNodePosition(index, totalMilestones) {
  if (totalMilestones <= 1) return 50;
  const step = index / (totalMilestones - 1);
  return MILESTONE_NODE_START + ((MILESTONE_NODE_END - MILESTONE_NODE_START) * step);
}

function getMilestoneLinearRatio(ratio) {
  const clamped = clampPercent(ratio * 100) / 100;
  return clamped;
}

function getMilestoneRailProgress(milestoneSnapshot, currentValue) {
  const sorted = milestoneSnapshot.sorted;
  if (sorted.length === 0) return MILESTONE_RAIL_END;

  const value = Math.max(0, Number(currentValue) || 0);
  const firstMilestone = sorted[0];
  const firstPosition = getMilestoneNodePosition(0, sorted.length);

  if (value <= firstMilestone.threshold) {
    const firstRatio = getMilestoneLinearRatio(firstMilestone.threshold > 0 ? value / firstMilestone.threshold : 1);
    return MILESTONE_RAIL_START + ((firstPosition - MILESTONE_RAIL_START) * firstRatio);
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previousMilestone = sorted[index - 1];
    const nextMilestone = sorted[index];
    if (value < nextMilestone.threshold) {
      const previousPosition = getMilestoneNodePosition(index - 1, sorted.length);
      const nextPosition = getMilestoneNodePosition(index, sorted.length);
      const segmentRange = Math.max(1, nextMilestone.threshold - previousMilestone.threshold);
      const segmentRatio = getMilestoneLinearRatio((value - previousMilestone.threshold) / segmentRange);
      return previousPosition + ((nextPosition - previousPosition) * segmentRatio);
    }
  }

  return MILESTONE_RAIL_END;
}

function HeroMilestoneCommand({ milestoneSnapshot, currentValue, heroMilestoneTitle, heroMilestoneDetail, copy, className = "" }) {
  const { milestonePrize, t } = copy;
  const scrollAnchorRef = useRef(null);
  const [scrollRatio, setScrollRatio] = useState(0);
  const totalMilestones = milestoneSnapshot.sorted.length;
  const focusedMilestone = milestoneSnapshot.complete
    ? milestoneSnapshot.sorted[milestoneSnapshot.sorted.length - 1]
    : milestoneSnapshot.next;
  const focusedReward = formatMilestoneReward(focusedMilestone);
  const focusedSlots = focusedMilestone?.rewardSlots ?? 0;
  const campaignProgress = getMilestoneRailProgress(milestoneSnapshot, currentValue);
  const revealRatio = scrollRatio;
  const visualProgress = MILESTONE_RAIL_START + ((campaignProgress - MILESTONE_RAIL_START) * revealRatio);
  const railFill = Math.min(
    MILESTONE_RAIL_END - MILESTONE_RAIL_START,
    Math.max(0, visualProgress - MILESTONE_RAIL_START),
  );
  const verticalFill = clampPercent((railFill / (MILESTONE_RAIL_END - MILESTONE_RAIL_START)) * 100);
  const nextTargetSummary = milestoneSnapshot.complete
    ? t("home.milestoneCompleteSummary")
    : t("home.milestoneNextTicketSummary", {
      count: formatNumber(milestoneSnapshot.next?.threshold ?? 0),
      remaining: formatNumber(milestoneSnapshot.remaining),
    });

  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return undefined;

    let frameId = 0;
    const updateScrollRatio = () => {
      frameId = 0;
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const start = viewportHeight * 0.9;
      const end = viewportHeight * 0.22;
      const nextRatio = Math.min(1, Math.max(0, (start - rect.top) / Math.max(1, start - end)));

      setScrollRatio((previousRatio) => (
        Math.abs(previousRatio - nextRatio) < 0.004 ? previousRatio : nextRatio
      ));
    };

    const requestUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateScrollRatio);
    };

    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <section className="home-milestone-scroll-shell" ref={scrollAnchorRef}>
      <GlareHover
        as="article"
        className={["hero-milestone-command", className].filter(Boolean).join(" ")}
        aria-label={t("home.milestoneProgress")}
        style={{
          "--milestone-scroll-fill": `${visualProgress}%`,
          "--milestone-campaign-fill": `${campaignProgress}%`,
        }}
      >
        <header className="hero-milestone-command__head">
          <span className="hero-milestone-command__title">
            <Gem size={15} strokeWidth={2.25} />
            {t("home.prizeLadder")}
          </span>
          <em className="hero-milestone-command__current">
            <span>{t("home.milestoneCurrentLabel")}</span>
            <strong>{formatNumber(currentValue)}</strong>
            <small>{t("common.tickets")}</small>
          </em>
        </header>

        <p className="hero-milestone-command__caption">
          {t("home.milestoneTicketExplain")} <span>{nextTargetSummary}</span>
        </p>
        <p className="hero-milestone-command__champion-rule">
          {t("home.milestoneChampionPoolRule")}
        </p>

        <section className="hero-milestone-command__focus">
          <span>{milestoneSnapshot.complete ? t("home.milestoneAllRewards") : t("home.milestoneNextReward")}</span>
          <strong>{heroMilestoneTitle}</strong>
          <p>{heroMilestoneDetail}</p>
          <dl>
            <div>
              <dt>{t("home.milestoneTarget")}</dt>
              <dd>{formatNumber(focusedMilestone?.threshold ?? 0)}</dd>
            </div>
            <div>
              <dt>{t("home.milestoneRewardAmount")}</dt>
              <dd>{focusedReward || "-"}</dd>
            </div>
            <div>
              <dt>{t("home.milestoneReward")}</dt>
              <dd>{focusedMilestone ? milestonePrize(focusedMilestone) : "-"}</dd>
            </div>
            <div>
              <dt>{t("home.milestonePrizeSlots")}</dt>
              <dd>{focusedSlots ? t("home.milestoneSlotCount", { count: formatNumber(focusedSlots) }) : "-"}</dd>
            </div>
          </dl>
        </section>

        <ol
          className="hero-milestone-levels"
          style={{
            "--milestone-fill": `${verticalFill}%`,
            "--milestone-rail-fill": `${railFill}%`,
            "--milestone-count": totalMilestones,
          }}
          aria-label={t("home.milestoneTrack")}
        >
          {milestoneSnapshot.sorted.map((milestone, index) => {
            const isUnlocked = currentValue >= milestone.threshold;
            const isNext = !isUnlocked && milestone.id === milestoneSnapshot.next?.id;
            const thresholdProgress = getMilestoneNodePosition(index, totalMilestones);
            const isScrollLit = visualProgress + 0.35 >= thresholdProgress;
            const dotLeft = thresholdProgress;
            const statusLabel = isUnlocked
              ? t("home.unlockedStatus")
              : isNext
                ? t("home.nextStatus")
                : t("home.lockedStatus");
            return (
              <li
                className={[
                  isUnlocked ? "is-unlocked" : "is-locked",
                  isNext ? "is-next" : "",
                  isScrollLit ? "is-scroll-lit" : "is-scroll-dim",
                ].filter(Boolean).join(" ")}
                key={milestone.id}
                aria-current={isNext ? "step" : undefined}
                aria-label={`${String(index + 1).padStart(2, "0")} ${t("home.milestoneTargetValue", { count: formatNumber(milestone.threshold) })} ${formatMilestoneRewardCompact(milestone) || "-"} ${statusLabel}`}
                style={{ "--milestone-dot-left": `${dotLeft}%` }}
              >
                <em>{String(index + 1).padStart(2, "0")}</em>
                <span>{t("home.milestoneTargetValue", { count: formatNumber(milestone.threshold) })}</span>
                <strong>{formatMilestoneRewardCompact(milestone) || "-"}</strong>
                <small>{t("home.milestoneUnlockHint")}</small>
              </li>
            );
          })}
        </ol>
        <section className="hero-milestone-command__summary" aria-label={t("home.milestoneSummaryAria")}>
          <output>
            <span>{t("home.currentMetric")}</span>
            <strong>{formatNumber(currentValue)}</strong>
          </output>
          <output>
            <span>{milestoneSnapshot.complete ? t("home.milestoneState") : t("home.remaining")}</span>
            <strong>{milestoneSnapshot.complete ? t("home.allUnlocked") : formatNumber(milestoneSnapshot.remaining)}</strong>
          </output>
        </section>
        <span className="hero-milestone-command__meter" aria-hidden="true">
          <span style={{ width: `${visualProgress}%` }} />
        </span>
      </GlareHover>
    </section>
  );
}

function HomeTicketFlow({ copy }) {
  const { t } = copy;
  const flowItems = [
    {
      id: "buyback",
      title: t("home.ticketFlowBuybackTitle"),
      body: t("home.ticketFlowBuybackBody"),
    },
    {
      id: "carryover",
      title: t("home.ticketFlowCarryoverTitle"),
      body: t("home.ticketFlowCarryoverBody"),
    },
    {
      id: "settlement",
      title: t("home.ticketFlowSettlementTitle"),
      body: t("home.ticketFlowSettlementBody"),
    },
  ];

  return (
    <section className="home-ticket-flow" aria-label={t("home.ticketFlowAria")}>
      <header className="home-ticket-flow__head">
        <h2>{t("home.ticketFlowTitle")}</h2>
      </header>
      <ol className="home-ticket-flow__steps">
        {flowItems.map((item, index) => {
          return (
            <li className={`is-${item.id}`} key={item.id}>
              <span className="home-ticket-flow__index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function HomeRoom({
  activeRound,
  matches,
  milestones,
  currentMilestoneValue,
  rounds,
  onSelectView,
  isActive = true,
}) {
  const copy = useCampaignCopy();
  const { t } = copy;
  const homeRoomRef = useRef(null);
  const heroVideoRef = useRef(null);
  const { mediaReady, videoFrameReady } = useHomeMediaReady(heroVideoRef);
  const activeRoundMatches = matches.filter((match) => match.roundId === activeRound.id);
  const milestoneSnapshot = getMilestoneSnapshot(milestones, currentMilestoneValue);
  const heroMilestoneTitle = milestoneSnapshot.complete
    ? t("home.allMilestonesOpen")
    : milestoneSnapshot.next ? copy.milestoneLabel(milestoneSnapshot.next) : t("home.nextMilestone");
  const heroMilestoneDetail = milestoneSnapshot.complete
    ? t("home.allMilestonesDetail")
    : t("home.ticketsToTarget", { remaining: formatNumber(milestoneSnapshot.remaining), target: formatNumber(milestoneSnapshot.next.threshold) });

  useScrollScrubbedHomeVideo(homeRoomRef, heroVideoRef, isActive);

  return (
    <section
      className={[
        "home-room",
        mediaReady ? "is-media-ready" : "is-media-loading",
        videoFrameReady ? "is-video-ready" : "is-video-poster",
      ].join(" ")}
      ref={homeRoomRef}
      hidden={!isActive}
      aria-hidden={isActive ? undefined : "true"}
      aria-label={t("home.aria")}
    >
      <div className="home-video-backdrop" aria-hidden="true">
        <img
          className="home-video-backdrop__poster"
          src={heroImage}
          alt=""
          loading="eager"
          decoding="async"
          fetchpriority="high"
        />
        <video
          className="home-video-backdrop__video"
          ref={heroVideoRef}
          poster={heroImage}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          disablePictureInPicture
        >
          <source src={HERO_SCROLL_VIDEO_URL} type="video/mp4" />
        </video>
        <span className="home-video-backdrop__loader" aria-hidden="true" />
      </div>

      <figure className="hero-stage">
        <figcaption className="hero-stage__content">
          <section className="hero-copy">
            <h1>{renderCopyLines(t("home.title"))}</h1>
            <p>
              {renderCopyLines(t("home.body"))}
            </p>
            <menu className="hero-actions" aria-label={t("home.primaryActionsAria")}>
              <li>
                <Magnet>
                  <button
                    className="hero-action hero-action--primary renaiss-metal-button is-light"
                    type="button"
                    onClick={() => onSelectView("vote")}
                  >
                    <Ticket size={18} strokeWidth={2.2} />
                    {t("home.startVoting")}
                    <ArrowRight size={17} strokeWidth={2.2} />
                  </button>
                </Magnet>
              </li>
              <li>
                <Magnet>
                  <button className="hero-action hero-action--ghost renaiss-metal-button" type="button" onClick={() => onSelectView("schedule")}>
                    <Clock3 size={18} strokeWidth={2.2} />
                    {t("home.viewSchedule")}
                  </button>
                </Magnet>
              </li>
            </menu>
          </section>

        </figcaption>
      </figure>

      <section className="home-scroll-sections">
        <HeroMilestoneCommand
          className="home-milestone-panel"
          milestoneSnapshot={milestoneSnapshot}
          currentValue={currentMilestoneValue}
          heroMilestoneTitle={heroMilestoneTitle}
          heroMilestoneDetail={heroMilestoneDetail}
          copy={copy}
        />
        <HomeTicketFlow copy={copy} />
        <RulesRoom
          activeRound={activeRound}
          activeRoundMatches={activeRoundMatches}
          rounds={rounds}
          className="home-rules-panel"
          showRewardMap={false}
        />
      </section>
    </section>
  );
}
