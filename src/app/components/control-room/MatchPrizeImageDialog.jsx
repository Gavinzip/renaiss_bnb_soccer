import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import matchPrizeCardImage from "../../assets/match-prize-card.webp";
import matchPrizeOriginalImage from "../../assets/match-prize-card-original.webp";

function getDialogTargetSize() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const mobileMaxHeightRatio = viewportWidth <= 520 ? 0.82 : 0.88;

  return Math.min(
    viewportWidth * 0.88,
    viewportHeight * mobileMaxHeightRatio,
    760,
    840,
  );
}

function getOriginFrame(geometry) {
  return {
    opacity: 0.98,
    x: geometry.origin.left + (geometry.origin.width / 2) - (geometry.viewportWidth / 2),
    y: geometry.origin.top + (geometry.origin.height / 2) - (geometry.viewportHeight / 2),
    width: geometry.origin.width,
    height: geometry.origin.height,
    borderRadius: 8,
  };
}

export function MatchPrizeImageDialog({ copy, matchId }) {
  const { t } = copy;
  const [open, setOpen] = useState(false);
  const [dialogGeometry, setDialogGeometry] = useState(null);
  const triggerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const matchLabel = String(matchId || "").toUpperCase();
  const zoomTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", bounce: 0.02, duration: 0.62 };

  const openDialog = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    setDialogGeometry(triggerRect ? {
      origin: {
        left: triggerRect.left,
        top: triggerRect.top,
        width: triggerRect.width,
        height: triggerRect.height,
      },
      targetSize: getDialogTargetSize(),
      viewportWidth,
      viewportHeight,
    } : null);
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const originFrame = dialogGeometry ? getOriginFrame(dialogGeometry) : null;
  const zoomFrameMotion = !prefersReducedMotion && dialogGeometry ? {
    initial: {
      ...originFrame,
    },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      width: dialogGeometry.targetSize,
      height: dialogGeometry.targetSize,
      borderRadius: 18,
    },
    exit: {
      ...originFrame,
    },
  } : {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
  };

  const dialogLayer = (
    <AnimatePresence onExitComplete={() => setDialogGeometry(null)}>
      {open ? (
        <motion.aside
          className="match-prize-dialog-layer"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          onClick={closeDialog}
        >
          <motion.section
            className="match-prize-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("vote.matchPrizeImageDialogAria", { match: matchLabel })}
            onClick={(event) => event.stopPropagation()}
          >
            <motion.div
              initial={zoomFrameMotion.initial}
              animate={zoomFrameMotion.animate}
              exit={zoomFrameMotion.exit}
              transition={zoomTransition}
              className="match-prize-dialog__image-frame"
            >
              <img
                className="match-prize-dialog__image"
                src={matchPrizeOriginalImage}
                alt={t("vote.matchPrizeOriginalAlt")}
                decoding="async"
              />
            </motion.div>
            <button
              type="button"
              className="match-prize-dialog__close"
              onClick={closeDialog}
              aria-label={t("vote.closePrizeImage")}
            >
              <X size={18} strokeWidth={2.35} />
            </button>
          </motion.section>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") closeDialog();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDialog, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="match-prize-lane__prize-trigger"
        onClick={openDialog}
        aria-label={t("vote.openPrizeImage", { match: matchLabel })}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <motion.span
          className="match-prize-lane__prize-frame"
          whileHover={prefersReducedMotion ? undefined : { scale: 1.035 }}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <img
            className="match-prize-lane__prize"
            src={matchPrizeCardImage}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
          />
        </motion.span>
        <span className="match-prize-lane__prize-expand" aria-hidden="true">
          <Maximize2 size={11} strokeWidth={2.4} />
        </span>
      </button>

      {typeof document === "undefined" ? dialogLayer : createPortal(dialogLayer, document.body)}
    </>
  );
}
