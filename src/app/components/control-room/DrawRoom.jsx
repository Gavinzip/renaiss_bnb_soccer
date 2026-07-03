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
import { getMatchPrizeImage } from "../../data/matchPrizeImages";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { fetchJsonWithTimeout } from "../../utils/httpClient";
import { getLegacyWalletProviders, normalizeWalletProviders } from "../../utils/walletProviders";

const drawStepIds = ["results", "eligible", "snapshot", "reveal"];
const targetDrawChainId = normalizeChainId(import.meta.env.VITE_DRAW_CHAIN_ID || "0x38");
const drawAdminCheckTimeoutMs = 60000;
const drawAdminBroadcastTimeoutMs = 14 * 60 * 1000;

function drawAdminEndpoint(path) {
  const apiOrigin = String(import.meta.env.VITE_DRAW_ADMIN_API_ORIGIN || import.meta.env.VITE_LOCAL_API_ORIGIN || "").replace(/\/$/, "");
  if (!apiOrigin || import.meta.env.PROD) return path;
  return `${apiOrigin}${path}`;
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
                <td>{match.id.toUpperCase()}</td>
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

function chainLabel(chainId, t) {
  const normalized = normalizeChainId(chainId);
  if (!normalized) return t("draw.operatorWalletChainUnknown");
  if (normalized === "0x38") return "BNB Chain";
  if (normalized === "0x61") return "BNB Testnet";
  return normalized;
}

function targetChainLabel(t) {
  return chainLabel(targetDrawChainId, t);
}

function DrawOperatorWallet({ activeDraw, t }) {
  const [walletProviders, setWalletProviders] = useState([]);
  const [walletDetecting, setWalletDetecting] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [issue, setIssue] = useState("");
  const [adminStatus, setAdminStatus] = useState(null);
  const [adminStatusIssue, setAdminStatusIssue] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [connectedWallet, setConnectedWallet] = useState({
    address: "",
    chainId: "",
    label: "",
    provider: null,
  });
  const connected = Boolean(connectedWallet.address);
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
    let active = true;
    fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/status"), {
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
  }, [t]);

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

  async function runDrawAction(action) {
    const broadcast = action === "broadcast";
    setIssue("");
    setRunResult(null);

    if (!connectedWallet.address) {
      setIssue(t("draw.operatorWalletMissing"));
      return;
    }
    if (!targetMatched) {
      setIssue(t("draw.operatorWalletWrongChain", { chain: targetChainLabel(t) }));
      return;
    }
    if (broadcast && !activeDraw.officialFinalsComplete) {
      setIssue(t("draw.operatorDrawFinalsBlocked", {
        finals: formatNumber(activeDraw.officialFinalCount),
        matches: formatNumber(activeDraw.matchCount),
        remaining: formatNumber(activeDraw.officialFinalsRemaining),
      }));
      return;
    }
    if (broadcast && typeof window !== "undefined") {
      const confirmed = window.confirm(t("draw.operatorDrawBroadcastConfirm", { round: activeDraw.id }));
      if (!confirmed) return;
    }

    setBusyAction(`draw:${action}`);
    try {
      const roundId = activeDraw.id;
      const { payload: challenge } = await fetchJsonWithTimeout(drawAdminEndpoint("/api/draw-admin/challenge"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedWallet.address,
          action,
          roundId,
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
          nonce: challenge.nonce,
          signature,
        }),
        timeoutMs: broadcast ? drawAdminBroadcastTimeoutMs : drawAdminCheckTimeoutMs,
      });
      setRunResult(payload);
      setAdminStatus((current) => ({
        ...(current || {}),
        running: false,
        lastRun: payload.lastRun || current?.lastRun || null,
      }));
      if (payload?.ok && (broadcast || payload?.result?.winnersOut) && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("renaiss:draw-winners-updated", {
          detail: {
            roundId,
            action,
            generatedAt: payload?.result?.generatedAt || new Date().toISOString(),
          },
        }));
      }
    } catch (error) {
      setIssue(error?.payload?.error || error?.message || t("draw.operatorDrawFailed"));
      if (error?.payload) setRunResult(error.payload);
    } finally {
      setBusyAction("");
    }
  }

  async function switchTargetChain() {
    if (!connectedWallet.provider?.request) return;
    setIssue("");
    setBusyAction("switch-chain");
    try {
      await connectedWallet.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetDrawChainId }],
      });
      setConnectedWallet((current) => ({
        ...current,
        chainId: targetDrawChainId,
      }));
    } catch (error) {
      setIssue(error instanceof Error ? error.message : t("draw.operatorWalletFailed"));
    } finally {
      setBusyAction("");
    }
  }

  const adminReady = Boolean(
    adminStatus?.enabled
    && adminStatus?.contractConfigured
    && adminStatus?.rpcConfigured
    && adminStatus?.broadcasterConfigured
    && adminStatus?.allowlistConfigured
    && adminStatus?.matchDrawLedgerExists,
  );
  const canRunDraw = connected && targetMatched && adminReady && !busyAction;
  const canBroadcastDraw = canRunDraw && activeDraw.officialFinalsComplete;
  const statusParts = [
    adminStatus?.contractConfigured ? t("draw.operatorDrawContractReady") : t("draw.operatorDrawContractMissing"),
    adminStatus?.matchDrawLedgerExists ? t("draw.operatorDrawLedgerReady") : t("draw.operatorDrawLedgerMissing"),
  ];
  const finalsNotice = activeDraw.officialFinalsComplete
    ? t("draw.operatorDrawFinalsReady", {
      finals: formatNumber(activeDraw.officialFinalCount),
      matches: formatNumber(activeDraw.matchCount),
    })
    : t("draw.operatorDrawFinalsPending", {
      finals: formatNumber(activeDraw.officialFinalCount),
      matches: formatNumber(activeDraw.matchCount),
      remaining: formatNumber(activeDraw.officialFinalsRemaining),
    });
  const plannedSteps = Array.isArray(runResult?.result?.plannedSteps) ? runResult.result.plannedSteps : [];
  const txs = Array.isArray(runResult?.result?.txs) ? runResult.result.txs : [];

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
            <dd>{targetChainLabel(t)}</dd>
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
              disabled={Boolean(busyAction)}
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
          <button type="button" disabled={Boolean(busyAction)} onClick={switchTargetChain}>
            {busyAction === "switch-chain" ? <Loader2 className="is-spinning" size={15} /> : <Network size={15} strokeWidth={2.2} />}
            <span>{t("draw.operatorWalletSwitch", { chain: targetChainLabel(t) })}</span>
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
        <p>
          {adminStatus?.enabled === false
            ? t("draw.operatorDrawDisabled")
            : adminStatusIssue || statusParts.join(" · ")}
        </p>
        {adminStatus?.contractAddress ? (
          <code>{compactAddress(adminStatus.contractAddress)}</code>
        ) : null}
        <p className={["draw-operator-wallet__finals", activeDraw.officialFinalsComplete ? "is-ready" : "is-warning"].join(" ")}>
          {finalsNotice}
        </p>
        <div className="draw-operator-wallet__actions">
          <button
            type="button"
            disabled={!canRunDraw}
            onClick={() => runDrawAction("verify")}
          >
            {busyAction === "draw:verify" ? <Loader2 className="is-spinning" size={15} /> : <ShieldCheck size={15} strokeWidth={2.2} />}
            <span>{t("draw.operatorDrawVerify")}</span>
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={!canBroadcastDraw}
            onClick={() => runDrawAction("broadcast")}
          >
            {busyAction === "draw:broadcast" ? <Loader2 className="is-spinning" size={15} /> : <Award size={15} strokeWidth={2.2} />}
            <span>{t("draw.operatorDrawBroadcast")}</span>
          </button>
        </div>
      </section>

      {runResult ? (
        <section className={["draw-operator-wallet__result", runResult.ok ? "is-ready" : "is-warning"].filter(Boolean).join(" ")}>
          <strong>{runResult.ok ? t("draw.operatorDrawRunOk") : t("draw.operatorDrawRunFailed")}</strong>
          <p>
            {runResult.result?.broadcast
              ? t("draw.operatorDrawBroadcasted")
              : t("draw.operatorDrawDryRun")}
          </p>
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
                <span>{match.id.toUpperCase()}</span>
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
