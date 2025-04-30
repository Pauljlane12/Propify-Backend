import { getLast10GameHitRate } from "./last10Games.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js";
import { getFgPercentTrend } from "./getFgPercentTrend.js";
import { getUsageRateTrend } from "./getUsageRateTrend.js";
import { getTeamDefRatingRank } from "./getTeamDefRatingRank.js";
import { getScoringSourceVs3ptDefense } from "./getScoringSourceVs3ptDefense.js";
import { getFgTrendLast3ForBothTeams } from "./getFgTrendLast3ForBothTeams.js"; // ✅ NEW

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
  console.log(
    `🔍 getInsightsForStat: Determined playerLastName as "${playerLastName}" from playerName "${playerName}"`
  );

  const statColumns = [statType];

  insights.insight_1_hit_rate = await getLast10GameHitRate({
    playerId,
    playerLastName,
    statType,
    statColumns,
    line,
    direction,
    supabase,
  });

  insights.insight_2_season_vs_last3 = await getSeasonVsLast3({
    playerId,
    statType,
    supabase,
  });

  insights.insight_3_positional_defense = await getDefenseVsPosition({
    playerId,
    statType,
    teamId,
    opponentTeamId,
    supabase,
  });

  insights.insight_4_matchup_history = await getMatchupHistory({
    playerId,
    opponentTeamId,
    statType,
    bettingLine: line,
    supabase,
  });

  insights.insight_5_home_vs_away = await getHomeAwaySplit({
    playerId,
    teamId,
    statType,
    supabase,
  });

  insights.advanced_metric_1_projected_game_pace = await getProjectedGamePace({
    teamId,
    opponentTeamId,
    supabase,
  });

  insights.advanced_metric_2_opponent_pace_rank = await getTeamPaceRank({
    opponentTeamId,
    supabase,
  });

  insights.rest_day_performance = await getRestDayPerformance({
    playerId,
    teamId,
    statType,
    supabase,
  });

  if (statType === "reb") {
    insights.advanced_metric_4_opponent_fg_last3 = await getOpponentFgPercentLast3({
      opponentTeamId,
      supabase,
    });

    insights.advanced_metric_7_fg_trend_both_teams = await getFgTrendLast3ForBothTeams({
      teamId,
      opponentTeamId,
      supabase,
    });
  }

  if (statType === "pts") {
    insights.advanced_metric_4_fga_trend_last3 = await getFgaTrendLast3({
      playerId,
      supabase,
    });

    insights.advanced_metric_9_3pt_scoring_vs_defense = await getScoringSourceVs3ptDefense({
      playerId,
      opponentTeamId,
      supabase,
    });
  }

  if (["pts", "fgm", "fg3m", "ftm"].includes(statType)) {
    insights.advanced_metric_5_fg_percent_trend = await getFgPercentTrend({
      playerId,
      supabase,
    });

    insights.advanced_metric_6_usage_rate_trend = await getUsageRateTrend({
      playerId,
      supabase,
    });

    insights.advanced_metric_8_team_def_rating_rank = await getTeamDefRatingRank({
      opponentTeamId,
      supabase,
    });
  }

  return insights;
}
