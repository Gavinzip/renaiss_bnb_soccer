import { CheckCircle2, ExternalLink, Loader2, LockKeyhole, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Stepper, { Step } from "../Stepper/Stepper";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";
import { fetchJsonWithTimeout } from "../../utils/httpClient";
import "./XFollowGate.css";

const RETRY_GATED_STATUSES = new Set(["rate_limited", "api_error", "retry_later"]);
const RENAISS_OFFICIAL_URL = "https://www.renaiss.xyz/";
const FIREFLY_ELIGIBILITY_LINKS = {
  firefly: "https://firefly.social/signup?step=login_social_platform",
  overall: "https://firefly.social/settings/wallets",
  predict: "https://firefly.social/prediction/category/fifwc",
};

function xLoginHref() {
  let returnTo = "/?view=vote&auth=success&xgate=1";

  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "vote");
    url.searchParams.set("auth", "success");
    url.searchParams.set("xgate", "1");
    returnTo = `${url.pathname}${url.search}${url.hash}`;
  }

  return `/api/auth/x/start?connect=1&return_to=${encodeURIComponent(returnTo)}`;
}

function statusMessageKey(status) {
  const map = {
    not_following: "xFollowGate.statusNotFollowing",
    rate_limited: "xFollowGate.statusRateLimited",
    api_error: "xFollowGate.statusApiError",
    x_api_credits_depleted: "xFollowGate.statusXApiCreditsDepleted",
    x_token_missing: "xFollowGate.statusTokenMissing",
    retry_later: "xFollowGate.statusRetryLater",
    skip_disabled: "xFollowGate.statusSkipDisabled",
    session_secret_missing: "xFollowGate.statusSkipUnavailable",
    wallet_required: "xFollowGate.statusWalletRequired",
    profile_store_missing: "xFollowGate.statusProfileStoreMissing",
    renaiss_twitter_required: "xFollowGate.statusRenaissTwitterRequired",
    twitter_identity_missing: "xFollowGate.statusTwitterMissing",
    twitter_identity_mismatch: "xFollowGate.statusTwitterMismatch",
  };
  return map[status] || "xFollowGate.statusIdle";
}

function eligibilityStatusMessageKey(status) {
  const map = {
    api_error: "xFollowGate.statusEligibilityApiError",
    eligibility_expired: "xFollowGate.statusEligibilityExpired",
    ineligible: "xFollowGate.statusEligibilityIneligible",
    login_required: "xFollowGate.statusEligibilityLoginRequired",
    missing_firefly_account: "xFollowGate.statusMissingFireflyAccount",
    missing_predict_bet: "xFollowGate.statusMissingPredictBet",
    rate_limited: "xFollowGate.statusEligibilityRateLimited",
    request_timeout: "xFollowGate.statusEligibilityTimeout",
    service_unconfigured: "xFollowGate.statusEligibilityUnconfigured",
    unverified: "xFollowGate.statusEligibilityIdle",
    wallet_required: "xFollowGate.statusWalletRequired",
    x_follow_required: "xFollowGate.statusEligibilityFollowRequired",
    x_identity_required: "xFollowGate.statusEligibilityIdentityRequired",
  };
  return map[status] || "xFollowGate.statusEligibilityIdle";
}

function initialStepForSession(authSession) {
  const xFollow = authSession?.xFollow || {};
  if (xFollow.bypassed && xFollow.gatePassed) return 3;
  if (!authSession?.authenticated || !authSession?.walletAddress || !xFollow.xConnected) return 1;
  if (!xFollow.gatePassed) return 2;
  return 3;
}

function eligibilityCheckState(value) {
  if (value === true) return "pass";
  if (value === false) return "fail";
  return "pending";
}

function csrfHeadersForSession(authSession) {
  const token = String(authSession?.csrfToken || "").trim();
  return token ? { "x-csrf-token": token } : {};
}

export function XFollowGate({
  authSession,
  authConfig,
  authEndpointReady,
  onRefreshAuth,
  onRequestClose,
  onRequestLogin,
}) {
  const { t } = useCampaignCopy();
  const [activeStep, setActiveStep] = useState(() => initialStepForSession(authSession));
  const [verifying, setVerifying] = useState(false);
  const [verifyingEligibility, setVerifyingEligibility] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [issue, setIssue] = useState("");
  const [eligibilityIssue, setEligibilityIssue] = useState("");
  const [localStatus, setLocalStatus] = useState(authSession?.xFollow || null);
  const [localEligibilityStatus, setLocalEligibilityStatus] = useState(authSession?.xAccountEligibility || null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const gate = localStatus || authSession?.xFollow || {};
  const eligibility = localEligibilityStatus || authSession?.xAccountEligibility || {};
  const gateConfig = authConfig?.xFollowGate || gate.target || {};
  const eligibilityConfig = authConfig?.xAccountEligibility || {};
  const target = gate.target || gateConfig;
  const targetHandle = target?.handle || gateConfig.targetHandle || "thefireflyapp";
  const targetUrl = target?.url || gateConfig.targetUrl || `https://x.com/${targetHandle}`;
  const xConnected = Boolean(gate.xConnected);
  const needsRenaissSession = authEndpointReady && (!authSession?.authenticated || !authSession?.walletAddress);
  const identityBlockingStatus = ["wallet_required", "profile_store_missing", "renaiss_twitter_required"].includes(gate.status);
  const identityIssueStatus = ["wallet_required", "profile_store_missing", "renaiss_twitter_required", "twitter_identity_missing", "twitter_identity_mismatch"].includes(gate.status);
  const identityIssue = identityIssueStatus ? t(statusMessageKey(gate.status)) : "";
  const xProviderReady = Boolean(authConfig?.providers?.x) && !identityBlockingStatus && !needsRenaissSession;
  const eligibilityRequired = eligibility.required ?? eligibilityConfig.required ?? true;
  const eligibilityGatePassed = !eligibilityRequired || Boolean(eligibility.gatePassed);
  const skipEnabled = Boolean(gate.skipEnabled || gateConfig.skipEnabled);
  const retryUntilMs = useMemo(() => {
    if (!RETRY_GATED_STATUSES.has(gate.status)) return 0;

    const lastCheckedAtMs = Date.parse(gate.lastCheckedAt || "");
    const configuredSeconds = Math.max(0, Number(gateConfig.retrySeconds || 0));
    if (Number.isFinite(lastCheckedAtMs) && configuredSeconds > 0) {
      return lastCheckedAtMs + configuredSeconds * 1000;
    }

    const serverSeconds = Math.max(0, Number(gate.retryAfterSeconds || 0));
    return serverSeconds > 0 ? Date.now() + serverSeconds * 1000 : 0;
  }, [gate.lastCheckedAt, gate.retryAfterSeconds, gate.status, gateConfig.retrySeconds]);
  const retryAfterSeconds = retryUntilMs > nowMs ? Math.ceil((retryUntilMs - nowMs) / 1000) : 0;
  const canContinueToFollow = authEndpointReady && xConnected && !identityIssueStatus && !needsRenaissSession;
  const canVerify = authEndpointReady && xConnected && xProviderReady && !identityIssueStatus && !verifying && !skipping && retryAfterSeconds <= 0;
  const canContinueToEligibility = authEndpointReady && Boolean(gate.gatePassed);
  const canVerifyEligibility = authEndpointReady && Boolean(gate.gatePassed) && !eligibilityGatePassed && !verifyingEligibility && !verifying && !skipping;
  const canSkip = authEndpointReady && skipEnabled && !verifying && !verifyingEligibility && !skipping;
  const canClose = typeof onRequestClose === "function";
  const eligibilityStatusIssue = eligibilityGatePassed || !eligibility.status
    ? ""
    : t(eligibilityStatusMessageKey(eligibility.status));
  const eligibilityChecks = [
    {
      id: "firefly",
      label: t("xFollowGate.eligibilityCheckFireflyAccount"),
      href: FIREFLY_ELIGIBILITY_LINKS.firefly,
      state: eligibilityCheckState(eligibility.hasFireflyAccount),
    },
    {
      id: "overall",
      label: t("xFollowGate.eligibilityCheckOverall"),
      href: FIREFLY_ELIGIBILITY_LINKS.overall,
      state: eligibilityCheckState(eligibility.eligible),
    },
    {
      id: "predict",
      label: t("xFollowGate.eligibilityCheckPredictBet"),
      href: FIREFLY_ELIGIBILITY_LINKS.predict,
      state: eligibilityCheckState(eligibility.hasPlacedBet),
    },
  ];

  useEffect(() => {
    setLocalStatus((current) => (
      current?.bypassed && current?.gatePassed
        ? current
        : authSession?.xFollow || null
    ));
    setLocalEligibilityStatus(authSession?.xAccountEligibility || null);
    setActiveStep(initialStepForSession(authSession));
  }, [authSession?.authenticated, authSession?.walletAddress, authSession?.xFollow, authSession?.xAccountEligibility]);

  useEffect(() => {
    if (!retryUntilMs || retryUntilMs <= Date.now()) {
      setNowMs(Date.now());
      return undefined;
    }

    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryUntilMs]);

  const stepLabels = useMemo(() => ({
    back: t("xFollowGate.back"),
    next: activeStep === 1
      ? t("xFollowGate.continue")
      : activeStep === 2
        ? gate.gatePassed
          ? t("xFollowGate.continue")
          : verifying
            ? t("xFollowGate.verifying")
            : t("xFollowGate.verify")
        : verifyingEligibility
          ? t("xFollowGate.verifyingEligibility")
          : t("xFollowGate.verifyEligibility"),
    indicators: [
      t("xFollowGate.stepConnect"),
      t("xFollowGate.stepVerify"),
      t("xFollowGate.stepEligibility"),
    ],
  }), [activeStep, gate.gatePassed, t, verifying, verifyingEligibility]);

  async function handleVerify() {
    if (!canVerify) return;

    setIssue("");
    setVerifying(true);
    try {
      const { payload } = await fetchJsonWithTimeout("/api/auth/x-follow/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...csrfHeadersForSession(authSession),
        },
        timeoutMs: 15000,
      });
      setLocalStatus(payload);
      if (!payload.gatePassed) {
        setIssue(t(statusMessageKey(payload.status), { seconds: payload.retryAfterSeconds || 0 }));
        return;
      }
      setActiveStep(3);
      await onRefreshAuth?.();
    } catch (error) {
      if (error?.payload?.status) setLocalStatus(error.payload.status || localStatus);
      const seconds = error?.retryAfterSeconds || 0;
      const key = statusMessageKey(error?.code);
      setIssue(key ? t(key, { seconds }) : error.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleVerifyEligibility() {
    if (!canVerifyEligibility) return;

    setEligibilityIssue("");
    setVerifyingEligibility(true);
    try {
      const { payload } = await fetchJsonWithTimeout("/api/auth/x-account-eligibility/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...csrfHeadersForSession(authSession),
        },
        timeoutMs: 15000,
      });
      setLocalEligibilityStatus(payload);
      if (!payload.gatePassed) {
        setEligibilityIssue(t(eligibilityStatusMessageKey(payload.status)));
        return;
      }
      await onRefreshAuth?.();
    } catch (error) {
      if (error?.payload?.status) setLocalEligibilityStatus(error.payload.status || localEligibilityStatus);
      const key = eligibilityStatusMessageKey(error?.code || error?.payload?.code);
      setEligibilityIssue(key ? t(key) : error.message);
    } finally {
      setVerifyingEligibility(false);
    }
  }

  async function handleSkip() {
    if (!canSkip) return;

    setIssue("");
    setSkipping(true);
    try {
      const { payload } = await fetchJsonWithTimeout("/api/auth/x-follow/skip", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...csrfHeadersForSession(authSession),
        },
        timeoutMs: 15000,
      });
      setLocalStatus(payload);
      await onRefreshAuth?.();
      setLocalStatus(payload);
      if (payload?.gatePassed) setActiveStep(3);
    } catch (error) {
      if (error?.payload?.status) setLocalStatus(error.payload.status || localStatus);
      const key = statusMessageKey(error?.code);
      setIssue(key ? t(key) : error.message);
    } finally {
      setSkipping(false);
    }
  }

  function stepComplete(step) {
    if (step === 1) return Boolean((gate.bypassed && gate.gatePassed) || (authSession?.walletAddress && xConnected && !identityIssueStatus));
    if (step === 2) return Boolean(gate.gatePassed);
    if (step === 3) return Boolean(eligibilityGatePassed);
    return false;
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
        initialStep={initialStepForSession({
          ...authSession,
          xFollow: gate,
          xAccountEligibility: eligibility,
        })}
        onStepChange={setActiveStep}
        onFinalStepCompleted={handleVerifyEligibility}
        backButtonText={stepLabels.back}
        nextButtonText={stepLabels.next}
        disableStepIndicators
        stepContainerClassName="x-follow-gate__step-tabs"
        contentClassName="x-follow-gate__step-content"
        footerClassName="x-follow-gate__step-footer"
        renderStepIndicator={({ step, state }) => (
          <span className="x-follow-gate__rail-item">
            <span className="x-follow-gate__rail-node" aria-hidden="true">
              {stepComplete(step) ? <CheckCircle2 size={14} strokeWidth={2.4} /> : String(step).padStart(2, "0")}
            </span>
            <span className="x-follow-gate__rail-copy">
              <span className="x-follow-gate__step-label">{stepLabels.indicators[step - 1]}</span>
              <span className="x-follow-gate__step-state">{t(`xFollowGate.stepState.${stepComplete(step) ? "complete" : state}`)}</span>
            </span>
          </span>
        )}
        nextButtonProps={{
          disabled: activeStep === 1
            ? !canContinueToFollow
            : activeStep === 2
              ? gate.gatePassed ? !canContinueToEligibility : !canVerify
              : !canVerifyEligibility,
          onClick: (event) => {
            if (activeStep === 2 && !gate.gatePassed) {
              event.preventDefault();
              handleVerify();
            }
          },
        }}
      >
        <Step>
          <section className="x-follow-gate__step">
            <span className={xConnected && !needsRenaissSession ? "is-complete" : "is-locked"}>
              {xConnected && !needsRenaissSession ? <CheckCircle2 size={18} /> : <X size={18} />}
              {needsRenaissSession
                ? t("xFollowGate.renaissRequired")
                : xConnected
                  ? t("xFollowGate.xConnected", { username: gate.username ? `@${gate.username}` : "X" })
                  : t("xFollowGate.xRequired")}
            </span>
            <h2>{t("xFollowGate.connectTitle")}</h2>
            {needsRenaissSession ? (
              <p>
                {t("xFollowGate.renaissBodyPrefix")}
                <a
                  className="x-follow-gate__inline-link"
                  href={RENAISS_OFFICIAL_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("xFollowGate.renaissOfficialLink")}
                </a>
                {t("xFollowGate.renaissBodySuffix")}
              </p>
            ) : (
              <p>{t("xFollowGate.connectBody")}</p>
            )}
            {identityIssue ? <p className="x-follow-gate__issue">{identityIssue}</p> : null}
            {needsRenaissSession ? (
              <Magnet
                as="button"
                type="button"
                className="x-follow-gate__action"
                onClick={onRequestLogin}
              >
                <LockKeyhole size={17} strokeWidth={2.35} />
                <span>{t("xFollowGate.signInRenaiss")}</span>
              </Magnet>
            ) : (
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
            )}
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
        <Step>
          <section className="x-follow-gate__step">
            <span className={eligibilityGatePassed ? "is-complete" : "is-locked"}>
              {eligibilityGatePassed ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
              {eligibilityGatePassed ? t("xFollowGate.eligibilityVerified") : t("xFollowGate.eligibilityNotVerified")}
            </span>
            <h2>{t("xFollowGate.eligibilityTitle")}</h2>
            <p>{t("xFollowGate.eligibilityBody")}</p>
            <ul className="x-follow-gate__eligibility-checks" aria-label={t("xFollowGate.eligibilityChecklistAria")}>
              {eligibilityChecks.map((check) => (
                <li key={check.id} className={`is-${check.state}`}>
                  <span className="x-follow-gate__eligibility-icon" aria-hidden="true">
                    {check.state === "pass" ? (
                      <CheckCircle2 size={16} strokeWidth={2.4} />
                    ) : check.state === "fail" ? (
                      <X size={16} strokeWidth={2.4} />
                    ) : (
                      <ShieldCheck size={16} strokeWidth={2.25} />
                    )}
                  </span>
                  <a className="x-follow-gate__eligibility-link" href={check.href} target="_blank" rel="noreferrer">
                    <span>{check.label}</span>
                    <ExternalLink size={13} strokeWidth={2.35} />
                  </a>
                  <strong>{t(`xFollowGate.eligibilityCheckState.${check.state}`)}</strong>
                </li>
              ))}
            </ul>
            {eligibilityIssue || eligibilityStatusIssue ? (
              <p className="x-follow-gate__issue">{eligibilityIssue || eligibilityStatusIssue}</p>
            ) : null}
            {verifyingEligibility ? (
              <p className="x-follow-gate__checking">
                <Loader2 className="is-spinning" size={16} />
                {t("xFollowGate.checkingEligibility")}
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
