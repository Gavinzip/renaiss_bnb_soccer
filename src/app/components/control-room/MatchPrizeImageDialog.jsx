import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const HOVER_OPEN_DELAY_MS = 300;
const PRIZE_IMAGE_ASPECT_RATIO = 593 / 989;

function getDialogTargetSize() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const isMobile = viewportWidth <= 520;
  const maxHeight = Math.min(
    viewportHeight * (isMobile ? 0.78 : 0.74),
    isMobile ? 620 : 700,
  );
  const maxWidth = Math.min(
    viewportWidth - (isMobile ? 28 : 84),
    viewportWidth * (isMobile ? 0.86 : 0.48),
    isMobile ? 420 : 520,
  );
  const width = Math.min(maxWidth, maxHeight * PRIZE_IMAGE_ASPECT_RATIO);
  const height = width / PRIZE_IMAGE_ASPECT_RATIO;

  return { width, height };
}

function getOriginFrame(geometry) {
  return {
    opacity: 0.98,
    left: geometry.origin.left,
    top: geometry.origin.top,
    width: geometry.origin.width,
    height: geometry.origin.height,
    borderRadius: 8,
  };
}

export function MatchPrizeImageDialog({ copy, matchId, prizeImage }) {
  const { t } = copy;
  const [open, setOpen] = useState(false);
  const [dialogGeometry, setDialogGeometry] = useState(null);
  const triggerRef = useRef(null);
  const hoverOpenTimeoutRef = useRef(0);
  const prefersReducedMotion = useReducedMotion();
  const matchLabel = String(matchId || "").toUpperCase();
  const zoomTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.16, 1, 0.3, 1] };

  const clearHoverOpenTimer = useCallback(() => {
    if (!hoverOpenTimeoutRef.current) return;
    window.clearTimeout(hoverOpenTimeoutRef.current);
    hoverOpenTimeoutRef.current = 0;
  }, []);

  const openDialog = useCallback(() => {
    clearHoverOpenTimer();
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const targetSize = getDialogTargetSize();

    setDialogGeometry(triggerRect ? {
      origin: {
        left: triggerRect.left,
        top: triggerRect.top,
        width: triggerRect.width,
        height: triggerRect.height,
      },
      target: {
        left: Math.max(0, (viewportWidth - targetSize.width) / 2),
        top: Math.max(0, (viewportHeight - targetSize.height) / 2),
        width: targetSize.width,
        height: targetSize.height,
      },
      viewportWidth,
      viewportHeight,
    } : null);
    setOpen(true);
  }, [clearHoverOpenTimer]);

  const closeDialog = useCallback(() => {
    clearHoverOpenTimer();
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [clearHoverOpenTimer]);

  const scheduleMouseHoverOpen = useCallback(() => {
    if (open) return;
    clearHoverOpenTimer();
    hoverOpenTimeoutRef.current = window.setTimeout(openDialog, HOVER_OPEN_DELAY_MS);
  }, [clearHoverOpenTimer, open, openDialog]);

  const schedulePointerHoverOpen = useCallback((event) => {
    if (event.pointerType === "touch") return;
    scheduleMouseHoverOpen();
  }, [scheduleMouseHoverOpen]);

  const originFrame = dialogGeometry ? getOriginFrame(dialogGeometry) : null;
  const zoomFrameMotion = !prefersReducedMotion && dialogGeometry ? {
    initial: {
      ...originFrame,
    },
    animate: {
      opacity: 1,
      left: dialogGeometry.target.left,
      top: dialogGeometry.target.top,
      width: dialogGeometry.target.width,
      height: dialogGeometry.target.height,
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
            style={dialogGeometry ? {
              "--match-prize-dialog-left": `${dialogGeometry.target.left}px`,
              "--match-prize-dialog-top": `${dialogGeometry.target.top}px`,
              "--match-prize-dialog-width": `${dialogGeometry.target.width}px`,
              "--match-prize-dialog-height": `${dialogGeometry.target.height}px`,
            } : undefined}
          >
            <motion.button
              type="button"
              initial={zoomFrameMotion.initial}
              animate={zoomFrameMotion.animate}
              exit={zoomFrameMotion.exit}
              transition={zoomTransition}
              className="match-prize-dialog__image-frame"
              onClick={closeDialog}
              aria-label={t("vote.closePrizeImage")}
              style={dialogGeometry ? {
                "--match-prize-dialog-left": `${dialogGeometry.target.left}px`,
                "--match-prize-dialog-top": `${dialogGeometry.target.top}px`,
                "--match-prize-dialog-width": `${dialogGeometry.target.width}px`,
                "--match-prize-dialog-height": `${dialogGeometry.target.height}px`,
              } : undefined}
            >
              <img
                className="match-prize-dialog__image"
                src={prizeImage}
                alt={t("vote.matchPrizeOriginalAlt")}
                decoding="async"
              />
            </motion.button>
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

  useEffect(() => clearHoverOpenTimer, [clearHoverOpenTimer]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="match-prize-lane__prize-trigger"
        onClick={openDialog}
        onMouseEnter={scheduleMouseHoverOpen}
        onMouseLeave={clearHoverOpenTimer}
        onPointerEnter={schedulePointerHoverOpen}
        onPointerLeave={clearHoverOpenTimer}
        onPointerCancel={clearHoverOpenTimer}
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
            src={prizeImage}
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
