import { useEffect, useState } from "react";

import { buildPokemon30LoginUrl } from "./pokemon30Auth";

const INITIAL_STATUS = {
  kind: "loading",
  entry: null,
  walletAddress: "",
  message: "正在安全讀取帳戶資格。",
};

async function readJsonResponse(path, signal) {
  const response = await fetch(path, {
    signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error("資格服務回傳了無法讀取的資料。");
  }
  return { response, body };
}

function walletLabel(walletAddress) {
  if (!walletAddress || walletAddress.length < 12) return "已登入";
  return `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
}

function copyForStatus(status) {
  switch (status.kind) {
    case "login_required":
      return { eyebrow: "RENAISS SSO", heading: "登入後查看我的資格", detail: "系統只會讀取與 Renaiss SSO 帳戶綁定的錢包；不會公開任何人的票數。" };
    case "wallet_required":
      return { eyebrow: "錢包尚未綁定", heading: "請先在 Renaiss 完成錢包綁定", detail: "完成綁定後，才能依登入帳戶安全顯示這次活動的對帳結果。" };
    case "reconciling":
      return { eyebrow: "對帳處理中", heading: "票券帳本尚未就緒", detail: "尚未完成鏈上回收額與 checkout 對帳，因此暫不顯示或推估票數。" };
    case "unavailable":
      return { eyebrow: "暫時無法讀取", heading: "資格服務暫時不可用", detail: "請稍後重新整理頁面；系統未回傳任何推估票數。" };
    case "ready":
      return { eyebrow: "已完成鏈上對帳", heading: "我的抽獎資格", detail: "只計入已完成 buyback，且鏈上回收額不高於對應卡機最低等級門檻的紀錄。" };
    default:
      return { eyebrow: "RENAISS SSO", heading: "正在讀取我的資格", detail: status.message };
  }
}

export function PokemonTicketStatus() {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const copy = copyForStatus(status);
  const canLogin = status.kind === "login_required";
  const isReady = status.kind === "ready";
  const tickets = status.entry?.tickets ?? 0;

  useEffect(() => {
    const controller = new AbortController();

    async function loadStatus() {
      try {
        const sessionResult = await readJsonResponse("/api/auth/me", controller.signal);
        const session = sessionResult.body;
        if (!sessionResult.response.ok) throw new Error("資格服務暫時無法確認登入狀態。");
        if (!session?.authenticated) {
          setStatus({ kind: "login_required", entry: null, walletAddress: "", message: "" });
          return;
        }
        if (session.requiresWalletLink || !session.walletAddress) {
          setStatus({ kind: "wallet_required", entry: null, walletAddress: "", message: "" });
          return;
        }

        const ticketResult = await readJsonResponse("/api/pokemon30/raffle-entry", controller.signal);
        const ticketPayload = ticketResult.body;
        if (ticketResult.response.status === 401) {
          setStatus({ kind: "login_required", entry: null, walletAddress: "", message: "" });
          return;
        }
        if (!ticketResult.response.ok) {
          if (ticketPayload?.sourceStatus && ticketPayload.sourceStatus !== "ready") {
            setStatus({ kind: "reconciling", entry: null, walletAddress: session.walletAddress, message: "" });
            return;
          }
          throw new Error(ticketPayload?.error || "資格服務暫時不可用。");
        }
        if (ticketPayload?.sourceStatus !== "ready") {
          setStatus({ kind: "reconciling", entry: null, walletAddress: session.walletAddress, message: "" });
          return;
        }
        setStatus({ kind: "ready", entry: ticketPayload.entry || null, walletAddress: session.walletAddress, message: "" });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setStatus({
          kind: "unavailable",
          entry: null,
          walletAddress: "",
          message: error instanceof Error ? error.message : "資格服務暫時不可用。",
        });
      }
    }

    loadStatus();
    return () => controller.abort();
  }, []);

  return (
    <aside className={`pokemon-ticket-status pokemon-ticket-status--${status.kind}`} aria-live="polite">
      <div className="pokemon-ticket-status__copy">
        <span>{copy.eyebrow}</span>
        <strong>{copy.heading}</strong>
        <p>{copy.detail}</p>
      </div>
      {isReady ? (
        <div className="pokemon-ticket-status__balance">
          <span>{walletLabel(status.walletAddress)}</span>
          <strong>{tickets}</strong>
          <b>張抽獎券</b>
        </div>
      ) : null}
      {canLogin ? (
        <a className="pokemon-ticket-status__login" href={buildPokemon30LoginUrl()}>
          使用 Renaiss SSO 登入
        </a>
      ) : null}
    </aside>
  );
}
