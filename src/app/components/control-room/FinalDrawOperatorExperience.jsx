import {
  ChevronRight,
  Dices,
  Gift,
  Loader2,
  RefreshCw,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMatchPrizeImage } from "../../data/matchPrizeImages";
import { compactAddress } from "../../data/ticketMath";

const demoWinner = {
  wallet: "0x000000000000000000000000000000000000d3e0",
  ticket: "DEMO-FINAL-071",
};

export function WalletProviderDialog({
  open,
  walletProviders,
  walletDetecting,
  connectedWallet,
  busyAction,
  operationBusy,
  onSelect,
  onDisconnect,
  onClose,
  t,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.setTimeout(
      () => dialogRef.current?.querySelector("button")?.focus(),
      0
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="draw-wallet-dialog"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        className="draw-wallet-dialog__surface"
        role="dialog"
        aria-modal="true"
        aria-label={t("draw.operatorWalletDialogAria")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>
            <WalletCards size={18} strokeWidth={2.1} />
            <strong>{t("draw.operatorWalletDialogTitle")}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("draw.operatorWalletDialogClose")}
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>
        <p>{t("draw.operatorWalletDialogBody")}</p>

        {connectedWallet.address ? (
          <section className="draw-wallet-dialog__connected">
            <span>
              <small>{t("draw.operatorWalletConnected")}</small>
              <strong>
                {connectedWallet.label || t("draw.operatorWalletTitle")}
              </strong>
              <code>{compactAddress(connectedWallet.address)}</code>
            </span>
            <button
              type="button"
              disabled={operationBusy}
              onClick={onDisconnect}
            >
              <RefreshCw size={15} strokeWidth={2.15} />
              {t("draw.operatorWalletDisconnect")}
            </button>
          </section>
        ) : null}

        <div className="draw-wallet-dialog__providers">
          {walletProviders.length > 0 ? (
            walletProviders.map((walletProvider) => {
              const busy = busyAction === `connect:${walletProvider.id}`;
              return (
                <button
                  key={walletProvider.id}
                  type="button"
                  disabled={operationBusy}
                  onClick={() => onSelect(walletProvider)}
                >
                  <span className="draw-wallet-dialog__provider-icon">
                    {busy ? (
                      <Loader2 className="is-spinning" size={18} />
                    ) : (
                      <WalletCards size={18} strokeWidth={2.1} />
                    )}
                  </span>
                  <span>
                    <strong>{walletProvider.label}</strong>
                    <small>{walletProvider.detail}</small>
                  </span>
                  <ChevronRight
                    size={17}
                    strokeWidth={2.15}
                    aria-hidden="true"
                  />
                </button>
              );
            })
          ) : (
            <section className="draw-wallet-dialog__empty">
              <WalletCards size={22} strokeWidth={1.9} />
              <strong>
                {walletDetecting
                  ? t("draw.operatorWalletDetecting")
                  : t("draw.operatorWalletMissing")}
              </strong>
              <p>{t("draw.operatorWalletDialogEmpty")}</p>
            </section>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function DrawSimulationPreview({ activeDraw, onPhaseChange, t }) {
  const reduceMotion = useReducedMotion();
  const timersRef = useRef([]);
  const [phase, setPhase] = useState("idle");
  const prizeImage = getMatchPrizeImage({ roundId: activeDraw.id }, 0);
  const activeStage =
    phase === "idle"
      ? 0
      : phase === "mixing"
      ? 1
      : phase === "revealing"
      ? 2
      : 3;

  function clearTimers() {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }

  function startSimulation() {
    clearTimers();
    setPhase("mixing");
    const revealDelay = reduceMotion ? 160 : 1500;
    const completeDelay = reduceMotion ? 360 : 3400;
    timersRef.current = [
      window.setTimeout(() => setPhase("revealing"), revealDelay),
      window.setTimeout(() => setPhase("complete"), completeDelay),
    ];
  }

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    clearTimers();
    setPhase("idle");
    return clearTimers;
  }, [activeDraw.id]);

  return (
    <section
      className={`draw-simulation is-${phase}`}
      aria-label={t("draw.operatorSimulationAria")}
    >
      <header className="draw-simulation__head">
        <span>
          <Dices size={17} strokeWidth={2.15} />
          <strong>{t("draw.operatorSimulationTitle")}</strong>
        </span>
        <em>{t("draw.operatorSimulationBadge")}</em>
      </header>
      <p>{t("draw.operatorSimulationBody")}</p>

      <ol
        className="draw-simulation__stages"
        aria-label={t("draw.operatorSimulationStagesAria")}
      >
        {["pool", "randomness", "winner"].map((stage, index) => (
          <li className={index < activeStage ? "is-active" : ""} key={stage}>
            <span>{index + 1}</span>
            <strong>
              {t(
                `draw.operatorSimulationStage${stage[0].toUpperCase()}${stage.slice(
                  1
                )}`
              )}
            </strong>
          </li>
        ))}
      </ol>

      <div className="draw-simulation__stage" aria-live="polite">
        <AnimatePresence mode="wait">
          {phase === "idle" ? (
            <motion.section
              className="draw-simulation__idle"
              key="idle"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            >
              <span className="draw-simulation__prize-preview">
                <img src={prizeImage} alt="" />
                <Gift size={24} strokeWidth={1.9} />
              </span>
              <span>
                <small>{t("draw.operatorSimulationPrizeLabel")}</small>
                <strong>{t("draw.operatorSimulationPrizeTitle")}</strong>
                <p>{t("draw.operatorSimulationIdle")}</p>
              </span>
            </motion.section>
          ) : null}

          {phase === "mixing" || phase === "revealing" ? (
            <motion.section
              className="draw-simulation__drawing"
              key="drawing"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 1.015 }}
            >
              <span className="draw-simulation__orb" aria-hidden="true">
                <Dices size={34} strokeWidth={1.75} />
              </span>
              <span>
                <small>
                  {phase === "mixing"
                    ? t("draw.operatorSimulationMixing")
                    : t("draw.operatorSimulationRevealing")}
                </small>
                <strong>
                  {phase === "mixing"
                    ? t("draw.operatorSimulationMixingTitle")
                    : t("draw.operatorSimulationRevealingTitle")}
                </strong>
              </span>
              <div className="draw-simulation__reel" aria-hidden="true">
                {[
                  "0x7A31...2B90",
                  "0x4C18...F721",
                  "0x9E02...11DA",
                  demoWinner.wallet,
                ].map((wallet) => (
                  <code key={wallet}>{wallet}</code>
                ))}
              </div>
            </motion.section>
          ) : null}

          {phase === "complete" ? (
            <motion.section
              className="draw-simulation__result"
              key="complete"
              initial={
                reduceMotion ? false : { opacity: 0, scale: 0.92, y: 18 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 150, damping: 18 }}
            >
              <span className="draw-simulation__celebration" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => (
                  <i style={{ "--particle": index }} key={index} />
                ))}
              </span>
              <span className="draw-simulation__result-image">
                <img src={prizeImage} alt="" />
              </span>
              <span className="draw-simulation__result-copy">
                <small>
                  <Sparkles size={14} strokeWidth={2.1} />{" "}
                  {t("draw.operatorSimulationComplete")}
                </small>
                <strong>{t("draw.operatorSimulationWinnerTitle")}</strong>
                <dl>
                  <div>
                    <dt>{t("draw.operatorSimulationWinnerWallet")}</dt>
                    <dd>{demoWinner.wallet}</dd>
                  </div>
                  <div>
                    <dt>{t("draw.operatorSimulationWinnerTicket")}</dt>
                    <dd>{demoWinner.ticket}</dd>
                  </div>
                </dl>
              </span>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      <footer>
        <p>{t("draw.operatorSimulationDisclaimer")}</p>
        <button
          type="button"
          disabled={phase === "mixing" || phase === "revealing"}
          onClick={startSimulation}
        >
          {phase === "mixing" || phase === "revealing" ? (
            <Loader2 className="is-spinning" size={16} />
          ) : phase === "complete" ? (
            <RefreshCw size={16} strokeWidth={2.15} />
          ) : (
            <Dices size={16} strokeWidth={2.15} />
          )}
          <span>
            {phase === "complete"
              ? t("draw.operatorSimulationAgain")
              : t("draw.operatorSimulationStart")}
          </span>
        </button>
      </footer>
    </section>
  );
}
