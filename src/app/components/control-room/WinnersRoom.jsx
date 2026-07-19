import {
  Award,
  ChevronDown,
  CirclePlay,
  Dices,
  Download,
  Eye,
  ExternalLink,
  Gift,
  Network,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import revealBackdrop from "../../assets/championship-trophy-renaiss-mark.webp";
import { getMatchPrizeImageByMatchId, preloadRoundPrizeImages } from "../../data/matchPrizeImages";
import { canonicalMatchId } from "../../data/matchIds.js";
import { compactAddress, formatNumber } from "../../data/ticketMath";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import SideRays from "../SideRays/SideRays";

const FALLBACK_ROUND_ORDER = [
  "round32",
  "round16",
  "quarterFinal",
  "semiFinal",
  "final",
];
const LazyDrawOperatorWallet = lazy(() =>
  import("./DrawRoom").then((module) => ({
    default: module.DrawOperatorWallet,
  }))
);
const WINNER_ROUND_LABEL_KEYS = {
  round32: "winnerReveal.roundGroupRound32",
  round16: "winnerReveal.roundGroupRound16",
  quarterFinal: "winnerReveal.roundGroupQuarterFinal",
  semiFinal: "winnerReveal.roundGroupSemiFinal",
  final: "winnerReveal.roundGroupFinal",
};

const FINAL_PRESENTATION_PREVIEW_WALLETS = {
  simulation: "0x000000000000000000000000000000000000d3e0",
  testnet: "0x0000000000000000000000000000000000000097",
};

function buildFinalPresentationPreview(mode, matches, t) {
  if (mode !== "simulation" && mode !== "testnet") return null;
  const finalMatch = matches.find((match) => match.roundId === "final") || null;
  const matchId = finalMatch?.id || "final";
  const ticketNumber = mode === "testnet" ? "TEST-FINAL-097" : "DEMO-FINAL-071";

  return {
    mode,
    winner: {
      id: `final-presentation-${mode}`,
      roundId: "final",
      matchId,
      prizeSlotIndex: 0,
      ticketNumber,
      walletAddress: FINAL_PRESENTATION_PREVIEW_WALLETS[mode],
      profile: {
        displayName: t(`winnerReveal.finalPresentation${mode === "testnet" ? "Testnet" : "Simulation"}Winner`),
      },
    },
    matchLabel: t("winnerReveal.finalPresentationMatchLabel"),
    prizeImage: getMatchPrizeImageByMatchId(matchId, matches, "final"),
  };
}

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

function normalizeHash(value) {
  const hash = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(hash) ? hash : "";
}

function compactHash(value) {
  const hash = normalizeHash(value);
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : "";
}

function bscScanBase(chainId) {
  return String(chainId || "") === "97" ? "https://testnet.bscscan.com" : "https://bscscan.com";
}

function transactionHref(hash, chainId) {
  const txHash = normalizeHash(hash);
  return txHash ? `${bscScanBase(chainId)}/tx/${txHash}` : "";
}

function localApiEndpoint(path) {
  const apiOrigin = String(import.meta.env.VITE_LOCAL_API_ORIGIN || "").replace(/\/$/, "");
  if (!apiOrigin || import.meta.env.PROD) return path;
  return `${apiOrigin}${path}`;
}

function transactionStepLabel(step, t) {
  const key = `winnerReveal.onChainProofStep.${step || "transaction"}`;
  const label = t(key);
  return label === key ? step || t("winnerReveal.onChainProofStep.transaction") : label;
}

function rowTicketNumbers(draw) {
  const rows = Array.isArray(draw?.winners) && draw.winners.length
    ? draw.winners
    : (Array.isArray(draw?.prizeSlots) ? draw.prizeSlots.map((slot) => slot?.winner).filter(Boolean) : []);
  return rows.map((winner) => String(winner?.ticketNumber || "").trim()).filter(Boolean);
}

function buildProofMatchRows({ winnerRevealData, selectedRound, matches }) {
  const selectedRoundId = String(selectedRound?.id || "").trim();
  const matchById = new Map(matches.map((match) => [canonicalMatchId(match.id), match]));
  const proof = winnerRevealData?.proof || {};
  const matchTxById = new Map();

  (Array.isArray(proof.matchTransactions) ? proof.matchTransactions : []).forEach((tx) => {
    const matchId = canonicalMatchId(tx?.matchId);
    if (matchId && normalizeHash(tx?.hash || tx?.transactionHash)) matchTxById.set(matchId, tx);
  });

  (Array.isArray(proof.transactions) ? proof.transactions : []).forEach((tx) => {
    const hash = normalizeHash(tx?.hash || tx?.transactionHash);
    if (!hash || !Array.isArray(tx?.matchIds)) return;
    tx.matchIds.forEach((matchIdValue) => {
      const matchId = canonicalMatchId(matchIdValue);
      if (matchId && !matchTxById.has(matchId)) matchTxById.set(matchId, { ...tx, matchId, hash });
    });
  });

  return (Array.isArray(winnerRevealData?.draws) ? winnerRevealData.draws : [])
    .filter((draw) => {
      const drawRoundId = String(draw?.roundId || draw?.drawRoundId || "").trim();
      return !selectedRoundId || drawRoundId === selectedRoundId;
    })
    .map((draw) => {
      const matchId = canonicalMatchId(draw.matchId);
      const match = matchById.get(matchId) || null;
      const matchTx = matchTxById.get(matchId) || null;
      const transactionHash = normalizeHash(
        draw.transactionHash
          || draw.revealTransactionHash
          || matchTx?.hash
          || matchTx?.transactionHash,
      );
      return {
        matchId,
        label: matchDisplayCode(match, draw.matchId),
        ledgerHash: draw.ledgerHash || "",
        drawRoundId: draw.drawRoundId || draw.roundId || "",
        totalTickets: draw.totalTickets || "",
        prizeSlotCount: draw.prizeSlotCount || 0,
        ticketNumbers: rowTicketNumbers(draw),
        transactionHash,
        transactionStep: matchTx?.step || (transactionHash ? "revealRoundMatches" : ""),
      };
    });
}

function buildRoundProofSummary({ winnerRevealData, selectedRound, selectedActiveWinner, matches }) {
  const selectedRoundId = String(selectedRound?.id || "").trim();
  const proof = winnerRevealData?.proof || {};
  const matchRows = buildProofMatchRows({ winnerRevealData, selectedRound, matches });
  const drawRoundId = String(
    matchRows[0]?.drawRoundId
      || winnerRevealData?.drawRoundId
      || selectedRoundId
      || winnerRevealData?.roundId
      || "",
  ).trim();
  const proofDownloadUrl = String(proof.ledgerDownloadUrl || "").trim();
  const ledgerDownloadHref = proof.ledgerDownloadAvailable === true && /^[A-Za-z0-9_-]+$/.test(drawRoundId)
    ? localApiEndpoint(proofDownloadUrl || `/match-draw-ledgers/${encodeURIComponent(drawRoundId)}.json`)
    : "";
  const roundTransactions = (Array.isArray(proof.roundTransactions) && proof.roundTransactions.length
    ? proof.roundTransactions
    : (Array.isArray(proof.transactions) ? proof.transactions : []).filter((tx) => !Array.isArray(tx.matchIds) || tx.matchIds.length === 0))
    .filter((tx) => normalizeHash(tx?.hash || tx?.transactionHash));

  return {
    roundId: selectedRoundId,
    drawRoundId,
    ledgerHash: winnerRevealData?.ledgerHash || "",
    roundKey: winnerRevealData?.roundKey || "",
    chainId: winnerRevealData?.chainId || "",
    contract: winnerRevealData?.contract || "",
    ledgerDownloadHref,
    roundTransactions,
    matchRows,
    selectedWinner: selectedActiveWinner?.winner || null,
    selectedMatchLabel: selectedActiveWinner?.matchLabel || "",
  };
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

function WinnerOnChainProof({ winnerRevealData, selectedRound, selectedActiveWinner, matches, open, onToggle }) {
  const { t } = useCampaignCopy();
  const proof = useMemo(
    () => buildRoundProofSummary({ winnerRevealData, selectedRound, selectedActiveWinner, matches }),
    [matches, selectedActiveWinner, selectedRound, winnerRevealData],
  );
  const selectedTicketNumber = String(proof.selectedWinner?.ticketNumber || "").trim();
  const hasMatchRows = proof.matchRows.length > 0;

  if (!hasMatchRows) return null;

  return (
    <section className={open ? "winner-proof is-open" : "winner-proof"} aria-label={t("winnerReveal.onChainProofAria")}>
      <button
        type="button"
        className="winner-proof__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ShieldCheck size={15} strokeWidth={2.3} />
        <span>{t("winnerReveal.onChainProofButton")}</span>
        {proof.ledgerHash ? <code>{compactHash(proof.ledgerHash)}</code> : null}
        <ChevronDown size={15} strokeWidth={2.3} aria-hidden="true" />
      </button>

      {open ? (
        <div className="winner-proof__panel">
          <header className="winner-proof__head">
            <strong>{t("winnerReveal.onChainProofTitle", { round: selectedRound?.label || "" })}</strong>
            <p>{t("winnerReveal.onChainProofBody")}</p>
          </header>

          <div className="winner-proof__summary">
            <span>
              <em>{t("winnerReveal.onChainProofLedgerHash")}</em>
              <code>{proof.ledgerHash || "-"}</code>
            </span>
            <span>
              <em>{t("winnerReveal.onChainProofRoundKey")}</em>
              <code>{proof.roundKey || "-"}</code>
            </span>
            {proof.ledgerDownloadHref ? (
              <a href={proof.ledgerDownloadHref} download>
                <Download size={14} strokeWidth={2.3} />
                {t("winnerReveal.onChainProofDownloadLedger")}
              </a>
            ) : null}
          </div>

          <p className="winner-proof__explain">
            {selectedTicketNumber
              ? t("winnerReveal.onChainProofTicketExample", {
                ticket: selectedTicketNumber,
                match: proof.selectedMatchLabel || proof.selectedWinner?.matchId || "",
              })
              : t("winnerReveal.onChainProofTicketBody")}
          </p>

          {proof.roundTransactions.length > 0 ? (
            <section className="winner-proof__tx-group" aria-label={t("winnerReveal.onChainProofRoundTxAria")}>
              <span>{t("winnerReveal.onChainProofRoundTxTitle")}</span>
              <div>
                {proof.roundTransactions.map((tx) => {
                  const href = transactionHref(tx.hash || tx.transactionHash, proof.chainId);
                  return (
                    <a href={href} target="_blank" rel="noreferrer" key={tx.id || tx.hash}>
                      {transactionStepLabel(tx.step, t)}
                      <code>{compactHash(tx.hash || tx.transactionHash)}</code>
                      <ExternalLink size={13} strokeWidth={2.3} />
                    </a>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="winner-proof__matches" aria-label={t("winnerReveal.onChainProofMatchTxAria")}>
            <span>{t("winnerReveal.onChainProofMatchTxTitle")}</span>
            <div className="winner-proof__match-list">
              {proof.matchRows.map((row) => {
                const href = transactionHref(row.transactionHash, proof.chainId);
                return (
                  <article className="winner-proof__match-row" key={row.matchId}>
                    <span>
                      <strong>{row.label}</strong>
                      <em>{t("winnerReveal.onChainProofTickets", { tickets: row.ticketNumbers.map((ticket) => `#${ticket}`).join(", ") || "-" })}</em>
                    </span>
                    <span className="winner-proof__match-hash">
                      <em>{t("winnerReveal.onChainProofMatchLedgerHash")}</em>
                      <code>{compactHash(row.ledgerHash) || "-"}</code>
                    </span>
                    {href ? (
                      <a className="winner-proof__match-tx" href={href} target="_blank" rel="noreferrer">
                        <em>{t("winnerReveal.onChainProofRevealTx")}</em>
                        <span>
                          <code>{compactHash(row.transactionHash)}</code>
                          <ExternalLink size={13} strokeWidth={2.3} />
                        </span>
                      </a>
                    ) : (
                      <small>{t("winnerReveal.onChainProofTxUnavailable")}</small>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function WinnersFinalDrawControl({
  activeDraw,
  canSwitchNetwork,
  hasOfficialResult,
  onPresentationPreview,
  onPresentationReset,
}) {
  const { t } = useCampaignCopy();
  const [open, setOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState("mainnet");
  const [simulationPhase, setSimulationPhase] = useState("idle");

  const handleSimulationPhaseChange = useCallback((phase) => {
    setSimulationPhase(phase);
    if (phase === "complete") onPresentationPreview?.("simulation", { scroll: false });
  }, [onPresentationPreview]);

  const handlePresentationReady = useCallback((mode) => {
    onPresentationPreview?.(mode, {
      scroll: mode === "mainnet",
      waitForRefresh: mode === "mainnet",
    });
  }, [onPresentationPreview]);

  const handleExecutionModeChange = useCallback((mode) => {
    setExecutionMode(mode);
    setSimulationPhase("idle");
    onPresentationReset?.();
  }, [onPresentationReset]);

  if (!activeDraw) return null;

  const modeLabel =
    executionMode === "testnet"
      ? t("draw.operatorModeTestnet")
      : executionMode === "simulation"
      ? simulationPhase === "complete"
        ? t("draw.operatorSimulationStatusComplete")
        : simulationPhase === "mixing" || simulationPhase === "revealing"
        ? t("draw.operatorSimulationStatusRunning")
        : t("draw.operatorModeSimulation")
      : t("draw.operatorModeMainnet");
  const presentationPreviewDisabled = executionMode === "mainnet" && !hasOfficialResult;

  return (
    <section
      className={`${
        open ? "winner-final-draw is-open" : "winner-final-draw"
      } is-mode-${executionMode}`}
      aria-label={t("winnerReveal.finalDrawAria")}
    >
      <header className="winner-final-draw__head">
        <span className="winner-final-draw__copy">
          <small>{t("winnerReveal.finalDrawEyebrow")}</small>
          <strong>{t("winnerReveal.finalDrawTitle")}</strong>
          <p>{t("winnerReveal.finalDrawBody")}</p>
        </span>
        <span className="winner-final-draw__controls">
          <span
            className="winner-final-draw__mode"
            aria-label={t("draw.operatorModeCurrent")}
          >
            {executionMode === "simulation" ? (
              <Dices size={15} strokeWidth={2.15} />
            ) : (
              <Network size={15} strokeWidth={2.15} />
            )}
            <span>
              <small>{t("draw.operatorModeCurrent")}</small>
              <strong>{modeLabel}</strong>
            </span>
          </span>
          <button
            type="button"
            className="winner-final-draw__preview"
            disabled={presentationPreviewDisabled}
            onClick={() => onPresentationPreview?.(executionMode, { scroll: true })}
          >
            <Eye size={16} strokeWidth={2.25} />
            {presentationPreviewDisabled
              ? t("winnerReveal.finalPresentationMainnetPending")
              : t("winnerReveal.finalPresentationPreviewButton")}
          </button>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <Award size={16} strokeWidth={2.35} />
            {open
              ? t("winnerReveal.finalDrawClose")
              : t("winnerReveal.finalDrawOpen")}
            <ChevronDown size={15} strokeWidth={2.35} aria-hidden="true" />
          </button>
        </span>
      </header>
      {open ? (
        <div className="winner-final-draw__panel">
          <Suspense
            fallback={
              <p className="winner-final-draw__loading">
                {t("winnerReveal.finalDrawLoading")}
              </p>
            }
          >
            <LazyDrawOperatorWallet
              activeDraw={activeDraw}
              t={t}
              canSwitchNetwork={canSwitchNetwork}
              executionMode={executionMode}
              onExecutionModeChange={handleExecutionModeChange}
              onSimulationPhaseChange={handleSimulationPhaseChange}
              onPresentationReady={handlePresentationReady}
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}

export function WinnersRoom({
  activeRoundId = "",
  winnerRevealData,
  winnerRevealIssue,
  rounds = [],
  matches = [],
  currentWalletAddress = "",
  canViewFinalDraw = false,
  canSwitchDrawNetwork = false,
  finalDraw = null,
  onRevealStateChange,
}) {
  const { t, roundLabel } = useCampaignCopy();
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const [videoFinished, setVideoFinished] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [mediaIssue, setMediaIssue] = useState("");
  const [selectedWinnerId, setSelectedWinnerId] = useState("");
  const [proofOpen, setProofOpen] = useState(false);
  const [finalPresentationPreviewMode, setFinalPresentationPreviewMode] = useState("");
  const [finalPresentationReplayKey, setFinalPresentationReplayKey] = useState(0);
  const [pendingMainnetPresentation, setPendingMainnetPresentation] = useState(null);
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
  const activeRound = roundOptions.find(
    (option) => option.id === activeRoundId
  );
  const selectedRound = activeRound
    ? activeRound
    : roundOptions.find((option) => option.id === latestRevealedRoundId) ||
      roundOptions[0] ||
      null;
  const showFinalDrawControl = Boolean(
    canViewFinalDraw && activeRoundId === "final" && finalDraw?.id === "final"
  );
  const selectedWinnerRevealData = useMemo(() => {
    const selectedRoundId = String(selectedRound?.id || "").trim();
    if (!selectedRoundId) return winnerRevealData;
    return (Array.isArray(winnerRevealData.roundSnapshots) ? winnerRevealData.roundSnapshots : [])
      .find((snapshot) => [snapshot?.roundId, snapshot?.sourceRoundId, snapshot?.drawRoundId]
        .map((value) => String(value || "").trim())
        .includes(selectedRoundId)) || winnerRevealData;
  }, [selectedRound?.id, winnerRevealData]);
  const selectedRoundWinners = selectedRound?.winners || [];
  const selectedRoundHasWinners = hasOfficialWinners && selectedRoundWinners.length > 0;
  const finalPresentationPreview = useMemo(
    () => buildFinalPresentationPreview(finalPresentationPreviewMode, matches, t),
    [finalPresentationPreviewMode, matches, t],
  );
  const displayedRoundWinners = finalPresentationPreview ? [finalPresentationPreview] : selectedRoundWinners;
  const displayedRoundHasWinners = Boolean(finalPresentationPreview || selectedRoundHasWinners);
  const officialPresentationFingerprint = useMemo(
    () => [
      winnerRevealData.drawId,
      winnerRevealData.generatedAt,
      ...selectedRoundWinners.map(({ winner }) => winner.id),
    ].join("|"),
    [selectedRoundWinners, winnerRevealData.drawId, winnerRevealData.generatedAt],
  );
  const selectedRoundCurrentUserWinnerCount = useMemo(() => {
    if (finalPresentationPreview || !selectedRoundHasWinners || !currentWalletAddress) return 0;
    return selectedRoundWinners.filter(({ winner }) => isCurrentUserWinner(winner, currentWalletAddress)).length;
  }, [currentWalletAddress, finalPresentationPreview, selectedRoundHasWinners, selectedRoundWinners]);
  const autoActiveRowIndex = displayedRoundHasWinners
    ? Math.max(0, Math.min(visibleCount - 1, displayedRoundWinners.length - 1))
    : -1;
  const manuallySelectedRowIndex = displayedRoundHasWinners && selectedWinnerId
    ? displayedRoundWinners.findIndex(({ winner }) => winner.id === selectedWinnerId)
    : -1;
  const proofSelectedRowIndex = manuallySelectedRowIndex >= 0 ? manuallySelectedRowIndex : autoActiveRowIndex;
  const selectedActiveWinner = displayedRoundHasWinners
    ? displayedRoundWinners[proofSelectedRowIndex] || displayedRoundWinners[0] || null
    : null;
  const showPrizeCard = revealStarted && Boolean(selectedActiveWinner);
  const activePrizeImage = selectedActiveWinner?.prizeImage || getMatchPrizeImageByMatchId("", matches, selectedRound?.id);
  const activePrizeMatchLabel = selectedActiveWinner?.matchLabel || selectedRound?.label || "";
  const activePrizeTitle = activePrizeMatchLabel
    ? finalPresentationPreview
      ? t("winnerReveal.finalPresentationPrizeTitle")
      : t("winnerReveal.cardPrizeMatchTitle", { match: activePrizeMatchLabel })
    : t("winnerReveal.cardPrizeTitle");

  const showFinalPresentation = useCallback((mode, { scroll = true, waitForRefresh = false } = {}) => {
    if (mode === "mainnet") {
      if (waitForRefresh) {
        setPendingMainnetPresentation({
          baseline: officialPresentationFingerprint,
          scroll,
        });
        return;
      }
      if (!selectedRoundHasWinners) return;
      setFinalPresentationPreviewMode("");
      setPendingMainnetPresentation(null);
    } else if (mode === "simulation" || mode === "testnet") {
      setFinalPresentationPreviewMode(mode);
      setPendingMainnetPresentation(null);
    } else {
      return;
    }

    setFinalPresentationReplayKey((current) => current + 1);
    setVideoFinished(true);
    setVisibleCount(0);
    setSelectedWinnerId("");
    setProofOpen(false);

    if (!scroll || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const presentation = document.querySelector(".winner-stage-primary");
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      presentation?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }, [officialPresentationFingerprint, selectedRoundHasWinners]);

  useEffect(() => {
    preloadRoundPrizeImages(selectedRound?.id);
  }, [selectedRound?.id]);

  useEffect(() => {
    setVideoFinished(false);
    setVisibleCount(0);
    setMediaIssue("");
    setSelectedWinnerId("");
    setProofOpen(false);
    setFinalPresentationPreviewMode("");
  }, [winnerRevealData.videoUrl, winnerRevealData.drawId, winnerRevealData.generatedAt]);

  useEffect(() => {
    setProofOpen(false);
    if (selectedRound?.id !== "final") {
      setFinalPresentationPreviewMode("");
      setPendingMainnetPresentation(null);
    }
  }, [selectedRound?.id]);

  useEffect(() => {
    if (
      !pendingMainnetPresentation
      || !selectedRoundHasWinners
      || officialPresentationFingerprint === pendingMainnetPresentation.baseline
    ) return;

    showFinalPresentation("mainnet", { scroll: pendingMainnetPresentation.scroll });
  }, [
    officialPresentationFingerprint,
    pendingMainnetPresentation,
    selectedRoundHasWinners,
    showFinalPresentation,
  ]);

  useEffect(() => {
    onRevealStateChange?.(revealStarted);
  }, [onRevealStateChange, revealStarted]);

  useEffect(() => () => {
    onRevealStateChange?.(false);
  }, [onRevealStateChange]);

  useEffect(() => {
    if (!revealStarted || !displayedRoundHasWinners) {
      setVisibleCount(0);
      setSelectedWinnerId("");
      return undefined;
    }

    if (listRef.current) listRef.current.scrollTop = 0;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisibleCount(displayedRoundWinners.length);
      return undefined;
    }

    setVisibleCount(0);
    setSelectedWinnerId("");
    const intervalId = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(displayedRoundWinners.length, current + 1);
        if (next >= displayedRoundWinners.length) window.clearInterval(intervalId);
        return next;
      });
    }, 560);

    return () => window.clearInterval(intervalId);
  }, [
    displayedRoundHasWinners,
    displayedRoundWinners.length,
    finalPresentationPreviewMode,
    finalPresentationReplayKey,
    revealStarted,
    selectedRound?.id,
  ]);

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
        className={[
          "winner-stage-reveal",
          showPrizeCard ? "has-prize-card" : "",
          showFinalDrawControl ? "has-final-draw-control" : "",
        ].filter(Boolean).join(" ")}
        aria-live="polite"
        aria-hidden={!revealStarted}
      >
        <div className="winner-stage-primary">
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
            {finalPresentationPreview ? (
              <section className="winner-final-presentation-notice" aria-label={t("winnerReveal.finalPresentationPreviewAria")}>
                <span>
                  <Eye size={15} strokeWidth={2.25} />
                  <strong>{t("winnerReveal.finalPresentationPreviewNotice", {
                    mode: finalPresentationPreview.mode === "testnet"
                      ? t("draw.operatorModeTestnet")
                      : t("draw.operatorModeSimulation"),
                  })}</strong>
                </span>
                <p>{t("winnerReveal.finalPresentationPreviewBody")}</p>
              </section>
            ) : null}
            {selectedRoundCurrentUserWinnerCount > 0 ? (
              <section className="winner-current-user-callout" aria-label={t("winnerReveal.currentUserAria")}>
                <Sparkles size={16} strokeWidth={2.35} />
                <span>{t("winnerReveal.currentUserWinner", { count: formatNumber(selectedRoundCurrentUserWinnerCount) })}</span>
              </section>
            ) : null}
            {displayedRoundHasWinners ? (
              <section
                ref={listRef}
                className={displayedRoundWinners.length > 9 ? "winner-reveal-list winner-reveal-list--dense" : "winner-reveal-list"}
                aria-label={t("winnerReveal.selectedRoundListAria", { round: selectedRound?.label || "" })}
              >
                <section className="winner-round-group" aria-label={selectedRound?.label || t("winnerReveal.unknownRound")}>
                  <header className="winner-round-group__head">
                    <span>{selectedRound?.label || t("winnerReveal.unknownRound")}</span>
                    <em>{t("winnerReveal.roundGroupCount", { count: formatNumber(displayedRoundWinners.length) })}</em>
                  </header>
                  <ol>
                    {displayedRoundWinners.map(({ winner, matchLabel, prizeImage }, index) => (
                      <WinnerRevealRow
                        winner={winner}
                        index={index}
                        matchLabel={matchLabel}
                        prizeImage={prizeImage}
                        currentUser={!finalPresentationPreview && isCurrentUserWinner(winner, currentWalletAddress)}
                        visible={index < visibleCount}
                        selected={index === proofSelectedRowIndex}
                        active={index === proofSelectedRowIndex}
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
            {finalPresentationPreview ? (
              <section className="winner-proof winner-proof--preview" aria-label={t("winnerReveal.finalPresentationProofReserved")}>
                <span>
                  <ShieldCheck size={15} strokeWidth={2.3} />
                  <strong>{t("winnerReveal.finalPresentationProofReserved")}</strong>
                </span>
                <p>{t("winnerReveal.finalPresentationProofPreviewBody")}</p>
              </section>
            ) : selectedRoundHasWinners ? (
              <WinnerOnChainProof
                winnerRevealData={selectedWinnerRevealData}
                selectedRound={selectedRound}
                selectedActiveWinner={selectedActiveWinner}
                matches={matches}
                open={proofOpen}
                onToggle={() => setProofOpen((current) => !current)}
              />
            ) : null}
          </section>
        </div>

        {showFinalDrawControl ? (
          <div className="winner-final-draw-zone">
            <WinnersFinalDrawControl
              activeDraw={finalDraw}
              canSwitchNetwork={canSwitchDrawNetwork}
              hasOfficialResult={selectedRoundHasWinners}
              onPresentationPreview={showFinalPresentation}
              onPresentationReset={() => setFinalPresentationPreviewMode("")}
            />
          </div>
        ) : null}
      </section>

      {mediaIssue || winnerRevealIssue ? (
        <p className="winner-stage-issue">{mediaIssue || winnerRevealIssue}</p>
      ) : null}
    </section>
  );
}
