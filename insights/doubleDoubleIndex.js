import { getLast10DoubleDoubleHitRate } from "./last10DoubleDouble.js"; // Reused for triple doubles
import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js";
import { getComboHomeAwaySplit } from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getTeamDefenseRankInsight } from "./getTeamDefenseRank.js";
import { getComboPaceContext } from "./paceContextCombo.js"; 
import { getTeamDefRatingRank } from "./getTeamDefRatingRank.js"; 

export async function getTripleDoubleInsights({
  playerId,
  playerName,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const statType = "triple_double";
  const statColumns = ["pts", "reb", "ast"];

  const insights = {};

  // 1. Last 10 Triple-Doubles
  insights.insight_1_hit_rate = await getLast10DoubleDoubleHitRate({
    playerId,
    statColumns,
    line: 3, // 3 categories with 10+ qualifies as triple-double
    supabase,
  });

  // 2. Season vs Last 3 Game Averages (PTS, REB, AST)
  insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
    playerId,
    statColumns,
    supabase,
  });

  // 3–5. Opponent Defense Ranks (PTS, REB, AST)
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

  // 6. Home vs Away Performance
  insights.insight_6_home_away = await getComboHomeAwaySplit({
    playerId,
    teamId,
    statColumns,
    supabase,
  });

  // 7. Rest Day Performance
  insights.insight_7_rest_day = await getComboRestDayPerformance({
    playerId,
    statType,
    supabase,
  });

  // 8. Projected Game Pace (both teams)
  insights.insight_8_projected_pace = await getComboPaceContext({
    opponentTeamId,
    supabase,
  });

  // 9. Opponent Team Defensive Rating
  insights.insight_9_def_rating = await getTeamDefRatingRank({
    opponentTeamId,
    supabase,
  });

  return insights;
}
