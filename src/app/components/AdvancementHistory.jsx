import { ArrowRight } from "lucide-react";
import { AnimatedContent } from "./AnimatedContent";

function groupByStage(matchups) {
  return matchups.reduce((groups, matchup) => {
    const group = groups.find((entry) => entry.stageId === matchup.stageId);
    if (group) {
      group.matchups.push(matchup);
      return groups;
    }

    return [
      ...groups,
      {
        stageId: matchup.stageId,
        stageLabel: matchup.stageLabel,
        matchups: [matchup],
      },
    ];
  }, []);
}

export function AdvancementHistory({ matchups, activeStage, t, teamName = (team) => team?.name ?? "" }) {
  const stageGroups = groupByStage(matchups);

  return (
    <AnimatedContent
      as="aside"
      className="advancement-history"
      key={activeStage.id}
      distance={16}
      direction="vertical"
      duration={0.42}
      delay={0.04}
      aria-label={t("history.aria")}
    >
      <span className="advancement-history__kicker">{t("history.routeArchive")}</span>
      {stageGroups.length ? (
        <ol className="advancement-history__stages">
          {stageGroups.map((stageGroup) => (
            <li className="advancement-history__stage" key={stageGroup.stageId}>
              <span className="advancement-history__stage-label">{stageGroup.stageLabel}</span>
              <ol className="advancement-history__matches">
                {stageGroup.matchups.map((matchup) => (
                  <li className="advancement-history__match" key={matchup.id}>
                    <span className="advancement-history__winner">
                      <img src={matchup.winner.flagSrc} alt="" aria-hidden="true" />
                      <strong>{teamName(matchup.winner)}</strong>
                    </span>
                    <ArrowRight size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="advancement-history__loser">{teamName(matchup.loser)}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <span className="advancement-history__empty">{t("history.empty")}</span>
      )}
    </AnimatedContent>
  );
}
