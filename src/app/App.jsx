import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlRoom } from "./components/control-room/ControlRoom";
import { preloadHomeRoomAssets } from "./components/control-room/HomeRoom";
import { VoteConfirmModal } from "./components/control-room/VoteConfirmModal";
import { VoteSubmitToast } from "./components/control-room/VoteSubmitToast";
import { InitialPageLoader } from "./components/InitialPageLoader";
import {
  buildRealtimeRound32Preview,
  createPendingFifaFutureKnockoutMatchesSnapshot,
  createPendingFifaQualificationSnapshot,
  createPendingFifaRound16MatchesSnapshot,
  createPendingFifaRound32MatchesSnapshot,
  fetchFifaFutureKnockoutMatchesSnapshot,
  fetchFifaQualificationSnapshot,
  fetchFifaRound16MatchesSnapshot,
  fetchFifaRound32MatchesSnapshot,
} from "./data/fifaRealtime";
import { verifiedLedgerSnapshot } from "./data/ticketLedgerSnapshot";
import { campaignMatches, milestones, roundDefinitions } from "./data/worldCupCampaign";
import { teams } from "./data/teams";
import { resolveMatchRuntimeState } from "./data/matchStatus";
import {
  DEFAULT_MATCH_ID,
  DEFAULT_ROUND_ID,
  DEFAULT_TICKET_AMOUNT,
  DEFAULT_VIEW_ID,
  commandViews,
  getRoundById,
  normalizeFootballLedger,
  normalizeFootballLedgerEntry,
  normalizeLedgerSummary,
  normalizeMilestoneSummary,
  summarizeRoundDraw,
} from "./data/campaignRuntime";
import {
  getEmptyPreviewVoteData,
  getRoundOutcomeSummary,
  normalizePreviewVotePayload,
} from "./data/votePreviewRuntime";
import {
  DEFAULT_WINNER_REVEAL_VIDEO_URL,
  getEmptyWinnerRevealData,
  normalizeWinnerRevealPayload,
} from "./data/winnerRevealRuntime";
import { I18nProvider } from "./i18n/I18nProvider";
import { useCampaignCopy } from "./i18n/useCampaignCopy";
import renaissLogo from "./assets/renaiss-logo-mark.webp";
import { installGoogleAnalytics, trackEvent, trackPageView } from "./utils/analytics";
import { fetchJsonWithTimeout, isRequestAbortError } from "./utils/httpClient";
import { preloadImage } from "./utils/preloadAssets";
import { requestRenaissProviderSignOut } from "./utils/renaissAuth";
import { canonicalMatchId, sameMatchId } from "./data/matchIds.js";
import { getRoundTicketAvailability } from "./data/ticketEligibility";

const INITIAL_LOADER_MIN_VISIBLE_MS = 1100;
const INITIAL_LOADER_EXIT_MS = 540;
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;
const AUTH_REQUEST_TIMEOUT_MS = 10000;
const DATA_REQUEST_TIMEOUT_MS = 12000;
const VOTE_SUBMIT_TIMEOUT_MS = 15000;
const voteableMatchStatuses = new Set(["open", "closing_soon"]);
const publicVoteRoundIds = roundDefinitions
  .map((round) => round.id)
  .filter((roundId) => roundId !== "round32");

const bundledMilestoneSummary = {
  milestones,
  currentMetricValue: null,
  metricType: "tickets_issued",
  sourceLabel: "bundled",
  sourceStatus: "preview",
  generatedAt: null,
};

function normalizeWalletAddress(value) {
  const address = String(value || "").trim();
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : "";
}

function readInitialWalletAddress() {
  if (typeof window === "undefined") return "";
  return normalizeWalletAddress(new URLSearchParams(window.location.search).get("wallet"));
}

function readInitialViewId() {
  if (typeof window === "undefined") return DEFAULT_VIEW_ID;
  const viewId = readViewIdFromSearch(window.location.search);
  return commandViews.some((view) => view.id === viewId) ? viewId : DEFAULT_VIEW_ID;
}

function readViewIdFromSearch(search) {
  return new URLSearchParams(search).get("view");
}

function syncViewIdToUrl(viewId, { replace = false } = {}) {
  if (typeof window === "undefined" || !commandViews.some((view) => view.id === viewId)) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("view") === viewId) return;

  url.searchParams.set("view", viewId);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history[replace ? "replaceState" : "pushState"]({ viewId }, "", nextUrl);
}

function urlWithWalletQuery(baseUrl, walletAddress) {
  if (!baseUrl || !walletAddress) return baseUrl;
  return urlWithQueryParams(baseUrl, { wallet: walletAddress });
}

function urlWithQueryParams(baseUrl, params = {}) {
  if (!baseUrl) return baseUrl;
  const url = new URL(baseUrl, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function buildRenaissLoginUrl() {
  if (typeof window === "undefined") return "/api/auth/renaiss/start";
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const localCallbackHostnames = new Set(["127.0.0.1", "0.0.0.0", "::1"]);
  const authOrigin = localCallbackHostnames.has(window.location.hostname) ? "http://localhost:5173" : window.location.origin;
  const url = new URL("/api/auth/renaiss/start", authOrigin);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("prompt", "consent");
  return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.toString();
}

function csrfHeadersForSession(authSession) {
  const token = String(authSession?.csrfToken || "").trim();
  return token ? { "x-csrf-token": token } : {};
}

function shouldRedirectForAuthError(error) {
  const code = String(error?.code || error?.payload?.code || "");
  if (["login_required", "wallet_required", "wallet_unlinked"].includes(code)) return true;
  if (Number(error?.status || 0) === 401) return true;
  return /Login is required|not linked to a voting wallet/i.test(error?.message || "");
}

function createEmptyLedgerEntry(walletAddress) {
  const userAddress = normalizeWalletAddress(walletAddress);
  return {
    rank: null,
    userAddress,
    sourceAddresses: userAddress ? [userAddress] : [],
    packs: {},
    rawTickets: 0,
    bonusTickets: 0,
    carryoverTickets: 0,
    insiderPracticeTickets: 0,
    insiderGrantTickets: 0,
    finalTickets: 0,
    totalVotingTickets: 0,
    sbt: "none",
    sbtMultiplier: 1,
    eventCount: 0,
    firstBuybackAt: 0,
    lastBuybackAt: 0,
    ticketStart: null,
    ticketEnd: null,
  };
}

function winnerWalletAddress(row) {
  return normalizeWalletAddress(row?.walletAddress || row?.userAddress || row?.profile?.walletAddress);
}

function countWinnersForWallet(winnerRevealData, walletAddress) {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet || winnerRevealData?.sourceStatus !== "revealed") return 0;
  return (Array.isArray(winnerRevealData?.winners) ? winnerRevealData.winners : [])
    .filter((winner) => winnerWalletAddress(winner) === wallet)
    .length;
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

function normalizeLocalSimulationMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "realtime" ? "realtime" : "scenario";
}

function normalizeLedgerEntryPayload(payload) {
  const entry = payload?.entry;
  if (!entry || typeof entry !== "object") return null;
  const userAddress = normalizeWalletAddress(entry.userAddress ?? entry.user_address);
  const normalizedEntry = normalizeFootballLedgerEntry(entry);
  const finalTickets = Math.max(0, Math.floor(Number(normalizedEntry.finalTickets ?? normalizedEntry.final_tickets) || 0));
  const rawTickets = Math.max(0, Math.floor(Number(normalizedEntry.rawTickets ?? normalizedEntry.raw_tickets) || 0));
  const carryoverTickets = Math.max(
    0,
    Math.floor(Number(normalizedEntry.carryoverTickets ?? normalizedEntry.carryover_tickets) || 0),
  );
  const insiderPracticeTickets = Math.max(
    0,
    Math.floor(Number(normalizedEntry.insiderPracticeTickets ?? normalizedEntry.insider_practice_tickets) || 0),
  );
  const taskRewardTickets = Math.max(
    0,
    Math.floor(Number(normalizedEntry.taskRewardTickets ?? normalizedEntry.task_reward_tickets) || 0),
  );
  const insiderGrantTickets = Math.max(
    taskRewardTickets,
    Math.floor(Number(normalizedEntry.insiderGrantTickets ?? normalizedEntry.insider_grant_tickets) || 0),
  );
  const totalVotingTickets = Math.max(
    Math.max(0, Math.floor(Number(normalizedEntry.totalVotingTickets ?? normalizedEntry.total_voting_tickets) || 0)),
    rawTickets + carryoverTickets + insiderPracticeTickets + insiderGrantTickets,
  );
  if (!userAddress || totalVotingTickets <= 0) return null;

  return {
    ...normalizedEntry,
    userAddress,
    sourceAddresses: Array.isArray(normalizedEntry.sourceAddresses) ? normalizedEntry.sourceAddresses : [],
    packs: normalizedEntry.packs && typeof normalizedEntry.packs === "object" ? normalizedEntry.packs : {},
    rawTickets,
    bonusTickets: 0,
    carryoverTickets,
    insiderPracticeTickets,
    insiderGrantTickets,
    taskRewardTickets,
    finalTickets: Math.max(
      finalTickets,
      rawTickets + carryoverTickets,
    ),
    totalVotingTickets,
    sbt: "none",
    sbtMultiplier: 1,
    eventCount: Math.max(0, Math.floor(Number(normalizedEntry.eventCount ?? normalizedEntry.event_count) || 0)),
    firstBuybackAt: Math.max(0, Math.floor(Number(normalizedEntry.firstBuybackAt ?? normalizedEntry.first_buyback_at) || 0)),
    lastBuybackAt: Math.max(0, Math.floor(Number(normalizedEntry.lastBuybackAt ?? normalizedEntry.last_buyback_at) || 0)),
    ticketStart: normalizedEntry.ticketStart ?? normalizedEntry.ticket_start ?? null,
    ticketEnd: normalizedEntry.ticketEnd ?? normalizedEntry.ticket_end ?? null,
  };
}

function isLiveVotePreview(data) {
  return data?.sourceStatus === "live";
}

function voteAllocationMergeKey(allocation) {
  return [
    allocation.walletAddress,
    allocation.roundId,
    canonicalMatchId(allocation.matchId),
    allocation.teamId,
  ].join(":");
}

function buildLiveVoteStats(...sources) {
  const allocationsByKey = new Map();

  sources.forEach((source) => {
    if (!isLiveVotePreview(source)) return;
    source.allocations.forEach((allocation) => {
      if (allocation.source === "local-preview") return;
      allocationsByKey.set(voteAllocationMergeKey(allocation), allocation);
    });
  });

  const totalsByMatchTeam = new Map();
  const walletsByMatch = new Map();
  allocationsByKey.forEach((allocation) => {
    const matchId = canonicalMatchId(allocation.matchId);
    if (!matchId) return;
    const key = `${matchId}:${allocation.teamId}`;
    totalsByMatchTeam.set(key, (totalsByMatchTeam.get(key) ?? 0) + allocation.tickets);
    const walletAddress = String(allocation.walletAddress || "").toLowerCase();
    if (walletAddress) {
      const wallets = walletsByMatch.get(matchId) ?? new Set();
      wallets.add(walletAddress);
      walletsByMatch.set(matchId, wallets);
    }
  });

  return {
    totalsByMatchTeam,
    voterCountsByMatch: new Map([...walletsByMatch].map(([matchId, wallets]) => [matchId, wallets.size])),
  };
}

function isVoteableMatch(match) {
  return voteableMatchStatuses.has(match?.status);
}

function getPreferredRoundMatch(matches, roundId) {
  return matches.find((match) => match.roundId === roundId && isVoteableMatch(match))
    ?? matches.find((match) => match.roundId === roundId)
    ?? null;
}

function hasVoteableMatchInRound(matches, roundId) {
  return matches.some((match) => match.roundId === roundId && isVoteableMatch(match));
}

function getDefaultVoteRoundId(matches, currentRoundId) {
  const currentIndex = publicVoteRoundIds.indexOf(currentRoundId);
  if (currentIndex >= 0 && hasVoteableMatchInRound(matches, currentRoundId)) return currentRoundId;

  const searchStart = currentIndex >= 0 ? currentIndex + 1 : 0;
  const nextVoteableRoundId = publicVoteRoundIds
    .slice(searchStart)
    .find((roundId) => hasVoteableMatchInRound(matches, roundId));
  if (nextVoteableRoundId) return nextVoteableRoundId;

  if (currentIndex < 0) {
    return publicVoteRoundIds.find((roundId) => hasVoteableMatchInRound(matches, roundId))
      ?? publicVoteRoundIds[0]
      ?? currentRoundId;
  }

  return currentRoundId;
}

function winnerRevealRoundId(row) {
  return String(row?.roundId || row?.round_id || row?.round?.id || row?.match?.roundId || row?.draw?.roundId || "").trim();
}

function collectWinnerRevealRoundIds(winnerRevealData) {
  if (winnerRevealData?.sourceStatus !== "revealed") return new Set();

  const roundIds = new Set();
  [
    winnerRevealData.roundId,
    winnerRevealData.sourceRoundId,
    winnerRevealData.drawRoundId,
  ].forEach((roundId) => {
    const normalized = String(roundId || "").trim();
    if (normalized) roundIds.add(normalized);
  });

  [
    winnerRevealData.winners,
    winnerRevealData.winnersBySlot,
    winnerRevealData.alternates,
  ].forEach((rows) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      const roundId = winnerRevealRoundId(row);
      if (roundId) roundIds.add(roundId);
    });
  });

  if (Array.isArray(winnerRevealData.draws)) {
    winnerRevealData.draws.forEach((draw) => {
      const drawRoundId = String(draw?.roundId || draw?.drawRoundId || "").trim();
      const drawHasReveal = Boolean(draw?.revealed)
        || (Array.isArray(draw?.winners) && draw.winners.length > 0)
        || (Array.isArray(draw?.prizeSlots) && draw.prizeSlots.some((slot) => slot?.winner));
      if (drawRoundId && drawHasReveal) roundIds.add(drawRoundId);
    });
  }

  return roundIds;
}

function getLatestPrizeRoundId(winnerRevealData, currentRoundId) {
  const revealedRoundIds = collectWinnerRevealRoundIds(winnerRevealData);
  const latestRevealedRoundId = publicVoteRoundIds
    .filter((roundId) => revealedRoundIds.has(roundId))
    .at(-1);

  if (latestRevealedRoundId) return latestRevealedRoundId;
  return publicVoteRoundIds.includes(currentRoundId) ? currentRoundId : publicVoteRoundIds[0] ?? currentRoundId;
}

function isPrizeRoundView(viewId) {
  return viewId === "winners" || viewId === "draw";
}

function AppContent() {
  const copy = useCampaignCopy();
  const { t } = copy;
  const localTestOrigin = isLocalTestOrigin();
  const defaultLocalSimulationMode = normalizeLocalSimulationMode(import.meta.env.VITE_LOCAL_SIMULATION_MODE);
  const defaultSimulationMode = localTestOrigin ? defaultLocalSimulationMode : "realtime";
  const initialRoundId = defaultSimulationMode === "scenario" ? DEFAULT_ROUND_ID : "round16";
  const initialMatchId = localTestOrigin
    ? DEFAULT_MATCH_ID
    : campaignMatches.find((match) => match.roundId === initialRoundId)?.id ?? DEFAULT_MATCH_ID;
  const ledgerSummaryUrl = import.meta.env.VITE_LEDGER_SUMMARY_URL || (import.meta.env.PROD ? "/api/raffle-summary" : "");
  const ledgerEntryUrl = import.meta.env.VITE_LEDGER_ENTRY_URL || (import.meta.env.PROD ? "/api/raffle-entry" : "");
  const milestoneSummaryUrl = import.meta.env.VITE_MILESTONE_SUMMARY_URL || (import.meta.env.PROD ? "/api/milestones" : "");
  const previewVoteUrl = import.meta.env.VITE_VOTE_PREVIEW_URL
    || (import.meta.env.PROD ? "/api/vote-preview" : "/mock-api/vote-preview.json");
  const voteSubmitUrl = import.meta.env.VITE_VOTE_SUBMIT_URL || (import.meta.env.PROD ? "/api/votes" : "");
  const localApiOrigin = import.meta.env.VITE_LOCAL_API_ORIGIN || "";
  const liveQualificationUrl = import.meta.env.VITE_LIVE_QUALIFICATION_URL
    || (import.meta.env.PROD || !localTestOrigin
      ? "/api/live-qualification"
      : localApiOrigin
        ? `${localApiOrigin}/api/live-qualification`
        : "");
  const liveRound32MatchesUrl = import.meta.env.VITE_LIVE_ROUND32_MATCHES_URL
    || (import.meta.env.PROD || !localTestOrigin
      ? "/api/live-round32-matches"
      : localApiOrigin
        ? `${localApiOrigin}/api/live-round32-matches`
        : "");
  const liveRound16MatchesUrl = import.meta.env.VITE_LIVE_ROUND16_MATCHES_URL
    || (import.meta.env.PROD || !localTestOrigin
      ? "/api/live-round16-matches"
      : localApiOrigin
        ? `${localApiOrigin}/api/live-round16-matches`
        : "");
  const liveFutureKnockoutMatchesUrl = import.meta.env.VITE_LIVE_FUTURE_KNOCKOUT_MATCHES_URL
    || (import.meta.env.PROD || !localTestOrigin
      ? "/api/live-future-knockout-matches"
      : localApiOrigin
        ? `${localApiOrigin}/api/live-future-knockout-matches`
        : "");
  const winnerRevealVideoUrl = import.meta.env.VITE_WINNER_REVEAL_VIDEO_URL || DEFAULT_WINNER_REVEAL_VIDEO_URL;
  const drawWinnersUrl = import.meta.env.VITE_DRAW_WINNERS_URL
    || (import.meta.env.PROD ? "/api/draw-winners" : "/mock-api/draw-winners.json");
  const authMeUrl = import.meta.env.VITE_AUTH_ME_URL || (import.meta.env.PROD ? "/api/auth/me" : "");
  const [ledger, setLedger] = useState(() => normalizeFootballLedger(verifiedLedgerSnapshot));
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState(null);
  const [ledgerIssue, setLedgerIssue] = useState("");
  const [ledgerReady, setLedgerReady] = useState(!ledgerSummaryUrl);
  const [milestoneSummary, setMilestoneSummary] = useState(bundledMilestoneSummary);
  const [milestoneIssue, setMilestoneIssue] = useState("");
  const [milestoneReady, setMilestoneReady] = useState(!milestoneSummaryUrl);
  const [previewVoteData, setPreviewVoteData] = useState(getEmptyPreviewVoteData);
  const [globalPreviewVoteData, setGlobalPreviewVoteData] = useState(getEmptyPreviewVoteData);
  const [previewVoteIssue, setPreviewVoteIssue] = useState("");
  const [previewVoteReady, setPreviewVoteReady] = useState(!previewVoteUrl);
  const [globalPreviewVoteReady, setGlobalPreviewVoteReady] = useState(!previewVoteUrl);
  const [winnerRevealData, setWinnerRevealData] = useState(() => getEmptyWinnerRevealData(winnerRevealVideoUrl));
  const [winnerRevealIssue, setWinnerRevealIssue] = useState("");
  const [winnerRevealReady, setWinnerRevealReady] = useState(!drawWinnersUrl);
  const [winnerRevealRefreshToken, setWinnerRevealRefreshToken] = useState(0);
  const [authSession, setAuthSession] = useState({ authenticated: false, config: null });
  const [authIssue, setAuthIssue] = useState("");
  const [authReady, setAuthReady] = useState(!authMeUrl);
  const [activeViewId, setActiveViewId] = useState(readInitialViewId);
  const [localSimulationMode, setLocalSimulationMode] = useState(defaultSimulationMode);
  const simulationMode = localTestOrigin ? localSimulationMode : "realtime";
  const [liveQualification, setLiveQualification] = useState(() => createPendingFifaQualificationSnapshot());
  const [liveRound32Matches, setLiveRound32Matches] = useState(() => createPendingFifaRound32MatchesSnapshot());
  const [liveRound16Matches, setLiveRound16Matches] = useState(() => createPendingFifaRound16MatchesSnapshot());
  const [liveFutureKnockoutMatches, setLiveFutureKnockoutMatches] = useState(
    () => createPendingFifaFutureKnockoutMatchesSnapshot(),
  );
  const [simulatedRoundId, setSimulatedRoundId] = useState(initialRoundId);
  const [activeRoundId, setActiveRoundId] = useState(initialRoundId);
  const [selectedMatchId, setSelectedMatchId] = useState(initialMatchId);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [ticketAmount, setTicketAmount] = useState(DEFAULT_TICKET_AMOUNT);
  const [previewAllocations, setPreviewAllocations] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(
    () => readInitialWalletAddress() || verifiedLedgerSnapshot.leaderboardEntries[0].userAddress,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingVote, setPendingVote] = useState(null);
  const [pendingVoteIssue, setPendingVoteIssue] = useState("");
  const [voteSubmitting, setVoteSubmitting] = useState(false);
  const [voteSubmitNotice, setVoteSubmitNotice] = useState(null);
  const [initialAssetsReady, setInitialAssetsReady] = useState(false);
  const [initialCoverPaintReady, setInitialCoverPaintReady] = useState(false);
  const [initialLoaderVisible, setInitialLoaderVisible] = useState(true);
  const [initialLoaderMounted, setInitialLoaderMounted] = useState(true);
  const [initialLoaderStartedAt] = useState(() => Date.now());
  const [matchStatusNow, setMatchStatusNow] = useState(() => Date.now());
  const trackedLoginKeyRef = useRef("");
  const roundManuallySelectedRef = useRef(false);
  const prizeRoundManuallySelectedRef = useRef(false);
  const previousActiveViewIdRef = useRef(activeViewId);
  const voteSubmitNoticeTimerRef = useRef(0);

  const refreshAuthSession = useCallback(async () => {
    if (!authMeUrl) {
      setAuthReady(true);
      return null;
    }

    setAuthReady(false);
    try {
      const { payload } = await fetchJsonWithTimeout(authMeUrl, {
        cache: "no-store",
        credentials: "same-origin",
        timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
      });
      setAuthSession(payload);
      setAuthIssue("");
      return payload;
    } catch (error) {
      setAuthSession({ authenticated: false, config: null });
      setAuthIssue(t("auth.sessionIssue", { message: error.message }));
      return null;
    } finally {
      setAuthReady(true);
    }
  }, [authMeUrl, t]);

  useEffect(() => {
    refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => () => {
    window.clearTimeout(voteSubmitNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    installGoogleAnalytics();
  }, []);

  useEffect(() => {
    function handlePopState() {
      setActiveViewId(readInitialViewId());
      setMobileNavOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    trackPageView({
      title: document.title,
      viewId: activeViewId,
    });
  }, [activeViewId]);

  useEffect(() => {
    if (!authSession?.authenticated) {
      trackedLoginKeyRef.current = "";
      return;
    }

    const provider = String(authSession.identity?.provider || "unknown");
    const loginKey = `${provider}:${authSession.walletAddress || "wallet-unlinked"}`;
    if (trackedLoginKeyRef.current === loginKey) return;
    trackedLoginKeyRef.current = loginKey;
    trackEvent("login_status", {
      auth_provider: provider,
      wallet_linked: Boolean(authSession.walletAddress),
    });
  }, [authSession?.authenticated, authSession?.identity?.provider, authSession?.walletAddress]);

  useEffect(() => {
    if (authSession?.walletAddress) {
      setSelectedWallet(authSession.walletAddress);
    }
  }, [authSession?.walletAddress]);

  useEffect(() => {
    const summaryUrl = ledgerSummaryUrl;
    if (!summaryUrl) {
      setLedgerReady(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLedgerReady(false);
    fetchJsonWithTimeout(summaryUrl, {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeLedgerSummary(payload);
        if (!normalized) throw new Error(t("data.invalidLedgerShape"));
        setLedger(normalized);
        setSelectedWallet((current) => current || normalized.leaderboardEntries[0]?.userAddress || "");
        setLedgerIssue("");
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setLedgerIssue(
          t("data.ledgerIssue", { message: error.message }),
        );
      })
      .finally(() => {
        if (!cancelled) setLedgerReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ledgerSummaryUrl, t]);

  useEffect(() => {
    if (!ledgerEntryUrl || !selectedWallet) {
      setSelectedLedgerEntry(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    fetchJsonWithTimeout(urlWithQueryParams(ledgerEntryUrl, {
      wallet: selectedWallet,
      includeIntervals: "1",
      intervalLimit: "12",
    }), {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        setSelectedLedgerEntry(normalizeLedgerEntryPayload(payload));
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setSelectedLedgerEntry(null);
        setLedgerIssue(t("data.ledgerIssue", { message: error.message }));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ledgerEntryUrl, selectedWallet, t]);

  useEffect(() => {
    const milestoneUrl = milestoneSummaryUrl;
    if (!milestoneUrl) {
      setMilestoneReady(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setMilestoneReady(false);
    fetchJsonWithTimeout(milestoneUrl, {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeMilestoneSummary(payload);
        if (!normalized) throw new Error(t("data.invalidMilestoneShape"));
        setMilestoneSummary(normalized);
        setMilestoneIssue("");
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setMilestoneSummary(bundledMilestoneSummary);
        setMilestoneIssue(
          t("data.milestoneIssue", { message: error.message }),
        );
      })
      .finally(() => {
        if (!cancelled) setMilestoneReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [milestoneSummaryUrl, t]);

  useEffect(() => {
    if (!previewVoteUrl) {
      setPreviewVoteReady(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPreviewVoteReady(false);

    fetchJsonWithTimeout(urlWithWalletQuery(previewVoteUrl, selectedWallet), {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizePreviewVotePayload(payload);
        setPreviewVoteData(normalized);
        setPreviewAllocations(normalized.allocations);
        setPreviewVoteIssue("");
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setPreviewVoteData(getEmptyPreviewVoteData());
        setPreviewAllocations([]);
        setPreviewVoteIssue(t("data.previewVoteIssue", { message: error.message }));
      })
      .finally(() => {
        if (!cancelled) setPreviewVoteReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [previewVoteUrl, selectedWallet, t]);

  useEffect(() => {
    if (!previewVoteUrl) {
      setGlobalPreviewVoteReady(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setGlobalPreviewVoteReady(false);

    fetchJsonWithTimeout(urlWithQueryParams(previewVoteUrl, { scope: "all" }), {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        setGlobalPreviewVoteData(normalizePreviewVotePayload(payload));
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setGlobalPreviewVoteData(getEmptyPreviewVoteData());
      })
      .finally(() => {
        if (!cancelled) setGlobalPreviewVoteReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [previewVoteUrl]);

  useEffect(() => {
    if (!drawWinnersUrl) {
      setWinnerRevealData(getEmptyWinnerRevealData(winnerRevealVideoUrl));
      setWinnerRevealReady(true);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setWinnerRevealReady(false);

    fetchJsonWithTimeout(drawWinnersUrl, {
      cache: "no-store",
      signal: controller.signal,
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
      .then(({ payload }) => payload)
      .then((payload) => {
        if (cancelled) return;
        setWinnerRevealData(normalizeWinnerRevealPayload(payload, winnerRevealVideoUrl));
        setWinnerRevealIssue("");
      })
      .catch((error) => {
        if (isRequestAbortError(error)) return;
        if (cancelled) return;
        setWinnerRevealData(getEmptyWinnerRevealData(winnerRevealVideoUrl));
        setWinnerRevealIssue(t("winnerReveal.dataIssue", { message: error.message }));
      })
      .finally(() => {
        if (!cancelled) setWinnerRevealReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [drawWinnersUrl, t, winnerRevealVideoUrl, winnerRevealRefreshToken]);

  useEffect(() => {
    function refreshWinnerRevealData() {
      setWinnerRevealRefreshToken((current) => current + 1);
    }

    window.addEventListener("renaiss:draw-winners-updated", refreshWinnerRevealData);
    return () => {
      window.removeEventListener("renaiss:draw-winners-updated", refreshWinnerRevealData);
    };
  }, []);

  useEffect(() => {
    if (simulationMode !== "realtime") return undefined;

    let cancelled = false;
    let intervalId = 0;

    async function syncFifaStandings() {
      setLiveQualification((current) => (
        current.fetchedAt
          ? { ...current, sourceStatus: "stale", issue: t("liveQualification.refreshing") }
          : createPendingFifaQualificationSnapshot(t("liveQualification.connecting"))
      ));

      try {
        const snapshot = liveQualificationUrl
          ? (await fetchJsonWithTimeout(liveQualificationUrl, {
            cache: "no-store",
            timeoutMs: DATA_REQUEST_TIMEOUT_MS,
          })).payload
          : await fetchFifaQualificationSnapshot();
        if (!cancelled) setLiveQualification(snapshot);
      } catch (error) {
        if (cancelled) return;
        setLiveQualification((current) => (
          current.fetchedAt
            ? { ...current, sourceStatus: "stale", issue: error.message }
            : createPendingFifaQualificationSnapshot(error.message)
        ));
      }
    }

    syncFifaStandings();
    intervalId = window.setInterval(syncFifaStandings, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveQualificationUrl, simulationMode, t]);

  useEffect(() => {
    if (simulationMode !== "realtime") return undefined;

    let cancelled = false;
    let intervalId = 0;

    async function syncFifaRound32Matches() {
      setLiveRound32Matches((current) => (
        current.fetchedAt
          ? { ...current, sourceStatus: "stale", issue: t("liveQualification.refreshing") }
          : createPendingFifaRound32MatchesSnapshot(t("liveQualification.connecting"))
      ));

      try {
        const snapshot = liveRound32MatchesUrl
          ? (await fetchJsonWithTimeout(liveRound32MatchesUrl, {
            cache: "no-store",
            timeoutMs: DATA_REQUEST_TIMEOUT_MS,
          })).payload
          : await fetchFifaRound32MatchesSnapshot();
        if (!cancelled) setLiveRound32Matches(snapshot);
      } catch (error) {
        if (cancelled) return;
        setLiveRound32Matches((current) => (
          current.fetchedAt
            ? { ...current, sourceStatus: "stale", issue: error.message }
            : createPendingFifaRound32MatchesSnapshot(error.message)
        ));
      }
    }

    syncFifaRound32Matches();
    intervalId = window.setInterval(syncFifaRound32Matches, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveRound32MatchesUrl, simulationMode, t]);

  useEffect(() => {
    if (simulationMode !== "realtime") return undefined;

    let cancelled = false;
    let intervalId = 0;

    async function syncFifaRound16Matches() {
      setLiveRound16Matches((current) => (
        current.fetchedAt
          ? { ...current, sourceStatus: "stale", issue: t("liveQualification.refreshing") }
          : createPendingFifaRound16MatchesSnapshot(t("liveQualification.connecting"))
      ));

      try {
        const snapshot = liveRound16MatchesUrl
          ? (await fetchJsonWithTimeout(liveRound16MatchesUrl, {
            cache: "no-store",
            timeoutMs: DATA_REQUEST_TIMEOUT_MS,
          })).payload
          : await fetchFifaRound16MatchesSnapshot();
        if (!cancelled) setLiveRound16Matches(snapshot);
      } catch (error) {
        if (cancelled) return;
        setLiveRound16Matches((current) => (
          current.fetchedAt
            ? { ...current, sourceStatus: "stale", issue: error.message }
            : createPendingFifaRound16MatchesSnapshot(error.message)
        ));
      }
    }

    syncFifaRound16Matches();
    intervalId = window.setInterval(syncFifaRound16Matches, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveRound16MatchesUrl, simulationMode, t]);

  useEffect(() => {
    if (simulationMode !== "realtime") return undefined;

    let cancelled = false;
    let intervalId = 0;

    async function syncFifaFutureKnockoutMatches() {
      setLiveFutureKnockoutMatches((current) => (
        current.fetchedAt
          ? { ...current, sourceStatus: "stale", issue: t("liveQualification.refreshing") }
          : createPendingFifaFutureKnockoutMatchesSnapshot(t("liveQualification.connecting"))
      ));

      try {
        const snapshot = liveFutureKnockoutMatchesUrl
          ? (await fetchJsonWithTimeout(liveFutureKnockoutMatchesUrl, {
            cache: "no-store",
            timeoutMs: DATA_REQUEST_TIMEOUT_MS,
          })).payload
          : await fetchFifaFutureKnockoutMatchesSnapshot();
        if (!cancelled) setLiveFutureKnockoutMatches(snapshot);
      } catch (error) {
        if (cancelled) return;
        setLiveFutureKnockoutMatches((current) => (
          current.fetchedAt
            ? { ...current, sourceStatus: "stale", issue: error.message }
            : createPendingFifaFutureKnockoutMatchesSnapshot(error.message)
        ));
      }
    }

    syncFifaFutureKnockoutMatches();
    intervalId = window.setInterval(syncFifaFutureKnockoutMatches, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveFutureKnockoutMatchesUrl, simulationMode, t]);

  const staticTeamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), []);
  const liveVoteStats = useMemo(
    () => buildLiveVoteStats(globalPreviewVoteData, previewVoteData),
    [globalPreviewVoteData, previewVoteData],
  );
  const realtimeRound32Preview = useMemo(
    () => buildRealtimeRound32Preview({
      matches: campaignMatches,
      teams,
      snapshot: liveQualification,
      fixtures: liveRound32Matches,
      round16Fixtures: liveRound16Matches,
      futureKnockoutFixtures: liveFutureKnockoutMatches,
      voteTotalsByMatchTeam: liveVoteStats.totalsByMatchTeam,
      voterCountsByMatch: liveVoteStats.voterCountsByMatch,
    }),
    [liveFutureKnockoutMatches, liveQualification, liveRound16Matches, liveRound32Matches, liveVoteStats],
  );
  const sourceMatches = simulationMode === "realtime" ? realtimeRound32Preview.matches : campaignMatches;
  const matches = useMemo(
    () => sourceMatches.map((match) => resolveMatchRuntimeState(match, matchStatusNow)),
    [matchStatusNow, sourceMatches],
  );
  const teamsById = simulationMode === "realtime" ? realtimeRound32Preview.teamsById : staticTeamsById;
  const displayedLiveQualification = simulationMode === "realtime" ? realtimeRound32Preview.snapshot : liveQualification;
  const simulatedRound = useMemo(() => getRoundById(simulatedRoundId), [simulatedRoundId]);
  const activeRound = useMemo(() => getRoundById(activeRoundId), [activeRoundId]);
  const selectedMatch = useMemo(
    () => matches.find((match) => sameMatchId(match.id, selectedMatchId))
      ?? matches.find((match) => match.roundId === activeRoundId)
      ?? matches[0],
    [activeRoundId, matches, selectedMatchId],
  );
  const activeEntry = useMemo(
    () => selectedLedgerEntry
      ?? ledger.leaderboardEntries.find((entry) => entry.userAddress === selectedWallet)
      ?? createEmptyLedgerEntry(selectedWallet),
    [ledger.leaderboardEntries, selectedLedgerEntry, selectedWallet],
  );
  const walletAllocations = useMemo(
    () => previewAllocations.filter((allocation) => allocation.walletAddress === selectedWallet),
    [previewAllocations, selectedWallet],
  );
  const walletVoteOutcomes = useMemo(
    () => previewVoteData.outcomes.filter((outcome) => outcome.walletAddress === selectedWallet),
    [previewVoteData.outcomes, selectedWallet],
  );
  const roundAllocations = useMemo(
    () => walletAllocations.filter((allocation) => allocation.roundId === activeRoundId),
    [activeRoundId, walletAllocations],
  );
  const roundVoteOutcomes = useMemo(
    () => walletVoteOutcomes.filter((outcome) => outcome.roundId === activeRoundId),
    [activeRoundId, walletVoteOutcomes],
  );
  const roundOutcomeSummary = useMemo(
    () => getRoundOutcomeSummary(previewVoteData, activeRoundId),
    [activeRoundId, previewVoteData],
  );
  const usedRoundTickets = useMemo(
    () => roundAllocations.reduce((total, allocation) => total + allocation.tickets, 0),
    [roundAllocations],
  );
  const roundTicketBreakdown = useMemo(
    () => getRoundTicketAvailability({
      entry: activeEntry,
      roundId: activeRoundId,
      allocations: walletAllocations,
      walletAddress: selectedWallet,
    }),
    [activeEntry, activeRoundId, selectedWallet, walletAllocations],
  );
  const remainingRoundTickets = roundTicketBreakdown.remainingTickets;
  const usedTicketPoolTickets = roundTicketBreakdown.usedTickets ?? usedRoundTickets;
  const isRealtimeRound32 = simulationMode === "realtime" && activeRoundId === "round32";
  const visibleRoundAllocations = roundAllocations;
  const visibleRoundVoteOutcomes = roundVoteOutcomes;
  const visibleUsedRoundTickets = usedTicketPoolTickets;
  const visibleRemainingRoundTickets = remainingRoundTickets;
  const pendingVoteMatch = useMemo(
    () => (pendingVote ? matches.find((match) => sameMatchId(match.id, pendingVote.matchId)) ?? null : null),
    [matches, pendingVote],
  );
  const pendingVoteTeam = useMemo(
    () => (pendingVote ? teamsById.get(pendingVote.teamId) ?? null : null),
    [pendingVote, teamsById],
  );
  const showVoteSubmitNotice = useCallback(({ teamId, tickets }) => {
    const team = teamsById.get(teamId);
    const notice = {
      id: `${teamId}-${Date.now()}`,
      teamName: team ? copy.teamName(team) : String(teamId || ""),
      tickets,
    };

    window.clearTimeout(voteSubmitNoticeTimerRef.current);
    setVoteSubmitNotice(notice);
    voteSubmitNoticeTimerRef.current = window.setTimeout(() => {
      setVoteSubmitNotice((current) => (current?.id === notice.id ? null : current));
    }, 3600);
  }, [copy, teamsById]);
  const visibleRoundOutcomeSummary = isRealtimeRound32
    ? { lostTickets: 0, winnerTickets: 0, pendingTickets: 0 }
    : roundOutcomeSummary;
  const currentWinnerWalletAddress = authSession?.walletAddress || (!authMeUrl || isLocalTestOrigin() ? selectedWallet : "");
  const currentUserWinnerCount = useMemo(
    () => countWinnersForWallet(winnerRevealData, currentWinnerWalletAddress),
    [currentWinnerWalletAddress, winnerRevealData],
  );
  const drawStats = useMemo(
    () => roundDefinitions.map((round) => summarizeRoundDraw(
      round,
      previewAllocations,
      getRoundOutcomeSummary(globalPreviewVoteData, round.id),
      getRoundOutcomeSummary(previewVoteData, round.id),
    )),
    [globalPreviewVoteData, previewAllocations, previewVoteData],
  );
  const latestPrizeRoundId = useMemo(
    () => getLatestPrizeRoundId(winnerRevealData, activeRoundId),
    [activeRoundId, winnerRevealData],
  );
  const milestoneCurrentValue = milestoneSummary.currentMetricValue ?? (ledger.totalRawTickets ?? 0);
  const initialDataReady = ledgerReady && milestoneReady && previewVoteReady && globalPreviewVoteReady && winnerRevealReady && authReady;
  const initialCoverAssetsReady = initialDataReady && initialAssetsReady;
  const initialExperienceReady = initialCoverAssetsReady && initialCoverPaintReady;

  useEffect(() => {
    let alive = true;

    Promise.all([
      preloadImage(renaissLogo),
      preloadHomeRoomAssets(),
    ]).finally(() => {
      if (alive) setInitialAssetsReady(true);
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!initialCoverAssetsReady) return undefined;

    let alive = true;
    let firstFrameId = 0;
    let secondFrameId = 0;

    const markAfterPaint = () => {
      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          if (alive) setInitialCoverPaintReady(true);
        });
      });
    };

    if (document.fonts?.ready) {
      document.fonts.ready.catch(() => undefined).finally(() => {
        if (alive) markAfterPaint();
      });
    } else {
      markAfterPaint();
    }

    return () => {
      alive = false;
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [initialCoverAssetsReady]);

  useEffect(() => {
    if (!initialExperienceReady) return undefined;

    const elapsed = Date.now() - initialLoaderStartedAt;
    const timeoutId = window.setTimeout(() => {
      setInitialLoaderVisible(false);
    }, Math.max(0, INITIAL_LOADER_MIN_VISIBLE_MS - elapsed));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [initialExperienceReady, initialLoaderStartedAt]);

  useEffect(() => {
    if (initialLoaderVisible) return undefined;

    const timeoutId = window.setTimeout(() => {
      setInitialLoaderMounted(false);
    }, INITIAL_LOADER_EXIT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [initialLoaderVisible]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMatchStatusNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setTicketAmount((current) => Math.max(1, Math.min(current, Math.max(1, visibleRemainingRoundTickets))));
  }, [visibleRemainingRoundTickets]);

  useEffect(() => {
    if (previousActiveViewIdRef.current === activeViewId) return;
    if (activeViewId === "vote") {
      roundManuallySelectedRef.current = false;
    }
    if (isPrizeRoundView(activeViewId)) {
      prizeRoundManuallySelectedRef.current = false;
    }
    previousActiveViewIdRef.current = activeViewId;
  }, [activeViewId]);

  useEffect(() => {
    if (activeViewId !== "vote") return;
    if (simulationMode !== "realtime") return;
    if (roundManuallySelectedRef.current) return;

    const defaultVoteRoundId = getDefaultVoteRoundId(matches, activeRoundId);
    if (!defaultVoteRoundId || defaultVoteRoundId === activeRoundId) return;

    const nextMatch = getPreferredRoundMatch(matches, defaultVoteRoundId);
    setActiveRoundId(defaultVoteRoundId);
    setSelectedMatchId(nextMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }, [activeRoundId, activeViewId, matches, selectedMatchId, simulationMode]);

  useEffect(() => {
    if (!isPrizeRoundView(activeViewId)) return;
    if (prizeRoundManuallySelectedRef.current) return;
    if (!latestPrizeRoundId || latestPrizeRoundId === activeRoundId) return;

    const nextMatch = matches.find((match) => match.roundId === latestPrizeRoundId);
    setActiveRoundId(latestPrizeRoundId);
    setSelectedMatchId(nextMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }, [activeRoundId, activeViewId, latestPrizeRoundId, matches, selectedMatchId]);

  function handleSelectView(viewId) {
    if (viewId === "vote" && activeViewId !== "vote") {
      roundManuallySelectedRef.current = false;
    }
    if (isPrizeRoundView(viewId) && activeViewId !== viewId) {
      prizeRoundManuallySelectedRef.current = false;
    }
    setActiveViewId(viewId);
    syncViewIdToUrl(viewId);
    setMobileNavOpen(false);
  }

  function handleSelectRound(roundId) {
    roundManuallySelectedRef.current = true;
    prizeRoundManuallySelectedRef.current = true;
    const firstMatch = matches.find((match) => match.roundId === roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulatedRound(roundId) {
    if (!localTestOrigin) return;
    roundManuallySelectedRef.current = true;
    prizeRoundManuallySelectedRef.current = true;
    const firstMatch = campaignMatches.find((match) => match.roundId === roundId);
    setLocalSimulationMode("scenario");
    setSimulatedRoundId(roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulationMode(nextMode) {
    if (!localTestOrigin) return;
    if (!["scenario", "realtime"].includes(nextMode)) return;
    setLocalSimulationMode(nextMode);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);

    if (nextMode === "realtime") {
      roundManuallySelectedRef.current = false;
      prizeRoundManuallySelectedRef.current = false;
      const defaultVoteRoundId = getDefaultVoteRoundId(matches, "round16");
      const firstVoteMatch = getPreferredRoundMatch(matches, defaultVoteRoundId);
      setSimulatedRoundId(defaultVoteRoundId);
      setActiveRoundId(defaultVoteRoundId);
      setSelectedMatchId(firstVoteMatch?.id ?? selectedMatchId);
    }
  }

  function handleSelectMatch(matchId, options = {}) {
    if (!options.automatic) {
      roundManuallySelectedRef.current = true;
      prizeRoundManuallySelectedRef.current = true;
    }
    const match = matches.find((entry) => sameMatchId(entry.id, matchId));
    if (match?.roundId && match.roundId !== activeRoundId) {
      setActiveRoundId(match.roundId);
    }
    setSelectedMatchId(matchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectTeam(teamId) {
    if (!teamId) return;
    setSelectedTeamId(teamId);
  }

  async function redirectToRenaissLogin() {
    if (typeof window === "undefined") return;
    if (authMeUrl && authSession?.authenticated) return;
    await requestRenaissProviderSignOut(authSession, authSession?.config);
    window.location.assign(buildRenaissLoginUrl());
  }

  function handleRequestPreviewVote(amount, target = {}) {
    if (voteSubmitUrl && authMeUrl) {
      if (!authSession?.walletAddress) {
        redirectToRenaissLogin();
        return;
      }

      const xFollowGateRequired = authSession?.config?.xFollowGate?.required !== false;
      const xAccountEligibilityRequired = authSession?.config?.xAccountEligibility?.required !== false;
      const xFollowGatePassed = !xFollowGateRequired || Boolean(authSession?.xFollow?.gatePassed);
      const xAccountEligibilityPassed = !xAccountEligibilityRequired || Boolean(authSession?.xAccountEligibility?.gatePassed);
      if (!xFollowGatePassed || !xAccountEligibilityPassed) {
        setPreviewVoteIssue(t("vote.voteEligibilityBlocked"));
        return;
      }
    }
    const nextMatchId = String(target?.matchId || selectedMatch?.id || "");
    const nextTeamId = String(target?.teamId || selectedTeamId || "");

    if (!nextMatchId || !nextTeamId) {
      const issue = t("vote.voteTargetMissing");
      setPendingVoteIssue(issue);
      setPreviewVoteIssue(issue);
      return;
    }

    if (remainingRoundTickets <= 0) {
      const issue = t("vote.noTicketsRemaining");
      setPendingVoteIssue(issue);
      setPreviewVoteIssue(issue);
      return;
    }

    if (target?.matchId) setSelectedMatchId(nextMatchId);
    if (target?.teamId) setSelectedTeamId(nextTeamId);
    setPendingVoteIssue("");
    setPendingVote({
      amount: Math.max(1, Math.min(Math.floor(amount || 0), remainingRoundTickets)),
      matchId: nextMatchId,
      teamId: nextTeamId,
    });
  }

  function applyLocalPreviewVote({ matchId = selectedMatch?.id, teamId = selectedTeamId, tickets }) {
    const submittedAt = new Date().toISOString();
    setPreviewAllocations((current) => {
      const existingIndex = current.findIndex((allocation) => (
        allocation.walletAddress === selectedWallet
        && allocation.roundId === activeRoundId
        && sameMatchId(allocation.matchId, matchId)
        && allocation.teamId === teamId
      ));

      if (existingIndex >= 0) {
        return current.map((allocation, index) => (
          index === existingIndex
            ? { ...allocation, tickets: allocation.tickets + tickets, updatedAt: submittedAt }
            : allocation
        ));
      }

      return [
        ...current,
        {
          id: `${selectedWallet}-${matchId}-${teamId}-${Date.now()}`,
          walletAddress: selectedWallet,
          roundId: activeRoundId,
          matchId,
          teamId,
          tickets,
          source: "local-preview",
          official: false,
          createdAt: submittedAt,
          updatedAt: submittedAt,
        },
      ];
    });
  }

  async function handleConfirmPreviewVote(voteRequest = pendingVote) {
    if (voteSubmitting) return;

    const request = typeof voteRequest === "object" && voteRequest
      ? voteRequest
      : { amount: voteRequest, matchId: selectedMatch?.id, teamId: selectedTeamId };
    const targetMatch = matches.find((match) => sameMatchId(match.id, request.matchId)) ?? selectedMatch;
    const targetTeamId = String(request.teamId || selectedTeamId || "");

    if (!targetMatch?.id || !targetTeamId) {
      const issue = t("vote.voteTargetMissing");
      setPendingVoteIssue(issue);
      setPreviewVoteIssue(issue);
      return;
    }

    if (remainingRoundTickets <= 0) {
      const issue = t("vote.noTicketsRemaining");
      setPendingVoteIssue(issue);
      setPreviewVoteIssue(issue);
      return;
    }

    const tickets = Math.max(1, Math.min(Math.floor(request.amount || 0), remainingRoundTickets));
    setVoteSubmitting(true);
    setPendingVoteIssue("");

    if (voteSubmitUrl) {
      try {
        const { payload } = await fetchJsonWithTimeout(voteSubmitUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...csrfHeadersForSession(authSession),
          },
          credentials: "same-origin",
          timeoutMs: VOTE_SUBMIT_TIMEOUT_MS,
          body: JSON.stringify({
            ...(authMeUrl ? {} : { walletAddress: selectedWallet }),
            roundId: activeRoundId,
            matchId: targetMatch.id,
            teamId: targetTeamId,
            tickets,
            requestId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          }),
        });
        const normalized = normalizePreviewVotePayload(payload.preview);
        setPreviewVoteData(normalized);
        setPreviewAllocations(normalized.allocations);
        setPreviewVoteIssue("");
      } catch (error) {
        const issue = t("data.submitVoteIssue", { message: error.message });
        setPendingVoteIssue(issue);
        setPreviewVoteIssue(issue);
        if (shouldRedirectForAuthError(error)) redirectToRenaissLogin();
        setVoteSubmitting(false);
        return;
      }
    } else {
      applyLocalPreviewVote({ matchId: targetMatch.id, teamId: targetTeamId, tickets });
    }

    setVoteSubmitting(false);
    showVoteSubmitNotice({ teamId: targetTeamId, tickets });
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
    setPendingVote(null);
    setPendingVoteIssue("");
  }

  return (
    <>
      {initialLoaderMounted ? <InitialPageLoader isLeaving={!initialLoaderVisible} /> : null}
      <ControlRoom
        activeViewId={activeViewId}
        mobileNavOpen={mobileNavOpen}
        ledger={ledger}
        ledgerIssue={ledgerIssue}
        activeEntry={activeEntry}
        selectedWallet={selectedWallet}
        simulatedRound={simulatedRound}
        simulatedRoundId={simulatedRoundId}
        activeRound={activeRound}
        activeRoundId={activeRoundId}
        rounds={roundDefinitions}
        matches={matches}
        teamsById={teamsById}
        selectedMatch={selectedMatch}
        selectedTeamId={selectedTeamId}
        ticketAmount={ticketAmount}
        remainingRoundTickets={visibleRemainingRoundTickets}
        roundTicketBreakdown={roundTicketBreakdown}
        usedRoundTickets={visibleUsedRoundTickets}
        roundAllocations={visibleRoundAllocations}
        roundVoteOutcomes={visibleRoundVoteOutcomes}
        roundOutcomeSummary={visibleRoundOutcomeSummary}
        previewVoteIssue={previewVoteIssue}
        winnerRevealData={winnerRevealData}
        winnerRevealIssue={winnerRevealIssue}
        currentWinnerWalletAddress={currentWinnerWalletAddress}
        currentUserWinnerCount={currentUserWinnerCount}
        drawStats={drawStats}
        milestones={milestoneSummary.milestones}
        currentMilestoneValue={milestoneCurrentValue}
        simulationMode={simulationMode}
        liveQualification={displayedLiveQualification}
        authSession={authSession}
        authConfig={authSession?.config}
        authIssue={authIssue}
        authEndpointReady={Boolean(authMeUrl)}
        onRequestLogin={redirectToRenaissLogin}
        onRefreshAuth={refreshAuthSession}
        onSelectView={handleSelectView}
        onToggleMobileNav={() => setMobileNavOpen((current) => !current)}
        onSelectWallet={setSelectedWallet}
        onSelectRound={handleSelectRound}
        onSelectSimulatedRound={handleSelectSimulatedRound}
        onSelectSimulationMode={handleSelectSimulationMode}
        onSelectMatch={handleSelectMatch}
        onSelectTeam={handleSelectTeam}
        onSetTicketAmount={setTicketAmount}
        onConfirmPreviewVote={handleRequestPreviewVote}
      />
      <VoteConfirmModal
        amount={pendingVote?.amount}
        issue={pendingVoteIssue}
        match={pendingVoteMatch}
        submitting={voteSubmitting}
        team={pendingVoteTeam}
        onCancel={() => {
          if (voteSubmitting) return;
          setPendingVote(null);
          setPendingVoteIssue("");
        }}
        onConfirm={() => handleConfirmPreviewVote(pendingVote)}
      />
      <VoteSubmitToast notice={voteSubmitNotice} />
    </>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;
