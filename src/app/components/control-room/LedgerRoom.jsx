import { Database, RotateCcw, ShieldAlert, Ticket, WalletCards } from "lucide-react";
import { CountUp } from "../CountUp";
import {
  calculateFinalTickets,
  calculateRawTickets,
  compactAddress,
  formatNumber,
  ticketRangeLabel,
} from "../../data/ticketMath";
import { ledgerApiContract } from "../../data/ticketLedgerSnapshot";
import { useCampaignCopy } from "../../i18n/useCampaignCopy";

function WalletSelector({ ledger, selectedWallet, onSelectWallet, t }) {
  return (
    <label className="wallet-select">
      <span>{t("ledger.previewWallet")}</span>
      <select value={selectedWallet} onChange={(event) => onSelectWallet(event.target.value)}>
        {ledger.leaderboardEntries.map((entry) => (
          <option key={entry.userAddress} value={entry.userAddress}>
            #{entry.rank} {compactAddress(entry.userAddress)} · {formatNumber(entry.finalTickets)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LedgerRoom({
  ledger,
  ledgerIssue,
  activeEntry,
  selectedWallet,
  activeRound,
  remainingRoundTickets,
  usedRoundTickets,
  onSelectWallet,
}) {
  const { dateTime, roundLabel, sourceLabel, t } = useCampaignCopy();
  const recalculatedRaw = calculateRawTickets(activeEntry?.packs, ledger.packRules);
  const recalculatedFinal = calculateFinalTickets(recalculatedRaw);

  return (
    <section className="ledger-room" aria-label={t("ledger.roomAria")}>
      <article className="ledger-source">
        <header>
          <Database size={22} strokeWidth={2.1} />
          <span>{t("ledger.source")}</span>
          <h2>{sourceLabel(ledger.sourceLabel)}</h2>
        </header>
        <dl>
          <dt>{t("common.totalFinalTickets")}</dt>
          <dd>
            <CountUp value={ledger.totalFinalTickets} formatter={formatNumber} />
          </dd>
          <dt>{t("ledger.rawBonus")}</dt>
          <dd>{formatNumber(ledger.totalRawTickets)}</dd>
          <dt>{t("ledger.generated")}</dt>
          <dd>{dateTime((ledger.generatedAt || 0) * 1000)}</dd>
          <dt>{t("ledger.ledgerHash")}</dt>
          <dd>
            <code>{ledger.ledgerHash}</code>
          </dd>
        </dl>
        {ledgerIssue ? (
          <p className="source-warning">
            <ShieldAlert size={17} strokeWidth={2.2} />
            {ledgerIssue}
          </p>
        ) : null}
      </article>

      <article className="wallet-ledger">
        <header>
          <WalletCards size={22} strokeWidth={2.1} />
          <span>{t("ledger.roundReset", { round: roundLabel(activeRound) })}</span>
          <h2>{formatNumber(remainingRoundTickets)}</h2>
        </header>
        <WalletSelector ledger={ledger} selectedWallet={selectedWallet} onSelectWallet={onSelectWallet} t={t} />
        <dl>
          <dt>{t("ledger.usedInRound")}</dt>
          <dd>{formatNumber(usedRoundTickets)}</dd>
          <dt>{t("ledger.ticketRange")}</dt>
          <dd>{ticketRangeLabel(activeEntry)}</dd>
          <dt>{t("ledger.recalculatedLabel")}</dt>
          <dd>{t("ledger.recalculated", { raw: formatNumber(recalculatedRaw), final: formatNumber(recalculatedFinal) })}</dd>
        </dl>
      </article>

      <article className="pack-matrix">
        <header>
          <Ticket size={22} strokeWidth={2.1} />
          <span>{t("ledger.packWeights")}</span>
          <h2>{t("ledger.onchainTicketMath")}</h2>
        </header>
        <table>
          <thead>
            <tr>
              <th>{t("ledger.pack")}</th>
              <th>{t("ledger.weight")}</th>
              <th>{t("ledger.owned")}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.packRules.map((rule) => (
              <tr key={rule.pack}>
                <td>{rule.label}</td>
                <td>{rule.ticketWeight}</td>
                <td>{formatNumber(activeEntry?.packs?.[rule.pack] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="integration-boundary">
        <header>
          <RotateCcw size={22} strokeWidth={2.1} />
          <span>{t("ledger.serverBoundary")}</span>
          <h2>{t("ledger.frontendReadsSummaryOnly")}</h2>
        </header>
        <p>{t("ledger.boundaryBody")}</p>
        <output className="boundary-env" aria-label={t("ledger.boundaryEnvAria")}>
          {ledgerApiContract.summaryUrlEnv}
        </output>
      </article>
    </section>
  );
}
