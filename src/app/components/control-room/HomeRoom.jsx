import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Gem,
  Ticket,
} from "lucide-react";
import heroImage from "../../assets/hero-world-cup-clean.webp";
import heroScrollVideoMobile from "../../assets/Background.mobile.mp4";
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

function useScrollScrubbedHomeVideo(containerRef, videoRef) {
  useEffect(() => {
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

    const syncVideoToScroll = () => {
      frameId = 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const containerTop = container.getBoundingClientRect().top + window.scrollY;
      const travel = Math.max(1, container.offsetHeight - viewportHeight);
      const progress = Math.min(1, Math.max(0, (window.scrollY - containerTop) / travel));
      const targetTime = Math.min(Math.max(0, duration - 0.02), Math.max(0, progress * duration));

      video.pause();
      if (Number.isFinite(targetTime) && Math.abs(video.currentTime - targetTime) > 0.006) {
        video.currentTime = targetTime;
      }
    };

    const requestSync = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(syncVideoToScroll);
    };

    const handleMetadata = () => {
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
      requestSync();
    };

    video.addEventListener("loadedmetadata", handleMetadata);
    window.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestSync);

    if (video.readyState >= 1) handleMetadata();
    requestSync();

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      video.removeEventListener("loadedmetadata", handleMetadata);
      window.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestSync);
    };
  }, [containerRef, videoRef]);
}

function useHomeMediaReady(videoRef) {
  const [mediaReady, setMediaReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    let imageReady = false;
    let videoReady = !video || video.readyState >= 1;

    const resolveReady = () => {
      if (!cancelled && imageReady && videoReady) setMediaReady(true);
    };

    const handleVideoReady = () => {
      videoReady = true;
      resolveReady();
    };

    if (video && !videoReady) {
      video.addEventListener("loadedmetadata", handleVideoReady, { once: true });
      video.addEventListener("error", handleVideoReady, { once: true });
    }

    preloadHomeRoomAssets().finally(() => {
      imageReady = true;
      resolveReady();
    });

    return () => {
      cancelled = true;
      if (video && !videoReady) {
        video.removeEventListener("loadedmetadata", handleVideoReady);
        video.removeEventListener("error", handleVideoReady);
      }
    };
  }, [videoRef]);

  return mediaReady;
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

function getMilestoneOverallProgress(milestoneSnapshot, currentValue) {
  const finalThreshold = milestoneSnapshot.sorted[milestoneSnapshot.sorted.length - 1]?.threshold ?? 0;
  if (!finalThreshold) return 100;
  return Math.min(100, Math.max(0, (currentValue / finalThreshold) * 100));
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
  const campaignProgress = getMilestoneOverallProgress(milestoneSnapshot, currentValue);
  const visualProgress = Math.min(campaignProgress, Math.max(0, campaignProgress * scrollRatio));
  const finalThreshold = milestoneSnapshot.sorted[milestoneSnapshot.sorted.length - 1]?.threshold ?? 0;
  const railFill = Math.min(92, Math.max(0, visualProgress * 0.92));
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
            "--milestone-fill": `${visualProgress}%`,
            "--milestone-rail-fill": `${railFill}%`,
          }}
          aria-label={t("home.milestoneTrack")}
        >
          {milestoneSnapshot.sorted.map((milestone, index) => {
            const isUnlocked = currentValue >= milestone.threshold;
            const isNext = !isUnlocked && milestone.id === milestoneSnapshot.next?.id;
            const thresholdProgress = finalThreshold
              ? Math.min(100, Math.max(0, (milestone.threshold / finalThreshold) * 100))
              : 100;
            const isScrollLit = visualProgress + 0.35 >= thresholdProgress;
            const stepProgress = totalMilestones > 1 ? index / (totalMilestones - 1) : 0.5;
            const dotLeft = Math.min(94, Math.max(6, 6 + (stepProgress * 88)));
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

export function HomeRoom({
  activeRound,
  matches,
  milestones,
  currentMilestoneValue,
  rounds,
  onSelectView,
}) {
  const copy = useCampaignCopy();
  const { t } = copy;
  const homeRoomRef = useRef(null);
  const heroVideoRef = useRef(null);
  const mediaReady = useHomeMediaReady(heroVideoRef);
  const activeRoundMatches = matches.filter((match) => match.roundId === activeRound.id);
  const milestoneSnapshot = getMilestoneSnapshot(milestones, currentMilestoneValue);
  const heroMilestoneTitle = milestoneSnapshot.complete
    ? t("home.allMilestonesOpen")
    : milestoneSnapshot.next ? copy.milestoneLabel(milestoneSnapshot.next) : t("home.nextMilestone");
  const heroMilestoneDetail = milestoneSnapshot.complete
    ? t("home.allMilestonesDetail")
    : t("home.ticketsToTarget", { remaining: formatNumber(milestoneSnapshot.remaining), target: formatNumber(milestoneSnapshot.next.threshold) });

  useScrollScrubbedHomeVideo(homeRoomRef, heroVideoRef);

  return (
    <section
      className={["home-room", mediaReady ? "is-media-ready" : "is-media-loading"].join(" ")}
      ref={homeRoomRef}
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
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          disablePictureInPicture
        >
          <source src={heroScrollVideoMobile} type="video/mp4" media="(max-width: 760px)" />
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
        <RulesRoom
          activeRound={activeRound}
          activeRoundMatches={activeRoundMatches}
          rounds={rounds}
          className="home-rules-panel"
        />
      </section>
    </section>
  );
}
