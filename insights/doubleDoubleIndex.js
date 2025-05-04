import { getLast10DoubleDoubleHitRate } from "./last10DoubleDouble.js";
import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js";
import { getComboHomeAwaySplit } from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getTeamDefenseRankInsight } from "./getTeamDefenseRank.js";

export async function getDoubleDoubleInsights({
  playerId,
  playerName,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const statType = "double_double"; // used for context, not a real stat column
  const statColumns = ["pts", "reb", "ast"];

  const insights = {};

  // 1. Last 10 games hit rate
  insights.insight_1_hit_rate = await getLast10DoubleDoubleHitRate({
    playerId,
    statColumns,
    line: 2, // 2 categories with 10+ qualifies as double-double
    supabase,
  });

  // 2. Season avg vs last 3 in pts, reb, ast
  insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
    playerId,
    statColumns,
    supabase,
  });

  // 3–5. Team defense rank in pts, reb, ast allowed
  insights.def_rank_pts = await getTeamDefenseRankInsight({
    teamId: opponentTeamId,
    statType: "pts",
    supabase,
  });

  insights.def_rank_reb = await getTeamDefenseRankInsight({
    teamId: opponentTeamId,
    statType: "reb",
    supabase,
  });

  insights.def_rank_ast = await getTeamDefenseRankInsight({
    teamId: opponentTeamId,
    statType: "ast",
    supabase,
  });

  // 6. Home vs Away split
  insights.insight_6_home_away = await getComboHomeAwaySplit({
    playerId,
    teamId,
    statColumns,
    supabase,
  });

  // 7. Rest day performance
  insights.insight_7_rest_day = await getComboRestDayPerformance({
    playerId,
    statType,
    supabase,
  });

  return insights;
}
