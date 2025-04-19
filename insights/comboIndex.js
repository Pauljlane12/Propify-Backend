import { getLast10ComboHitRate } from "./last10Combo.js";
import { getSeasonVsLast3Combo } from "./seasonVsLast3Combo.js";
import { getMatchupHistoryCombo } from "./matchupHistoryCombo.js";
import { getComboHomeAwaySplit } from "./homeAwaySplitCombo.js";
import { getComboRestDayPerformance } from "./restDayPerformanceCombo.js";
import { getComboPaceContext } from "./paceContextCombo.js";

export async function getComboInsights({
  playerId,
  statType,
  statColumns,
  line,
  teamId,
  opponentTeamId,
  supabase,
}) {
  const insights = {};

  console.log("📦 [Combo] Running insights for:", statType);

  try {
    // ✅ Insight 1 — Last 10 Game Hit Rate (Combo)
    insights.insight_1_hit_rate = await getLast10ComboHitRate({
      playerId,
      statColumns,
      line,
      supabase,
    });

    // ✅ Insight 2 — Season Avg vs Last 3 Games (Combo)
    insights.insight_2_season_vs_last3 = await getSeasonVsLast3Combo({
      playerId,
      statColumns,
      supabase,
    });

    // ✅ Insight 3 — Matchup History (Current + Previous Season)
    insights.insight_3_matchup_history = await getMatchupHistoryCombo({
      playerId,
      opponentTeamId,
      statColumns,
      supabase,
    });

    // ✅ Insight 4 — Home vs Away Split (Combo)
    insights.insight_4_home_away_split = await getComboHomeAwaySplit({
      playerId,
      teamId,
      statColumns,
      supabase,
    });

    // ✅ Insight 5 — Rest Day Performance (Combo)
    insights.insight_5_rest_day_performance = await getComboRestDayPerformance({
      playerId,
      statType,
      supabase,
    });

    // ✅ Insight 6 — Opponent Pace Context (Combo)
    insights.insight_6_pace_context = await getComboPaceContext({
      opponentTeamId,
      supabase,
    });

  } catch (err) {
    console.error("❌ Combo insights failed:", err.message);
    return { error: err.message };
  }

  return insights;
}
