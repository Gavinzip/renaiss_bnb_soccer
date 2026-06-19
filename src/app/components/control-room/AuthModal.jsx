import { AtSign, Chrome, Loader2, Mail, MessageCircle, ShieldCheck, WalletCards, X } from "lucide-react";
import { useMemo, useState } from "react";
import { compactAddress } from "../../data/ticketMath";
import { Magnet } from "../Magnet";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

function providerEnabled(authConfig, provider) {
  return Boolean(authConfig?.providers?.[provider]);
}

function providerHref(provider) {
  return `/api/auth/${provider}/start`;
}

function authErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export function AuthModal({
  open,
  authSession,
  authConfig,
  authIssue,
  authEndpointReady,
  onClose,
  onRefresh,
}) {
  const { t } = useCampaignCopy();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailStep, setEmailStep] = useState("email");
  const [busyAction, setBusyAction] = useState("");
  const [localIssue, setLocalIssue] = useState("");
  const walletLinked = Boolean(authSession?.walletAddress);
  const hasBackend = Boolean(authEndpointReady);
  const canUseEmail = hasBackend && providerEnabled(authConfig, "email");
  const canUseWallet = hasBackend && providerEnabled(authConfig, "wallet");
  const providerRows = useMemo(() => ([
    {
      id: "google",
      Icon: Chrome,
      label: t("auth.google"),
      enabled: hasBackend && providerEnabled(authConfig, "google"),
      href: providerHref("google"),
    },
    {
      id: "x",
      Icon: X,
      label: t("auth.x"),
      enabled: hasBackend && providerEnabled(authConfig, "x"),
      href: providerHref("x"),
    },
    {
      id: "discord",
      Icon: MessageCircle,
      label: t("auth.discord"),
      enabled: hasBackend && providerEnabled(authConfig, "discord"),
      href: providerHref("discord"),
    },
  ]), [authConfig, hasBackend, t]);

  if (!open) return null;

  async function handleWalletLogin() {
    setLocalIssue("");
    if (!window.ethereum?.request) {
      setLocalIssue(t("auth.walletMissing"));
      return;
    }

    setBusyAction("wallet");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts?.[0];
      if (!address) throw new Error(t("auth.walletMissing"));

      const nonceResponse = await fetch(`/api/auth/wallet/nonce?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const noncePayload = await nonceResponse.json().catch(() => ({}));
      if (!nonceResponse.ok) throw new Error(noncePayload.error || `HTTP ${nonceResponse.status}`);

      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [noncePayload.message, address],
      });

      const verifyResponse = await fetch("/api/auth/wallet/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          message: noncePayload.message,
          signature,
        }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) throw new Error(verifyPayload.error || `HTTP ${verifyResponse.status}`);
      await onRefresh?.();
      onClose?.();
    } catch (error) {
      setLocalIssue(authErrorMessage(error, t("auth.walletFailed")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleSendOtp(event) {
    event.preventDefault();
    setLocalIssue("");
    setBusyAction("email");
    try {
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setEmailStep("otp");
    } catch (error) {
      setLocalIssue(authErrorMessage(error, t("auth.emailFailed")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setLocalIssue("");
    setBusyAction("otp");
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: otp }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await onRefresh?.();
      onClose?.();
    } catch (error) {
      setLocalIssue(authErrorMessage(error, t("auth.otpFailed")));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="auth-modal-backdrop" role="presentation">
      <section className="auth-modal" role="dialog" aria-modal="true" aria-label={t("auth.title")}>
        <header className="auth-modal__header">
          <span>
            <ShieldCheck size={18} strokeWidth={2.25} />
            {t("auth.eyebrow")}
          </span>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={19} strokeWidth={2.25} />
          </button>
        </header>

        <section className="auth-modal__intro">
          <h2>{walletLinked ? t("auth.linkedTitle") : t("auth.title")}</h2>
          <p>{walletLinked ? t("auth.linkedBody", { wallet: compactAddress(authSession.walletAddress) }) : t("auth.body")}</p>
        </section>

        {!hasBackend ? <p className="auth-modal__issue">{t("auth.backendMissing")}</p> : null}
        {authIssue ? <p className="auth-modal__issue">{authIssue}</p> : null}
        {localIssue ? <p className="auth-modal__issue">{localIssue}</p> : null}

        <div className="auth-provider-list">
          {providerRows.map(({ id, Icon, label, enabled, href }) => (
            <a
              key={id}
              className={!enabled ? "is-disabled" : ""}
              href={enabled ? href : undefined}
              aria-disabled={!enabled}
              onClick={(event) => {
                if (!enabled) event.preventDefault();
              }}
            >
              <Icon size={18} strokeWidth={2.15} />
              <span>{label}</span>
              <em>{enabled ? t("auth.openProvider") : t("auth.notConfigured")}</em>
            </a>
          ))}

          <button type="button" disabled={!canUseWallet || busyAction === "wallet"} onClick={handleWalletLogin}>
            {busyAction === "wallet" ? <Loader2 className="is-spinning" size={18} /> : <WalletCards size={18} strokeWidth={2.15} />}
            <span>{t("auth.wallet")}</span>
            <em>{canUseWallet ? t("auth.signWallet") : t("auth.notConfigured")}</em>
          </button>
        </div>

        <form className="auth-email-form" onSubmit={emailStep === "otp" ? handleVerifyOtp : handleSendOtp}>
          <label>
            <span>{t("auth.email")}</span>
            <div>
              <AtSign size={18} strokeWidth={2.15} />
              <input
                type="email"
                value={email}
                placeholder="abc@renaiss.xyz"
                autoComplete="email"
                disabled={!canUseEmail || emailStep === "otp"}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </label>
          {emailStep === "otp" ? (
            <label>
              <span>{t("auth.otp")}</span>
              <div>
                <Mail size={18} strokeWidth={2.15} />
                <input
                  inputMode="numeric"
                  value={otp}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  disabled={!canUseEmail}
                  maxLength={6}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
            </label>
          ) : null}
          <Magnet as="button" type="submit" disabled={!canUseEmail || Boolean(busyAction)}>
            {busyAction ? <Loader2 className="is-spinning" size={18} /> : <Mail size={18} strokeWidth={2.15} />}
            <span>{emailStep === "otp" ? t("auth.verifyOtp") : t("auth.sendOtp")}</span>
          </Magnet>
        </form>
      </section>
    </div>
  );
}
