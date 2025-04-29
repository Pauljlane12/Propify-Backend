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
import { getFgPercentTrend } from "./getFgPercentTrend.js"; // ✅ NEW

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

  // Only show for rebounds
  if (statType === "reb") {
    insights.advanced_metric_4_opponent_fg_last3 =
      await getOpponentFgPercentLast3({
        opponentTeamId,
        supabase,
      });
  }

  // Only show for points props
  if (statType === "pts") {
    insights.advanced_metric_4_fga_trend_last3 = await getFgaTrendLast3({
      playerId,
      supabase,
    });
  }

  // ✅ FG% trend — only for scoring statTypes (single props)
  if (["pts", "fgm", "fg3m", "ftm"].includes(statType)) {
    insights.advanced_metric_5_fg_percent_trend = await getFgPercentTrend({
      playerId,
      supabase,
    });
  }

  return insights;
}
