import {
  AlertTriangle,
  Award,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LockKeyhole,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatedContent } from "../AnimatedContent";
import { GlareHover } from "../GlareHover";
import { Magnet } from "../Magnet";
import { compactAddress, formatNumber, formatPercent } from "../../data/ticketMath";
import { getMatchPrizeImage, preloadRoundPrizeImages } from "../../data/matchPrizeImages";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { fetchJsonWithTimeout } from "../../utils/httpClient";
import { getLegacyWalletProviders, normalizeWalletProviders } from "../../utils/walletProviders";

const drawStepIds = ["results", "eligible", "snapshot", "reveal"];
const fallbackDrawNetworks = [
  { key: "mainnet", label: "BNB Chain", chainId: "56", chainIdHex: "0x38" },
  { key: "testnet", label: "BNB Testnet", chainId: "97", chainIdHex: "0x61" },
];
const defaultDrawNetworkKey = normalizeDrawNetworkKey(import.meta.env.VITE_DRAW_NETWORK || "mainnet");
const drawAdminCheckTimeoutMs = 60000;
const drawAdminBroadcastTimeoutMs = 14 * 60 * 1000;

function drawAdminEndpoint(path) {
  const apiOrigin = String(import.meta.env.VITE_DRAW_ADMIN_API_ORIGIN || import.meta.env.VITE_LOCAL_API_ORIGIN || "").replace(/\/$/, "");
  if (!apiOrigin || import.meta.env.PROD) return path;
  return `${apiOrigin}${path}`;
}

function drawAdminStatusEndpoint(networkKey, roundId, drawRoundId = roundId) {
  const params = new URLSearchParams();
  if (networkKey) params.set("network", networkKey);
  if (roundId) params.set("roundId", roundId);
  if (drawRoundId && drawRoundId !== roundId) params.set("drawRoundId", drawRoundId);
  const query = params.toString();
  return drawAdminEndpoint(`/api/draw-admin/status${query ? `?${query}` : ""}`);
}

function normalizeRedrawAttempt(value) {
  const number = Number(value || 1);
  if (!Number.isFinite(number)) return 1;
  return Math.min(999, Math.max(1, Math.floor(number)));
}

function drawRoundIdFor(baseRoundId, redrawEnabled, redrawAttempt) {
  const sourceRoundId = String(baseRoundId || "").trim();
  if (!sourceRoundId || !redrawEnabled) return sourceRoundId;
  return `${sourceRoundId}-redraw-${normalizeRedrawAttempt(redrawAttempt)}`;
}

export function preloadRoomAssets() {
  return Promise.resolve();
}

function getActiveDrawStep(status) {
  if (status === "revealed") return 3;
  if (status === "snapshot_ready") return 2;
  if (status === "eligible_ready") return 1;
  return 0;
}

function getDrawStateCopy(activeDraw, t) {
  if (activeDraw.drawStatusResolved === "revealed") {
    return {
      tone: "revealed",
      Icon: CheckCircle2,
      eyebrow: t("draw.winnersRevealed"),
      title: t("draw.completeTitle"),
      body: t("draw.completeBody"),
    };
  }

  if (activeDraw.drawStatusResolved === "snapshot_ready") {
    return {
      tone: "snapshot",
      Icon: ShieldCheck,
      eyebrow: t("draw.snapshotReady"),
      title: t("draw.snapshotTitle"),
      body: t("draw.snapshotBody"),
    };
  }

  if (activeDraw.eligibleEntries > 0 || activeDraw.drawStatusResolved === "eligible_ready") {
    return {
      tone: "eligible",
      Icon: Award,
      eyebrow: t("draw.eligiblePoolLive"),
      title: t("draw.eligibleTitle"),
      body: t("draw.eligibleBody"),
    };
  }

  if (activeDraw.pendingEntries > 0) {
    return {
      tone: "pending",
      Icon: Clock3,
      eyebrow: t("draw.waitingResults"),
      title: t("draw.waitingTitle"),
      body: t("draw.waitingBody"),
    };
  }

  return {
    tone: "locked",
    Icon: LockKeyhole,
    eyebrow: t("draw.noEligible"),
    title: t("draw.noEligibleTitle"),
    body: t("draw.noEligibleBody"),
  };
}

function matchDisplayCode(match) {
  return String(match?.displayCode || match?.id || "").toUpperCase();
}

function PrizeSlots({ count, active, stateTone, t }) {
  return (
    <ol className="prize-slots" aria-label={t("draw.prizeSlotsAria", { count: formatNumber(count) })}>
      {Array.from({ length: count }, (_, index) => (
        <AnimatedContent
          as="li"
          className={[active ? "is-active" : "", `is-${stateTone}`].filter(Boolean).join(" ")}
          delay={index * 0.012}
          distance={10}
          duration={0.32}
          key={`slot-${index + 1}`}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
        </AnimatedContent>
      ))}
    </ol>
  );
}

function ResultTable({ matches, teamsById, copy }) {
  const { teamName, t } = copy;

  return (
    <section className="draw-results" aria-label={t("draw.resultTableAria")}>
      <header>
        <span>{t("draw.advancingResults")}</span>
        <strong>{t("draw.officialOnly")}</strong>
      </header>
      <table>
        <thead>
          <tr>
            <th>{t("common.match")}</th>
            <th>{t("draw.teams")}</th>
            <th>{t("common.status")}</th>
            <th>{t("common.advancing")}</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const [left, right] = match.teams.map((teamId) => teamsById.get(teamId));
            const isFinal = match.status === "official_final";
            const advancing = match.advancingTeamId ? teamName(teamsById.get(match.advancingTeamId)) : t("draw.pending");
            return (
              <tr className={isFinal ? "is-final" : "is-pending"} key={match.id}>
                <td>{matchDisplayCode(match)}</td>
                <td>{teamName(left)} / {teamName(right)}</td>
                <td>{isFinal ? match.score || t("common.final") : t("draw.pendingFinal")}</td>
                <td>{advancing}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function UserDrawStatus({ activeDraw, t }) {
  const eligibleEntries = activeDraw.userEligibleEntries ?? activeDraw.eligibleEntries;
  const pendingEntries = activeDraw.userPendingEntries ?? activeDraw.pendingEntries;
  const lostEntries = activeDraw.userLostEntries ?? activeDraw.lostEntries;
  const hasEligible = eligibleEntries > 0;
  const hasPending = pendingEntries > 0;
  const hasLost = lostEntries > 0;
  const status = hasEligible ? t("draw.eligibleBeforeReveal") : hasPending ? t("draw.pendingResult") : t("draw.notEligibleYet");
  const reason = hasEligible
    ? t("draw.correctOfficial")
    : hasPending
      ? t("draw.previewWait")
      : t("draw.noWinningAllocation");

  return (
    <section className="user-draw-status" aria-label={t("draw.userDrawAria")}>
      <header>
        <span>{t("draw.userDrawCenter")}</span>
        <strong>{status}</strong>
      </header>
      <p>{reason}</p>
      <dl>
        <dt>{t("draw.eligibleEntries")}</dt>
        <dd>{formatNumber(eligibleEntries)}</dd>
        <dt>{t("common.totalPool")}</dt>
        <dd>{formatNumber(activeDraw.totalPoolEntries)}</dd>
        <dt>{t("draw.estimatedChance")}</dt>
        <dd>{formatPercent(activeDraw.estimatedChance)}</dd>
        <dt>{t("draw.lostEntries")}</dt>
        <dd>{hasLost ? formatNumber(lostEntries) : "0"}</dd>
        <dt>{t("draw.revealStatus")}</dt>
        <dd>{activeDraw.drawStatusResolved === "revealed" ? t("draw.revealed") : t("draw.awaitingReveal")}</dd>
        <dt>{t("draw.wonNotWon")}</dt>
        <dd>{activeDraw.drawStatusResolved === "revealed" ? t("draw.notWon") : t("draw.pendingReveal")}</dd>
        <dt>{t("common.auditReference")}</dt>
        <dd>{activeDraw.drawStatusResolved === "revealed" ? "demo-audit-ref" : t("draw.snapshotNotRevealed")}</dd>
      </dl>
    </section>
  );
}

function DrawReadinessDeck({ activeDraw, t }) {
  const finalsComplete = activeDraw.officialFinalCount >= activeDraw.matchCount;
  const revealReady = ["snapshot_ready", "revealed"].includes(activeDraw.drawStatusResolved);
  const cards = [
    {
      id: "finals",
      tone: finalsComplete ? "ready" : "pending",
      Icon: finalsComplete ? ShieldCheck : Clock3,
      label: t("draw.officialFinals"),
      value: `${formatNumber(activeDraw.officialFinalCount)}/${formatNumber(activeDraw.matchCount)}`,
      detail: finalsComplete ? t("draw.eligibilityCanLock") : t("draw.waitingMatchResults"),
    },
    {
      id: "eligible",
      tone: activeDraw.eligibleEntries > 0 ? "eligible" : "quiet",
      Icon: Award,
      label: t("draw.eligibleEntries"),
      value: formatNumber(activeDraw.eligibleEntries),
      detail: t("draw.correctPicksOnly"),
    },
    {
      id: "pending",
      tone: activeDraw.pendingEntries > 0 ? "pending" : "quiet",
      Icon: CircleDashed,
      label: t("draw.pendingEntries"),
      value: formatNumber(activeDraw.pendingEntries),
      detail: t("draw.awaitingFinals"),
    },
    {
      id: "prizes",
      tone: "prize",
      Icon: Award,
      label: t("draw.roundPrizes"),
      value: formatNumber(activeDraw.prizeCount),
      detail: t("draw.winnerSlots"),
    },
    {
      id: "boundary",
      tone: revealReady ? "snapshot" : "locked",
      Icon: revealReady ? ShieldCheck : LockKeyhole,
      label: t("draw.revealLayer"),
      value: revealReady ? t("draw.snapshot") : t("draw.notWired"),
      detail: t("draw.contractOutsideBuild"),
    },
  ];

  return (
    <section className="draw-readiness-deck" aria-label={t("draw.readinessAria")}>
      {cards.map((card, index) => {
        const Icon = card.Icon;
        return (
          <AnimatedContent as="article" className={`draw-readiness-card is-${card.tone}`} delay={index * 0.025} distance={8} key={card.id}>
            <span>
              <Icon size={16} strokeWidth={2.25} />
              {card.label}
            </span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </AnimatedContent>
        );
      })}
    </section>
  );
}

function RoundDrawLedger({ drawStats, activeDraw, onSelectRound, copy }) {
  const { roundLabel, t } = copy;

  return (
    <section className="round-draw-ledger" aria-label={t("draw.roundLedgerAria")}>
      <header>
        <span>
          <RefreshCw size={16} strokeWidth={2.25} />
          {t("draw.roundLedgerTitle")}
        </span>
        <strong>{t("draw.roundLedgerReset")}</strong>
      </header>
      <ol>
        {drawStats.map((round, index) => {
          const roundState = getDrawStateCopy(round, t);
          const isActive = round.id === activeDraw.id;
          const stagedEntries = round.eligibleEntries + round.pendingEntries;
          const entryCopy = round.eligibleEntries > 0
            ? t("draw.roundLedgerReady", { entries: formatNumber(round.eligibleEntries) })
            : round.pendingEntries > 0
              ? t("draw.roundLedgerPending", { entries: formatNumber(round.pendingEntries) })
              : t("draw.roundLedgerQuiet");

          return (
            <AnimatedContent as="li" key={round.id} delay={index * 0.026} distance={10}>
              <Magnet
                as="button"
                className={[
                  "round-draw-ledger__card",
                  isActive ? "is-active" : "",
                  `is-${roundState.tone}`,
                ].filter(Boolean).join(" ")}
                type="button"
                strength={58}
                aria-current={isActive ? "step" : undefined}
                aria-label={t("draw.roundLedgerButtonAria", {
                  round: roundLabel(round, "advanceLabel"),
                  state: roundState.eyebrow,
                })}
                onClick={() => onSelectRound(round.id)}
              >
                <span className="round-draw-ledger__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="round-draw-ledger__copy">
                  <strong>{roundLabel(round, "advanceLabel")}</strong>
                  <small>{t("draw.roundLedgerFinals", {
                    finals: formatNumber(round.officialFinalCount),
                    matches: formatNumber(round.matchCount),
                  })}</small>
                </span>
                <dl>
                  <div>
                    <dt>{t("draw.roundPrizes")}</dt>
                    <dd>{formatNumber(round.prizeCount)}</dd>
                  </div>
                  <div>
                    <dt>{t("draw.roundLedgerEntries")}</dt>
                    <dd>{formatNumber(stagedEntries)}</dd>
                  </div>
                  <div>
                    <dt>{t("draw.estimatedChance")}</dt>
                    <dd>{formatPercent(round.estimatedChance)}</dd>
                  </div>
                </dl>
                <em>{entryCopy}</em>
              </Magnet>
            </AnimatedContent>
          );
        })}
      </ol>
      <p>{t("draw.roundLedgerBoundary")}</p>
    </section>
  );
}

function DrawRoundRail({ drawStats, activeDraw, simulatedRoundId, onSelectRound, copy }) {
  const { roundLabel, t } = copy;
  const simulatedIndex = Math.max(0, drawStats.findIndex((round) => round.id === simulatedRoundId));

  return (
    <aside className="draw-round-rail" aria-label={t("draw.roundsAria")}>
      <header>
        <span>{t("draw.roundPools")}</span>
        <strong>{t("draw.winnersEach", { count: formatNumber(activeDraw.prizeCount) })}</strong>
      </header>
      <ol>
        {drawStats.map((round, index) => {
          const isActive = round.id === activeDraw.id;
          const canInspect = index <= simulatedIndex;
          const stagedEntries = round.eligibleEntries + round.pendingEntries;
          const roundState = getDrawStateCopy(round, t);

          return (
            <li key={round.id} className={[isActive ? "is-active" : "", canInspect ? "is-inspectable" : "is-future-locked"].filter(Boolean).join(" ")}>
              <Magnet
                as="button"
                type="button"
                className={`draw-round-rail__button is-${roundState.tone}`}
                strength={42}
                disabled={!canInspect}
                onClick={() => onSelectRound(round.id)}
                aria-current={isActive ? "step" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{roundLabel(round)}</strong>
                <small>{canInspect ? `${formatNumber(stagedEntries)} ${t("common.entries")}` : t("roundRail.futureLocked")}</small>
              </Magnet>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function DrawProgressMap({ activeDraw, activeStep, drawState, t }) {
  const settledPercent = Math.min(100, Math.round((activeDraw.officialFinalCount / Math.max(1, activeDraw.matchCount)) * 100));
  const eligiblePercent = Math.min(100, Math.round((activeDraw.eligibleEntries / Math.max(1, activeDraw.eligibleEntries + activeDraw.pendingEntries)) * 100));
  const DrawStateIcon = drawState.Icon;

  return (
    <section className={`draw-progress-map is-${drawState.tone}`} aria-label={t("draw.progressMap")}>
      <header>
        <span>
          <DrawStateIcon size={17} strokeWidth={2.25} />
          {drawState.eyebrow}
        </span>
        <h2>{drawState.title}</h2>
        <p>{drawState.body}</p>
      </header>

      <section className="draw-progress-map__meters">
        <article>
          <span>{t("draw.officialFinals")}</span>
          <strong>{formatNumber(activeDraw.officialFinalCount)} / {formatNumber(activeDraw.matchCount)}</strong>
          <i style={{ "--progress": `${settledPercent}%` }} aria-hidden="true" />
        </article>
        <article>
          <span>{t("draw.eligibleEntries")}</span>
          <strong>{formatNumber(activeDraw.eligibleEntries)}</strong>
          <i style={{ "--progress": `${eligiblePercent}%` }} aria-hidden="true" />
        </article>
        <article>
          <span>{t("draw.roundPrizes")}</span>
          <strong>{formatNumber(activeDraw.prizeCount)}</strong>
          <i style={{ "--progress": "100%" }} aria-hidden="true" />
        </article>
      </section>

      <ol className="draw-step-runway" aria-label={t("draw.pipelineAria")}>
        {drawStepIds.map((stepId, index) => (
          <li className={index <= activeStep ? "is-active" : ""} key={stepId} aria-current={index === activeStep ? "step" : undefined}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{t(`draw.steps.${stepId}`)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function normalizeChainId(value) {
  if (typeof value === "number") return `0x${value.toString(16)}`;
  const chainId = String(value || "").trim().toLowerCase();
  if (!chainId) return "";
  if (chainId.startsWith("0x")) return chainId;
  const numeric = Number(chainId);
  return Number.isFinite(numeric) ? `0x${numeric.toString(16)}` : chainId;
}

function normalizeDrawNetworkKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || key === "mainnet" || key === "bsc" || key === "bnb" || key === "56" || key === "0x38") return "mainnet";
  if (key === "testnet" || key === "bsc-testnet" || key === "bnb-testnet" || key === "97" || key === "0x61") return "testnet";
  return "mainnet";
}

function drawNetworkOptions(adminStatus) {
  const networks = Array.isArray(adminStatus?.networks) && adminStatus.networks.length > 0
    ? adminStatus.networks
    : fallbackDrawNetworks;
  const seen = new Set();
  return networks
    .map((network) => ({
      ...network,
      key: normalizeDrawNetworkKey(network?.key || network?.chainId || network?.chainIdHex),
      label: network?.label || (normalizeChainId(network?.chainIdHex || network?.chainId) === "0x61" ? "BNB Testnet" : "BNB Chain"),
    }))
    .filter((network) => {
      if (seen.has(network.key)) return false;
      seen.add(network.key);
      return true;
    });
}

function selectedDrawNetwork(adminStatus, selectedNetworkKey) {
  const key = normalizeDrawNetworkKey(selectedNetworkKey);
  return drawNetworkOptions(adminStatus).find((network) => network.key === key) || fallbackDrawNetworks[0];
}

function statusForSelectedNetwork(adminStatus, selectedNetworkKey) {
  if (!adminStatus) return null;
  const selectedNetwork = selectedDrawNetwork(adminStatus, selectedNetworkKey);
  return {
    ...adminStatus,
    ...selectedNetwork,
    networkKey: selectedNetwork.key,
  };
}

function chainLabel(chainId, t) {
  const normalized = normalizeChainId(chainId);
  if (!normalized) return t("draw.operatorWalletChainUnknown");
  if (normalized === "0x38") return "BNB Chain";
  if (normalized === "0x61") return "BNB Testnet";
  return normalized;
}

function drawNetworkLabel(network, t) {
  return network?.label || chainLabel(network?.chainIdHex || network?.chainId, t);
}

function drawNetworkChainId(network) {
  return normalizeChainId(network?.chainIdHex || network?.chainId || "0x38");
}

function walletChainParamsForNetwork(network, t) {
  const chainId = drawNetworkChainId(network);
  if (chainId === "0x38") {
    return {
      chainId,
      chainName: "BNB Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      blockExplorerUrls: ["https://bscscan.com"],
    };
  }
  if (chainId === "0x61") {
    return {
      chainId,
      chainName: "BNB Smart Chain Testnet",
      nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545/"],
      blockExplorerUrls: ["https://testnet.bscscan.com"],
    };
  }
  return {
    chainId,
    chainName: drawNetworkLabel(network, t),
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: [],
    blockExplorerUrls: [],
  };
}

function formatDurationSeconds(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function elapsedSecondsSince(startedAt, nowMs) {
  const startedMs = Date.parse(startedAt || "");
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

function durationSecondsBetween(startedAt, finishedAt) {
  const startedMs = Date.parse(startedAt || "");
  const finishedMs = Date.parse(finishedAt || "");
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) return 0;
  return Math.round((finishedMs - startedMs) / 1000);
}

function formatRunTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function runOutputText(...sources) {
  const chunks = [];
  const seen = new Set();
  for (const source of sources) {
    const values = [
      source?.stderr,
      source?.stdout,
      source?.output?.stderr,
      source?.output?.stdout,
    ];
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      chunks.push(text);
    }
  }
  const output = chunks.join("\n\n");
  return output.length > 12000 ? output.slice(-12000) : output;
}

function extractRunOutputTransactions(output) {
  const txs = [];
  const seen = new Set();
  const matcher = /\[draw-round\]\s+([^\s]+).*?\btx=(0x[a-fA-F0-9]{64})/g;
  let match = matcher.exec(output || "");
  while (match) {
    const hash = match[2];
    if (!seen.has(hash)) {
      seen.add(hash);
      txs.push({ step: match[1], hash });
    }
    match = matcher.exec(output || "");
  }
  return txs;
}

function mergeRunTransactions(primaryTxs, outputTxs) {
  const merged = [];
  const seen = new Set();
  for (const tx of [...primaryTxs, ...outputTxs]) {
    const key = tx?.hash || `${tx?.step || "tx"}-${merged.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tx);
  }
  return merged;
}

function drawRunMatches(run, drawRoundId, networkKey) {
  if (!run) return false;
  const runDrawRoundId = String(run.drawRoundId || run.roundId || "");
  const runNetworkKey = normalizeDrawNetworkKey(run.networkKey || run.network || "");
  return runDrawRoundId === String(drawRoundId || "") && runNetworkKey === normalizeDrawNetworkKey(networkKey);
}

function drawRunSucceeded(run, action, drawRoundId, networkKey) {
  return Boolean(run?.ok && run.action === action && drawRunMatches(run, drawRoundId, networkKey));
}

function drawFailureText(payload, error) {
  return [
    payload?.error,
    payload?.stderr,
    payload?.stdout,
    payload?.output?.stderr,
    payload?.output?.stdout,
    payload?.lastRun?.error,
    payload?.lastRun?.output?.stderr,
    payload?.lastRun?.output?.stdout,
    error?.message,
  ].filter(Boolean).join("\n");
}

function shouldAutoRedrawAfterFailure(action, payload, error) {
  if (action !== "verify" && action !== "broadcast") return false;
  const text = drawFailureText(payload, error).toLowerCase();
  if (!text) return false;
  return /ledger hash .*does not match|does not match .*ledger hash|waitingforroundrandomness|randomness.*timed out|draw script timed out|already requested|request.*already exists|pending request|vrf.*timeout/.test(text);
}

function runStageCopy({ runPayloadResult, visibleRun, output, t }) {
  const status = runPayloadResult?.status;
  if (status?.requested && !status?.randomnessReady && !status?.fulfilled) {
    return t("draw.operatorRunWaitingRandomness", { requestId: status.requestId || "-" });
  }
  const waitingLine = String(output || "")
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.includes("waitingForRoundRandomness"));
  if (waitingLine) {
    const requestId = waitingLine.match(/requestId=([^\s]+)/)?.[1] || "-";
    const elapsedSeconds = waitingLine.match(/elapsedSeconds=([0-9]+)/)?.[1] || "";
    return t("draw.operatorRunWaitingRandomnessElapsed", {
      requestId,
      elapsed: elapsedSeconds ? formatDurationSeconds(elapsedSeconds) : "-",
    });
  }
  if (visibleRun?.error) return visibleRun.error;
  return "";
}

function roundLedgerSummaryFor(adminStatus, roundId) {
  const roundDraws = Array.isArray(adminStatus?.matchDrawLedger?.roundDraws)
    ? adminStatus.matchDrawLedger.roundDraws
    : [];
  return roundDraws.find((round) => String(round.roundId || "") === String(roundId || "")) || null;
}

function hasLockedLedgerForRound(adminStatus, roundId) {
  return Boolean(adminStatus?.matchDrawLedgerExists && roundLedgerSummaryFor(adminStatus, roundId));
}

function drawAdminReadinessItems(adminStatus, roundId, t) {
  if (!adminStatus) return [];
  return [
    {
      id: "api",
      ready: adminStatus.enabled !== false,
      label: adminStatus.enabled !== false ? t("draw.operatorDrawApiEnabled") : t("draw.operatorDrawDisabled"),
    },
    {
      id: "contract",
      ready: Boolean(adminStatus.contractConfigured),
      label: adminStatus.contractConfigured ? t("draw.operatorDrawContractReady") : t("draw.operatorDrawContractMissing"),
    },
    {
      id: "rpc",
      ready: Boolean(adminStatus.rpcConfigured),
      label: adminStatus.rpcConfigured ? t("draw.operatorDrawRpcReady") : t("draw.operatorDrawRpcMissing"),
    },
    {
      id: "broadcaster",
      ready: Boolean(adminStatus.broadcasterConfigured),
      label: adminStatus.broadcasterConfigured ? t("draw.operatorDrawBroadcasterReady") : t("draw.operatorDrawBroadcasterMissing"),
    },
    {
      id: "allowlist",
      ready: Boolean(adminStatus.allowlistConfigured),
      label: adminStatus.allowlistConfigured ? t("draw.operatorDrawAllowlistReady") : t("draw.operatorDrawAllowlistMissing"),
    },
    {
      id: "ledger",
      ready: hasLockedLedgerForRound(adminStatus, roundId),
      label: hasLockedLedgerForRound(adminStatus, roundId) ? t("draw.operatorDrawLedgerReady") : t("draw.operatorDrawLedgerMissing"),
    },
  ];
}

function DrawOperatorWallet({ activeDraw, t }) {
  const [walletProviders, setWalletProviders] = useState([]);
  const [walletDetecting, setWalletDetecting] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [issue, setIssue] = useState("");
  const [adminStatus, setAdminStatus] = useState(null);
  const [adminStatusIssue, setAdminStatusIssue] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [selectedNetworkKey, setSelectedNetworkKey] = useState(defaultDrawNetworkKey);
  const [redrawEnabled, setRedrawEnabled] = useState(false);
  const [redrawAttempt, setRedrawAttempt] = useState(1);
  const [activeRun, setActiveRun] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [connectedWallet, setConnectedWallet] = useState({
    address: "",
    chainId: "",
    label: "",
    provider: null,
  });
  const connected = Boolean(connectedWallet.address);
  const sourceRoundId = activeDraw.id;
  const drawRoundId = drawRoundIdFor(sourceRoundId, redrawEnabled, redrawAttempt);
  const redrawActive = drawRoundId !== sourceRoundId;
  const selectedNetwork = selectedDrawNetwork(adminStatus, selectedNetworkKey);
  const targetDrawChainId = drawNetworkChainId(selectedNetwork);
  const targetMatched = connected && normalizeChainId(connectedWallet.chainId) === targetDrawChainId;

  useEffect(() => {
    let active = true;
    const discoveredEntries = [];

    function publish(entries = []) {
      if (!active) return;
      const nextEntries = entries.length > 0 ? entries : discoveredEntries;
      setWalletProviders(normalizeWalletProviders(nextEntries));
    }

    function handleAnnounceProvider(event) {
      const detail = event.detail;
      if (!detail?.provider) return;
      discoveredEntries.push({
        provider: detail.provider,
        info: detail.info || null,
        source: "eip6963",
      });
      publish();
    }

    setWalletDetecting(true);
    window.addEventListener?.("eip6963:announceProvider", handleAnnounceProvider);
    discoveredEntries.push(...getLegacyWalletProviders());
    publish();
    window.dispatchEvent?.(new Event("eip6963:requestProvider"));

    const settleTimer = window.setTimeout(() => {
      if (!active) return;
      setWalletDetecting(false);
      publish();
    }, 420);

    return () => {
      active = false;
      window.clearTimeout(settleTimer);
      window.removeEventListener?.("eip6963:announceProvider", handleAnnounceProvider);
    };
  }, []);

  useEffect(() => {
    const provider = connectedWallet.provider;
    if (!provider?.on) return undefined;

    function handleAccountsChanged(accounts = []) {
      const nextAddress = accounts?.[0] || "";
      setConnectedWallet((current) => ({
        ...current,
        address: nextAddress,
      }));
    }

    function handleChainChanged(chainId) {
      setConnectedWallet((current) => ({
        ...current,
        chainId: normalizeChainId(chainId),
      }));
    }

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [connectedWallet.provider]);

  useEffect(() => {
    setRedrawEnabled(false);
    setRedrawAttempt(1);
    setIssue("");
    setRunResult(null);
    setActiveRun(null);
  }, [sourceRoundId]);

  useEffect(() => {
    let active = true;
    fetchJsonWithTimeout(drawAdminStatusEndpoint(selectedNetworkKey, sourceRoundId, drawRoundId), {
      timeoutMs: 10000,
    })
      .then(({ payload }) => {
        if (!active) return;
        setAdminStatus(payload);
        setAdminStatusIssue("");
      })
      .catch((error) => {
        if (!active) return;
        setAdminStatus(null);
        setAdminStatusIssue(error?.message || t("draw.operatorDrawStatusFailed"));
      });
    return () => {
      active = false;
    };
  }, [drawRoundId, selectedNetworkKey, sourceRoundId, t]);

  useEffect(() => {
    if (!busyAction && !adminStatus?.running && activeRun?.status !== "running") return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.status, adminStatus?.running, busyAction]);

  useEffect(() => {
    if (!adminStatus?.running && activeRun?.status !== "running") return undefined;
    refreshAdminStatus();
    const timer = window.setInterval(() => {
      refreshAdminStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeRun?.status, adminStatus?.running, drawRoundId, selectedNetworkKey, sourceRoundId]);

  async function refreshAdminStatus() {
    try {
      const { payload } = await fetchJsonWithTimeout(drawAdminStatusEndpoint(selectedNetworkKey, sourceRoundId, drawRoundId), {
        timeoutMs: 10000,
      });
      setAdminStatus(payload);
      setAdminStatusIssue("");
      return payload;
    } catch (error) {
      setAdminStatusIssue(error?.message || t("draw.operatorDrawStatusFailed"));
      return null;
    }
  }

  async function connectDrawWallet(walletProvider) {
    setIssue("");
    if (!walletProvider?.provider?.request) {
      setIssue(t("draw.operatorWalletMissing"));
      return;
    }

    setBusyAction(`connect:${walletProvider.id}`);
    try {
      const accounts = await walletProvider.provider.request({ method: "eth_requestAccounts" });
      const address = accounts?.[0] || "";
      if (!address) throw new Error(t("draw.operatorWalletMissing"));
      const chainId = normalizeChainId(await walletProvider.provider.request({ method: "eth_chainId" }));
      setConnectedWallet({
        address,
        chainId,
        label: walletProvider.label,
        provider: walletProvider.provider,
      });
    } catch (error) {
      setIssue(error instanceof Error ? error.message : t("draw.operatorWalletFailed"));
    } finally {
      setBusyAction("");
    }
  }

  async function signDrawMessage(message) {
    if (!connectedWallet.provider?.request || !connectedWallet.address) {
      throw new Error(t("draw.operatorWalletMissing"));
    }
    return connectedWallet.provider.request({
      method: "personal_sign",
      params: [message, connectedWallet.address],
    });
  }

  async function ensureTargetChain() {
    if (!connectedWallet.provider?.request) {
      setIssue(t("draw.operatorWalletMissing"));
      return false;
    }

    const currentChainId = normalizeChainId(
      await connectedWallet.provider.request({ method: "eth_chainId" }).catch(() => connectedWallet.chainId),
    );
    if (currentChainId === targetDrawChainId) {
      setConnectedWallet((current) => ({ ...current, chainId: targetDrawChainId }));
      return true;
    }

    setBusyAction("switch-chain");
    try {
      await connectedWallet.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetDrawChainId }],
      });
    } catch (error) {
      const code = Number(error?.code ?? error?.data?.originalError?.code);
      try {
        if (code !== 4902) throw error;
        const params = walletChainParamsForNetwork(selectedNetwork, t);
        if (!params.rpcUrls.length) throw error;
        await connectedWallet.provider.request({
          method: "wallet_addEthereumChain",
          params: [params],
        });
        await connectedWallet.provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetDrawChainId }],
        });
      } catch (switchError) {
        setIssue(switchError instanceof Error ? switchError.message : t("draw.operatorWalletFailed"));
        setBusyAction("");
        return false;
      }
    }

    let nextChainId = "";
    try {
      nextChainId = normalizeChainId(await connectedWallet.provider.request({ method: "eth_chainId" }));
    } catch (error) {
      setIssue(error instanceof Error ? error.message : t("draw.operatorWalletFailed"));
      setBusyAction("");
      return false;
    }
    setConnectedWallet((current) => ({ ...current, chainId: nextChainId }));
    setBusyAction("");
    if (nextChainId !== targetDrawChainId) {
      setIssue(t("draw.operatorWalletWrongChain", { chain: drawNetworkLabel(selectedNetwork, t) }));
      return false;
    }
    return true;
  }

  function selectDrawNetwork(networkKey) {
    if (busyAction || adminStatus?.running) return;
    setSelectedNetworkKey(normalizeDrawNetworkKey(networkKey));
    setIssue("");
    setRunResult(null);
    setActiveRun(null);
  }

  function selectRedrawEnabled(value) {
    if (busyAction || adminStatus?.running) return;
    setRedrawEnabled(Boolean(value));
    setIssue("");
    setRunResult(null);
    setActiveRun(null);
  }

  function updateRedrawAttempt(value) {
    if (busyAction || adminStatus?.running) return;
    setRedrawAttempt(normalizeRedrawAttempt(value));
    setIssue("");
    setRunResult(null);
    setActiveRun(null);
  }

  function enableNextRedrawVersion() {
    const nextAttempt = redrawEnabled ? normalizeRedrawAttempt(redrawAttempt + 1) : normalizeRedrawAttempt(redrawAttempt);
    const nextDrawRoundId = drawRoundIdFor(sourceRoundId, true, nextAttempt);
    setRedrawEnabled(true);
    setRedrawAttempt(nextAttempt);
    return nextDrawRoundId;
  }

  function beginOperatorRun(action, roundId, nextDrawRoundId = roundId) {
    const startedAt = new Date().toISOString();
    setNowMs(Date.now());
    setActiveRun({
      action,
      roundId,
      drawRoundId: nextDrawRoundId,
      networkKey: selectedNetworkKey,
      networkLabel: drawNetworkLabel(selectedNetwork, t),
      status: "running",
      ok: false,
      startedAt,
      finishedAt: null,
      durationSeconds: null,
      code: "",
      error: "",
    });
  }

  function finishOperatorRun(payload, error = null) {
    const finishedAt = new Date().toISOString();
    const lastRun = payload?.lastRun || null;
    setActiveRun((current) => {
      const startedAt = current?.startedAt || lastRun?.startedAt || finishedAt;
      const ok = Boolean(payload?.ok);
      return {
        ...(current || {}),
        action: payload?.action || current?.action || lastRun?.action || "",
        roundId: payload?.roundId || current?.roundId || lastRun?.roundId || "",
        drawRoundId: payload?.drawRoundId || current?.drawRoundId || lastRun?.drawRoundId || "",
        networkKey: payload?.networkKey || current?.networkKey || lastRun?.networkKey || selectedNetworkKey,
        networkLabel: current?.networkLabel || drawNetworkLabel(selectedNetwork, t),
        status: ok ? "completed" : "failed",
        ok,
        startedAt,
        finishedAt: lastRun?.finishedAt || finishedAt,
        durationSeconds: lastRun?.durationSeconds ?? durationSecondsBetween(startedAt, finishedAt),
        code: payload?.code || error?.code || "",
        error: payload?.error || error?.message || lastRun?.error || "",
      };
    });
  }

  function drawRoundReadinessSnapshot() {
    const currentStatus = statusForSelectedNetwork(adminStatus, selectedNetworkKey);
    const readiness = currentStatus?.roundReadiness || runResult?.readiness || null;
    if (!readiness) {
      return {
        complete: activeDraw.officialFinalsComplete,
        confirmedCount: activeDraw.officialFinalCount,
        expectedCount: activeDraw.matchCount,
        missingCount: activeDraw.officialFinalsRemaining,
        missingMatchIds: [],
      };
    }
    return {
      complete: Boolean(readiness.complete),
      confirmedCount: Number(readiness.confirmedCount || 0),
      expectedCount: Number(readiness.expectedCount || activeDraw.matchCount || 0),
      missingCount: Number(readiness.missingCount || 0),
      missingMatchIds: Array.isArray(readiness.missingMatchIds) ? readiness.missingMatchIds : [],
    };
  }

  async function lockDrawLedger() {
    setIssue("");
    setRunResult(null);

    if (!connectedWallet.address) {
      setIssue(t("draw.operatorWalletMissing"));
      return;
    }
    if (!(await ensureTargetChain())) return;
    const roundReadiness = drawRoundReadinessSnapshot();
    if (!roundReadiness.complete) {
      setIssue(t("draw.operatorDrawFinalsBlocked", {
        finals: formatNumber(roundReadiness.confirmedCount),
        matches: formatNumber(roundReadiness.expectedCount),
        remaining: formatNumber(roundReadiness.missingCount),
      }));
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(t("draw.operatorDrawLedgerConfirm", { round: drawRoundId, sourceRound: sourceRoundId }));
      if (!confirmed) return;
    }

    setBusyAction("draw:ledger");
    beginOperatorRun("ledger", sourceRoundId, drawRoundId);
    try {
      const roundId = sourceRoundId;
      const { payload: challenge } = await fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/challenge"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedWallet.address,
          action: "ledger",
          roundId,
          drawRoundId,
          network: selectedNetworkKey,
        }),
        timeoutMs: drawAdminCheckTimeoutMs,
      });
      const signature = await signDrawMessage(challenge.message);
      const { payload } = await fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/ledger"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedWallet.address,
          action: "ledger",
          roundId,
          drawRoundId,
          network: selectedNetworkKey,
          nonce: challenge.nonce,
          signature,
        }),
        timeoutMs: drawAdminCheckTimeoutMs,
      });
      setRunResult(payload);
      setAdminStatus(payload.status || await refreshAdminStatus());
      finishOperatorRun(payload);
    } catch (error) {
      const payload = error?.payload || null;
      setIssue(payload?.error || error?.message || t("draw.operatorDrawLedgerFailed"));
      if (payload) setRunResult(payload);
      finishOperatorRun(payload, error);
    } finally {
      setBusyAction("");
    }
  }

  async function runDrawAction(action) {
    const broadcast = action === "broadcast";
    setIssue("");
    setRunResult(null);

    if (!connectedWallet.address) {
      setIssue(t("draw.operatorWalletMissing"));
      return;
    }
    if (!(await ensureTargetChain())) return;
    const roundReadiness = drawRoundReadinessSnapshot();
    if (broadcast && !roundReadiness.complete) {
      setIssue(t("draw.operatorDrawFinalsBlocked", {
        finals: formatNumber(roundReadiness.confirmedCount),
        matches: formatNumber(roundReadiness.expectedCount),
        remaining: formatNumber(roundReadiness.missingCount),
      }));
      return;
    }
    if (broadcast && typeof window !== "undefined") {
      const confirmed = window.confirm(t("draw.operatorDrawBroadcastConfirm", { round: drawRoundId, sourceRound: sourceRoundId }));
      if (!confirmed) return;
    }

    setBusyAction(`draw:${action}`);
    beginOperatorRun(action, sourceRoundId, drawRoundId);
    try {
      const roundId = sourceRoundId;
      const { payload: challenge } = await fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/challenge"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedWallet.address,
          action,
          roundId,
          drawRoundId,
          network: selectedNetworkKey,
        }),
        timeoutMs: drawAdminCheckTimeoutMs,
      });
      const signature = await signDrawMessage(challenge.message);
      const { payload } = await fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/round"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedWallet.address,
          action,
          roundId,
          drawRoundId,
          network: selectedNetworkKey,
          nonce: challenge.nonce,
          signature,
        }),
        timeoutMs: broadcast ? drawAdminBroadcastTimeoutMs : drawAdminCheckTimeoutMs,
      });
      setRunResult(payload);
      await refreshAdminStatus();
      finishOperatorRun(payload);
      if (payload?.ok && (broadcast || payload?.result?.winnersOut) && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("renaiss:draw-winners-updated", {
          detail: {
            roundId,
            drawRoundId,
            action,
            generatedAt: payload?.result?.generatedAt || new Date().toISOString(),
          },
        }));
      }
    } catch (error) {
      const payload = error?.payload || null;
      const failureMessage = payload?.error || error?.message || t("draw.operatorDrawFailed");
      const nextRedrawRoundId = shouldAutoRedrawAfterFailure(action, payload, error) ? enableNextRedrawVersion() : "";
      setIssue(nextRedrawRoundId
        ? `${failureMessage} ${t("draw.operatorDrawAutoRedrawEnabled", { drawRound: nextRedrawRoundId })}`
        : failureMessage);
      if (payload) setRunResult(payload);
      finishOperatorRun(payload, error);
    } finally {
      setBusyAction("");
    }
  }

  async function switchTargetChain() {
    if (!connectedWallet.provider?.request) return;
    setIssue("");
    try {
      await ensureTargetChain();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : t("draw.operatorWalletFailed"));
    }
  }

  const currentAdminStatus = statusForSelectedNetwork(adminStatus, selectedNetworkKey);
  const networkOptions = drawNetworkOptions(adminStatus);
  const targetNetworkLabel = drawNetworkLabel(selectedNetwork, t);
  const operationBusy = Boolean(busyAction || currentAdminStatus?.running);
  const roundReadiness = drawRoundReadinessSnapshot();
  const activeRoundLedger = roundLedgerSummaryFor(currentAdminStatus, drawRoundId);
  const ledgerLocked = Boolean(activeRoundLedger);
  const adminBaseReady = Boolean(currentAdminStatus?.enabled && currentAdminStatus?.allowlistConfigured);
  const contractExecutionReady = Boolean(
    currentAdminStatus?.enabled
    && currentAdminStatus?.contractConfigured
    && currentAdminStatus?.rpcConfigured
    && currentAdminStatus?.broadcasterConfigured
    && currentAdminStatus?.allowlistConfigured,
  );
  const adminReady = contractExecutionReady && ledgerLocked;
  const canLockLedger = connected && adminBaseReady && roundReadiness.complete && !operationBusy;
  const canRunDraw = connected && adminReady && !operationBusy;
  const canBroadcastDraw = canRunDraw && roundReadiness.complete;
  const readinessItems = drawAdminReadinessItems(currentAdminStatus, drawRoundId, t);
  const missingReadinessItems = readinessItems.filter((item) => !item.ready);
  const adminStatusCopy = adminStatusIssue
    || (missingReadinessItems.length > 0
      ? t("draw.operatorDrawMissingItems", {
        items: missingReadinessItems.map((item) => item.label).join(" · "),
      })
      : t("draw.operatorDrawAllReady"));
  const finalsNotice = roundReadiness.complete
    ? t("draw.operatorDrawFinalsReady", {
      finals: formatNumber(roundReadiness.confirmedCount),
      matches: formatNumber(roundReadiness.expectedCount),
    })
    : t("draw.operatorDrawFinalsPending", {
      finals: formatNumber(roundReadiness.confirmedCount),
      matches: formatNumber(roundReadiness.expectedCount),
      remaining: formatNumber(roundReadiness.missingCount),
    });
  const serverLastRun = currentAdminStatus?.lastRun?.startedAt ? currentAdminStatus.lastRun : null;
  const visibleRun = serverLastRun || activeRun;
  const runPayloadResult = runResult?.result || serverLastRun?.result || null;
  const plannedSteps = Array.isArray(runPayloadResult?.plannedSteps) ? runPayloadResult.plannedSteps : [];
  const outputText = runOutputText(runResult, activeRun, serverLastRun);
  const txs = mergeRunTransactions(
    Array.isArray(runPayloadResult?.txs) ? runPayloadResult.txs : [],
    extractRunOutputTransactions(outputText),
  );
  const runIsRunning = Boolean(currentAdminStatus?.running) || (activeRun?.status === "running" && !serverLastRun?.finishedAt);
  const runElapsedSeconds = runIsRunning
    ? (currentAdminStatus?.runningElapsedSeconds ?? elapsedSecondsSince(visibleRun?.startedAt, nowMs))
    : (visibleRun?.durationSeconds ?? durationSecondsBetween(visibleRun?.startedAt, visibleRun?.finishedAt));
  const runStatusLabel = runIsRunning
    ? t("draw.operatorRunRunning")
    : visibleRun?.ok
      ? t("draw.operatorRunCompleted")
      : visibleRun
        ? t("draw.operatorRunFailed")
        : t("draw.operatorRunIdle");
  const runTone = runIsRunning ? "is-running" : visibleRun?.ok ? "is-ready" : visibleRun ? "is-warning" : "";
  const runStage = runStageCopy({ runPayloadResult, visibleRun, output: outputText, t });
  const resultDetails = [
    runResult?.code ? `${t("draw.operatorRunCode")}: ${runResult.code}` : "",
    runResult?.error || "",
    visibleRun?.error || "",
    outputText,
  ].filter(Boolean);
  const currentBroadcastCompleted = drawRunSucceeded(runResult, "broadcast", drawRoundId, selectedNetworkKey)
    || drawRunSucceeded(visibleRun, "broadcast", drawRoundId, selectedNetworkKey);
  const primaryDrawStep = (() => {
    if (operationBusy) {
      return {
        action: "running",
        disabled: true,
        Icon: Loader2,
        iconClassName: "is-spinning",
        label: t("draw.operatorDrawPrimaryRunning"),
        className: "is-primary",
      };
    }
    if (!connected) {
      return {
        action: "connect",
        disabled: true,
        Icon: WalletCards,
        label: t("draw.operatorDrawPrimaryConnectWallet"),
        className: "is-primary",
      };
    }
    if (!targetMatched) {
      return {
        action: "switch-chain",
        disabled: false,
        Icon: Network,
        label: t("draw.operatorWalletSwitch", { chain: targetNetworkLabel }),
        className: "is-primary",
      };
    }
    if (!roundReadiness.complete) {
      return {
        action: "waiting-finals",
        disabled: true,
        Icon: Clock3,
        label: t("draw.operatorDrawPrimaryWaitingFinals"),
        className: "is-primary",
      };
    }
    if (!ledgerLocked) {
      return {
        action: "ledger",
        disabled: !canLockLedger,
        Icon: LockKeyhole,
        label: t("draw.operatorDrawLockLedger"),
        className: "is-primary",
      };
    }
    if (!currentBroadcastCompleted) {
      return {
        action: "broadcast",
        disabled: !canBroadcastDraw,
        Icon: Award,
        label: t("draw.operatorDrawBroadcast"),
        className: "is-danger",
      };
    }
    return {
      action: "complete",
      disabled: true,
      Icon: CheckCircle2,
      label: t("draw.operatorDrawPrimaryComplete"),
      className: "is-primary",
    };
  })();
  const PrimaryDrawIcon = primaryDrawStep.Icon;

  async function runPrimaryDrawStep() {
    if (primaryDrawStep.disabled) return;
    if (primaryDrawStep.action === "switch-chain") {
      await switchTargetChain();
      return;
    }
    if (primaryDrawStep.action === "ledger") {
      await lockDrawLedger();
      return;
    }
    if (primaryDrawStep.action === "verify" || primaryDrawStep.action === "broadcast") {
      await runDrawAction(primaryDrawStep.action);
    }
  }

  return (
    <section className="draw-operator-wallet" aria-label={t("draw.operatorWalletAria")}>
      <header>
        <span>
          <WalletCards size={16} strokeWidth={2.25} />
          {t("draw.operatorWalletTitle")}
        </span>
        <strong>{connected ? compactAddress(connectedWallet.address) : t("draw.operatorWalletDisconnected")}</strong>
      </header>
      <p>{t("draw.operatorWalletBody")}</p>

      <section className="draw-operator-wallet__network" aria-label={t("draw.operatorNetworkMode")}>
        <header>
          <span>{t("draw.operatorNetworkMode")}</span>
          <strong>{targetNetworkLabel}</strong>
        </header>
        <div className="draw-operator-wallet__network-options" role="tablist" aria-label={t("draw.operatorNetworkMode")}>
          {networkOptions.map((network) => {
            const active = network.key === selectedNetworkKey;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "is-active" : ""}
                disabled={operationBusy}
                key={network.key}
                onClick={() => selectDrawNetwork(network.key)}
              >
                <Network size={14} strokeWidth={2.2} />
                <span>{drawNetworkLabel(network, t)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {connected ? (
        <dl>
          <div>
            <dt>{t("draw.operatorWalletAddress")}</dt>
            <dd>{compactAddress(connectedWallet.address)}</dd>
          </div>
          <div>
            <dt>{t("draw.operatorWalletChain")}</dt>
            <dd className={targetMatched ? "is-ready" : "is-warning"}>
              <Network size={13} strokeWidth={2.2} />
              {chainLabel(connectedWallet.chainId, t)}
            </dd>
          </div>
          <div>
            <dt>{t("draw.operatorWalletTarget")}</dt>
            <dd>{targetNetworkLabel}</dd>
          </div>
        </dl>
      ) : null}

      <div className="draw-operator-wallet__actions">
        {walletProviders.length > 0 ? walletProviders.map((walletProvider) => {
          const busy = busyAction === `connect:${walletProvider.id}`;
          return (
            <button
              key={walletProvider.id}
              type="button"
              disabled={operationBusy}
              onClick={() => connectDrawWallet(walletProvider)}
            >
              {busy ? <Loader2 className="is-spinning" size={15} /> : <WalletCards size={15} strokeWidth={2.2} />}
              <span>{walletProvider.label}</span>
            </button>
          );
        }) : (
          <button type="button" disabled>
            <WalletCards size={15} strokeWidth={2.2} />
            <span>{walletDetecting ? t("draw.operatorWalletDetecting") : t("draw.operatorWalletMissing")}</span>
          </button>
        )}
        {connected && !targetMatched ? (
          <button type="button" disabled={operationBusy} onClick={switchTargetChain}>
            {busyAction === "switch-chain" ? <Loader2 className="is-spinning" size={15} /> : <Network size={15} strokeWidth={2.2} />}
            <span>{t("draw.operatorWalletSwitch", { chain: targetNetworkLabel })}</span>
          </button>
        ) : null}
      </div>

      <section className="draw-operator-wallet__admin" aria-label={t("draw.operatorDrawAria")}>
        <header>
          <span>{t("draw.operatorDrawTitle")}</span>
          <strong className={adminReady ? "is-ready" : "is-warning"}>
            {adminReady ? t("draw.operatorDrawReady") : t("draw.operatorDrawNotReady")}
          </strong>
        </header>
        <p>{adminStatusCopy}</p>
        {readinessItems.length > 0 ? (
          <ul className="draw-operator-wallet__readiness">
            {readinessItems.map((item) => (
              <li className={item.ready ? "is-ready" : "is-warning"} key={item.id}>
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
        {currentAdminStatus?.contractAddress ? (
          <code>{targetNetworkLabel} · {compactAddress(currentAdminStatus.contractAddress)}</code>
        ) : null}
        <section className="draw-operator-wallet__redraw" aria-label={t("draw.operatorRedrawAria")}>
          <label className="draw-operator-wallet__redraw-toggle">
            <input
              type="checkbox"
              checked={redrawEnabled}
              disabled={operationBusy}
              onChange={(event) => selectRedrawEnabled(event.target.checked)}
            />
            <span>
              <strong>{t("draw.operatorRedrawLabel")}</strong>
              <small>{t("draw.operatorRedrawBody")}</small>
            </span>
          </label>
          {redrawEnabled ? (
            <label className="draw-operator-wallet__redraw-version">
              <span>{t("draw.operatorRedrawAttempt")}</span>
              <input
                type="number"
                min="1"
                max="999"
                step="1"
                value={redrawAttempt}
                disabled={operationBusy}
                onChange={(event) => updateRedrawAttempt(event.target.value)}
              />
              <code>{drawRoundId}</code>
            </label>
          ) : (
            <code>{drawRoundId}</code>
          )}
          {redrawActive ? (
            <p>{t("draw.operatorRedrawWarning", { sourceRound: sourceRoundId, drawRound: drawRoundId })}</p>
          ) : null}
        </section>
        <p className={["draw-operator-wallet__finals", roundReadiness.complete ? "is-ready" : "is-warning"].join(" ")}>
          {finalsNotice}
          {!roundReadiness.complete && roundReadiness.missingMatchIds.length > 0 ? (
            <span>{t("draw.operatorDrawReadinessMissing", { matches: roundReadiness.missingMatchIds.join(", ") })}</span>
          ) : null}
        </p>
        <div className="draw-operator-wallet__actions">
          <button
            type="button"
            className={["draw-operator-wallet__primary-action", primaryDrawStep.className].filter(Boolean).join(" ")}
            disabled={primaryDrawStep.disabled}
            onClick={runPrimaryDrawStep}
          >
            <PrimaryDrawIcon className={primaryDrawStep.iconClassName || ""} size={15} strokeWidth={2.2} />
            <span>{primaryDrawStep.label}</span>
          </button>
        </div>
      </section>

      <section className={["draw-operator-wallet__run", runTone].filter(Boolean).join(" ")} aria-label={t("draw.operatorRunLog")}>
        <header>
          <span>{t("draw.operatorRunLog")}</span>
          <strong>{runStatusLabel}</strong>
        </header>
        <div className="draw-operator-wallet__run-grid">
          <div>
            <span>{t("draw.operatorRunAction")}</span>
            <strong>{visibleRun?.action || "-"}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunNetwork")}</span>
            <strong>{visibleRun?.networkLabel || targetNetworkLabel}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunDrawRound")}</span>
            <strong>{visibleRun?.drawRoundId || drawRoundId || "-"}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunElapsed")}</span>
            <strong>{formatDurationSeconds(runElapsedSeconds)}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunStarted")}</span>
            <strong>{formatRunTimestamp(visibleRun?.startedAt)}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunFinished")}</span>
            <strong>{formatRunTimestamp(visibleRun?.finishedAt)}</strong>
          </div>
          <div>
            <span>{t("draw.operatorRunCode")}</span>
            <strong>{(runResult?.code || visibleRun?.code || visibleRun?.exitCode) ?? "-"}</strong>
          </div>
        </div>
        {runStage ? (
          <p className="draw-operator-wallet__run-note">{runStage}</p>
        ) : null}
        <p>{txs.length > 0 ? t("draw.operatorRunTransactions") : t("draw.operatorRunNoTransactions")}</p>
        {txs.length > 0 ? (
          <ol>
            {txs.map((tx, index) => (
              <li key={`${tx.hash || tx.step || "tx"}-${index}`}>
                {tx.step || t("common.status")} · {compactAddress(tx.hash || "")}
              </li>
            ))}
          </ol>
        ) : null}
        {outputText ? (
          <pre>{outputText}</pre>
        ) : null}
      </section>

      {runResult ? (
        <section className={["draw-operator-wallet__result", runResult.ok ? "is-ready" : "is-warning"].filter(Boolean).join(" ")}>
          <strong>{runResult.ok ? t("draw.operatorDrawRunOk") : t("draw.operatorDrawRunFailed")}</strong>
          <p>
            {runResult.action === "ledger"
              ? t("draw.operatorDrawLedgerLocked")
              : runResult.result?.broadcast
              ? t("draw.operatorDrawBroadcasted")
              : t("draw.operatorDrawDryRun")}
          </p>
          {runResult.action === "ledger" && activeRoundLedger?.ledgerHash ? (
            <code>{compactAddress(activeRoundLedger.ledgerHash)}</code>
          ) : null}
          {plannedSteps.length > 0 ? (
            <ol>
              {plannedSteps.map((step, index) => (
                <li key={`${step.step || "step"}-${index}`}>{step.step || t("common.status")}</li>
              ))}
            </ol>
          ) : null}
          {txs.length > 0 ? (
            <ol>
              {txs.map((tx, index) => (
                <li key={`${tx.hash || tx.step || "tx"}-${index}`}>
                  {tx.step || t("common.status")} · {compactAddress(tx.hash || "")}
                </li>
              ))}
            </ol>
          ) : null}
          {resultDetails.length > 0 ? (
            <pre>{resultDetails.join("\n")}</pre>
          ) : null}
        </section>
      ) : null}

      <small>{connected ? t("draw.operatorWalletReady") : t("draw.operatorWalletBoundary")}</small>
      {issue ? <em>{issue}</em> : null}
    </section>
  );
}

function DrawPrizeRunway({ activeDraw, drawState, t }) {
  return (
    <section className="draw-prize-runway" aria-label={t("draw.prizeRunway", { count: formatNumber(activeDraw.prizeCount) })}>
      <header>
        <span>{t("draw.prizeSlotsAria", { count: formatNumber(activeDraw.prizeCount) })}</span>
        <strong>{formatNumber(activeDraw.prizeCount)}</strong>
      </header>
      <ol>
        {Array.from({ length: activeDraw.prizeCount }, (_, index) => (
          <li className={activeDraw.eligibleEntries > 0 ? `is-${drawState.tone}` : ""} key={`draw-slot-${index + 1}`}>
            {String(index + 1).padStart(2, "0")}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DrawMatchRibbon({ matches, teamsById, copy }) {
  const { matchStatusCompact, teamName, t } = copy;

  return (
    <section className="draw-match-ribbon" aria-label={t("draw.matchRibbonAria")}>
      <header>
        <span>{t("draw.advancingResults")}</span>
        <strong>{t("draw.officialOnly")}</strong>
      </header>
      <ol>
        {matches.map((match, matchIndex) => {
          const teams = match.teams.map((teamId) => teamsById.get(teamId)).filter(Boolean);
          const advancingTeam = teamsById.get(match.advancingTeamId);
          const prizeImage = getMatchPrizeImage(match, matchIndex);
          return (
            <li className={match.advancingTeamId ? "has-result" : ""} key={match.id}>
              <span className="draw-match-ribbon__prize" aria-hidden="true">
                <img src={prizeImage} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="draw-match-ribbon__copy">
                <span>{matchDisplayCode(match)}</span>
                <strong>{teams.map((team) => teamName(team)).join(" / ")}</strong>
                <small>{advancingTeam ? `${t("common.advancing")} ${teamName(advancingTeam)}` : matchStatusCompact(match.status)}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function DrawRoom({ activeRound, rounds, simulatedRoundId, drawStats, matches, teamsById, onSelectRound }) {
  const copy = useCampaignCopy();
  const { roundLabel, t } = copy;
  const activeDraw = drawStats.find((round) => round.id === activeRound.id) ?? drawStats[0];
  const activeStep = getActiveDrawStep(activeDraw.drawStatusResolved);
  const roundMatches = matches.filter((match) => match.roundId === activeRound.id);
  const drawState = getDrawStateCopy(activeDraw, t);

  useEffect(() => {
    preloadRoundPrizeImages(activeRound.id);
  }, [activeRound.id]);

  return (
    <section className="draw-room draw-room-v2" aria-label={t("draw.roomAria")}>
      <DrawRoundRail drawStats={drawStats} activeDraw={activeDraw} rounds={rounds} simulatedRoundId={simulatedRoundId} onSelectRound={onSelectRound} copy={copy} />

      <article className="draw-stage-map">
        <header className="draw-stage-map__head">
          <span>{roundLabel(activeDraw, "englishLabel")}</span>
          <h1>{t("views.draw.title")}</h1>
          <p>{t("views.draw.body")}</p>
        </header>

        <DrawProgressMap activeDraw={activeDraw} activeStep={activeStep} drawState={drawState} t={t} />
        <DrawOperatorWallet activeDraw={activeDraw} t={t} />

        <section className="draw-stage-map__stats" aria-label={t("mast.currentRoundBalances")}>
          <output>
            <span>{t("draw.eligibleEntries")}</span>
            <strong>{formatNumber(activeDraw.eligibleEntries)}</strong>
          </output>
          <output>
            <span>{t("common.pending")}</span>
            <strong>{formatNumber(activeDraw.pendingEntries)}</strong>
          </output>
          <output>
            <span>{t("common.roundPool")}</span>
            <strong>{formatNumber(activeDraw.totalPoolEntries)}</strong>
          </output>
          <output>
            <span>{t("draw.estimatedChance")}</span>
            <strong>{formatPercent(activeDraw.estimatedChance)}</strong>
          </output>
        </section>

        <DrawPrizeRunway activeDraw={activeDraw} drawState={drawState} t={t} />
        <DrawMatchRibbon matches={roundMatches} teamsById={teamsById} copy={copy} />

        <footer className="draw-boundary-notes">
          <p>
            <ShieldCheck size={17} strokeWidth={2.2} />
            {t("draw.correctEnterOnly")}
          </p>
          <p>
            <LockKeyhole size={17} strokeWidth={2.2} />
            {t("draw.revealContractNotBuilt")}
          </p>
          <p>
            <AlertTriangle size={17} strokeWidth={2.2} />
            {t("draw.noFakeWinners")}
          </p>
        </footer>
      </article>
    </section>
  );
}
