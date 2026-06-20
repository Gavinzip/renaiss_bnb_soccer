import { CheckCircle2, ExternalLink, Loader2, LockKeyhole, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Stepper, { Step } from "../Stepper/Stepper";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import "./XFollowGate.css";

function xLoginHref() {
  return `/api/auth/x/start?return_to=${encodeURIComponent("/?view=vote&auth=success")}`;
}

function statusMessageKey(status) {
  const map = {
    not_following: "xFollowGate.statusNotFollowing",
    rate_limited: "xFollowGate.statusRateLimited",
    api_error: "xFollowGate.statusApiError",
    x_token_missing: "xFollowGate.statusTokenMissing",
    retry_later: "xFollowGate.statusRetryLater",
    skip_disabled: "xFollowGate.statusSkipDisabled",
    session_secret_missing: "xFollowGate.statusSkipUnavailable",
  };
  return map[status] || "xFollowGate.statusIdle";
}

export function XFollowGate({
  authSession,
  authConfig,
  authEndpointReady,
  onRefreshAuth,
  onRequestClose,
}) {
  const { t } = useCampaignCopy();
  const [activeStep, setActiveStep] = useState(authSession?.xFollow?.xConnected ? 2 : 1);
  const [verifying, setVerifying] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [issue, setIssue] = useState("");
  const [localStatus, setLocalStatus] = useState(authSession?.xFollow || null);
  const gate = localStatus || authSession?.xFollow || {};
  const gateConfig = authConfig?.xFollowGate || gate.target || {};
  const target = gate.target || gateConfig;
  const targetHandle = target?.handle || gateConfig.targetHandle || "thefireflyapp";
  const targetUrl = target?.url || gateConfig.targetUrl || `https://x.com/${targetHandle}`;
  const xConnected = Boolean(gate.xConnected);
  const xProviderReady = Boolean(authConfig?.providers?.x);
  const skipEnabled = Boolean(gate.skipEnabled || gateConfig.skipEnabled);
  const retryAfterSeconds = Math.max(0, Number(gate.retryAfterSeconds || 0));
  const canContinueToVerify = authEndpointReady && xConnected;
  const canVerify = authEndpointReady && xConnected && xProviderReady && !verifying && !skipping && retryAfterSeconds <= 0;
  const canSkip = authEndpointReady && skipEnabled && !verifying && !skipping;
  const canClose = typeof onRequestClose === "function";

  useEffect(() => {
    setLocalStatus(authSession?.xFollow || null);
    setActiveStep(authSession?.xFollow?.xConnected ? 2 : 1);
  }, [authSession?.xFollow]);

  const stepLabels = useMemo(() => ({
    back: t("xFollowGate.back"),
    next: activeStep === 1 ? t("xFollowGate.continue") : verifying ? t("xFollowGate.verifying") : t("xFollowGate.verify"),
    indicators: [
      t("xFollowGate.stepConnect"),
      t("xFollowGate.stepVerify"),
    ],
  }), [activeStep, t, verifying]);

  async function handleVerify() {
    if (!canVerify) return;

    setIssue("");
    setVerifying(true);
    try {
      const response = await fetch("/api/auth/x-follow/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLocalStatus(payload.status || localStatus);
        throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), {
          code: payload.code,
          retryAfterSeconds: payload.retryAfterSeconds,
        });
      }
      setLocalStatus(payload);
      if (!payload.gatePassed) {
        setIssue(t(statusMessageKey(payload.status), { seconds: payload.retryAfterSeconds || 0 }));
        return;
      }
      await onRefreshAuth?.();
    } catch (error) {
      const seconds = error?.retryAfterSeconds || 0;
      const key = statusMessageKey(error?.code);
      setIssue(key ? t(key, { seconds }) : error.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSkip() {
    if (!canSkip) return;

    setIssue("");
    setSkipping(true);
    try {
      const response = await fetch("/api/auth/x-follow/skip", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLocalStatus(payload.status || localStatus);
        throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), {
          code: payload.code,
        });
      }
      setLocalStatus(payload);
      await onRefreshAuth?.();
    } catch (error) {
      const key = statusMessageKey(error?.code);
      setIssue(key ? t(key) : error.message);
    } finally {
      setSkipping(false);
    }
  }

  return (
    <section className="x-follow-gate" aria-label={t("xFollowGate.aria")}>
      {canClose ? (
        <button type="button" className="x-follow-gate__close" onClick={onRequestClose} aria-label={t("xFollowGate.close")}>
          <X size={16} strokeWidth={2.35} />
        </button>
      ) : null}
      <header className="x-follow-gate__head">
        <span>
          <LockKeyhole size={16} strokeWidth={2.35} />
          {t("xFollowGate.eyebrow")}
        </span>
        <h1>{t("xFollowGate.title")}</h1>
        <p>{t("xFollowGate.body", { handle: `@${targetHandle}` })}</p>
      </header>

      <Stepper
        initialStep={xConnected ? 2 : 1}
        onStepChange={setActiveStep}
        onFinalStepCompleted={handleVerify}
        backButtonText={stepLabels.back}
        nextButtonText={stepLabels.next}
        disableStepIndicators
        stepContainerClassName="x-follow-gate__step-tabs"
        contentClassName="x-follow-gate__step-content"
        footerClassName="x-follow-gate__step-footer"
        renderStepIndicator={({ step, state }) => (
          <span className="x-follow-gate__rail-item">
            <span className="x-follow-gate__rail-node" aria-hidden="true">
              {step < activeStep || (step === 2 && gate.gatePassed) ? <CheckCircle2 size={14} strokeWidth={2.4} /> : String(step).padStart(2, "0")}
            </span>
            <span className="x-follow-gate__rail-copy">
              <span className="x-follow-gate__step-label">{stepLabels.indicators[step - 1]}</span>
              <span className="x-follow-gate__step-state">{t(`xFollowGate.stepState.${state}`)}</span>
            </span>
          </span>
        )}
        nextButtonProps={{
          disabled: activeStep === 1 ? !canContinueToVerify : !canVerify,
        }}
      >
        <Step>
          <section className="x-follow-gate__step">
            <span className={xConnected ? "is-complete" : "is-locked"}>
              {xConnected ? <CheckCircle2 size={18} /> : <X size={18} />}
              {xConnected
                ? t("xFollowGate.xConnected", { username: gate.username ? `@${gate.username}` : "X" })
                : t("xFollowGate.xRequired")}
            </span>
            <h2>{t("xFollowGate.connectTitle")}</h2>
            <p>{t("xFollowGate.connectBody")}</p>
            <Magnet
              as="a"
              className={xProviderReady ? "x-follow-gate__action" : "x-follow-gate__action is-disabled"}
              href={xProviderReady ? xLoginHref() : undefined}
              aria-disabled={!xProviderReady}
              onClick={(event) => {
                if (!xProviderReady) event.preventDefault();
              }}
            >
              <X size={17} strokeWidth={2.35} />
              <span>{xConnected ? t("xFollowGate.reconnectX") : t("xFollowGate.connectX")}</span>
            </Magnet>
          </section>
        </Step>
        <Step>
          <section className="x-follow-gate__step">
            <span className={gate.gatePassed ? "is-complete" : "is-locked"}>
              {gate.gatePassed ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
              {gate.verified
                ? t("xFollowGate.verified")
                : gate.bypassed
                  ? t("xFollowGate.skipped")
                  : t("xFollowGate.notVerified")}
            </span>
            <h2>{t("xFollowGate.followTitle", { handle: `@${targetHandle}` })}</h2>
            <p>{t("xFollowGate.followBody")}</p>
            <a className="x-follow-gate__follow-link" href={targetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} strokeWidth={2.35} />
              <span>{t("xFollowGate.openTarget", { handle: `@${targetHandle}` })}</span>
            </a>
            {issue ? <p className="x-follow-gate__issue">{issue}</p> : null}
            {retryAfterSeconds > 0 ? (
              <p className="x-follow-gate__issue">{t("xFollowGate.statusRetryLater", { seconds: retryAfterSeconds })}</p>
            ) : null}
            {verifying ? (
              <p className="x-follow-gate__checking">
                <Loader2 className="is-spinning" size={16} />
                {t("xFollowGate.checking")}
              </p>
            ) : null}
          </section>
        </Step>
      </Stepper>

      {skipEnabled ? (
        <aside className="x-follow-gate__test-skip">
          <p>{t("xFollowGate.skipBody")}</p>
          <button type="button" disabled={!canSkip} onClick={handleSkip}>
            {skipping ? <Loader2 className="is-spinning" size={16} /> : <ShieldOff size={16} strokeWidth={2.35} />}
            <span>{skipping ? t("xFollowGate.skipping") : t("xFollowGate.skipButton")}</span>
          </button>
        </aside>
      ) : null}
    </section>
  );
}
