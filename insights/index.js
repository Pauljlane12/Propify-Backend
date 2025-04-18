import { getLast10GameHitRate } from "./last10Games.js";
import { getSeasonVsLast3 } from "./seasonVsLast3.js";
import { getDefenseVsPosition } from "./defenseVsPosition.js";
import { getMatchupHistory } from "./matchupHistory.js";
import { getHomeAwaySplit } from "./homeAwaySplit.js";
import { getInjuryReport } from "./injuryReport.js";
import { getProjectedGamePace } from "./gamePace.js";
import { getTeamPaceRank } from "./teamPaceRank.js";
import { getOpponentFgPercentLast3 } from "./opponentFgPercentLast3.js";
import { getRestDayPerformance } from "./restDayPerformance.js";

export async function getInsightsForStat({
  playerId,
  statType,
  line,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};

  const statColumns = [statType]; // ✅ fix: define statColumns for insight_1

  // ✅ Shared across all props
  insights.insight_1_hit_rate = await getLast10GameHitRate({
    playerId,
    statType,
    statColumns, // ✅ now correctly defined
    line,
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
    supabase,
  });

  insights.insight_5_home_vs_away = await getHomeAwaySplit({
    playerId,
    teamId,
    statType,
    supabase,
  });

  insights.insight_7_injury_report = await getInjuryReport({
    teamId,
    opponentTeamId,
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

  return insights;
}
