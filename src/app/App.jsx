import { useCallback, useEffect, useMemo, useState } from "react";
import { ControlRoom } from "./components/control-room/ControlRoom";
import { preloadHomeRoomAssets } from "./components/control-room/HomeRoom";
import { VoteConfirmModal } from "./components/control-room/VoteConfirmModal";
import { InitialPageLoader } from "./components/InitialPageLoader";
import {
  buildRealtimeRound32Preview,
  createPendingFifaQualificationSnapshot,
  fetchFifaQualificationSnapshot,
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
import { preloadImage } from "./utils/preloadAssets";

const INITIAL_LOADER_MIN_VISIBLE_MS = 1100;
const INITIAL_LOADER_EXIT_MS = 540;
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;

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
  const viewId = new URLSearchParams(window.location.search).get("view");
  return commandViews.some((view) => view.id === viewId) ? viewId : DEFAULT_VIEW_ID;
}

function urlWithWalletQuery(baseUrl, walletAddress) {
  if (!baseUrl || !walletAddress) return baseUrl;
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("wallet", walletAddress);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function buildRenaissLoginUrl() {
  if (typeof window === "undefined") return "/api/auth/renaiss/start";
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const localCallbackHostnames = new Set(["127.0.0.1", "0.0.0.0", "::1"]);
  const authOrigin = localCallbackHostnames.has(window.location.hostname) ? "http://localhost:5173" : window.location.origin;
  const url = new URL("/api/auth/renaiss/start", authOrigin);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("prompt", "login");
  return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.toString();
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
    finalTickets: 0,
    sbt: "none",
    sbtMultiplier: 1,
    eventCount: 0,
    firstBuybackAt: 0,
    lastBuybackAt: 0,
    ticketStart: null,
    ticketEnd: null,
  };
}

function normalizeLedgerEntryPayload(payload) {
  const entry = payload?.entry;
  if (!entry || typeof entry !== "object") return null;
  const userAddress = normalizeWalletAddress(entry.userAddress ?? entry.user_address);
  const finalTickets = Math.max(0, Math.floor(Number(entry.finalTickets ?? entry.final_tickets) || 0));
  if (!userAddress || finalTickets <= 0) return null;

  return {
    ...entry,
    userAddress,
    sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
    packs: entry.packs && typeof entry.packs === "object" ? entry.packs : {},
    rawTickets: Math.max(0, Math.floor(Number(entry.rawTickets ?? entry.raw_tickets) || 0)),
    bonusTickets: Math.max(0, Math.floor(Number(entry.bonusTickets ?? entry.bonus_tickets) || 0)),
    finalTickets,
    sbt: String(entry.sbt ?? "none"),
    sbtMultiplier: Number(entry.sbtMultiplier ?? entry.sbt_multiplier ?? 1),
    eventCount: Math.max(0, Math.floor(Number(entry.eventCount ?? entry.event_count) || 0)),
    firstBuybackAt: Math.max(0, Math.floor(Number(entry.firstBuybackAt ?? entry.first_buyback_at) || 0)),
    lastBuybackAt: Math.max(0, Math.floor(Number(entry.lastBuybackAt ?? entry.last_buyback_at) || 0)),
    ticketStart: entry.ticketStart ?? entry.ticket_start ?? null,
    ticketEnd: entry.ticketEnd ?? entry.ticket_end ?? null,
  };
}

function AppContent() {
  const copy = useCampaignCopy();
  const { t } = copy;
  const ledgerSummaryUrl = import.meta.env.VITE_LEDGER_SUMMARY_URL || (import.meta.env.PROD ? "/api/raffle-summary" : "");
  const ledgerEntryUrl = import.meta.env.VITE_LEDGER_ENTRY_URL || (import.meta.env.PROD ? "/api/raffle-entry" : "");
  const milestoneSummaryUrl = import.meta.env.VITE_MILESTONE_SUMMARY_URL || (import.meta.env.PROD ? "/api/milestones" : "");
  const previewVoteUrl = import.meta.env.VITE_VOTE_PREVIEW_URL
    || (import.meta.env.PROD ? "/api/vote-preview" : "/mock-api/vote-preview.json");
  const voteSubmitUrl = import.meta.env.VITE_VOTE_SUBMIT_URL || (import.meta.env.PROD ? "/api/votes" : "");
  const winnerRevealVideoUrl = import.meta.env.VITE_WINNER_REVEAL_VIDEO_URL || DEFAULT_WINNER_REVEAL_VIDEO_URL;
  const drawWinnersUrl = import.meta.env.VITE_DRAW_WINNERS_URL
    || (import.meta.env.PROD ? "/api/draw-winners" : "/mock-api/draw-winners.json");
  const authMeUrl = import.meta.env.VITE_AUTH_ME_URL || (import.meta.env.PROD ? "/api/auth/me" : "");
  const [ledger, setLedger] = useState(verifiedLedgerSnapshot);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState(null);
  const [ledgerIssue, setLedgerIssue] = useState("");
  const [ledgerReady, setLedgerReady] = useState(!ledgerSummaryUrl);
  const [milestoneSummary, setMilestoneSummary] = useState(bundledMilestoneSummary);
  const [milestoneIssue, setMilestoneIssue] = useState("");
  const [milestoneReady, setMilestoneReady] = useState(!milestoneSummaryUrl);
  const [previewVoteData, setPreviewVoteData] = useState(getEmptyPreviewVoteData);
  const [previewVoteIssue, setPreviewVoteIssue] = useState("");
  const [previewVoteReady, setPreviewVoteReady] = useState(!previewVoteUrl);
  const [winnerRevealData, setWinnerRevealData] = useState(() => getEmptyWinnerRevealData(winnerRevealVideoUrl));
  const [winnerRevealIssue, setWinnerRevealIssue] = useState("");
  const [winnerRevealReady, setWinnerRevealReady] = useState(!drawWinnersUrl);
  const [authSession, setAuthSession] = useState({ authenticated: false, config: null });
  const [authIssue, setAuthIssue] = useState("");
  const [authReady, setAuthReady] = useState(!authMeUrl);
  const [activeViewId, setActiveViewId] = useState(readInitialViewId);
  const [simulationMode, setSimulationMode] = useState("scenario");
  const [liveQualification, setLiveQualification] = useState(() => createPendingFifaQualificationSnapshot());
  const [simulatedRoundId, setSimulatedRoundId] = useState(DEFAULT_ROUND_ID);
  const [activeRoundId, setActiveRoundId] = useState(DEFAULT_ROUND_ID);
  const [selectedMatchId, setSelectedMatchId] = useState(DEFAULT_MATCH_ID);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [ticketAmount, setTicketAmount] = useState(DEFAULT_TICKET_AMOUNT);
  const [previewAllocations, setPreviewAllocations] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(
    () => readInitialWalletAddress() || verifiedLedgerSnapshot.leaderboardEntries[0].userAddress,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingVoteAmount, setPendingVoteAmount] = useState(null);
  const [initialAssetsReady, setInitialAssetsReady] = useState(false);
  const [initialCoverPaintReady, setInitialCoverPaintReady] = useState(false);
  const [initialLoaderVisible, setInitialLoaderVisible] = useState(true);
  const [initialLoaderMounted, setInitialLoaderMounted] = useState(true);
  const [initialLoaderStartedAt] = useState(() => Date.now());
  const [matchStatusNow, setMatchStatusNow] = useState(() => Date.now());

  const refreshAuthSession = useCallback(async () => {
    if (!authMeUrl) {
      setAuthReady(true);
      return null;
    }

    setAuthReady(false);
    try {
      const response = await fetch(authMeUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
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
    setLedgerReady(false);
    fetch(summaryUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeLedgerSummary(payload);
        if (!normalized) throw new Error(t("data.invalidLedgerShape"));
        setLedger(normalized);
        setSelectedWallet((current) => current || normalized.leaderboardEntries[0]?.userAddress || "");
        setLedgerIssue("");
      })
      .catch((error) => {
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
      };
  }, [ledgerSummaryUrl, t]);

  useEffect(() => {
    if (!ledgerEntryUrl || !selectedWallet) {
      setSelectedLedgerEntry(null);
      return undefined;
    }

    let cancelled = false;

    fetch(urlWithWalletQuery(ledgerEntryUrl, selectedWallet), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setSelectedLedgerEntry(normalizeLedgerEntryPayload(payload));
      })
      .catch((error) => {
        if (cancelled) return;
        setSelectedLedgerEntry(null);
        setLedgerIssue(t("data.ledgerIssue", { message: error.message }));
      });

    return () => {
      cancelled = true;
    };
  }, [ledgerEntryUrl, selectedWallet, t]);

  useEffect(() => {
    const milestoneUrl = milestoneSummaryUrl;
    if (!milestoneUrl) {
      setMilestoneReady(true);
      return undefined;
    }

    let cancelled = false;
    setMilestoneReady(false);
    fetch(milestoneUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeMilestoneSummary(payload);
        if (!normalized) throw new Error(t("data.invalidMilestoneShape"));
        setMilestoneSummary(normalized);
        setMilestoneIssue("");
      })
      .catch((error) => {
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
    };
  }, [milestoneSummaryUrl, t]);

  useEffect(() => {
    if (!previewVoteUrl) {
      setPreviewVoteReady(true);
      return undefined;
    }

    let cancelled = false;
    setPreviewVoteReady(false);

    fetch(urlWithWalletQuery(previewVoteUrl, selectedWallet), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizePreviewVotePayload(payload);
        setPreviewVoteData(normalized);
        setPreviewAllocations(normalized.allocations);
        setPreviewVoteIssue("");
      })
      .catch((error) => {
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
    };
  }, [previewVoteUrl, selectedWallet, t]);

  useEffect(() => {
    if (!drawWinnersUrl) {
      setWinnerRevealData(getEmptyWinnerRevealData(winnerRevealVideoUrl));
      setWinnerRevealReady(true);
      return undefined;
    }

    let cancelled = false;
    setWinnerRevealReady(false);

    fetch(drawWinnersUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setWinnerRevealData(normalizeWinnerRevealPayload(payload, winnerRevealVideoUrl));
        setWinnerRevealIssue("");
      })
      .catch((error) => {
        if (cancelled) return;
        setWinnerRevealData(getEmptyWinnerRevealData(winnerRevealVideoUrl));
        setWinnerRevealIssue(t("winnerReveal.dataIssue", { message: error.message }));
      })
      .finally(() => {
        if (!cancelled) setWinnerRevealReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [drawWinnersUrl, t, winnerRevealVideoUrl]);

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
        const snapshot = await fetchFifaQualificationSnapshot();
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
  }, [simulationMode, t]);

  const staticTeamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), []);
  const realtimeRound32Preview = useMemo(
    () => buildRealtimeRound32Preview({ matches: campaignMatches, teams, snapshot: liveQualification }),
    [liveQualification],
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
    () => matches.find((match) => match.id === selectedMatchId)
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
  const remainingRoundTickets = Math.max(0, (activeEntry?.finalTickets ?? 0) - usedRoundTickets);
  const isRealtimeRound32 = simulationMode === "realtime" && activeRoundId === "round32";
  const visibleRoundAllocations = isRealtimeRound32 ? [] : roundAllocations;
  const visibleRoundVoteOutcomes = isRealtimeRound32 ? [] : roundVoteOutcomes;
  const visibleUsedRoundTickets = isRealtimeRound32
    ? 0
    : usedRoundTickets;
  const visibleRemainingRoundTickets = isRealtimeRound32
    ? Math.max(0, activeEntry?.finalTickets ?? 0)
    : remainingRoundTickets;
  const visibleRoundOutcomeSummary = isRealtimeRound32
    ? { lostTickets: 0, winnerTickets: 0, pendingTickets: 0 }
    : roundOutcomeSummary;
  const drawStats = useMemo(
    () => roundDefinitions.map((round) => summarizeRoundDraw(
      round,
      walletAllocations,
      getRoundOutcomeSummary(previewVoteData, round.id),
    )),
    [previewVoteData, walletAllocations],
  );
  const milestoneCurrentValue = milestoneSummary.currentMetricValue ?? (ledger.totalFinalTickets ?? 0);
  const initialDataReady = ledgerReady && milestoneReady && previewVoteReady && winnerRevealReady && authReady;
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
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setTicketAmount((current) => Math.max(1, Math.min(current, Math.max(1, visibleRemainingRoundTickets))));
  }, [visibleRemainingRoundTickets]);

  function handleSelectView(viewId) {
    setActiveViewId(viewId);
    setMobileNavOpen(false);
  }

  function handleSelectRound(roundId) {
    const firstMatch = matches.find((match) => match.roundId === roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulatedRound(roundId) {
    const firstMatch = campaignMatches.find((match) => match.roundId === roundId);
    setSimulationMode("scenario");
    setSimulatedRoundId(roundId);
    setActiveRoundId(roundId);
    setSelectedMatchId(firstMatch?.id ?? selectedMatchId);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
  }

  function handleSelectSimulationMode(nextMode) {
    if (!["scenario", "realtime"].includes(nextMode)) return;
    setSimulationMode(nextMode);
    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);

    if (nextMode === "realtime") {
      const firstRound32Match = matches.find((match) => match.roundId === "round32")
        ?? campaignMatches.find((match) => match.roundId === "round32");
      setSimulatedRoundId("round32");
      setActiveRoundId("round32");
      setSelectedMatchId(firstRound32Match?.id ?? selectedMatchId);
    }
  }

  function handleSelectMatch(matchId) {
    const match = matches.find((entry) => entry.id === matchId);
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

  function redirectToRenaissLogin() {
    if (typeof window === "undefined") return;
    window.location.assign(buildRenaissLoginUrl());
  }

  function handleRequestPreviewVote(amount) {
    if (voteSubmitUrl && authMeUrl && !authSession?.walletAddress) {
      redirectToRenaissLogin();
      return;
    }
    if (!selectedTeamId || remainingRoundTickets <= 0) return;
    setPendingVoteAmount(Math.max(1, Math.min(Math.floor(amount || 0), remainingRoundTickets)));
  }

  function applyLocalPreviewVote({ tickets }) {
    const submittedAt = new Date().toISOString();
    setPreviewAllocations((current) => {
      const existingIndex = current.findIndex((allocation) => (
        allocation.walletAddress === selectedWallet
        && allocation.roundId === activeRoundId
        && allocation.matchId === selectedMatch.id
        && allocation.teamId === selectedTeamId
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
          id: `${selectedWallet}-${selectedMatch.id}-${selectedTeamId}-${Date.now()}`,
          walletAddress: selectedWallet,
          roundId: activeRoundId,
          matchId: selectedMatch.id,
          teamId: selectedTeamId,
          tickets,
          source: "local-preview",
          official: false,
          createdAt: submittedAt,
          updatedAt: submittedAt,
        },
      ];
    });
  }

  async function handleConfirmPreviewVote(amount) {
    if (!selectedTeamId || remainingRoundTickets <= 0) return;
    const tickets = Math.max(1, Math.min(Math.floor(amount || 0), remainingRoundTickets));

    if (voteSubmitUrl) {
      try {
        const response = await fetch(voteSubmitUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...(authMeUrl ? {} : { walletAddress: selectedWallet }),
            roundId: activeRoundId,
            matchId: selectedMatch.id,
            teamId: selectedTeamId,
            tickets,
            requestId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        const normalized = normalizePreviewVotePayload(payload.preview);
        setPreviewVoteData(normalized);
        setPreviewAllocations(normalized.allocations);
        setPreviewVoteIssue("");
      } catch (error) {
        setPreviewVoteIssue(t("data.previewVoteIssue", { message: error.message }));
        if (/login|required|linked/i.test(error.message)) redirectToRenaissLogin();
        setPendingVoteAmount(null);
        return;
      }
    } else {
      applyLocalPreviewVote({ tickets });
    }

    setSelectedTeamId(null);
    setTicketAmount(DEFAULT_TICKET_AMOUNT);
    setPendingVoteAmount(null);
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
        usedRoundTickets={visibleUsedRoundTickets}
        roundAllocations={visibleRoundAllocations}
        roundVoteOutcomes={visibleRoundVoteOutcomes}
        roundOutcomeSummary={visibleRoundOutcomeSummary}
        previewVoteIssue={previewVoteIssue}
        winnerRevealData={winnerRevealData}
        winnerRevealIssue={winnerRevealIssue}
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
        amount={pendingVoteAmount}
        match={selectedMatch}
        team={teamsById.get(selectedTeamId)}
        onCancel={() => setPendingVoteAmount(null)}
        onConfirm={() => handleConfirmPreviewVote(pendingVoteAmount)}
      />
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
