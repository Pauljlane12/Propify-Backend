import { getLast10GameHitRate } from "./last10Games.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";
import { getFgaTrendLast3 } from "./fgaTrendLast3.js"; // ✅ New import

export async function getInsightsForStat({
  playerId,
  statType,
  line,
  direction,        // ✅ NEW
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};

  const statColumns = [statType];

  // ✅ Hit Rate - now direction-aware
  insights.insight_1_hit_rate = await getLast10GameHitRate({
    playerId,
    statType,
    statColumns,
    line,
    direction,      // ✅ Pass direction to support over/under logic
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

  // ✅ Matchup history — already fixed
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

  // 🔍 Advanced Metrics (all props)
  insights.advanced_metric_1_projected_game_pace = await getProjectedGamePace({
    teamId,
    opponentTeamId,
    supabase,
  });

  insights.advanced_metric_2_opponent_pace_rank = await getTeamPaceRank({
    opponentTeamId,
    supabase,
  });

  // 🧠 Rest Day Insight (applies to ALL stat types)
  insights.rest_day_performance = await getRestDayPerformance({
    playerId,
    teamId,
    statType,
    supabase,
  });

  // 🧠 Rebound-specific advanced insight
  if (statType === "reb") {
    insights.advanced_metric_4_opponent_fg_last3 = await getOpponentFgPercentLast3({
      opponentTeamId,
      supabase,
    });
  }

  // 🧠 Points-specific advanced insight
  if (statType === "pts") {
    insights.advanced_metric_4_fga_trend_last3 = await getFgaTrendLast3({
      playerId,
      supabase,
    });
  }

  return insights;
}
