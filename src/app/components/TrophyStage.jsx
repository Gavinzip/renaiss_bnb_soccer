import trophyCutout from "../assets/championship-trophy-renaiss-ai.png";
import { ShinyText } from "./ShinyText";

export function TrophyStage({
  champion,
  settlementStats,
  isConfirming = false,
  t,
  numberFormatter,
  teamName = (team) => team?.name ?? "",
}) {
  const metrics = [
    {
      id: "highest",
      label: t("trophy.highestConviction"),
      value: settlementStats?.highestTeam
        ? `${teamName(settlementStats.highestTeam)} ${numberFormatter.format(settlementStats.highestTeam.votes)}`
        : t("trophy.noSettlement"),
    },
    {
      id: "additive",
      label: t("trophy.additiveVotes"),
      value: numberFormatter.format(settlementStats?.additiveVotes ?? 0),
    },
    {
      id: "mine",
      label: t("trophy.myLiveVotes"),
      value: numberFormatter.format(settlementStats?.livePersonalVotes ?? 0),
    },
  ];

  return (
    <section className="trophy-stage" aria-label={t("trophy.aria")}>
      <img className="trophy-stage__image" src={trophyCutout} alt={t("trophy.imageAlt")} />
      <output className={isConfirming ? "trophy-stage__champion is-obscured" : "trophy-stage__champion"} aria-live="polite">
        <span>{t("trophy.championPick")}</span>
        <ShinyText as="strong">{champion ? teamName(champion) : t("trophy.awaitingVote")}</ShinyText>
      </output>
      <ul className="trophy-stage__telemetry" aria-label={t("trophy.settlementAria")}>
        {metrics.map((metric) => (
          <li className="trophy-stage__metric" key={metric.id}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
