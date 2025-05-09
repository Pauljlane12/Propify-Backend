import { getLast10GameHitRate } from "./last10Games.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js";
import { getFgPercentTrend } from "./getFgPercentTrend.js";
import { getUsageRateTrend } from "./getUsageRateTrend.js";
import { getScoringSourceVs3ptDefense } from "./getScoringSourceVs3ptDefense.js";
import { getFgTrendLast3ForBothTeams } from "./getFgTrendLast3ForBothTeams.js";
import { getFg3aTrend } from "./getFg3aTrend.js";
import { getOpponentFoulTendencies } from "./getOpponentFoulTendencies.js";
import { getOpponentStealsRank } from "./getOpponentStealsRank.js";
import { getTeamDefenseRankInsight } from "./getTeamDefenseRank.js";
import { getPaceAdjustedPerformance } from "./getPaceAdjustedPerformance.js";
import { getStatWithImpactPlayerOut } from "./statWithImpactPlayerOut.js"; // ✅ NEW

const getLastName = (name) => {
  if (!name) return "Player";
  const parts = name.trim().split(" ");
  const lastName = parts.length > 1 ? parts[parts.length - 1] : name;
  return lastName.charAt(0).toUpperCase() + lastName.slice(1);
};

export async function getInsightsForStat({
  playerId,
  playerName,
  statType,
  line,
  direction,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};
  const playerLastName = getLastName(playerName);

  insights.insight_1_hit_rate = await getLast10GameHitRate({
    playerId,
    playerLastName,
    statType,
    statColumns: [statType],
    line,
    direction,
    supabase,
  });

  insights.insight_2_season_vs_last3 = await getSeasonVsLast3({
    playerId,
    statType,
    playerLastName,
    supabase,
  });

  insights.insight_3_positional_defense = await getDefenseVsPosition({
    playerId,
    statType,
    teamId,
    opponentTeamId,
    playerLastName,
    supabase,
  });

  insights.insight_4_matchup_history = await getMatchupHistory({
    playerId,
    playerName,
    playerLastName,
    opponentTeamId,
    statType,
    bettingLine: line,
    supabase,
  });

  insights.insight_5_home_vs_away = await getHomeAwaySplit({
    playerId,
    teamId,
    statType,
    playerLastName,
    supabase,
  });

  insights.impact_of_injured_teammates = await getStatWithImpactPlayerOut({
    playerId,
    playerLastName,
    statType,
    supabase,
  });

  insights.advanced_metric_2_pace_adjusted_performance = await getPaceAdjustedPerformance({
    playerId,
    playerLastName,
    opponentTeamId,
    statType,
    supabase,
  });

  insights.rest_day_performance = await getRestDayPerformance({
    playerId,
    teamId,
    statType,
    playerLastName,
    supabase,
  });

  if (statType === "pts") {
    insights.advanced_metric_4_fga_trend_last3 = await getFgaTrendLast3({
      playerId,
      playerLastName,
      supabase,
    });

    insights.advanced_metric_9_3pt_scoring_vs_defense = await getScoringSourceVs3ptDefense({
      playerId,
      opponentTeamId,
      playerLastName,
      supabase,
    });
  }

  if (["pts", "fgm", "fg3m", "ftm"].includes(statType)) {
    insights.advanced_metric_5_fg_percent_trend = await getFgPercentTrend({
      playerId,
      playerLastName,
      supabase,
    });

    insights.advanced_metric_6_usage_rate_trend = await getUsageRateTrend({
      playerId,
      playerLastName,
      supabase,
    });
  }

  if (["fg3a", "fg3m"].includes(statType)) {
    insights.advanced_metric_10_fg3a_trend = await getFg3aTrend({
      playerId,
      playerLastName,
      supabase,
    });
  }

  if (statType === "ftm") {
    insights.advanced_metric_10_opponent_foul_tendencies = await getOpponentFoulTendencies({
      opponentTeamId,
      supabase,
    });
  }

  if (statType === "turnover") {
    insights.advanced_metric_11_opponent_steals_rank = await getOpponentStealsRank({
      opponentTeamId,
      supabase,
    });
  }

  if (["pts", "reb", "ast", "blk", "stl", "fg3m", "fg3a", "turnover"].includes(statType)) {
    insights.advanced_metric_12_team_defense_rank = await getTeamDefenseRankInsight({
      teamId: opponentTeamId,
      statType,
      playerLastName,
      supabase,
    });
  }

  return insights;
}
